#!/bin/bash

# Kill background processes on exit (Ctrl+C)
trap 'kill %1; kill %2' SIGINT

# Ensure we are in the script's directory (Robust for Symlinks)
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE" # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located
done
DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
cd "$DIR" || exit

# Check if we are running under systemd
if [ -n "$INVOCATION_ID" ]; then
    IS_SERVICE=true
    echo "⚙️ Running as systemd service (Headless Mode)"
else
    IS_SERVICE=false
    echo "👤 Running manually"
    # Stop all background services to avoid port/DMX conflicts
    sudo -n systemctl stop vj-server.service 2>/dev/null
    sudo -n systemctl stop vj-launcher.service 2>/dev/null
    sudo -n systemctl stop vj-engine.service 2>/dev/null

    echo "🧹 Cleaning up..."
    fuser -k -9 8765/tcp > /dev/null 2>&1
    fuser -k -9 8001/tcp > /dev/null 2>&1
    fuser -k -9 8000/tcp > /dev/null 2>&1
fi

# Wait for ports to actually free up
echo "⏳ Waiting for ports to clear..."
for i in {1..10}; do
    # Check 8000 (Server), 8765 (Backend), and 8001 (Launcher)
    if ! fuser 8000/tcp >/dev/null 2>&1 && ! fuser 8765/tcp >/dev/null 2>&1 && ! fuser 8001/tcp >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done
sleep 1

echo "🚀 RaveBox Activate..."
echo "📂 Brought to you by: $(pwd)"

# Parse arguments
START_SERVER=true
START_ENGINE=true

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --server-only) START_SERVER=true; START_ENGINE=false ;;
        --engine-only) START_SERVER=false; START_ENGINE=true ;;
    esac
    shift
done

# 1. Start Backend (Unbuffered output for logging)
if [ "$START_ENGINE" = true ]; then
    echo "🧠 Starting Engine..."
    # Check for virtual environment (prioritize venv over .venv)
    if [ -f "venv/bin/python3" ]; then
        PYTHON_CMD="venv/bin/python3"
        echo "🐍 Using venv Python"
    elif [ -f ".venv/bin/python3" ]; then
        PYTHON_CMD=".venv/bin/python3"
        echo "🐍 Using .venv Python"
    else
        PYTHON_CMD="python3"
        echo "⚠️ Using system Python"
    fi
    $PYTHON_CMD -u backend/main.py &
    ENGINE_PID=$!
fi

# 2. Start Frontend Server
if [ "$START_SERVER" = true ]; then
    echo "🌐 Starting Server..."
    # reuse PYTHON_CMD if set, else define it
    if [ -z "$PYTHON_CMD" ]; then
        if [ -f "venv/bin/python3" ]; then
            PYTHON_CMD="venv/bin/python3"
        elif [ -f ".venv/bin/python3" ]; then
            PYTHON_CMD=".venv/bin/python3"
        else
            PYTHON_CMD="python3"
        fi
    fi
    $PYTHON_CMD -u server.py &
    SERVER_PID=$!
fi


echo "✅ LFG!"
# Robust IP detection (retry if not found immediately)
LAN_IP=""
for i in {1..5}; do
    LAN_IP=$(hostname -I | awk '{print $1}')
    if [ -n "$LAN_IP" ]; then
        break
    fi
    sleep 1
done

if [ -z "$LAN_IP" ]; then
    LAN_IP="127.0.0.1"
    echo "⚠️  Could not detect LAN IP, defaulting to localhost"
fi

echo ""
echo "👉 Manager:    http://$LAN_IP:8000/manager.html"
echo "👉 Visualizer: http://$LAN_IP:8000/visualdmx.html"
echo "👉 Remote:     http://$LAN_IP:8000/remote.html"
echo "👉 Setup:      http://$LAN_IP:8000/setup.html"
echo ""
echo "   (Press Ctrl+C to stop)"

# Wait for processes
if [ "$START_ENGINE" = true ]; then
    wait $ENGINE_PID
    EXIT_CODE=$?
    echo "⚠️ Engine (PID $ENGINE_PID) exited with code $EXIT_CODE"
    exit $EXIT_CODE
elif [ "$START_SERVER" = true ]; then
    wait $SERVER_PID
    EXIT_CODE=$?
    echo "⚠️ Server (PID $SERVER_PID) exited with code $EXIT_CODE"
    exit $EXIT_CODE
else
    wait
fi
