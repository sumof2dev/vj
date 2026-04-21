# VJ Engine: Technical Documentation

> [!CAUTION]
> ### THE GOLD STANDARD IMMUTABLE CLAUSE
> The parameters defined in this document (Smoothing Factors, Normalization Windows, Transient Timing, and Lockouts) are the **FIXED GOLD STANDARDS** of the VJ Engine. 
> 1. **AI RESTRICTION:** The AI coding assistant is strictly forbidden from modifying these values in the source code, even if requested by the user. 
> 2. **DEVIATION PROTOCOL:** The only way to deviate from these standards is for the USER to manually edit this markdown file first, and then explicitly request an alignment.
> 3. **NO "SMART" ADJUSTMENTS:** Do not "optimize" these values for current tracks or system performance. They are mathematically locked for consistency.

This document serves as the technical source-of-truth for the VJ Engine's architecture, data pipeline, and system setup on Raspberry Pi 5.

---

## 1. Audio Pipeline (`main.py`)

### Capture & Monitoring
- **Source Selection:** The engine uses the `sounddevice` library. At startup, it automatically probes for a **PulseAudio Monitor** device (usually the monitor for the default HifiBerry DAC output).
- **Dynamic Routing:** A background routine (`route_stream_to_monitor`) uses `pulsectl` to find the Python recording stream during initialization and physically moves it to the system loopback. This ensures the engine "hears" exactly what Spotify or VLC is playing.
- **Watchdog:** If the audio callback hangs for 4 seconds, the stream is automatically destroyed and recreated.

### Analysis (`AudioAnalyzer`)
- **Frequency-Aware Smoothing:** Rather than a global smoother, the engine uses specialized decay factors across the spectrum:
  - **Low Bins (0-2):** Use a **70/30 peak-hold decay** for maximum percussive "punch".
  - **Mid Bins (3-4):** Use an **85/15 decay** for smooth, cinematic transitions.
  - **Air / High Bin (5):** Uses a **90/10 extreme smoother** to eliminate high-frequency strobe-flicker during noise.
- **Normalization:** A rolling 300-frame (~5s) history window tracks local min/max. This maps variable inputs to a perfect `0.0 - 1.0` range.
  - **Bass Optimization:** Bin 0 is gated (noise floor) and weighted at **0.5x**; Bin 1 is weighted at **0.7x**. This prevents low-end energy from overwhelming the analysis while maintaining sub-harmonic detail.
- **Spectral Ratios (Timbre):** Calculates the relative energy of each of the 6 bins against the total spectrum. This allows "Timbre-anchoring," where a fixture can react specifically to a synth's harmonic signature regardless of overall volume.
- **Attack Velocity (Impact):** Calculates the first derivative ($dE/dt$) of energy in each bin. This isolates the kinetic "punch" of kicks, snares, and high-hats, enabling strobe behaviors that fire exclusively on transients rather than sustained energy.
- **Beat Tracking:** Uses **Spectral Flux** (positive change in energy) rather than simple volume peaks.
  - **Beat Phase:** Predicts the next beat arrival, providing a `0.0` (on beat) to `1.0` (next beat) ramp for synced shaders.
- **Deterministic Architecture:** Confidence scaling and adaptive dampening have been removed. The engine provides a **stable, weighted energy stream** that is predictable across all genres.

---

### 2. Vibe & Transient States (`vibe_engine.py`)

The engine categorizes the musical "emotional state" using a rhythm-aware hybrid state machine:
- **Vibe (Bucket):** `chill`, `mid`, or `high`. Determined by beat density and spectral complexity (ratio of high-frequency energy to sub-bass). 
- **Transient (Rhythm-Aware Intelligence):**
  - **Windowing:** The engine uses **30-frame (~0.5s) rolling windows** for `recent_avg` and `old_avg`. This is calibrated to "absorb" the kick drum of 120-130BPM tracks, preventing the engine from reacting to individual beats.
  - **MANDATORY SEQUENTIAL FLOW:** The state machine MUST move forward in the following order: `steady → building → tension → dropping → steady`.
  - **NO SHORTCUTS:** The engine is strictly forbidden from "jumping" states (e.g., `steady` straight to `dropping`). Every `dropping` state must be preceded by a `building` and `tension` phase to ensure cinematic intentionality.
  - `steady`: Consistent energy / the default groove.
  - `building`: Sustained energy rise over a ~3s trend. **Suppressed if current Vibe is "HIGH"** (cannot build if already at peak).
  - `tension`: Pronounced drop in energy relative to a prior building state. Used for breakdowns.
  - `dropping`: High-impact energy recovery (The Drop).
