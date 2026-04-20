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

### Direct Entry (Standalone / Local)
- **Primary Entry Point**: `https://{id}.ravebox.love` or **Local IP**.
- **Frontend**: Served directly from the Pi's internal `vj-server` (Port 8000).
- **Workflow**: All assets and data are hosted on the same origin. No "Secret Code" entry is required as the hostname identifies the box.
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
*Technical Ref: NET-SYNC v1.3 / Cloud-First Standard*
