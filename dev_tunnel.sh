#!/bin/bash
# VJ - Dev Tunnel Helper
# Starts the backend and provides the command for a Cloudflare dev tunnel.

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "--------------------------------------------------------"
echo "🛠️  RAVEBOX UNIFIED DEV MODE"
echo "--------------------------------------------------------"

# 1. Start the Backend (if not already running)
# We assume the backend is server.py running on port 8000
if ! lsof -i:8000 >/dev/null; then
    echo "🚀 Starting Backend (server.py)..."
    chmod +x server.py
    # Run in background, logging to /tmp
    nohup /usr/bin/python3 server.py > /tmp/vj_server.log 2>&1 &
    sleep 2
    if lsof -i:8000 >/dev/null; then
        echo "✅ Backend started successfully on port 8000."
    else
        echo "❌ Backend failed to start. Check /tmp/vj_server.log"
        exit 1
    fi
else
    echo "✅ Backend is already running on port 8000."
fi

# 2. Provide Tunnel Instructions
echo "--------------------------------------------------------"
echo "To link your local machine to https://dev.ravebox.love:"
echo ""
echo "👉 Run this command in a NEW terminal session:"
echo "   cloudflared tunnel run --url http://localhost:8000 dev-tunnel"
echo ""
echo "Note: Replace 'dev-tunnel' with your actual Cloudflare Tunnel name."
echo "--------------------------------------------------------"
echo "Once the tunnel is active, access your LOCAL code at:"
echo "🔗 https://dev.ravebox.love/setup.html"
echo "🔗 https://dev.ravebox.love/manager.html"
echo "--------------------------------------------------------"
echo "Files will be served from: $DIR"
echo "Changes to HTML/JS will be visible instantly on reload."
echo "--------------------------------------------------------"
