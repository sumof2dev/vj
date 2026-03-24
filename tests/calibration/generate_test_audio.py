import numpy as np
import wave
import json
import os

# --- CONFIGURATION ---
SAMPLE_RATE = 44100
FILENAME = "calibration_audio.wav"
TRUTH_FILENAME = "calibration_truth.json"

# AudioAnalyzer frequencies for reference
WLED_FREQS = [
    86, 129, 216, 301, 430, 560, 818, 1120, 
    1421, 1895, 2412, 3015, 3704, 4479, 7106, 9259
]

def generate_sine_wave(freq, duration, amplitude=0.5):
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
    return amplitude * np.sin(2 * np.pi * freq * t)

def generate_beat(bpm, duration, freq=100, burst_len=0.08, amplitude=0.8):
    samples = int(SAMPLE_RATE * duration)
    audio = np.zeros(samples)
    beat_interval = 60.0 / bpm
    
    num_beats = int(duration / beat_interval)
    truth_beats = []
    
    for i in range(num_beats):
        start_time = i * beat_interval
        start_idx = int(start_time * SAMPLE_RATE)
        burst_samples = int(burst_len * SAMPLE_RATE)
        
        if start_idx + burst_samples < samples:
            # Envelope to avoid clicks
            envelope = np.ones(burst_samples)
            fade_len = int(0.01 * SAMPLE_RATE)
            envelope[:fade_len] = np.linspace(0, 1, fade_len)
            envelope[-fade_len:] = np.linspace(1, 0, fade_len)
            
            # Using 'w' instead of 'wave' to avoid shadowing module
            w = generate_sine_wave(freq, burst_len, amplitude)
            audio[start_idx:start_idx+burst_samples] = w * envelope
            truth_beats.append(start_time)
            
    return audio, truth_beats

def main():
    print(f"🏗️  Generating calibration audio: {FILENAME}")
    
    all_audio = []
    truth = {
        "bpm": 128.0,
        "sections": []
    }
    
    current_time = 0.0
    
    # 1. BASS BEATS (128 BPM) - 10 seconds
    print(" - Section 1: Bass Beats (128 BPM)")
    audio_data, beats = generate_beat(128.0, 10.0, freq=100)
    all_audio.append(audio_data)
    truth["sections"].append({
        "name": "bass_beats",
        "start": current_time,
        "end": current_time + 10.0,
        "expected_vibe": "chill",
        "beats": [b + current_time for b in beats]
    })
    current_time += 10.0
    
    # 2. FREQUENCY SWEEP (Mid range) - 5 seconds
    print(" - Section 2: Mid Sweep")
    sweep_duration = 5.0
    t = np.linspace(0, sweep_duration, int(SAMPLE_RATE * sweep_duration), endpoint=False)
    f_start, f_end = 400.0, 2000.0
    # Linear frequency sweep: phase = 2*pi * integral(f(t))
    # f(t) = f_start + (f_end-f_start)/T * t
    # phi(t) = 2*pi * (f_start*t + 0.5 * (f_end-f_start)/T * t^2)
    phi = 2 * np.pi * (f_start * t + 0.5 * (f_end - f_start) / sweep_duration * t**2)
    sweep = 0.5 * np.sin(phi)
    
    all_audio.append(sweep)
    truth["sections"].append({
        "name": "mid_sweep",
        "start": current_time,
        "end": current_time + 5.0,
        "expected_vibe": "mid"
    })
    current_time += 5.0
    
    # 3. HIGH FREQUENCY DROPS - 5 seconds
    print(" - Section 3: High Sparks")
    sparks = np.zeros(int(SAMPLE_RATE * 5.0))
    for i in range(10):
        spark_start = i * 0.5
        spark_idx = int(spark_start * SAMPLE_RATE)
        burst_data = generate_sine_wave(8000, 0.05, 0.6)
        envelope = np.exp(-np.linspace(0, 5, len(burst_data)))
        sparks[spark_idx:spark_idx+len(burst_data)] = burst_data * envelope
    all_audio.append(sparks)
    truth["sections"].append({
        "name": "high_sparks",
        "start": current_time,
        "end": current_time + 5.0,
        "expected_vibe": "mid"
    })
    current_time += 5.0
    
    # 4. THE BUILD (Crescendo + Increasing BPM) - 10 seconds
    print(" - Section 4: The Build")
    build_len = 10.0
    build_audio = np.zeros(int(SAMPLE_RATE * build_len))
    build_beats = []
    
    bpm_start, bpm_end = 120, 180
    build_time = 0
    while build_time < build_len:
        current_bpm = bpm_start + (bpm_end - bpm_start) * (build_time / build_len)
        interval = 60.0 / current_bpm
        idx = int(build_time * SAMPLE_RATE)
        burst_len = 0.05
        if idx + int(burst_len * SAMPLE_RATE) < len(build_audio):
            w = generate_sine_wave(150, burst_len, 0.3 + 0.7 * (build_time / build_len))
            build_audio[idx:idx+int(burst_len*SAMPLE_RATE)] = w
            build_beats.append(build_time + current_time)
        build_time += interval
        
    all_audio.append(build_audio)
    truth["sections"].append({
        "name": "building",
        "start": current_time,
        "end": current_time + build_len,
        "expected_transient": "building",
        "beats": build_beats
    })
    current_time += build_len
    
    # 5. TENSION (Silence/High drone) - 3 seconds
    print(" - Section 5: Tension")
    tension_drone = generate_sine_wave(4000, 3.0, 0.2)
    all_audio.append(tension_drone)
    truth["sections"].append({
        "name": "tension",
        "start": current_time,
        "end": current_time + 3.0,
        "expected_transient": "tension"
    })
    current_time += 3.0
    
    # 6. THE DROP - 10 seconds
    print(" - Section 6: The Drop")
    drop_audio, drop_beats = generate_beat(140.0, 10.0, freq=60, burst_len=0.15, amplitude=1.0)
    all_audio.append(drop_audio)
    truth["sections"].append({
        "name": "dropping",
        "start": current_time,
        "end": current_time + 10.0,
        "expected_transient": "dropping",
        "expected_vibe": "high",
        "beats": [b + current_time for b in drop_beats]
    })
    current_time += 10.0
    
    # Concatenate and save
    final_audio = np.concatenate(all_audio)
    
    # Save WAV
    print(f"💾 Saving to {FILENAME}...")
    with wave.open(FILENAME, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2) # 16-bit
        wf.setframerate(SAMPLE_RATE)
        # Scale to 16-bit PCM
        wf.writeframes((final_audio * 32767).astype(np.int16).tobytes())
        
    # Save Truth
    with open(TRUTH_FILENAME, 'w') as f:
        json.dump(truth, f, indent=4)
        
    print(f"✅ Created {FILENAME} ({len(final_audio)/SAMPLE_RATE:.2f}s)")
    print(f"✅ Created {TRUTH_FILENAME}")

if __name__ == "__main__":
    main()
