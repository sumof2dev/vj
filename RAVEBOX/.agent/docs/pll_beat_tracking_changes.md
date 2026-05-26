# PLL Beat Tracking & Harmonic Export — Session Notes
**Date:** 2025-05-25  
**File Modified:** `backend/audio_analyzer.py`  
**Status:** Code complete, compiles clean. Runtime tests blocked by numpy import hang on sumofmini (system-level issue, not code).

---

## Change 1: Phase-Locked Beat Tracking (PLL)

### Problem
The beat detector used a hardcoded 350ms lockout window:
```python
if now - self.prev_beat_timestamp > 0.35:
```
- Broke tracking above 171 BPM (lockout ≥ beat period)
- Too permissive at slow tempos (ghost doubles)
- Hard-reset `prev_beat_timestamp = now` on every beat, causing cumulative DMX LFO phase drift from soft-onset kicks

### Solution — Three Mechanisms

#### 1. Dynamic Lockout
```python
lockout = max(0.135, median(beat_intervals) × 0.55)
```
- **0.55 ratio** — 55% of tracked beat period (standard syncopation tolerance)
- **0.135s floor** — supports up to 220 BPM without dropout
- **Cold-start fallback** — uses original 0.35s until `beat_intervals` has ≥ 2 entries

#### 2. Integer Multiplier Matching (Syncopation Resilience)
```python
time_elapsed = now - self.prev_beat_timestamp
elapsed_cycles = max(1, round(time_elapsed / self.pll_period))
expected_beat = self.prev_beat_timestamp + (elapsed_cycles * self.pll_period)
```
Without this, a skipped downbeat (musical rest) arrives ~2 periods late, blowing past the tolerance window and triggering a hard reset every time. The integer matching recognizes "this arrived 2 beats later" and still applies soft correction.

#### 3. Phase Error Correction
```python
phase_error = now - expected_beat
tolerance = self.pll_period * 0.25

if abs(phase_error) < tolerance and len(self.beat_intervals) >= 2:
    # Soft pull: absorb 35% of deviation
    self.prev_beat_timestamp = expected_beat + phase_error * 0.35
else:
    # Hard reset: genuine tempo change
    self.prev_beat_timestamp = now
```
A kick arriving 20ms late shifts the grid by only 7ms. Converges to true tempo within 3-4 beats.

### Constants Added to `__init__`
```python
self.beat_intervals = collections.deque(maxlen=8)  # widened from 4

# PLL Tracking Constants
self.lockout_ratio    = 0.55   # Dynamic lockout as fraction of beat period
self.lockout_floor    = 0.135  # Hard floor (~220 BPM ceiling support)
self.pll_correction   = 0.35   # Phase error proportional correction factor
self.pll_period       = 0.50   # Initial period estimate (120 BPM)
```

### Tempo Coverage After Change

| Tempo | Period | Lockout | Tracks? |
|---|---|---|---|
| 80 BPM | 750ms | 413ms | ✅ Tight enough to block ghost doubles |
| 128 BPM | 469ms | 258ms | ✅ Standard EDM |
| 174 BPM | 345ms | 190ms | ✅ DnB (was **broken** at 350ms) |
| 220 BPM | 273ms | 150ms | ✅ Upper ceiling |

---

## Change 2: Harmonic Band Export

### Problem
The HPSS layer produces both percussive and harmonic FFTs, but only the percussive side was exported (`bass_p`, `mid_p`, `high_p`). The harmonic FFT was computed and thrown away.

### Solution
Mirrored the existing percussive pipeline for harmonic bands:

1. **Cold-start path** — `harmonic_fft = fft_raw` (before HPSS window fills)
2. **Soft mask** — `mask_h = h² / (h² + p² + ε)` (complement of percussive mask)
3. **Bin mapping** — `wled_bins_h` routed through same 16-bin WLED mapping
4. **Normalization** — `history_bass_h`, `history_mid_h`, `history_high_h` deques
5. **Export** — `bass_h`, `mid_h`, `high_h` added to return dict and `get_empty_state()`

### New State Dict Fields
```python
# Return dict now has three band sets:
"bass":   ..., "mid":   ..., "high":   ...,   # Unified (full FFT)
"bass_p": ..., "mid_p": ..., "high_p": ...,   # Percussive (kicks, snares, hats)
"bass_h": ..., "mid_h": ..., "high_h": ...,   # Harmonic (pads, vocals, leads)  ← NEW
```

### New `__init__` State
```python
self.history_bass_h = collections.deque(maxlen=self.rolling_window_size)
self.history_mid_h  = collections.deque(maxlen=self.rolling_window_size)
self.history_high_h = collections.deque(maxlen=self.rolling_window_size)
```

---

## Downstream Impact
- **No changes** to `main.py`, `dmx_engine.py`, `vibe_engine.py`, or any frontend files
- Return dict has 3 new keys (`bass_h`, `mid_h`, `high_h`) — additive, non-breaking
- `get_empty_state()` updated to include them
- DMX engine can start consuming harmonic bands whenever wiring is added

## Verification Status
- `py_compile`: ✅ Passes
- PLL math validation: ✅ All 6 scenarios verified (cold-start, 128/174/220 BPM, phase correction, syncopation)
- Runtime `process()` test: ⏳ Blocked — `import numpy` hangs on sumofmini. Suspected system-level numpy/BLAS issue, not code. Test command to retry:

```bash
cd backend && python3 -c "
from audio_analyzer import AudioAnalyzer
import numpy as np
a = AudioAnalyzer()
state = a.process(np.random.randn(1024, 1) * 0.1)
print('bass_h:', state['bass_h'], 'mid_h:', state['mid_h'], 'high_h:', state['high_h'])
print('PLL period:', a.pll_period, 'lockout_ratio:', a.lockout_ratio)
print('OK')
"
```
