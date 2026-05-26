import os
import sys
import wave
import json
import numpy as np

sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
from audio_analyzer import AudioAnalyzer

def run_observation():
    wav_path = sys.argv[1] if len(sys.argv) > 1 else "complex_test_source.wav"
    truth_path = sys.argv[2] if len(sys.argv) > 2 else "complex_ground_truth.json"
    
    if not os.path.exists(wav_path) or not os.path.exists(truth_path):
        print(f"Missing calibration files: {wav_path} or {truth_path}. Run generator first.")
        return

    with open(truth_path, 'r') as f:
        truth = json.load(f)
        
    wf = wave.open(wav_path, 'rb')
    n_channels = wf.getnchannels()
    sampwidth = wf.getsampwidth()
    framerate = wf.getframerate()
    
    analyzer = AudioAnalyzer()
    analyzer.gain = 1.0
    
    block_size = 2048
    frame_count = 0
    
    detected_kicks = []
    detected_snares = []
    detected_cymbals = []
    
    # We will log states to evaluate harmonic active windows
    times = []
    bass_h_vals = []
    mid_h_vals = []
    high_h_vals = []
    
    scale = 32768.0 if sampwidth == 2 else 2147483648.0
    
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
        state = analyzer.process(audio_data, now=t)
        
        times.append(t)
        bass_h_vals.append(state['bass_h'])
        mid_h_vals.append(state['mid_h'])
        high_h_vals.append(state['high_h'])
        
        hit = state.get('hit_type', 'NONE')
        if hit in ('KICK', 'KICK+SNARE'):
            detected_kicks.append(t)
        if hit in ('SNARE', 'KICK+SNARE'):
            detected_snares.append(t)
        if hit == 'CYMBAL':
            detected_cymbals.append(t)
        
        frame_count += 1
        
    wf.close()
    
    # Evaluate matches (tolerance 150ms)
    def evaluate_hits(truth_times, detected_times, name):
        matches = 0
        missed = []
        for gt in truth_times:
            if not detected_times:
                missed.append(gt)
                continue
            closest = min(detected_times, key=lambda dt: abs(dt - gt))
            if abs(closest - gt) < 0.150:
                matches += 1
            else:
                missed.append(gt)
                
        precision = matches / len(detected_times) if detected_times else 0.0
        recall = matches / len(truth_times) if truth_times else 0.0
        
        # Calculate false positives (detected hits with no matching ground truth)
        false_positives = []
        for dt in detected_times:
            closest_gt = min(truth_times, key=lambda gt: abs(dt - gt)) if truth_times else 999
            if abs(closest_gt - dt) >= 0.150:
                false_positives.append(dt)
                
        print(f"\n--- {name.upper()} HIT CLASSIFICATION ---")
        print(f"Ground Truth Hits: {len(truth_times)}")
        print(f"Detected Hits:     {len(detected_times)}")
        print(f"Matched Hits:      {matches}")
        print(f"Missed Hits:       {len(missed)} {missed[:10]}...")
        print(f"False Positives:   {len(false_positives)} {false_positives[:10]}...")
        print(f"Recall:            {recall*100:.1f}%")
        print(f"Precision:         {precision*100:.1f}%")
        
    evaluate_hits(truth['percussive_ground_truth']['kick_drum_hits_seconds'], detected_kicks, "Kick")
    evaluate_hits(truth['percussive_ground_truth']['snare_drum_hits_seconds'], detected_snares, "Snare")
    evaluate_hits(truth['percussive_ground_truth']['hihat_cymbal_hits_seconds'], detected_cymbals, "Cymbal/Hat")
    
    # Evaluate Harmonic content during active vs inactive windows
    def evaluate_harmonic(times, vals, active_windows, name):
        active_vals = []
        inactive_vals = []
        
        for t, val in zip(times, vals):
            is_active = False
            for w in active_windows:
                if w['start_sec'] <= t < w['end_sec']:
                    is_active = True
                    break
            if is_active:
                active_vals.append(val)
            else:
                inactive_vals.append(val)
                
        avg_active = sum(active_vals) / len(active_vals) if active_vals else 0.0
        avg_inactive = sum(inactive_vals) / len(inactive_vals) if inactive_vals else 0.0
        
        print(f"\n--- HARMONIC {name.upper()} BANDS ---")
        print(f"Avg Active Level:   {avg_active:.4f}")
        print(f"Avg Inactive Level: {avg_inactive:.4f}")
        print(f"Separation Ratio:   {avg_active / (avg_inactive + 1e-6):.2f}x")

    def get_bin_windows(prefix):
        for k in truth['harmonic_ground_truth_bins']:
            if k.startswith(prefix):
                return truth['harmonic_ground_truth_bins'][k]
        return []

    evaluate_harmonic(times, bass_h_vals, get_bin_windows('bin_1_sub_bass'), "Bass Harmonic")
    evaluate_harmonic(times, mid_h_vals, get_bin_windows('bin_2'), "Mid Harmonic")
    evaluate_harmonic(times, high_h_vals, get_bin_windows('bin_3'), "High Harmonic")

if __name__ == "__main__":
    run_observation()
