import json
import math
import wave
import numpy as np

# ==============================================================================
# FILE: generate_calibration_source.py
# ==============================================================================

def build_calibration_suite():
    # Technical Specifications: Defined via programmatic synthesis configuration parameters
    sr = 44100          # Sampling rate (Hz)
    bpm = 120           # Beats per minute
    beat_len = 0.5      # Time per beat (seconds): 60 / 120 BPM
    duration = 30       # Total duration (seconds)
    total_samples = sr * duration

    t = np.linspace(0, duration, total_samples, endpoint=False)
    mixed_audio = np.zeros(total_samples)

    # Ground-truth tracking arrays
    kick_times = []
    snare_times = []
    hat_times = []

    print("Synthesizing percussive grids...")
    total_beats = int(duration / beat_len)
    
    for beat in range(total_beats):
        beat_time = beat * beat_len
        sample_idx = int(beat_time * sr)
        
        # 1. KICK DRUM: Triggers on every downbeat (0.5s intervals)
        kick_times.append(round(beat_time, 3))
        dur_k = int(0.12 * sr)
        t_k = np.linspace(0, 0.12, dur_k, endpoint=False)
        # Pitch sweep from 150 Hz down to 40 Hz
        f_k = 40 + (150 - 40) * np.exp(-50 * t_k)
        kick_wave = np.sin(2 * np.pi * f_k * t_k) * np.exp(-20 * t_k)
        mixed_audio[sample_idx:sample_idx+dur_k] += kick_wave * 0.6
        
        # 2. SNARE DRUM: Triggers on alternate beats (1.0s intervals)
        # Extracted out of the Psytrance window (15.0s to 22.5s) to match structural profile
        if (beat % 2 == 1) and not (15.0 <= beat_time < 22.5):
            snare_times.append(round(beat_time, 3))
            dur_s = int(0.15 * sr)
            noise_s = np.random.normal(0, 1, dur_s)
            t_s = np.linspace(0, 0.15, dur_s, endpoint=False)
            snare_wave = noise_s * np.exp(-25 * t_s)
            mixed_audio[sample_idx:sample_idx+dur_s] += snare_wave * 0.25

        # 3. HI-HAT/CYMBAL: Temporal layout shifts based on structural blocks
        if 15.0 <= beat_time < 22.5:
            # Psytrance Section: Dense 16th-note high-hat pattern (0.125s intervals)
            for sub in range(4):
                h_time = beat_time + (sub * 0.125)
                if h_time < 22.5:
                    hat_times.append(round(h_time, 3))
                    h_idx = int(h_time * sr)
                    dur_h = int(0.04 * sr)
                    noise_h = np.random.normal(0, 1, dur_h)
                    t_h = np.linspace(0, 0.04, dur_h, endpoint=False)
                    hat_wave = noise_h * np.sin(2 * np.pi * 8000 * t_h) * np.exp(-90 * t_h)
                    mixed_audio[h_idx:h_idx+dur_h] += hat_wave * 0.15
        else:
            # Techno/Trance Sections: Clean off-beat hi-hat placement (0.25s offset)
            h_time = beat_time + 0.25
            if h_time < duration:
                hat_times.append(round(h_time, 3))
                h_idx = int(h_time * sr)
                dur_h = int(0.06 * sr)
                noise_h = np.random.normal(0, 1, dur_h)
                t_h = np.linspace(0, 0.06, dur_h, endpoint=False)
                hat_wave = noise_h * np.sin(2 * np.pi * 8000 * t_h) * np.exp(-60 * t_h)
                mixed_audio[h_idx:h_idx+dur_h] += hat_wave * 0.15

    print("Injecting harmonic separation melody bins...")
    # Generate structural mask windows matching your specifications (scaled to 30s duration)
    # Block 2: 7.5s - 15.0s (Techno with melody)
    # Block 4: 22.5s - 30.0s (Trance with melody)
    mask_block2 = (t >= 7.5) & (t < 15.0)
    mask_block4 = (t >= 22.5) & (t < 30.0)
    harmonic_mask = mask_block2 | mask_block4

    # Bin 1: Continuous Deep Sub-Bass (55 Hz sine wave)
    mixed_audio[harmonic_mask] += np.sin(2 * np.pi * 55 * t[harmonic_mask]) * 0.22
    
    # Bin 2: Mid-Range Pluck / Arpeggio (440 Hz square wave matrix)
    mixed_audio[harmonic_mask] += np.sign(np.sin(2 * np.pi * 440 * t[harmonic_mask])) * 0.07
    
    # Bin 3: High Lead Sound (1200 Hz pure sine wave)
    mixed_audio[harmonic_mask] += np.sin(2 * np.pi * 1200 * t[harmonic_mask]) * 0.08

    print("Normalizing audio track signal...")
    # Prevent digital clipping boundaries
    mixed_audio = mixed_audio / np.max(np.abs(mixed_audio))
    audio_int16 = (mixed_audio * 32767).astype(np.int16)

    # Export reference WAV file
    wav_filename = "calibration_source.wav"
    with wave.open(wav_filename, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(audio_int16.tobytes())
    print(f"-> Successfully saved: {wav_filename}")

    # Export ground-truth JSON report
    json_filename = "calibration_ground_truth.json"
    report = {
        "calibration_metadata": {
            "description": "Programmatically generated ground-truth profile for validation testing.",
            "duration_seconds": float(duration),
            "sample_rate_hz": sr,
            "grid_bpm": float(bpm)
        },
        "percussive_ground_truth": {
            "kick_drum_hits_seconds": kick_times,
            "snare_drum_hits_seconds": snare_times,
            "hihat_cymbal_hits_seconds": hat_times
        },
        "harmonic_ground_truth_bins": {
            "bin_1_sub_bass_55hz_active_windows": [
                {"start_sec": 7.5, "end_sec": 15.0},
                {"start_sec": 22.5, "end_sec": 30.0}
            ],
            "bin_2_mid_range_440hz_active_windows": [
                {"start_sec": 7.5, "end_sec": 15.0},
                {"start_sec": 22.5, "end_sec": 30.0}
            ],
            "bin_3_high_lead_1200hz_active_windows": [
                {"start_sec": 7.5, "end_sec": 15.0},
                {"start_sec": 22.5, "end_sec": 30.0}
            ]
        }
    }

    with open(json_filename, "w") as f:
        json.dump(report, f, indent=2)
    print(f"-> Successfully saved: {json_filename}")

if __name__ == "__main__":
    build_calibration_suite()