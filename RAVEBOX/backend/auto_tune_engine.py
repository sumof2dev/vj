import sys
import os
import json
import random
import time
import math
import collections

# Attempt to load librosa/numpy
try:
    import numpy as np
    import librosa
except ModuleNotFoundError:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    venv_python = None
    for venv in ['venv_local', 'venv', '.venv']:
        p = os.path.join(base_dir, venv, 'bin', 'python3')
        if os.path.isfile(p):
            venv_python = p
            break
    if venv_python and sys.executable != venv_python:
        os.execv(venv_python, [venv_python] + sys.argv)
    else:
        raise

# Import engines
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from vibe_engine import VibeEngine
from audio_analyzer import AudioAnalyzer

def calculate_overlap(engine_log, corrections):
    """
    Calculate an F-measure or Intersection-over-Union style score 
    for how well the engine_log matches the manual corrections.
    """
    if not corrections:
        return 0.0

    score = 0.0
    total_duration = 0.0
    
    # We evaluate at 10Hz resolution
    dt = 0.1
    
    min_t = min(c['s'] for c in corrections)
    max_t = max(c['e'] for c in corrections)
    
    t = min_t
    while t <= max_t:
        total_duration += dt
        
        # What is the truth label at t?
        truth_label = 'steady'
        for c in corrections:
            if c['s'] <= t <= c['e']:
                truth_label = c['label']
                break
                
        # What is the engine label at eval_t?
        # Shift transient evaluation by +2.5s to compensate for 1800-frame causal lookback delay
        is_transient = truth_label in ['building', 'tension', 'dropping']
        eval_t = t + 2.5 if is_transient else t
        
        engine_label = 'steady'
        # find closest log entry
        for entry in reversed(engine_log):
            if entry['t'] <= eval_t:
                engine_label = entry['state']
                break
                
        # Vibe vs Transient labels
        # corrections can be 'building', 'tension', 'dropping', 'steady' (transients)
        # or 'chill', 'mid', 'high' (vibes).
        # We simplify by just comparing strings
        
        if truth_label == engine_label:
            score += dt
        elif truth_label in ['chill', 'mid', 'high'] and engine_label in ['chill', 'mid', 'high']:
            # Partial credit if it's off by 1?
            pass
            
        t += dt

    if total_duration == 0:
        return 0.0
        
    return score / total_duration

def generate_dmx_snippet(audio_path, start_t, end_t, params):
    """Run audio_analyzer over a snippet of audio with specific parameters."""
    analyzer = AudioAnalyzer()
    analyzer.p = params
    analyzer.hot_reload() # Force apply params
    
    y, sr = librosa.load(audio_path, sr=44100, mono=False, offset=start_t, duration=end_t-start_t)
    if y.ndim == 1:
        y = np.expand_dims(y, axis=1)
    else:
        y = y.T # Librosa returns (channels, samples), audio_analyzer expects (samples, channels)
        
    hop_length = 735 # 44100 / 60 = 735 samples per frame
    
    frames = []
    num_frames = len(y) // hop_length
    
    for i in range(num_frames):
        chunk = y[i*hop_length : (i+1)*hop_length, :]
        now = start_t + (i / 60.0)
        state = analyzer.process(chunk, now=now)
        frames.append({"t": now, "a": state})
        
    return frames

