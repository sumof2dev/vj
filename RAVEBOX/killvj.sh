#!/bin/bash
echo "🔪 Killing VJ Engines & Services..."

# 1. Stop systemd services so they don't auto-restart
echo "🛑 Stopping background systemd services..."
sudo systemctl stop vj-server.service vj-launcher.service vj-engine.service vj-camera.service vj-node.service cloudflared.service 2>/dev/null || true

# 2. Kill Main VJ (8000, 8001, 8765, 8004)
fuser -k 8000/tcp >/dev/null 2>&1
fuser -k 8001/tcp >/dev/null 2>&1
fuser -k 8765/tcp >/dev/null 2>&1
fuser -k 8004/tcp >/dev/null 2>&1

# Kill Dev Server (8085)
fuser -k 8085/tcp >/dev/null 2>&1

# Kill VJSetup Sandbox (8081, 8766)
fuser -k 8081/tcp >/dev/null 2>&1
fuser -k 8766/tcp >/dev/null 2>&1

# Kill by process name just in case
pkill -f "vjsetup/server.py"
pkill -f "vjsetup/backend/main.py"
pkill -f "backend/main.py"
pkill -f "server.py"
pkill -f "launcher.py"
pkill -f "scripts/calibration_server.py"
pkill -f "cloudflared.*tunnel run"

echo "💀 All engines and services terminated."
