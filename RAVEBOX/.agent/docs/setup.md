# RaveBox Networking & Connectivity Guide

This document defines the infrastructure and remote access strategies for the RaveBox system.

---

## 1. The Unified Ingress Architecture

RaveBox uses a single, subdomain-based routing architecture that supports two primary entry points depending on the user's location and network status.

### Global Entry (GCS Hybrid)
- **Primary Entry Point**: `https://ravebox.love`
- **Frontend**: Served via Google Cloud Storage (GCS) Global CDN.
- **Workflow**: User enters a **Secret Code**. The UI dynamically pairs with the individual Pi backend via `{id}.ravebox.love`.
- **Data Flow**: Library, profiles, presets, and live WebSocket data are pulled from and saved to the backend host.

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
