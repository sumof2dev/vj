import sys
import os
import json
import numpy as np
import librosa

# Add backend to path
sys.path.append(os.path.abspath("backend"))
from audio_analyzer import AudioAnalyzer

audio_path = "recordings/REC_20260527_073848/audio.wav"
y, sr = librosa.load(audio_path, sr=44100, mono=False)
if y.ndim == 1:
    y = np.expand_dims(y, axis=0)
# y is shape (channels, samples). Let's transpose to (samples, channels)
y = y.T

analyzer = AudioAnalyzer()
block_size = 2048
num_blocks = len(y) // block_size

print(f"Audio shape: {y.shape}, sample rate: {sr}")
print(f"Processing {num_blocks} blocks...")

sim_beats = []
pll_periods = []
intervals_history = []

for i in range(num_blocks):
    block = y[i*block_size:(i+1)*block_size]
    # Simulated time
    t = (i * block_size) / sr
    state = analyzer.process(block, now=t)
    if state["beat"]:
        sim_beats.append(t)
        pll_periods.append(analyzer.pll_period)
        intervals_history.append(list(analyzer.beat_intervals))

print(f"Simulated beats count: {len(sim_beats)}")
print("First 20 simulated beat times:", [round(b, 3) for b in sim_beats[:20]])
print("First 20 PLL periods:", [round(p, 3) for p in pll_periods[:20]])
print("First 20 beat interval histories:")
for idx, history in enumerate(intervals_history[:20]):
    print(f"Beat {idx+1} at {sim_beats[idx]:.3f}s: PLL period={pll_periods[idx]:.3f}s, History={[round(h, 3) for h in history]}")
