# VJ Engine Audio and Data Flow Analysis

This document provides a detailed breakdown of how audio is captured, analyzed, and translated into physical light/laser movements in the VJ Engine.

## 1. Audio Capture (`main.py`)
- **Capture Logic:** Audio is captured using the `sounddevice` library in `main.py` (`audio_callback`). It reads directly from the system's default audio input or a designated PulseAudio monitor (e.g., catching system output like Spotify).
- **Buffering:** Captured frames (blocks of 2048 samples at 44.1kHz) are pushed into a thread-safe `collections.deque` named `audio_queue`. 
- **Watchdog:** An `audio_watchdog()` routine monitors the callback; if it stops firing for 4 seconds, the stream is automatically restarted to prevent silent failures.

## 2. Audio Analysis (`main.py` - `AudioAnalyzer`)
The `process_audio_queue()` asyncio loops pops frames from the queue and sends them to the `AudioAnalyzer.process()` method for heavy mathematical analysis:
- **FFT & Binning:** The raw audio is converted to mono, mean-centered (DC offset removal), and processed via Fast Fourier Transform (FFT). The frequencies are mapped into 16 bins designed to match WLED ranges.
- **Bands:** The bins are grouped into three primary raw bands: `raw_bass` (bins 0-3), `raw_mid` (bins 4-10), and `raw_high` (bins 11-15).
- **Rolling Normalization:** To account for quiet vs. loud songs dynamically, the engine keeps a history of the last 300 frames (~5-10s). It normalizes current values against the historical min/max, mapping them to a clean `0.0` to `1.0` range (`out_bass`, `out_mid`, `out_high`, and `vol`).
- **Spectral Flux & Onset Detection:** Flux is calculated by measuring the *positive change* in energy across the bands compared to the previous frame. This identifies "hits" or transients. Independent onset flags are generated for bass (`bass_onset`) and high frequencies (`high_onset`).
- **Beat & BPM Detection:** An adaptive threshold (based on average flux history) determines if a given frame constitutes a beat. If triggered, it calculates BPM and tracks the `beat_phase` (a 0.0-1.0 value representing the current progress between beats).
- **Confidence Metrics:** The engine scores the "confidence" and "isolation" of the audio signal based on beat interval stability, peak-to-average ratio of the bins, and transient sharpness.

## 3. Vibe Determination (`vibe_engine.py`)
The raw analyzed dictionary is passed to the `VibeEngine`:
- **Density:** It tracks how many beats occurred in the last 3 seconds.
- **Vibe Bucketing ("Chill", "Mid", "High"):** Based on density, volume, confidence, and optionally Spotify API energy metrics (if a track is playing), it categorizes the current musical mood. 
- **Energy Trend & Transients:** It tracks long-term energy and short-term "impact" (heavy bass weighting). By analyzing the difference (derivative), it classifies the musical structure into four transient states:
  - `steady`
  - `building` (energy steadily rising)
  - `tension` (sudden drop in impact while energy was high – the "pre-drop" silence)
  - `dropping` (massive sudden spike in bass/impact)
- **Mod Smoothing:** It applies specific decay filters to create smoother modifier variables (`mods.bass`, `mods.high`, `mods.flux`) for downstream animation.

## 4. Scene Selection & The DMX Engine (`dmx_engine.py`)
The `DMXEngine` receives the final structured data (`dt`, `audio_state`, `visual_states`) 60 times a second:
- **Accumulators & Timers:** Internal clocks (`_lfo_time`, `color_timer`, `beat_pulse`, `acc_bass`, etc.) are advanced based on `dt` and modulated by audio factors (like `speed` and `flux`).
- **Rhythmic Switching:** On a beat, a master `rot_state_timer` increments. Depending on the `scene_freq` setting and the current `vibe`, it decides when to automatically switch the `current_scene_name` (e.g., switching from `scroll` to `chase`) and randomize visual layers.
- **The Playhead ("The Time Scrubber"):** Each lighting zone has a "drone" with a virtual playhead (`drone['t']`). The speed of this playhead determines the speed of the physical effect and is aggressively warped by the music (e.g., slamming in reverse during a `dropping` state, or slowing down during `tension`).
- **Rhythm Envelopes:** The `rhythm_state` handles short, punchy animations (like drum hits). It prioritizes kicks (`bass_hit` -> "BOOTS/CHA") and snares (`high_hit` -> "CATS"), selecting pre-assigned shapes and colors from the `roles.json` configuration.

## 5. DMX Channel Mapping & Fixture Profiles (JSON)
Before outputting, the engine maps the logical scene/rhythm decisions to physical DMX values. It relies on JSON definitions configured and saved via the Web UI (e.g., `setup.html` -> `fixtures/ehaho_laser.json`):
- **Stage Config (`stage_config.json`):** Defines what physical fixtures exist, their DMX start address, and their assigned "behavior" role (e.g., `lead` vs `rhythm`).
- **Role Config (`roles.json`):** Stores user-defined limits (e.g., bounding the X/Y movement of a specific laser) and color/shape assignments for rhythmic hits.
- **Fixture Profiles (e.g., `ehaho_laser.json`):** 
  - `channels`: Maps logical roles (like `zoom` or `pattern`) to relative DMX offsets.
  - `modes` and `ranges`: Defines what DMX value block triggers manual control vs. macro effects.
  - `calibration`: Stores specific hardware quirks (e.g., where "center" is for a pan/tilt motor, or max safe sweep degrees).
  - `shapes` / `macros`: Maps human-readable names to specific DMX integer values for patterns or built-in fixture macros.
  - `dynamics`: Sets parameter thresholds for how audio metrics (like `flux` or `bass`) modulate specific effects in `_calculate_channel`.

## 6. Output Translation (`dmx_engine.py` -> `main.py`)
- Inside `dmx_engine.py`, the `_process_device` loop calculates the final 0-255 integer value for every defined channel based on the active scene, the audio modifiers, and the JSON constraints, applying master overrides or blackouts (like forcing the `dimmer` to 0 during a `tension` transient).
- These integers are written to an internal 513-byte `universe` array.
- Back in `main.py`, the universe is dispatched to a background thread (`sync_send_dmx`), which calculates the strict serial timing (Break, MAB) and flushes the buffer out through the RS485 hat or USB-DMX adapter at 250k baud, physically creating light.

## 7. Web Interface Interaction (`setup.html` & `server.py`)
- **`server.py`:** Provides a REST API to list, read, and write JSON fixture profiles and stage configurations to the disk.
- **`setup.html`:** Serves as the configuration dashboard.
  - The **Fixture Editor** creates the JSON map of what DMX channels control what feature.
  - The **Stage Manager** creates `stage_config.json`, assigning a profile to a starting DMX address.
  - The **Roles Config** defines bounding boxes for movement, saving to `roles.json`.
  - The **Live Test** UI communicates via WebSockets to `main.py`, sending parameter changes (`intensity`, `speed`, `overrides`) directly into the running engine, bypassing the normal audio flow for manual calibration.

## Summary of the Pipeline
Capture (Monitor) -> Clean & FFT -> Extract Bands & Flux -> Normalization -> Beat Detection & Confidence -> Vibe & Transient Classification (Build/Drop) -> Update Virtual Playheads & Accumulators -> Scene Generation (Lissajous/Scroll/Rhythm) -> JSON Profile Resolution & Constraint Bounding -> Universe Array Write -> Serial Port RS485 Flush -> Physical Beam.
