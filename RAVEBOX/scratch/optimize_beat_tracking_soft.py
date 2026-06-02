import sys
import os
import json
import numpy as np
import librosa

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

def run_simulation(mask_type, mult, abs_thresh, lockout_ratio, pll_corr, offset):
    analyzer = AudioAnalyzer()
    analyzer.flux_threshold_mult = mult
    analyzer.flux_threshold_abs = abs_thresh
    analyzer.lockout_ratio = lockout_ratio
    analyzer.pll_correction = pll_corr
    
    # We patch the analyzer's HPSS masking method dynamically based on mask_type
    original_process = analyzer.process
    
    def patched_process(indata, now=None):
        # We need to compute mono and FFT ourselves or let the analyzer do it, 
        # but let's override the mask logic by subclassing/monkeypatching.
        # Actually, let's just intercept the process by running a custom version of the core loop.
        pass

    # To be extremely precise, let's implement the processing loop directly here
    # mimicking AudioAnalyzer.process but with our choice of soft/binary masking.
    
    # Analyzer state variables
    history_bass_p = collections.deque(maxlen=300)
    history_mid_p  = collections.deque(maxlen=300)
    history_high_p = collections.deque(maxlen=300)
    history_flux   = collections.deque(maxlen=300)
    
    # PLL state
    bpm_list = []
    bpm = 120.0
    prev_beat_timestamp = 0.0
    beat_intervals = collections.deque(maxlen=8)
    pll_period = 0.50
    
    prev_bands_p = [0.0, 0.0, 0.0]
    fft_history = collections.deque(maxlen=5)
    
    sim_beats = []
    
    for i in range(num_blocks):
        block = y[i*block_size:(i+1)*block_size]
        t = (i * block_size) / sr
        
        mono = np.mean(block, axis=1)
        mono = mono - np.mean(mono)
        fft_raw = np.abs(np.fft.rfft(mono))
        
        fft_history.append(fft_raw)
        if len(fft_history) < 5:
            continue
            
        harmonic_fft = np.nanmedian(fft_history, axis=0)
        pad_size = 2
        padded = np.pad(fft_raw, pad_size, mode='edge')
        L = len(fft_raw)
        stacked = np.stack([padded[j:L+j] for j in range(5)], axis=0)
        percussive_fft = np.nanmedian(stacked, axis=0)
        
        h_sq = harmonic_fft ** 2
        p_sq = percussive_fft ** 2
        eps = 1e-6
        
        if mask_type == "binary":
            mask_p = (p_sq > (h_sq * 0.85)).astype(np.float32)
        else: # soft
            mask_p = p_sq / (h_sq + p_sq + eps)
            
        percussive_fft = fft_raw * mask_p
        
        # Calculate WLED bins
        wled_bins_p = [0.0] * 16
        freqs = np.fft.rfftfreq(len(mono), 1/44100)
        current_fft_idx = 1
        for k, cutoff in enumerate(analyzer.wled_freqs):
            start = current_fft_idx
            while current_fft_idx < len(freqs) and freqs[current_fft_idx] < cutoff:
                current_fft_idx += 1
            if current_fft_idx == start: current_fft_idx += 1
            chunk_p = percussive_fft[start:current_fft_idx]
            if chunk_p.size > 0: wled_bins_p[k] = np.nanmean(chunk_p)
            
        raw_bass_p = np.mean(wled_bins_p[0:4])
        raw_mid_p  = np.mean(wled_bins_p[4:11])
        raw_high_p = np.mean(wled_bins_p[11:16])
        
        history_bass_p.append(raw_bass_p)
        history_mid_p.append(raw_mid_p)
        history_high_p.append(raw_high_p)
        
        max_bass_ref = max(history_bass_p) if history_bass_p else 1.0
        max_bass_ref = max(5.0, max_bass_ref)
        
        min_bass = min(history_bass_p)
        max_bass = max(history_bass_p)
        sane_peak_bass = max(5.0, max_bass)
        out_bass_p = min(1.0, max(0.0, (raw_bass_p - min_bass) / (sane_peak_bass - min_bass + 1e-6)) * analyzer.gain * 2.0)
        
        min_mid = min(history_mid_p)
        max_mid = max(history_mid_p)
        sane_peak_mid = max(max_bass_ref * 0.25, max_mid)
        out_mid_p = min(1.0, max(0.0, (raw_mid_p - min_mid) / (sane_peak_mid - min_mid + 1e-6)) * analyzer.gain * 2.0)
        
        min_high = min(history_high_p)
        max_high = max(history_high_p)
        sane_peak_high = max(max_bass_ref * 0.12, max_high)
        out_high_p = min(1.0, max(0.0, (raw_high_p - min_high) / (sane_peak_high - min_high + 1e-6)) * analyzer.gain * 2.0)
        
        bass_delta = max(0, out_bass_p - prev_bands_p[0])
        mid_delta  = max(0, out_mid_p - prev_bands_p[1])
        high_delta = max(0, out_high_p - prev_bands_p[2])
        
        prev_bands_p = [out_bass_p, out_mid_p, out_high_p]
        
        flux = (bass_delta * 1.0) + (mid_delta * 0.4) + (high_delta * 0.1)
        
        is_beat = False
        if len(history_flux) > 0:
            avg_flux = sum(history_flux) / len(history_flux)
            if flux > avg_flux * mult and flux > abs_thresh:
                if len(beat_intervals) >= 2:
                    sorted_ibi = sorted(beat_intervals)
                    pll_period = float(sorted_ibi[len(sorted_ibi) // 2])
                    lockout = max(analyzer.lockout_floor, pll_period * lockout_ratio)
                else:
                    lockout = 0.35
                    
                time_elapsed = t - prev_beat_timestamp
                is_half_tempo_trigger = False
                if len(beat_intervals) >= 2 and pll_period > 0.65:
                    half_period = pll_period * 0.5
                    if half_period >= analyzer.lockout_floor:
                        half_tolerance = pll_period * 0.125
                        if abs(time_elapsed - half_period) < half_tolerance:
                            is_half_tempo_trigger = True
                            
                if (time_elapsed > lockout) or is_half_tempo_trigger:
                    is_beat = True
                    delta = t - prev_beat_timestamp
                    if delta > 1.5:
                        prev_beat_timestamp = t
                    else:
                        elapsed_cycles = max(1, round(time_elapsed / pll_period))
                        expected_beat = prev_beat_timestamp + (elapsed_cycles * pll_period)
                        phase_error = t - expected_beat
                        tolerance = pll_period * 0.25
                        if abs(phase_error) < tolerance and len(beat_intervals) >= 2:
                            prev_beat_timestamp = expected_beat + phase_error * pll_corr
                        else:
                            prev_beat_timestamp = t
                        beat_intervals.append(delta)
                        
        history_flux.append(flux)
        if is_beat:
            sim_beats.append(t)
            
    # Apply offset and evaluate
    shifted_beats = [b - offset for b in sim_beats]
    _, prec, rec, f = audit_engine._match_beats(shifted_beats, truth_beats)
    return len(sim_beats), prec, rec, f

import collections
print("Running comparison...")
for mask in ["binary", "soft"]:
    best_f = 0
    best_p = None
    for mult in [1.2, 1.4, 1.6, 1.8, 2.0]:
        for abs_thresh in [0.15, 0.20, 0.25, 0.30]:
            for lockout in [0.45, 0.50, 0.55, 0.60]:
                for corr in [0.15, 0.25, 0.35]:
                    for offset in [-0.20, -0.15, -0.10, -0.05, 0.0, 0.05, 0.10]:
                        count, prec, rec, f = run_simulation(mask, mult, abs_thresh, lockout, corr, offset)
                        if f > best_f:
                            best_f = f
                            best_p = (mult, abs_thresh, lockout, corr, offset, count, prec, rec)
    print(f"\nBest for {mask.upper()}:")
    print(f"  F-Measure: {best_f*100:.2f}%")
    if best_p:
        print(f"  Params: mult={best_p[0]}, abs={best_p[1]}, lockout={best_p[2]}, corr={best_p[3]}, offset={best_p[4]*1000:.0f}ms")
        print(f"  Beats: count={best_p[5]}, precision={best_p[6]*100:.1f}%, recall={best_p[7]*100:.1f}%")
