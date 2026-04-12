
## 5. System Setup Guide

### 1. Hardware Config (`/boot/firmware/config.txt`)
Essential for unlocking WaveShare RS485 HATS and HifiBerry DACs.

```ini
[all]
# Unlocks UART0 for DMX (RS485)
dtparam=uart0=on
dtoverlay=disable-bt
enable_uart=1

# NOTE: Avoid 'dtoverlay=uart0-pi5' on Pi 5. It conflicts with I2S (Pin 18).

# Audio for HifiBerry
# NOTE for Pi 5: Modern HATs are often auto-detected. 
# Only add these if 'aplay -l' doesn't show the card.
# dtoverlay=hifiberry-dacplus
# dtparam=audio=off
dtoverlay=vc4-kms-v3d,noaudio
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
