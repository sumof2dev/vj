import json
import random
import wave
import numpy as np

# ==============================================================================
# FILE: generate_complex_calibration.py
# ==============================================================================

def build_complex_suite():
    # Technical Specifications
    sr = 44100          
    bpm = 124           
    beat_len = 60.0 / bpm  # ~0.4838 seconds per beat
    duration = 30.0     
    total_samples = int(sr * duration)

    t = np.linspace(0, duration, total_samples, endpoint=False)
    mixed_audio = np.zeros(total_samples)

    # Ground-truth tracking arrays
    kick_times = []
    snare_times = []
    hat_times = []

    # Seed random for reproducible timing jitter
    random.seed(42)
    np.random.seed(42)

    total_beats = int(duration / beat_len)
    
    print("Synthesizing complex percussive layers with timing jitter...")
    for beat in range(total_beats):
        beat_time = beat * beat_len
        
        # 1. KICK DRUM (Every downbeat)
        if beat_time + 0.15 < duration:
            kick_times.append(round(beat_time, 3))
            sample_idx = int(beat_time * sr)
            dur_k = int(0.18 * sr)
            t_k = np.linspace(0, 0.18, dur_k, endpoint=False)
            # Complex exponential pitch drop (220Hz down to 48Hz) + 2nd harmonic saturation
            f_k = 48 + (220 - 48) * np.exp(-65 * t_k)
            kick_fund = np.sin(2 * np.pi * f_k * t_k)
            kick_sat = np.sin(2 * np.pi * 2 * f_k * t_k) * 0.15 # Harmonic distortion
            kick_wave = (kick_fund + kick_sat) * np.exp(-14 * t_k)
            mixed_audio[sample_idx:sample_idx+dur_k] += kick_wave * 0.65
        
        # 2. COMPLEX SNARE (Beats 2 and 4) - Skips during the Psytrance mid-section
        if (beat % 4 == 1 or beat % 4 == 3) and not (7.5 <= beat_time < 15.0):
            if beat_time < duration:
                snare_times.append(round(beat_time, 3))
                sample_idx = int(beat_time * sr)
                dur_s = int(0.22 * sr)
                t_s = np.linspace(0, 0.22, dur_s, endpoint=False)
                # Snare fundamental body resonance (180Hz) + white noise high-pass tail
                body = np.sin(2 * np.pi * 180 * t_s) * np.exp(-30 * t_s)
                noise = np.random.normal(0, 1, dur_s) * np.exp(-18 * t_s)
                snare_wave = (body * 0.4) + (noise * 0.6)
                mixed_audio[sample_idx:sample_idx+dur_s] += snare_wave * 0.35

        # 3. HI-HATS with micro-timing jitter (Offsets up to +/- 3ms)
        # Structural layout shifts: dense 16ths in Psytrance block (7.5s - 15.0s), offbeat elsewhere
        if 7.5 <= beat_time < 15.0:
            for sub in range(4):
                jitter = random.uniform(-0.003, 0.003)
                h_time = beat_time + (sub * (beat_len / 4)) + jitter
                if 7.5 <= h_time < 15.0:
                    hat_times.append(round(h_time, 3))
                    h_idx = int(h_time * sr)
                    dur_h = int(0.03 * sr)
                    t_h = np.linspace(0, 0.03, dur_h, endpoint=False)
                    # Downward sweeping high-frequency noise bands
                    noise_h = np.random.normal(0, 1, dur_h)
                    mod_env = 6000 + 4000 * np.exp(-150 * t_h)
                    hat_wave = noise_h * np.sin(2 * np.pi * mod_env * t_h) * np.exp(-120 * t_h)
                    mixed_audio[h_idx:h_idx+dur_h] += hat_wave * 0.12
        else:
            # Off-beat open hats
            jitter = random.uniform(-0.002, 0.002)
            h_time = beat_time + (beat_len / 2) + jitter
            if h_time < duration:
                hat_times.append(round(h_time, 3))
                h_idx = int(h_time * sr)
                dur_h = int(0.08 * sr)
                t_h = np.linspace(0, 0.08, dur_h, endpoint=False)
                noise_h = np.random.normal(0, 1, dur_h)
                hat_wave = noise_h * np.sin(2 * np.pi * 9000 * t_h) * np.exp(-45 * t_h)
                mixed_audio[h_idx:h_idx+dur_h] += hat_wave * 0.14

    print("Injecting masking harmonic structures and detuned melody bins...")
    # Dynamic Windows: 
    # Block 2 (Melodic Techno): 7.5s - 15.0s
    # Block 4 (Melodic Trance): 22.5s - 30.0s
    mask_block2 = (t >= 7.5) & (t < 15.0)
    mask_block4 = (t >= 22.5) & (t < 30.0)
    melody_active = mask_block2 | mask_block4

    # Bin 1: Syncopated Rolling Sub-Bass (Collides rhythmically with Kick tail)
    # 16th-note envelope gating on a 55Hz fundamental to challenge low-end tracking
    bass_gate = np.abs(np.sin(2 * np.pi * (1 / (beat_len / 4)) * t))
    mixed_audio += (np.sin(2 * np.pi * 55 * t) * bass_gate * 0.18)

    # Bin 2: Detuned Mid-Range Plucks (Multi-oscillator phase beating)
    f_mid = 330.0  # E4 root
    pluck_env = np.abs(np.sin(2 * np.pi * (1 / beat_len) * t)) * melody_active
    osc1 = np.sin(2 * np.pi * f_mid * t)
    osc2 = np.sin(2 * np.pi * (f_mid * 1.0015) * t)  # Slightly sharp detune
    osc3 = np.sin(2 * np.pi * (f_mid * 0.9985) * t)  # Slightly flat detune
    mixed_audio += ((osc1 + osc2 + osc3) / 3) * pluck_env * 0.08

    # Bin 3: High Frequency Soaring Lead (Challenging high-frequency separation boundaries)
    f_high = 1650.0 
    lead_gate = (0.5 + 0.5 * np.sin(2 * np.pi * 0.25 * t)) * melody_active # Slow LFO filter sweeping
    lead_wave = np.sin(2 * np.pi * f_high * t) + 0.2 * np.sin(2 * np.pi * 3 * f_high * t)
    mixed_audio += lead_wave * lead_gate * 0.06

    print("Finalizing complex mastering limits...")
    # Apply hard ceiling normalization to simulate compressed mastering conditions
    mixed_audio = mixed_audio / np.max(np.abs(mixed_audio))
    audio_int16 = (mixed_audio * 32767).astype(np.int16)

    # Output generation
    wav_filename = "complex_test_source.wav"
    with wave.open(wav_filename, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(audio_int16.tobytes())
    print(f"-> Successfully saved: {wav_filename}")

    json_filename = "complex_ground_truth.json"
    report = {
        "calibration_metadata": {
            "description": "Stress-test calibration file containing detuned harmonics, micro-timing jitter, and transient masking.",
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
            "bin_1_sub_bass_active_windows": [
                {"start_sec": 0.0, "end_sec": 30.0, "profile": "Continuous syncopated 16th-note gate"}
            ],
            "bin_2_detuned_mid_active_windows": [
                {"start_sec": 7.5, "end_sec": 15.0},
                {"start_sec": 22.5, "end_sec": 30.0}
            ],
            "bin_3_modulated_high_active_windows": [
                {"start_sec": 7.5, "end_sec": 15.0},
                {"start_sec": 22.5, "end_sec": 30.0}
            ]
        }
    }

    with open(json_filename, "w") as f:
        json.dump(report, f, indent=2)
    print(f"-> Successfully saved: {json_filename}")

if __name__ == "__main__":
    build_complex_suite()