import numpy as np
import wave
import json
import os

SAMPLE_RATE = 44100
FILENAME = "calibration_audio.wav"
TRUTH_FILENAME = "calibration_truth.json"

def main():
    all_audio = []
    truth = {"bpm": 128.0, "sections": []}
    
    # 1. Steady (10s) - 80Hz Sine Pulse @ 0.5
    print("S1")
    s1 = np.zeros(int(SAMPLE_RATE * 10))
    s1_beats = []
    for i in range(21): # ~126 BPM
        t_sec = i * 0.47
        t = int(t_sec * SAMPLE_RATE)
        burst = np.sin(2*np.pi * 80 * np.linspace(0, 0.1, int(0.1*SAMPLE_RATE))) * 0.6
        if t+len(burst) < len(s1): 
            s1[t:t+len(burst)] = burst
            s1_beats.append(float(t_sec))
    all_audio.append(s1)
    truth["sections"].append({"name": "bass_beats", "start": 0.0, "end": 10.0, "expected_vibe": "mid", "beats": s1_beats})

    # 2. Loud (5s) - 80Hz Continuous Sine @ 0.9
    print("S2")
    s2 = np.sin(2*np.pi * 80 * np.linspace(0, 5, int(5*SAMPLE_RATE))) * 0.9
    all_audio.append(s2)
    truth["sections"].append({"name": "loud_bass", "start": 10.0, "end": 15.0, "expected_vibe": "high"})

    # 3. Silence (5s)
    print("S3")
    s3 = np.zeros(int(SAMPLE_RATE * 5))
    all_audio.append(s3)
    truth["sections"].append({"name": "near_silence", "start": 15.0, "end": 20.0, "expected_vibe": "chill"})

    # 4. Building (6s) - Continuous Sine Ramp 0.05 -> 1.0
    print("S4")
    t4 = np.linspace(0, 6, int(6*SAMPLE_RATE))
    s4 = (0.05 + 0.95 * (t4/6.0)) * np.sin(2*np.pi * 100 * t4)
    all_audio.append(s4)
    truth["sections"].append({"name": "building", "start": 20.0, "end": 26.0, "expected_transient": "building"})

    # 5. Tension (4s) - Total Silence
    print("S5")
    s5 = np.zeros(int(SAMPLE_RATE * 4))
    all_audio.append(s5)
    truth["sections"].append({"name": "tension", "start": 26.0, "end": 30.0, "expected_transient": "tension"})

    # 6. Drop (10s) - Heavy 60Hz Pulses @ 1.0
    print("S6")
    s6 = np.zeros(int(SAMPLE_RATE * 10))
    s6_beats = []
    for i in range(23): # ~138 BPM
        t_sec = i * 0.43
        t = int(t_sec * SAMPLE_RATE)
        burst = np.sin(2*np.pi * 60 * np.linspace(0, 0.2, int(0.2*SAMPLE_RATE))) * 1.0
        if t+len(burst) < len(s6): 
            s6[t:t+len(burst)] = burst
            s6_beats.append(float(30.0 + t_sec))
    all_audio.append(s6)
    truth["sections"].append({"name": "dropping", "start": 30.0, "end": 40.0, "expected_transient": "dropping", "expected_vibe": "high", "beats": s6_beats})

    final = np.concatenate(all_audio)
    out = os.path.dirname(os.path.abspath(__file__))
    with wave.open(os.path.join(out, FILENAME), 'wb') as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SAMPLE_RATE)
        wf.writeframes((final * 32767).astype(np.int16).tobytes())
    with open(os.path.join(out, TRUTH_FILENAME), 'w') as f: json.dump(truth, f, indent=4)
    print("Done")

if __name__ == "__main__":
    main()
