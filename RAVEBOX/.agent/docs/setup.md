# RaveBox Networking & Connectivity Guide

This document defines the infrastructure and remote access strategies for the RaveBox system.

---

## 1. The Unified Ingress Architecture

RaveBox uses a single, subdomain-based routing architecture that supports two primary entry points depending on the user's location and network status.

### Global Entry (GCS Hybrid with Ping-Redirect)
- **Primary Entry Point**: `https://ravebox.love`
- **Frontend**: Served via Google Cloud Storage (GCS) Global CDN.
- **Workflow**: User enters a **Secret Code** (or it is loaded from browser storage). The UI automatically pings the backend tunnel API to verify connectivity.
- **Tunnel Online (Redirect)**: If the backend is reachable, the browser seamlessly redirects to the dedicated tunnel subdomain (e.g., `https://{id}.ravebox.love/manager.html`). This ensures the user is served the exact local version of the UI directly from their hardware.
- **Tunnel Offline (GCS Fallback)**: If the backend tunnel is offline, the redirect is aborted. The browser remains on the `ravebox.love` GCS frontend, ensuring the user can still access the cached UI and attempt recovery or offline operations.

### Direct Entry (Standalone / Local / Custom Tunnel)
- **Primary Entry Point**: `https://{id}.ravebox.love` or **Local IP**.
- **Frontend**: Served directly from the Pi's internal `vj-server` (Port 8000).
- **Workflow**: All assets and data are hosted on the same origin. No "Secret Code" entry is required. **The system explicitly disables the "Change Host" prompt and ignores any previously saved `vj_backend_host` codes in local storage.** This enforces Strict Domain Isolation, meaning the URL in the browser is the absolute source of truth for the API backend connections.
- **Local Network Support**: If cached via the PWA (Service Worker) and on the same network, the system can operate without an active internet connection by hitting the Pi's local IP.

---

---

## 2. Cloudflare Zero Trust Tunnels

Remote access is provided via `cloudflared`.

### The Cloud-Managed "Trap"
> [!WARNING]
> **Dashboard Priority**: Any tunnel managed via the **Cloudflare Zero Trust Dashboard** (e.g., `ravebox-backend`) will **silently override** any local `config.yml` on the Pi. Routing changes for these tunnels MUST be performed in the Cloudflare Dashboard.

### The Protocol Chain (Fixing 502/1033 Errors)
Internally, the tunnel service protocol **MUST MATCH** the backend engine's local security state and trust its certificates.
1.  **Protocol Match**:
    - If Engine is in `wss` mode -> Tunnel service must be `https://127.0.0.1:{PORT}`.
2.  **No TLS Verify (Critical)**:
    - Because RaveBox uses self-signed certificates on the Pi, you MUST enable **"No TLS Verify"** in the Cloudflare Dashboard for every Public Hostname entry (TLS settings). 
    - Failure to do this results in a **502 Bad Gateway**.
3.  **Domain SSL Mode**:
    - The Cloudflare Dashboard SSL/TLS setting for the domain should be set to **"Full"**. 

---

## 3. Recovery from Backup

If you have restored a backup or moved files to a new device, follow this checklist to restore connectivity:

1.  **Permission Restoration**:
    - Restoration often strips execute bits. Fix all scripts: `chmod +x *.sh`
2.  **Service Re-activation**:
    - Tunnels may be disabled by default. Enable and start:
    - `sudo systemctl enable --now cloudflare-tunnel.service`
3.  **The "Inverted Port" Audit**:
    - If you get 404s on profiles/presets but the page loads, your ports might be swapped in the Dashboard.
    - **Correct Golden Mapping**: 
      - `ravecave.ravebox.love` -> `8000` (Server/Files)
      - `api-ravecave.ravebox.love` -> `8001` (Launcher)

---

## 4. SSL & IP Persistence

### LAN IP Dependency
Self-signed certificates (`cert.pem`) include the Pi's LAN IP.
- **IP Change**: If the Pi receives a new internal IP, you **MUST** re-run `./generate_cert.sh`.

---

## 5. Infrastructure Stability & Known Traps

The RaveBox stack is a delicate balance between legacy Python servers and modern cloud proxies. Follow these rules to avoid breaking connectivity.

