# Hardware Deployment & Environment Guide

This document defines the roles, environment configurations, and deployment strategies for the RaveBox systems, detailing the split between the developer/crawler machine and the production kiosk devices.

---

## 1. Architectural Split

The RaveBox ecosystem runs in a hybrid master/node or developer/production configuration depending on the target hardware:

| Component / File | Minisforum A1-X255 (Dev/Crawl PC) | Raspberry Pi 4/5 (Production Kiosk) | Role / Purpose |
| :--- | :---: | :---: | :--- |
| **`crawler.py`** | **Yes** | No (Excluded) | Background playlist monitor and Spotify scraper. |
| **`offline_audit_engine.py`** | **Yes** | No (Excluded) | Non-causal Librosa audit and truth profile extractor. |
| **`song_database/`** | **Yes** | No (Excluded) | Precomputed track-specific JSON profiles. |
| **`models/`** | **Yes** | No (Excluded) | Acoustic tokenization codebooks and sequence predictors. |
| **`backend/main.py`** | **Yes (Hybrid Mode)** | **Yes (Live Mode)** | Master engine routing and real-time WebSocket broker. |
| **`audio_analyzer.py`** | **Yes** | **Yes** | Real-time FFT, onset detection, and metric calculations. |

---

## 2. Environment Configurations

### A. Minisforum A1-X255 (Dev/Crawl Machine)
* **Hardware Profile:** High-performance MiniPC (AMD Ryzen / Intel Core), high memory capacity, unrestricted disk space.
* **Software Environment:** Complete Python environment including deep signal processing and ML libraries.
* **Additional Dependencies:**
  - `librosa` & `scipy`: Non-causal time-frequency analysis.
  - `scikit-learn` & `joblib`: Vector quantization (VQ) codebook construction and feature clustering.
  - `onnxruntime` or `torch`: Autoregressive sequence prediction modeling.
* **Hybrid Behavior:** During live playback on Spotify, if a track matches a profile inside `song_database`, the local engine bypasses live state estimation (vibe/transient tracking) and interpolates values directly from the pre-computed ground truth with sub-second accuracy.

### B. Raspberry Pi 4 / 5 (Production/Deployed Kiosk)
* **Hardware Profile:** Quad-core ARM Cortex-A72/A76, low-power fanless setup, constrained SD card / storage life.
* **Software Environment:** Raspberry Pi OS Lite (64-bit), minimal dependencies.
* **Slim Dependencies:** `sounddevice`, `numpy`, `websockets`, `pulsectl`, `python-kasa`, `pyserial`, `opencv-python-headless`. Excludes heavy signal-processing engines (`librosa`) or ML/training modules to conserve CPU and SD card read/write cycles.
* **Live Behavior:** Runs purely in **Live Causal Mode**, analyzing incoming loopback/microphone PCM streams on the fly to drive DMX fixtures and WebGL shaders.

---

## 3. Deployment Flow & Sandboxing

To keep the Raspberry Pi kiosk lean and secure, the file propagation utility (`push_update.sh`) uses `rsync` with strict exclusions to prevent dev-only tools and cached profiles from copying to the target production nodes.

### Excluded Directories & Files
The following items are permanently sandboxed on the Minisforum machine:
* `crawler.py` (and background scraper scripts)
* `offline_audit_engine.py`
* `song_database/` (individual song ground truth JSON profiles)
* `models/` (VQ clustering and SLM models)
* `scripts/` (acoustic tokenization and sequence training utilities)

### Deployment Command
To push updates from the Minisforum dev environment to a production Pi node, run:
```bash
./push_update.sh pi@<pi_ip_address>
```
The script automatically builds the visualizer bundle locally, runs rsync to exclude sandboxed files, configures systemd services, and safely reboots the kiosk node.
