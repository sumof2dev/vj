# VJ Engine: Technical Documentation

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
- **Beat Tracking:** Uses **Spectral Flux** (positive change in energy) rather than simple volume peaks.
  - **Beat Phase:** Predicts the next beat arrival, providing a `0.0` (on beat) to `1.0` (next beat) ramp for synced shaders.
- **Deterministic Architecture:** Confidence scaling and adaptive dampening have been removed. The engine provides a **stable, weighted energy stream** that is predictable across all genres.

---

## 2. Vibe & Transient States (`vibe_engine.py`)

The engine categorizes the musical "emotional state" using a hybrid state machine:
- **Vibe (Bucket):** `chill`, `mid`, or `high`. Determined by beat density (beats per 3 seconds) and volume, modified by a user-controlled `vibe_bias`. 
- **Transient (The EDM Intelligence):**
  - `steady`: Consistent energy.
  - `building`: Energy is rising over a ~2s trend.
  - `tension`: Sudden drop in "impact" (heavy bass) while energy was previously high. Used for the "pre-drop" silence.
  - `dropping`: Massive spike in impact following a tension state or sudden bass onset.
- **Stability Mechanisms:**
  - **Hysteresis:** Vibe states are locked for 2.0s minimum to prevent rapid flip-flopping.
  - **Post-Drop Lockout:** After a `dropping` state, the engine enforces a **3.0s lockout** where it cannot re-enter `building`. This prevents the "fake build" effect common during high-intensity track intros or busy bridges.
  - **Cinematic Holds:** Each transient state has a minimum hold time (Building: 1.5s, Tension: 2.0s, Dropping: 4.0s) to ensure visual transitions feel intentional and dramatic.

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

## 6. Hosting & Network Architecture

The RaveBox system uses a hybrid infrastructure model to balance local processing power with global accessibility and SSL-secured PWA support.

### Global Connectivity & Tunnels
Remote access is provided via **Cloudflare Zero Trust Tunnels** (`cloudflared`). This allows the Raspberry Pi 5 to be accessible via the internet without manual port forwarding or a public IP address.

The tunnel configuration (`setup_tunnel.sh`) maps three logical entry points to the Pi's specialized ports:
- **`{BOX_NAME}.ravebox.love` → Port 8000:** The primary **Production Server** (UI Assets & Configuration API).
- **`api-{BOX_NAME}.ravebox.love` → Port 8001:** The **Launcher Service** (System Control & Admin API).
- **`ws-{BOX_NAME}.ravebox.love` → Port 8765:** The **DMX Engine WebSocket** (High-speed audio metrics & state streaming).

### Backend Component Roles
1.  **VJ Engine (`backend/main.py`):**
    - The "brain" of the system.
    - Operates as a WebSocket server on **Port 8765**.
    - Performance-critical; broadcasts the 6-bin EQ data and transient states to all connected visualizers at 60fps.
2.  **VJ Server (`server.py`):**
    - The application gateway on **Port 8000**.
    - Serves the static HTML/JS frontend.
    - Manages the persistence of `fixtures/` and the `library/` (UserGen Shaders).
    - **The Proxy:** Acts as an internal proxy for port 8001. When a UI sends a command to `/api/restart`, the Server (8000) internally forwards it to the Launcher (8001) to keep the frontend logic simple.
3.  **VJ Launcher (`launcher.py`):**
    - The system administrator on **Port 8001**.
    - Executes `systemctl` commands to start/stop the engine.
    - Handles external integrations like **Spotify OAuth** and **TP-Link Kasa** smart plug control.

### Hosting & SSL Strategy
- **Frontend Assets:** Commonly deployed to **Google Cloud Storage (GCS)** or served locally via the Production Server. Hosting on GCS allows the heavy React/Visualizer assets to be cached globally while connecting back to the Pi for live data.
- **SSL Termination:** Cloudflare provides the public-facing SSL certificates required for PWA "Add to Home Screen" support. Internally, the services use local certificates (`cert.pem`) to ensure data remains encrypted across the tunnel.
- **Smart Redirection:** The `launcher.py` includes logic to automatically detect `.ravebox.love` domains and append the `api-` prefix, ensuring that internal redirects between services work seamlessly in both local and remote environments.

---
*Technical Ref: INFRA v1.2 / Cloudflare Tunnel / GCS Integrated*

