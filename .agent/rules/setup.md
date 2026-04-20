---
trigger: always_on
---
# RaveBox Networking & Connectivity Guide

This document defines the infrastructure and remote access strategies for the RaveBox system.

---

## 1. Unified Ingress Architecture

RaveBox uses a single, subdomain-based routing model that supports both Global CDN entry and Direct Backend entry.

### Entry Points
- **Global Entry (`ravebox.love`)**: GCS-hosted frontend. User enters a **Secret Code** to pair with the backend.
- **Direct Entry (`[ID].ravebox.love`)**: Backend-hosted frontend. Connects straight to the local hardware; no code required.

### Routing Standard (The Golden Mapping)
Regardless of the entry point, the system resolves services via subdomains:
- `{ID}.ravebox.love` ➔ **Port 8000** (Server / File API)
- `api-{ID}.ravebox.love` ➔ **Port 8001** (Launcher / System Admin)
- `ws-{ID}.ravebox.love` ➔ **Port 8765** (DMX Engine WebSocket)

---

## 2. Cloudflare Zero Trust Tunnels

### Protocol Alignment (Critical)
Internally, the tunnel protocol **MUST MATCH** the backend engine's local security state:
- If Engine is in `wss` mode ➔ Tunnel service must be `https://localhost:{PORT}`.
- **No TLS Verify**: Because certificates are self-signed, "No TLS Verify" MUST be enabled in the Cloudflare Dashboard for all hostnames.

---

## 3. Component Roles & Proxying

1.  **VJ Server (Port 8000)**: Serves assets and Data APIs. Acts as a proxy for the Launcher.
2.  **VJ Launcher (Port 8001)**: Handles system actions (restarts, camera, auth).
3.  **VJ Engine (Port 8765)**: High-speed WebSocket for DMX and audio state.

---

## 4. SSL & IP Persistence

### LAN IP Dependency
Self-signed certificates (`cert.pem`) are bound to the Pi's LAN IP.
- **IP Change**: If the Pi moves to a new network, you **MUST** re-run `./generate_cert.sh`.
- **Symptoms**: TLS Handshake failures or connection hangs in the browser.

---
*Technical Ref: NET-SYNC v1.4 / Unified-Architecture*
