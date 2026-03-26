# VJ Engine: Technical Documentation

This document serves as the technical source-of-truth for the VJ Engine's architecture, data pipeline, and system setup on Raspberry Pi 5.

---

## 1. Audio Pipeline (`main.py`)

### Capture & Monitoring
- **Source Selection:** The engine uses the `sounddevice` library. At startup, it automatically probes for a **PulseAudio Monitor** device (usually the monitor for the default HifiBerry DAC output).
- **Dynamic Routing:** A background routine (`route_stream_to_monitor`) uses `pulsectl` to find the Python recording stream during initialization and physically moves it to the system loopback. This ensures the engine "hears" exactly what Spotify or VLC is playing.
- **Watchdog:** If the audio callback hangs for 4 seconds, the stream is automatically destroyed and recreated.

### Analysis (`AudioAnalyzer`)
- **Visual Frequency Bins (6 Bins):** Unlike WLED's linear bins, the engine calculates 6 grouped bins for high-fidelity visualization and optimized processing:
  - `Sub + Bass`, `Low-Mid`, `Mid`, `High-Mid`, `Presence`, `Air / High`.
- **Smoothing:** All bins use a **70/30 peak-hold decay** (70% previous frame, 30% current) to eliminate flicker while maintaining reactivity.
- **Normalization:** A rolling 300-frame (~5s) history window tracks local min/max. This maps variable inputs to a perfect `0.0 - 1.0` range.
  - **Sub-Bass Weighting:** Bin 0 is weighted at **0.5x** and Bin 1 at **0.7x** to prevent low-end energy from dominating the overall analysis.
- **Beat Tracking:** Uses **Spectral Flux** (positive change in energy) rather than simple volume peaks.
  - **Beat Phase:** Predicts the next beat arrival, providing a `0.0` (on beat) to `1.0` (next beat) ramp for synced shaders.
- **Raw Signal Architecture:** Confidence scaling and adaptive dampening have been removed. The engine provides the **raw, unweighted energy** for maximum visual impact and predictability.

---

## 2. Vibe & Transient States (`vibe_engine.py`)

The engine categorizes the musical "emotional state" using a hybrid state machine:
- **Vibe (Bucket):** `chill`, `mid`, or `high`. Determined by beat density (beats per 3 seconds) and volume, modified by a user-controlled `vibe_bias`.
- **Transient (The EDM Intelligence):**
  - `steady`: Consistent energy.
  - `building`: Energy is rising over a ~2s trend.
  - `tension`: Sudden drop in "impact" (heavy bass) while energy was previously high. Used for the "pre-drop" silence.
  - `dropping`: Massive spike in impact following a tension state or sudden bass onset.

---

## 3. DMX Logic Engine (`dmx_engine.py`)

### 3-Field Spatial Engine
The engine maintains three independent `LogicMatrix` math cores:
- **Logic Matrix (Master):** Global calculations.
- **Logic L / Logic R:** Independent spatial fields that allow fixtures on the left of the room to react to different LFO phases or bin energies than those on the right.
- **Global Speed Standard:** The engine defaults to a **0.6 Base Speed**. This governs both DMX LFO frequencies and visualizer animation pace to ensure a smooth, non-frantic performance.
- **Synchronized Real-Time Clock:** Both the DMX engine and the Shader engine use a strict **1:1 Real-world Clock**. Variable clock speeds (accelerated drops or slowed breakdowns) have been removed to ensure perfect hardware-visual synchronization.

### The 4-Layer Priority Stack
Before a final DMX value is sent, it passes through four priority layers:
1.  **Spatial Logic & Frequency Modifiers:** Raw LFOs (Sine, Tri, Saw, Square) or Direct Frequency maps (which dynamically select the most dominant of the 6 bins with a valid range) mapped to the 3-point calibration (Min/Center/Max).
2.  **Base Layer (Presets):** The active background scene (e.g., "Lissajous") provides a default overlay.
3.  **System Triggers (High Priority):** Dynamic overlays from `fixtures/presets.json` that automatically punch through when specific vibe, transient, or EQ bin conditions are met. These can even override global blackout ("silence") states to ensure immediate visual impact.
4.  **Manual Overrides & Performance Layers:** Absolute highest priority. Direct injections from the Setup UI, Virtual Joysticks, or physical Gamepads. 
    - **Visual Base Gain (1.0):** The visualizer gain is locked at **1.0x** (matched 1:1 with DMX intensity) to ensure the visualizer's "pop" accurately reflects the live hardware output.
    - **Additive Injection:** Unlike static overrides, manual frequency injections (via Gamepad triggers or UI sliders) act as an **additive layer** on top of the live analysis, allowing for "Live Remixing" of the automated show.
    - **Hardware Deadranges:** Enforces a strict 15% hardware deadzone and trigger-clutch activation (LB/RB) to prevent DMX "ghosting" during manual performance.

### Preset Logic
Presets stored in `fixtures/presets.json` use the `trigger` field (e.g., `vibe:high`, `bass_style:wonky`, or `bin:0>0.8`) to automatically override specific fixture roles when conditions are met. 
- **Global Silence Blackout:** If volume remains below 3% for more than **2.0 seconds**, the engine enters a global blackout state. Preset triggers can be configured to "punch through" this state for immediate impact.

---

## 4. Hardware Translation

### Timing & Transmission (`main.py`)
Accurate DMX timing is critical on the Pi 5. The engine uses two methods based on the host:
- **Pi 5 Native UART:** Uses a **Baud Rate Trick**. To send the DMX **BREAK**, it drops the baud to 57600, sends a `0x00`, then slams back to 250k. This creates a hardware-precise 100us Break consistent with the DMX512 standard.
- **USB-DMX (FTDI):** Uses `port.break_condition = True` for high-level driver control.

---

## 5. System Setup Guide

### 1. Hardware Config (`/boot/firmware/config.txt`)
Essential for unlocking WaveShare RS485 HATS and HifiBerry DACs.
```ini
# Unlocks UART0 pins on Pi 5 GPIO
dtparam=uart0=on
dtoverlay=disable-bt
enable_uart=1
dtoverlay=uart0-pi5

# Configures I2S for HifiBerry
dtparam=audio=off
dtoverlay=hifiberry-dacplus
```

### 2. OS Dependencies
```bash
sudo apt update && sudo apt install -y python3-venv libasound2-dev libpulse0 pulseaudio-utils gpiod libgpiod-dev openssl fuser
```

### 3. Permissions & Persistence
- **Sudoers:** `/etc/sudoers.d/vj-launcher` must exist to allow the Web UI to issue `systemctl restart` commands without a password.
- **Services:** Run `./setup_service.sh` to install the `vj-server`, `vj-launcher`, and `vj-engine` systemd units.
- **SSL:** Run `./generate_cert.sh` to enable SSL (HTTPS/WSS), which is required for mobile PWA standalone support.

### 4. Sanity Check & Calibration
- **Engine Calibration:** Accessible via the "Sanity Check" tab in the Help UI. This test feeds a pre-compiled EDM signal into the engine core to verify BPM detection accuracy, spectral flux responsiveness, and state machine integrity (Transitions between chill, tension, and dropping).

---
*Technical Ref: DMX_ENGINE v2.6 / PI5-LABWC Optimized*