### The protocol Lock (HTTP/1.0 Only)
- **Problem**: Attempting to "modernize" `server.py` by switching to `HTTP/1.1` (to allow persistent connections) will likely break the system. 
- **Consequence**: Cloudflare Tunnels and the browser will report "Unexpected EOF" or **404 Not Found** on valid files because the Python backend does not natively handle the complex socket-management required for proxied 1.1 traffic.
- **Rule**: Always keep `protocol_version` at its default in `server.py`.

### The CSS/Asset Query-String Bug
- **Behavior**: Page assets like `setup.css` use version tags (e.g. `?v=421...`) to bypass Cloudflare's CDN.
- **Trap**: If `server.py` logic is modified to explicitly look for filenames, it must account for these query strings. If not, the file will exist on disk but the server will return a 404 to the browser. 

### The Service Worker Cache Trap
- **Behavior**: The RaveBox PWA uses a "Network First" strategy. If the server returns a 404 once (e.g. while restarting), the browser's Service Worker may cache that "Missing" state.
- **Resolution**: If you see a 404 for `manager.html` after a server restart, a standard refresh is often not enough. You **MUST** perform a **Hard Refresh (Ctrl+Shift+R)** or **Clear Site Data** in the browser console.

---
*Technical Ref: NET-SYNC v1.4 / Infrastructure-Stability-Standard*

---

## 6. Headless SoftAP Onboarding

To integrate headless SoftAP onboarding into the existing RaveBox file architecture, the system takes advantage of the default **NetworkManager** setup native to Raspberry Pi OS Bookworm.

Since the Pi is completely headless and running a local web instance, your smartphone will scan a static WPA connection sticker physically attached to the machine. Once connected to the Pi's internal access point, your phone will directly pull an onboarding page from the internal production server (`server.py`) running on Port 8000.

### The Physical Setup (Static QR Code)

Since there is no external display, a static QR code sticker is placed directly onto the hardware chassis. The payload string inside the QR code matches the static network the Pi falls back onto when it loses connectivity:

```text
WIFI:S:RaveBox-Setup;T:WPA;P:RaveBoxParty123;;
```

Below this sticker, write a note instructing users:
> *"Scan to connect, then open your mobile browser and navigate to **http://10.42.0.1:8000/wifi_setup.html***"
> *(Note: `10.42.0.1` is the default NetworkManager `ipv4.method shared` local gateway).*

### Workflow Mechanics

1. **Boot Assessment**: The device executes `launcher.py` and waits for 30 seconds to observe if it can hook onto an open pipeline or any known home profile.
2. **AP Failover**: If isolated, `nmcli` sets up a hotspot named `RaveBox-Setup`.
3. **User Action**: The user scans the static frame sticker code using their smartphone to connect to the hotspot, opening a window pointing to `http://10.42.0.1:8000/wifi_setup.html`.
4. **Credential Handshake**: The smartphone targets the local script interface (`/api/wifi/connect`) directly on the device. It terminates the hotspot and establishes authentication links over the primary interface.
### The AP vs. Scan Limitation

Due to driver limitations on the Raspberry Pi's wireless chip, active background scanning (`/api/wifi/scan`) may occasionally return an empty list if the interface is heavily broadcasting the access point beacon. In these cases, users may need to manually enter the SSID in future updates to the provisioning UI.

### Hardening & Production Adjustments

To make this modular configuration framework consumer-proof:

1. **The Shell Watchdog Pattern**: The network connection script (`server.py`) explicitly uses an automated fallback mechanism. If the target Wi-Fi connection fails (e.g. incorrect password), the device safely rolls back to Hotspot mode automatically so the user is not permanently locked out.
2. **Sudo Permissions**: The system user running `server.py` must have passwordless execution privileges for `/usr/bin/nmcli` configured in the system `/etc/sudoers` file. Otherwise, the OS will block the network transition commands.
3. **Smart Device Re-discovery**: Once the node successfully transitions to the venue network, its local IP address will change dynamically. The smartphone will need to rely on the cloudflare tunnel (or a local mDNS lookup like `ravebox.local`) to re-establish a data link on the new network thread.