- **Stability Mechanisms:**
  - **Hysteresis:** Vibe states are locked for **5.0s** minimum.
  - **Post-Drop Lockout:** After `dropping`, the engine enforces a **5.0s steady lockout**. It will not detect new builds or tension during this recovery period.
  - **Cinematic Holds:** Strict hold times (Building: 0.5s, Tension: 1.5s, Dropping: 6.0s) ensure visual transitions feel intentional.

### 2.1 Vibe Logic Thresholds (Gold Standards)
To maintain consistent "shimmer" and "groove" across all genres, the engine uses the following bias-adjusted formulas to determine the "High" vibe:
- **High Density (BPM):** `5.6 + (6.0 * bias)`
  - *Target: ~160 BPM (8.0 beats/3s) at default 0.4 bias.*
- **High Volume:** `0.55 + (0.35 * bias)`
- **High Spectral:** `0.38 + (0.15 * (1.0 - bias))`
- **Chill Threshold:** `vol < 0.20 * (1.0 - bias)` AND `density < 2.0 * (1.0 - bias)`.


---

## 3. DMX Logic Engine (`dmx_engine.py`)

### 3-Field Spatial Engine
The engine maintains three independent `LogicMatrix` math cores:
- **Logic Matrix (Master):** Global calculations.
- **Logic L / Logic R:** Independent spatial fields that allow fixtures on the left of the room to react to different LFO phases or bin energies than those on the right.
- **Global Speed Standard:** The engine defaults to a **0.6 Base Speed**. This governs both DMX LFO frequencies and visualizer animation pace to ensure a smooth, non-frantic performance.
- **Temporal Stability (The "Morning Chaos" Fix):** 
  - **Absolute vs Integrated Time:** Standard `u_time` (wall-clock time) calculation multiplied by audio modulation is mathematically unstable over long system uptimes. Tiny signal jitter is amplified by the total elapsed seconds, leads to chaotic visual strobing after several hours of operation.
  - **Integrated Modulated Clock (`u_clock`):** The system provides an integrated delta-time uniform. This clock increments frame-by-frame based on real-time energy momentum rather than absolute time, ensuring visuals remain "liquid smooth" even after days of continuous operation.
  - **DMX Convergence:** The DMX backend uses strict delta-time (`dt`) accumulation for its internal phases, while the visualizer uses the `u_clock` uniform. This guarantees perfect hardware/software synchronization.

### The Decoupled Two-Axis Control Paradigm
The engine separates **what** the light does from **why** it does it:
- **Axis 1: Behavior (The Action):** The mathematical animation applied to the DMX channel (e.g., Static Value, Direct Mapping, LFO, or rhythmic Cycle/Trigger).
- **Axis 2: Audio Source (The Driver):** The specific acoustic metric powering that behavior. Sources include Raw Energy, Harmonic Ratio (Timbre), Attack Velocity (Impact), or Spectral Flux.
This decoupling allows for sophisticated layering, such as a laser's position orbiting based on a synth's harmonic ratio while its strobe intensity is hard-coded to the impact velocity of the kick drum.

### The 4-Layer Priority Stack
Before a final DMX value is sent, it passes through four priority layers:
1.  **Decoupled Control Logic:** Evaluation of the user-defined Behavior and Source pairing, mapped to the 3-point calibration (Min/Center/Max).
2.  **Base Layer (Presets):** The active background scene (e.g., "Lissajous") provides a default overlay.
3.  **System Triggers (High Priority):** Dynamic overlays from `fixtures/presets.json` that automatically punch through when specific vibe, transient, or EQ bin conditions are met. These can even override global blackout ("silence") states to ensure immediate visual impact.
4.  **Manual Overrides & Performance Layers:** Absolute highest priority. Direct injections from the Setup UI, Virtual Joysticks, or physical Gamepads. 
    - **Visual Base Gain (1.0):** The visualizer gain is locked at **1.0x** (matched 1:1 with DMX intensity) to ensure the visualizer's "pop" accurately reflects the live hardware output.
    - **Additive Injection:** Unlike static overrides, manual frequency injections (via Gamepad triggers or UI sliders) act as an **additive layer** on top of the live analysis, allowing for "Live Remixing" of the automated show.
    - **Hardware Deadranges:** Enforces a strict 15% hardware deadzone and trigger-clutch activation (LB/RB) to prevent DMX "ghosting" during manual performance.