def run_tuner(session_name):
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    rec_dir = os.path.join(base_dir, 'recordings', session_name)
    train_dir = os.path.join(base_dir, 'training_data')
    config_path = os.path.join(base_dir, 'tuning_config', 'engine_params.json')
    
    # 1. Load current parameters
    current_params = {}
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            current_params = json.load(f)
            
    # 2. Find latest training data for session
    latest_training = None
    latest_time = 0
    if os.path.exists(train_dir):
        for fname in os.listdir(train_dir):
            if fname.endswith('.json'):
                fpath = os.path.join(train_dir, fname)
                with open(fpath, 'r') as f:
                    try:
                        data = json.load(f)
                        if data.get('session') == session_name:
                            mtime = os.path.getmtime(fpath)
                            if mtime > latest_time:
                                latest_time = mtime
                                latest_training = data
                    except Exception:
                        pass
                        
    if not latest_training or not latest_training.get('corrections'):
        return {"error": "No training corrections found for session."}
        
    corrections = latest_training['corrections']
    
    # 3. Determine time bounds
    min_t = max(0, min(c['s'] for c in corrections) - 10.0) # 10 seconds of warmup
    max_t = max(c['e'] for c in corrections) + 2.0
    
    # 4. Load Audio & extract Snippet
    audio_path = os.path.join(rec_dir, 'audio.wav')
    has_audio = os.path.exists(audio_path)
    
    # If no audio, we can only tune VibeEngine using dmx.json
    dmx_path = os.path.join(rec_dir, 'dmx.json')
    base_frames = []
    if os.path.exists(dmx_path):
        with open(dmx_path, 'r') as f:
            full_dmx = json.load(f)
            base_frames = [f for f in full_dmx if min_t <= f['t'] <= max_t]
            
    # 5. Define Parameter Space
    param_space = {
        "building_trend": [0.1, 0.2, 0.25, 0.3, 0.4],
        "building_energy": [0.2, 0.3, 0.35, 0.4, 0.5],
        "tension_drop": [0.5, 0.6, 0.7, 0.8],
        "drop_impact": [0.3, 0.4, 0.5, 0.6],
        "drop_spike": [0.15, 0.25, 0.30, 0.40]
    }
    
    if has_audio:
        param_space.update({
            "hpss_window": [3, 5, 7, 9],
            "hpss_freq_kernel": [11, 15, 19],
            "eq_bass_offset": [0.0, 0.05, 0.08, 0.12]
        })
        
    # 6. Random Search
    best_score = -1.0
    best_params = current_params.copy()
    
    ITERATIONS = 40 if has_audio else 100
    
    for i in range(ITERATIONS):
        # Generate random parameter set
        test_params = current_params.copy()
        changed = False
        audio_params_changed = False
        for k, v_list in param_space.items():
            val = random.choice(v_list)
            if test_params.get(k) != val:
                changed = True
                if k in ["hpss_window", "hpss_freq_kernel", "eq_bass_offset"]:
                    audio_params_changed = True
            test_params[k] = val
            
        # Run simulation
        if has_audio and audio_params_changed:
            frames = generate_dmx_snippet(audio_path, min_t, max_t, test_params)
        else:
            frames = base_frames
            
        engine = VibeEngine()
        engine.p = test_params
        engine.hot_reload()
        
        engine_log = []
        for f in frames:
            res = engine.update(f['a'], now=f['t'])
            # Which state are we trying to optimize? Usually transient
            engine_log.append({"t": f['t'], "state": res['transient'] if res['transient'] != 'steady' else res['vibe']})
            # To handle both vibes and transients in the same log, we might want to evaluate them separately.
            # For simplicity, if truth label is a vibe, we evaluate vibe. If truth label is transient, we evaluate transient.
            # Our calculate_overlap will check string match. So we can just append a combined log.
            # Let's save both
            engine_log[-1]['vibe'] = res['vibe']
            engine_log[-1]['transient'] = res['transient']
            
        # Re-evaluate score matching truth to either vibe or transient
        score = 0.0
        dt = 0.1
        t = min_t
        total_duration = 0.0
        while t <= max_t:
            total_duration += dt
            
            # Find truth
            truth_label = 'steady'
            for c in corrections:
                if c['s'] <= t <= c['e']:
                    truth_label = c['label']
                    break
                    
            if truth_label != 'steady':
                # Shift transient evaluation by +2.5s to compensate for 1800-frame causal lookback delay
                is_transient = truth_label in ['building', 'tension', 'dropping']
                eval_t = t + 2.5 if is_transient else t
                
                # Find engine state
                closest = None
                for entry in reversed(engine_log):
                    if entry['t'] <= eval_t:
                        closest = entry
                        break
                        
                if closest:
                    if truth_label in ['building', 'tension', 'dropping']:
                        if closest['transient'] == truth_label:
                            score += dt
                    elif truth_label in ['chill', 'mid', 'high']:
                        if closest['vibe'] == truth_label:
                            score += dt
            t += dt
            
        if total_duration > 0:
            final_score = score / total_duration
            if final_score > best_score:
                best_score = final_score
                best_params = test_params.copy()
                
    # 7. Generate Diff & Save
    diff = {}
    for k, v in best_params.items():
        old_v = current_params.get(k)
        if old_v != v:
            diff[k] = {"old": old_v, "new": v}
            
    if diff:
        # Save to tuning config
        with open(config_path, 'w') as f:
            json.dump(best_params, f, indent=4)
            
        # Save to history
        hist_dir = os.path.join(base_dir, 'tuning_config', 'history')
        if not os.path.exists(hist_dir):
            os.makedirs(hist_dir)
            
        ts = int(time.time() * 1000)
        hist_file = os.path.join(hist_dir, f"vibe_config_{ts}.json")
        with open(hist_file, 'w') as f:
            json.dump({"timestamp": ts, "session": session_name, "params": best_params, "diff": diff, "score": best_score}, f, indent=4)
            
    return {"status": "ok", "diff": diff, "score": best_score}

if __name__ == "__main__":
    if len(sys.argv) > 1:
        res = run_tuner(sys.argv[1])
        print(json.dumps(res, indent=2))
