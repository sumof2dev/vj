#!/bin/bash
echo "🔪 Killing VJ Engines..."

# Kill Main VJ (8000, 8001, 8765)
fuser -k 8000/tcp >/dev/null 2>&1
fuser -k 8001/tcp >/dev/null 2>&1
fuser -k 8765/tcp >/dev/null 2>&1

# Kill VJSetup Sandbox (8081, 8766)
fuser -k 8081/tcp >/dev/null 2>&1
fuser -k 8766/tcp >/dev/null 2>&1

# Kill by process name just in case
pkill -f "vjsetup/server.py"
pkill -f "vjsetup/backend/main.py"
pkill -f "backend/main.py"
pkill -f "server.py"

echo "💀 All engines terminated."
