import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + '/..')
from backend.audio_analyzer import AudioAnalyzer
import librosa

y, sr = librosa.load("scratch/giantsteps-tempo-dataset/audio/1068430.LOFI.mp3", sr=44100, mono=False)
if y.ndim == 2: y = y.T
elif y.ndim == 1: y = y.reshape(-1, 1)

analyzer = AudioAnalyzer()
bpm_history = []
last_beat_count = 0
dt = 2048 / 44100
for i in range(len(y) // 2048):
    start = i * 2048
    end = start + 2048
    analyzer.process(y[start:end], now=i*dt)
    if analyzer.beat_count > last_beat_count:
        bpm_history.append(analyzer.bpm)
        last_beat_count = analyzer.beat_count

print(bpm_history)
