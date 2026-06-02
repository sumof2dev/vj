import os
import sys
import wave
import json
import numpy as np

sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
from audio_analyzer import AudioAnalyzer

def load_ground_truth(truth_path):
    with open(truth_path, 'r') as f:
        return json.load(f)

def extract_frames(wav_path):
    wf = wave.open(wav_path, 'rb')
    n_channels = wf.getnchannels()
    sampwidth = wf.getsampwidth()
    framerate = wf.getframerate()
    scale = 32768.0 if sampwidth == 2 else 2147483648.0
    block_size = 2048
    
    analyzer = AudioAnalyzer()
    analyzer.gain = 1.0
    
    frames = []
    frame_count = 0
    
    while True:
        data = wf.readframes(block_size)
        if not data:
            break
        audio_data = np.frombuffer(data, dtype=np.int16).astype(np.float32) / scale
        if n_channels == 2:
            if len(audio_data) % 2 != 0:
                audio_data = audio_data[:-(len(audio_data) % 2)]
            audio_data = audio_data.reshape(-1, 2)
        else:
            audio_data = audio_data.reshape(-1, 1)
            
        if len(audio_data) < block_size:
            pad_len = block_size - len(audio_data)
            audio_data = np.pad(audio_data, ((0, pad_len), (0, 0)) if n_channels == 2 else ((0, pad_len),), 'constant')
            
        t = frame_count * block_size / float(framerate)
        
        # We need to extract the intermediate variables inside process()
        # To do this cleanly, we'll let process run, but we will grab the state and inputs we need
        # We can extract them from the analyzer's updated state
        state = analyzer.process(audio_data, now=t)
        
        # Access the private/internal variables we populated in the analyzer
        # Since we modified audio_analyzer.py to use instance variables, let's grab what we need
        # Note: we need to know the attacks_p, raw_bins_p, cumulative_bins_p_max, pll_period, etc.
        # Let's extract them from the analyzer. We can write a tiny wrapper or read the internal attributes.
        # Let's see: we want to capture:
        # - kick_score, snare_score, cymbal_score
        # - raw_bins_p
        # - cumulative_bins_p_max
        # - pll_period
        # - timestamp
        
        # Let's reconstruct them or read them.
        # We can inspect analyzer.prev_raw_bins_p or state bins.
        # Wait, since the analyzer process already ran, we can just save these values!
        # Let's see what is stored on analyzer at the end of process():
        # - self.prev_raw_bins_p (corresponds to raw_bins_p)
        # - self.cumulative_bins_p_max
        # - self.pll_period
        
        # For scores, let's compute them from attacks_p.
        # In process():
        # attacks_p = [max(0.0, raw_bins_p[i] - self.prev_raw_bins_p[i]) for i in range(6)]
        # We can do this extraction post-process or store them in process()
        # Since we can just run the simulation inside process directly, or run the sweep by instantiating 
        # a new analyzer for each parameter set, let's see which is simpler!
        # Instantiating a new analyzer and processing the whole file only takes 0.15 seconds.
        # Running a grid of 100 parameter sets takes 15 seconds. This is extremely simple and requires no code duplication!
        # Let's write the sweep to instantiate a new AudioAnalyzer, set parameters, and process the file.
        
        frames.append((audio_data, t))
        frame_count += 1
        
    wf.close()
    return frames

def evaluate_hits(truth_times, detected_times):
    matches = 0
    for gt in truth_times:
        if not detected_times:
            continue
        closest = min(detected_times, key=lambda dt: abs(dt - gt))
        if abs(closest - gt) < 0.150:
            matches += 1
            
    precision = matches / len(detected_times) if detected_times else 0.0
    recall = matches / len(truth_times) if truth_times else 0.0
    
    # F-score
    if precision + recall > 0:
        f_score = 2 * (precision * recall) / (precision + recall)
    else:
        f_score = 0.0
        
    # Calculate false positives
    false_positives = 0
    for dt in detected_times:
        closest_gt = min(truth_times, key=lambda gt: abs(dt - gt)) if truth_times else 999
        if abs(closest_gt - dt) >= 0.150:
            false_positives += 1
            
    return recall, precision, f_score, false_positives

