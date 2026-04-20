# RaveBox Installation & Initial Setup

This guide provides the technical requirements for building a new RaveBox instance from a fresh Raspberry Pi OS install. 

---

## 1. Hardware Configuration (`/boot/firmware/config.txt`)

Essential for unlocking UART (RS485) and audio capabilities. The configuration varies by Pi model.

```ini
[all]
# Combined UART & BT Config
# On Pi 5: Uses UART0 for DMX to avoid I2S pin conflicts.
# On Pi 4: Standard UART setup.
enable_uart=1
dtoverlay=disable-bt

[pi5]
dtparam=uart0=on
dtoverlay=vc4-kms-v3d,noaudio

[pi4]
dtparam=audio=on
# Ensure standard UART pins 14/15 are available
```

> [!NOTE]
> **Pi 4 Onboard Audio:** Unlike the Pi 5 HifiBerry configuration, the Pi 4 "EVT" setup preserves `dtparam=audio=on` to support the onboard 3.5mm jack for visualizer/engine analysis.

---

## 2. OS Dependencies

Run the following command to install the required system libraries for audio analysis, GPIO control, and certificate management:

```bash
sudo apt update && sudo apt install -y python3-venv libasound2-dev libpulse0 pulseaudio-utils gpiod libgpiod-dev openssl fuser
```

---

## 3. Permissions & Services

### Sudoer Access
The Web UI (Port 8000) requests system restarts via the Launcher (Port 8001). To enable this without password prompts, the following file must exist:
- **Path**: `/etc/sudoers.d/vj-launcher`
- **Content**: `ravebox ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart vj-*`

### Service Installation
Run the following script to install the `vj-server`, `vj-launcher`, and `vj-engine` systemd units:
```bash
./setup_service.sh
```

### SSL Certificates
Run the following script to enable the SSL handshake (HTTPS/WSS) required for PWA support:
```bash
./generate_cert.sh
```

---

## 4. Hardware Peculiarities & Troubleshooting

### Pi 5: I2S / UART Conflict (Pin 18)
- **Problem**: Audio (HifiBerry) stops working, and `dmesg` reports `pin gpio18 already requested`.
- **Cause**: The `dtoverlay=uart0-pi5` overlay intended to move UART to the 40-pin header conflicts with the I2S0 controller.
- **Resolution**: 
  1. Remove `dtoverlay=uart0-pi5`.
  2. Use standard `dtparam=uart0=on` and `dtoverlay=disable-bt` instead.

### Pi 5: HifiBerry Detection
Modern Pi 5 firmware often auto-detects HifiBerry HATs. Adding `dtoverlay=hifiberry-dacplus` manually can sometimes cause redundant driver loading and audio failure. Verify with `aplay -l` first.

---

## 5. Sanity Check & Calibration
Once installed, access the **"Sanity Check"** tab in the Help UI. This test feeds a pre-compiled EDM signal into the engine core to verify:
- BPM Detection Accuracy.
- Spectral Flux responsiveness.
- State Machine Transitions (Chill -> Tension -> Drop).

---
*Technical Ref: INSTALL v1.0 / HW-SYNC*
