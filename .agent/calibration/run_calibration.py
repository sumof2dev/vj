import sys
import os
import wave
import json
import numpy as np
import time

# Add backend to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), "../../backend"))

from audio_analyzer import AudioAnalyzer
from vibe_engine import VibeEngine

# --- CONFIGURATION ---
WAV_FILE = "calibration_audio.wav"
TRUTH_FILE = "calibration_truth.json"
BLOCK_SIZE = 2048
SAMPLE_RATE = 44100

def main():
    if not os.path.exists(WAV_FILE) or not os.path.exists(TRUTH_FILE):
        print(f"❌ Missing files: {WAV_FILE} or {TRUTH_FILE}")
        return

    print("🧪 Starting Calibration Test...")
    
    # Load Truth
    with open(TRUTH_FILE, 'r') as f:
        truth = json.load(f)
        
    # Open WAV
    wf = wave.open(WAV_FILE, 'rb')
    num_frames = wf.getnframes()
    
    # Initialize Engines
    analyzer = AudioAnalyzer()
    analyzer.set_gain(1.0) # Full sensitivity for test
    vibe = VibeEngine()
    
    results = {
        "beats": [],
        "vibe_states": [],
        "transients": [],
        "bpm": []
    }
    
    # Process Loop
    processed_frames = 0
    start_cpu_time = time.time()
    
    print(f" - Processing {num_frames} frames ({num_frames/SAMPLE_RATE:.2f}s)...")
    
    while processed_frames < num_frames:
        data = wf.readframes(BLOCK_SIZE)
        if not data:
            break
            
        # Convert to float32 numpy array
        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32767.0
        # If mono, reshape to (N, 1) to match analyzer expectation (axis=1 mean)
        samples = samples.reshape(-1, 1)
        
        current_time = processed_frames / SAMPLE_RATE
        
        # Audio Analysis
        audio_state = analyzer.process(samples, now=current_time)
        
        # Vibe Analysis
        vibe_state = vibe.update(audio_state, now=current_time)
        
        # Collect results
        if audio_state['beat']:
            results["beats"].append(current_time)
            
        results["vibe_states"].append((current_time, vibe_state['vibe']))
        results["transients"].append((current_time, vibe_state['transient']))
        results["bpm"].append((current_time, audio_state['bpm']))
        
        processed_frames += len(samples)

    wf.close()
    duration = time.time() - start_cpu_time
    print(f"✅ Processing complete in {duration:.2f}s (Real-time speed: {(num_frames/SAMPLE_RATE)/duration:.1f}x)")
    
    # --- EVALUATION ---
    print("\n--- Calibration Report ---")
    
    # 1. Beat Detection Accuracy
    all_truth_beats = []
    for section in truth["sections"]:
        if "beats" in section:
            all_truth_beats.extend(section["beats"])
            
    print(f"🥁 Beat Detection:")
    print(f"   Truth: {len(all_truth_beats)} beats")
    print(f"   Detected: {len(results['beats'])} beats")
    
    # Simple matching (within 100ms)
    matches = 0
    lags = []
    for tb in all_truth_beats:
        # Find closest detected beat
        closest = min(results["beats"], key=lambda db: abs(db - tb)) if results["beats"] else 999
        if abs(closest - tb) < 0.1: # 100ms window
            matches += 1
            lags.append(closest - tb)
            
    precision = matches / len(results["beats"]) if results["beats"] else 0
    recall = matches / len(all_truth_beats) if all_truth_beats else 0
    print(f"   Precision: {precision*100:.1f}%")
    print(f"   Recall: {recall*100:.1f}%")
    if lags:
        print(f"   Avg Lag: {np.mean(lags)*1000:.1f}ms")

    # 2. Vibe State Transitions
    print(f"🌈 Vibe State Tracking:")
    for section in truth["sections"]:
        if "expected_vibe" in section:
            expected = section["expected_vibe"]
            # Sample vibe at mid-section
            mid_time = (section["start"] + section["end"]) / 2.0
            # Find closest sample
            _, actual = min(results["vibe_states"], key=lambda x: abs(x[0] - mid_time))
            status = "✅" if actual == expected else "❌"
            print(f"   [{section['name']}] Expected: {expected:6} | Actual: {actual:6} | {status}")

    # 3. Transient Detection
    print(f"⚡ Transient Detection:")
    for section in truth["sections"]:
        if "expected_transient" in section:
            expected = section["expected_transient"]
            # Sample at mid-section
            mid_time = (section["start"] + section["end"]) / 2.0
            _, actual = min(results["transients"], key=lambda x: abs(x[0] - mid_time))
            status = "✅" if actual == expected else "❌"
            print(f"   [{section['name']}] Expected: {expected:8} | Actual: {actual:8} | {status}")

    # 4. BPM Accuracy
    print(f"⏱️  BPM Tracking:")
    for section in truth["sections"]:
        if "beats" in section and section["name"] != "building":
            # For steady sections, compare mid-point BPM
            mid_time = (section["start"] + section["end"]) / 2.0
            _, actual_bpm = min(results["bpm"], key=lambda x: abs(x[0] - mid_time))
            # Find closest truth BPM (approximate for steady sections)
            expected_bpm = 60.0 / (section["beats"][1] - section["beats"][0]) if len(section["beats"]) > 1 else 120.0
            error = abs(actual_bpm - expected_bpm)
            print(f"   [{section['name']:11}] Expected: {expected_bpm:6.1f} | Actual: {actual_bpm:6.1f} | Error: {error:4.1f} ({error/expected_bpm*100:4.1f}%)")
        elif section["name"] == "building":
            # For the build, report the PEAK BPM reached
            peak_bpm = max([b for t, b in results["bpm"] if section["start"] < t < section["end"]])
            print(f"   [{section['name']:11}] Target Peak: 180.0 | Actual Peak: {peak_bpm:6.1f} (Cap: 171.4 due to debounce)")

    print("--------------------------\n")

if __name__ == "__main__":
    main()