def run_sweep():
    wav_path = "complex_test_source.wav"
    truth_path = "complex_ground_truth.json"
    
    if not os.path.exists(wav_path) or not os.path.exists(truth_path):
        print("Missing files.")
        return
        
    truth = load_ground_truth(truth_path)
    gt_kicks = truth['percussive_ground_truth']['kick_drum_hits_seconds']
    gt_snares = truth['percussive_ground_truth']['snare_drum_hits_seconds']
    gt_cymbals = truth['percussive_ground_truth']['hihat_cymbal_hits_seconds']
    
    print("Loading audio frames...")
    frames = extract_frames(wav_path)
    print(f"Loaded {len(frames)} frames.")
    
    # We want to sweep:
    # 1. kick_threshold (default 0.18)
    # 2. cymbal_threshold (default 0.12)
    # 3. snare_threshold_low (default 0.22)
    # 4. snare_threshold_high (default 0.38)
    # 5. kick_peak_gate (default 0.35)
    # 6. snare_peak_gate (default 0.15)
    
    # Let's perform a step-wise search to keep it fast
    # First, let's sweep kick parameters
    best_kick_f = 0.0
    best_kick_params = {}
    
    print("\nSweeping Kick parameters...")
    for kt in [0.18, 0.22, 0.25, 0.28, 0.32]:
        for kpg in [0.30, 0.35, 0.40, 0.45, 0.50]:
            analyzer = AudioAnalyzer()
            analyzer.gain = 1.0
            analyzer.kick_threshold = kt
            analyzer.kick_peak_gate = kpg
            
            detected = []
            for audio_data, t in frames:
                state = analyzer.process(audio_data, now=t)
                hit = state.get('hit_type', 'NONE')
                if hit in ('KICK', 'KICK+SNARE'):
                    detected.append(t)
            
            rec, prec, f, fp = evaluate_hits(gt_kicks, detected)
            if f > best_kick_f or (f == best_kick_f and fp < best_kick_params.get('fp', 999)):
                best_kick_f = f
                best_kick_params = {'kt': kt, 'kpg': kpg, 'rec': rec, 'prec': prec, 'fp': fp}
                
    print("Best Kick Params:", best_kick_params)
    
    # Next, let's sweep Snare parameters
    best_snare_f = 0.0
    best_snare_params = {}
    
    print("\nSweeping Snare parameters...")
    for stl in [0.22, 0.26, 0.30, 0.35, 0.40]:
        for sth in [0.38, 0.42, 0.46, 0.50, 0.55]:
            for spg in [0.15, 0.20, 0.25, 0.30, 0.35]:
                # Use the best kick params to keep the context consistent
                analyzer = AudioAnalyzer()
                analyzer.gain = 1.0
                analyzer.kick_threshold = best_kick_params['kt']
                analyzer.kick_peak_gate = best_kick_params['kpg']
                analyzer.snare_threshold_low = stl
                analyzer.snare_threshold_high = sth
                analyzer.snare_peak_gate = spg
                
                detected = []
                for audio_data, t in frames:
                    state = analyzer.process(audio_data, now=t)
                    hit = state.get('hit_type', 'NONE')
                    if hit in ('SNARE', 'KICK+SNARE'):
                        detected.append(t)
                        
                rec, prec, f, fp = evaluate_hits(gt_snares, detected)
                if f > best_snare_f or (f == best_snare_f and fp < best_snare_params.get('fp', 999)):
                    best_snare_f = f
                    best_snare_params = {'stl': stl, 'sth': sth, 'spg': spg, 'rec': rec, 'prec': prec, 'fp': fp}
                    
    print("Best Snare Params:", best_snare_params)
    
    # Finally, sweep Cymbal parameters
    best_cym_f = 0.0
    best_cym_params = {}
    
    print("\nSweeping Cymbal parameters...")
    for ct in [0.12, 0.15, 0.18, 0.22, 0.26, 0.30]:
        analyzer = AudioAnalyzer()
        analyzer.gain = 1.0
        analyzer.kick_threshold = best_kick_params['kt']
        analyzer.kick_peak_gate = best_kick_params['kpg']
        analyzer.snare_threshold_low = best_snare_params['stl']
        analyzer.snare_threshold_high = best_snare_params['sth']
        analyzer.snare_peak_gate = best_snare_params['spg']
        analyzer.cymbal_threshold = ct
        
        detected = []
        for audio_data, t in frames:
            state = analyzer.process(audio_data, now=t)
            hit = state.get('hit_type', 'NONE')
            if hit == 'CYMBAL':
                detected.append(t)
                
        rec, prec, f, fp = evaluate_hits(gt_cymbals, detected)
        if f > best_cym_f or (f == best_cym_f and fp < best_cym_params.get('fp', 999)):
            best_cym_f = f
            best_cym_params = {'ct': ct, 'rec': rec, 'prec': prec, 'fp': fp}
            
    print("Best Cymbal Params:", best_cym_params)
    
if __name__ == "__main__":
    run_sweep()
