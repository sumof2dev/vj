import sys
import os
import json
import numpy as np
import librosa

# Add backend to path
sys.path.append(os.path.abspath("backend"))
from audio_analyzer import AudioAnalyzer
from offline_audit_engine import OfflineAuditEngine

audio_path = "recordings/REC_20260527_073848/audio.wav"
y, sr = librosa.load(audio_path, sr=44100, mono=False)
if y.ndim == 1:
    y = np.expand_dims(y, axis=0)
y = y.T

# Get ground truth beat times
audit_engine = OfflineAuditEngine()
truth = audit_engine.analyze_ground_truth(audio_path)
truth_beats = truth["beat_times"]
print(f"Ground truth beats: {len(truth_beats)} (BPM: {truth['global_bpm']:.2f})")

block_size = 2048
num_blocks = len(y) // block_size

def run_simulation(mult, abs_thresh, lockout_ratio, pll_corr):
    analyzer = AudioAnalyzer()
    analyzer.flux_threshold_mult = mult
    analyzer.flux_threshold_abs = abs_thresh
    analyzer.lockout_ratio = lockout_ratio
    analyzer.pll_correction = pll_corr
    
    sim_beats = []
    for i in range(num_blocks):
        block = y[i*block_size:(i+1)*block_size]
        t = (i * block_size) / sr
        state = analyzer.process(block, now=t)
        if state["beat"]:
            sim_beats.append(t)
            
    # Match beats
    _, prec, rec, f = audit_engine._match_beats(sim_beats, truth_beats)
    return len(sim_beats), prec, rec, f

# Grid search
print("Starting grid search...")
best_f = 0
best_params = None

for mult in [1.3, 1.5, 1.7, 2.0, 2.3, 2.5]:
    for abs_thresh in [0.15, 0.20, 0.25, 0.30, 0.35]:
        for lockout in [0.45, 0.50, 0.55, 0.60, 0.65]:
            for corr in [0.15, 0.25, 0.35, 0.45]:
                count, prec, rec, f = run_simulation(mult, abs_thresh, lockout, corr)
                if f > best_f:
                    best_f = f
                    best_params = (mult, abs_thresh, lockout, corr, count, prec, rec)
                    print(f"New best: F={f*100:.1f}% | mult={mult}, abs={abs_thresh}, lockout={lockout}, corr={corr} | count={count}, P={prec*100:.1f}%, R={rec*100:.1f}%")

print("\nBest Parameters found:")
print(f"F-Measure: {best_f*100:.1f}%")
print(f"flux_threshold_mult: {best_params[0]}")
print(f"flux_threshold_abs: {best_params[1]}")
print(f"lockout_ratio: {best_params[2]}")
print(f"pll_correction: {best_params[3]}")
print(f"Beats count: {best_params[4]} (Precision: {best_params[5]*100:.1f}%, Recall: {best_params[6]*100:.1f}%)")