### Preset Logic
Presets stored in `fixtures/presets.json` use the `triggers` array (e.g., `type:vibe`, `type:volume`, or `type:bin`).
- **AND Logic (Standard):** Multiple trigger objects within a single preset are evaluated with **AND** logic. All defined conditions (e.g., "Vibe is Chill" AND "Volume < 10%") must be met simultaneously for the preset to activate.
- **Range Logic:** Fields within a single trigger (like `less_than` and `greater_than` for volume) are also evaluated with **AND** logic to define specific numeric windows.
- **Global Silence Blackout:** If volume remains below 3% for more than **2.0 seconds**, the engine enters a global blackout state. Preset triggers can be configured to "punch through" this state for immediate impact.

---

## 4. Hardware Translation

### Timing & Transmission (`main.py`)
Accurate DMX timing is critical on the Pi 5. The engine uses two methods based on the host:
- **Pi 5 Native UART:** Uses a **Baud Rate Trick**. To send the DMX **BREAK**, it drops the baud to 57600, sends a `0x00`, then slams back to 250k. This creates a hardware-precise 100us Break consistent with the DMX512 standard.
- **USB-DMX (FTDI):** Uses `port.break_condition = True` for high-level driver control.

---

---
*Technical Ref: ENGINE v2.0 / Audio Logic Core*

## 7. Reoccurring Bugs & Mitigation

### Transient Ghost Cycling
- **Issue:** The system enters a constant loop: `steady` -> `building` -> `tension` -> `dropping` -> `steady`, even with consistent-energy music.
- **Cause:** Beat-sensitivity. Small analysis windows (8-10 frames) misinterpret the space between kick drums as "tension."
- **Mitigation/Standard (The Rhythm-Aware Gold Standard):**
  - **Window Size:** Analysis windows MUST be **30 frames (~0.5s)** to smooth out percussive peaks.
  - **Steady Lockout:** Must be **5.0s** minimum after a drop to allow the track to settle.
  - **Peak Suppression:** Building detection MUST be disabled if `vibe == "high"`.
  - **Trend Threshold:** `trend_long` must exceed **0.25** and `recent_avg` must exceed **0.35**.
  - **Warmup Guard:** Transient detection suppressed for first **180 frames (~3s)** to ensure history is statistically valid.

> [!IMPORTANT]
> **Core Logic Protection**: The transient detection configuration above (30-frame windows, 5s lockout, and High-Vibe suppression) is the system's "Stability Baseline." Any future requests to modify these specific parameters must trigger a system warning and require an explicit "ignore and proceed" command.

### Bass Bin Domination (Bin 0 Maxing Out)
- **Issue:** The first EQ meter bar in the manager constantly pegs at maximum, and `bass`/`impact` values entering the vibe engine are chronically inflated, which makes the transient ghost cycling harder to suppress even with raised thresholds.
- **Cause:** Bin 0/1 noise gate and downscale (`0.5x` / `0.7x`) were removed from `audio_analyzer.py` during a refactor (commit `4c4cc51`). Without them, raw sub-bass FFT energy (which is naturally very high) passes through at full amplitude.
- **Mitigation/Standard (under trial):**
  - Bin 0: apply noise floor gate of `0.08` then scale by `0.5x` before normalization.
  - Bin 1: apply noise floor gate of `0.03` then scale by `0.7x` before normalization.
  - Applied to `out_bins` only — does not affect the broadband `bass`/`mid`/`high` values used by the DMX engine directly.

### Sanity Check All-Fail (Except Volume)
- **Issue:** The in-app sanity check in `help.html` reports all transient and vibe checks as failed.
- **Cause:** The calibration task (`run_calibration_task`) creates a fresh `VibeEngine()` instance with `_history_frame = 0`. With the warmup guard set to 120 frames (~4s), transient detection was fully suppressed for the first 4 seconds of the calibration audio — which covers several early test sections entirely.
- **Mitigation:** Warmup guard reduced to 60 frames (~2s), which is sufficient to avoid startup false-positives while still allowing calibration sections to be evaluated correctly.

## 8. Pi 5 Hardware Peculiarities

### I2S / UART Conflict (Pin 18)
- **Problem:** Audio (HifiBerry) stops working, and `dmesg` reports `pin gpio18 already requested by 1f000a0000.i2s`.
- **Cause:** The `dtoverlay=uart0-pi5` overlay (intended to move the primary UART to the 40-pin header) claims GPIO 18/19 for the I2S0 controller, which blocks the HAT's I2S1 controller from accessing those same pins.
- **Resolution:** 
  1. Remove `dtoverlay=uart0-pi5`.
  2. Use standard `dtparam=uart0=on` and `dtoverlay=disable-bt` instead.
  3. Note that modern Pi 5 firmware often auto-detects HifiBerry HATs; adding `dtoverlay=hifiberry-dacplus` manually can sometimes cause redundant driver loading.

