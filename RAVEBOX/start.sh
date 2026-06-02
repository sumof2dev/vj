#!/bin/bash

# Kill background processes on exit (Ctrl+C or Systemd Stop)
trap 'kill $(jobs -p) 2>/dev/null' SIGINT SIGTERM

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
if [ -n "$INVOCATION_ID" ] && grep -q "system.slice" /proc/self/cgroup 2>/dev/null; then
    IS_SERVICE=true
    echo "Running as systemd service (Headless Mode)"
else
    IS_SERVICE=false
    echo "Running manually"
    # Stop all background services to avoid port/DMX conflicts
    sudo -n /usr/bin/systemctl stop vj-server.service 2>/dev/null
    sudo -n /usr/bin/systemctl stop vj-launcher.service 2>/dev/null
    sudo -n /usr/bin/systemctl stop vj-engine.service 2>/dev/null
    sudo -n /usr/bin/systemctl stop vj-camera.service 2>/dev/null

    echo "🧹 Cleaning up existing manual instances..."
    pkill -f "backend/main.py" 2>/dev/null
    pkill -f "launcher.py" 2>/dev/null
    pkill -f "server.py" 2>/dev/null
    pkill -f "calibration_server.py" 2>/dev/null
    
    fuser -k -9 8765/tcp > /dev/null 2>&1
    fuser -k -9 8001/tcp > /dev/null 2>&1
    fuser -k -9 8000/tcp > /dev/null 2>&1
    fuser -k -9 8004/tcp > /dev/null 2>&1
fi

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

# Wait for ports to actually free up (Mode-Aware)
echo "Waiting for ports to clear..."
for i in {1..10}; do
    # 1. Manual Mode: Wait for ALL ports
    if [ "$IS_SERVICE" = false ]; then
        if ! fuser 8000/tcp >/dev/null 2>&1 && ! fuser 8765/tcp >/dev/null 2>&1 && ! fuser 8001/tcp >/dev/null 2>&1 && ! fuser 8004/tcp >/dev/null 2>&1; then
            break
        fi
    else
        # 2. Service Mode: Only wait for the port we are about to use
        # If --engine-only, only wait for 8765. If --server-only, only wait for 8000.
        if [ "$START_ENGINE" = true ] && [ "$START_SERVER" = false ]; then
            if ! fuser 8765/tcp >/dev/null 2>&1; then break; fi
        elif [ "$START_SERVER" = true ] && [ "$START_ENGINE" = false ]; then
            if ! fuser 8000/tcp >/dev/null 2>&1; then break; fi
        else
            # Default catch-all
            break
        fi
    fi
    sleep 0.5
done
sleep 1

PORT_CONFLICT=false
if [ "$IS_SERVICE" = false ]; then
    for port in 8000 8001 8765 8004; do
        if fuser $port/tcp >/dev/null 2>&1; then
            PORT_CONFLICT=true
            pid=$(lsof -t -i:$port 2>/dev/null || fuser $port/tcp 2>/dev/null | awk '{print $1}')
            echo "Port $port is already in use."
            if [ -n "$pid" ]; then
                proc_info=$(ps -p $pid -o args= 2>/dev/null)
                echo "Process PID: $pid ($proc_info)"
                
                svc_name=""
                case $port in
                    8000) svc_name="vj-server" ;;
                    8001) svc_name="vj-launcher" ;;
                    8765) svc_name="vj-engine" ;;
                    8004) svc_name="vj-camera" ;;
                esac
                
                if [ -n "$svc_name" ] && systemctl is-active --quiet $svc_name.service 2>/dev/null; then
                    echo "   💡 Running as systemd service: $svc_name.service"
                    echo "   👉 To stop it, run: sudo systemctl stop $svc_name.service"
                else
                    echo "   👉 To kill the process, run: kill -9 $pid"
                fi
            fi
        fi
    done
fi

if [ "$PORT_CONFLICT" = true ]; then
    echo "Cannot start manually because one or more ports are in use. Please free the ports or use systemd services."
    exit 1
fi

echo "RaveBox Activate..."
echo "Brought to you by: $(pwd)"


# 1. Start Backend (Unbuffered output for logging)
if [ "$START_ENGINE" = true ]; then
    echo "Starting Engine..."
    # Check for virtual environment (prioritize venv_local over venv)
    if [ -f "venv_local/bin/python3" ] && venv_local/bin/python3 -c "import websockets" &>/dev/null; then
        PYTHON_CMD="venv_local/bin/python3"
        echo "Using venv_local Python"
    elif [ -f "venv/bin/python3" ] && venv/bin/python3 -c "import websockets" &>/dev/null; then
        PYTHON_CMD="venv/bin/python3"
        echo "Using venv Python"
    elif [ -f ".venv/bin/python3" ] && .venv/bin/python3 -c "import websockets" &>/dev/null; then
        PYTHON_CMD=".venv/bin/python3"
        echo "Using .venv Python"
    else
        PYTHON_CMD="python3"
        echo "Using system Python"
    fi
    $PYTHON_CMD -u backend/main.py &
    ENGINE_PID=$!
fi

# 2. Start Frontend Server
if [ "$START_SERVER" = true ]; then
    echo "🌐 Starting Server..."
    # reuse PYTHON_CMD if set, else define it
    if [ -z "$PYTHON_CMD" ]; then
        if [ -f "venv_local/bin/python3" ] && venv_local/bin/python3 -c "import websockets" &>/dev/null; then
            PYTHON_CMD="venv_local/bin/python3"
        elif [ -f "venv/bin/python3" ] && venv/bin/python3 -c "import websockets" &>/dev/null; then
            PYTHON_CMD="venv/bin/python3"
        elif [ -f ".venv/bin/python3" ] && .venv/bin/python3 -c "import websockets" &>/dev/null; then
            PYTHON_CMD=".venv/bin/python3"
        else
            PYTHON_CMD="python3"
        fi
    fi
    $PYTHON_CMD -u server.py &
    SERVER_PID=$!
fi

# 3. Start Launcher (For UI control & Status)
if [ "$IS_SERVICE" = false ]; then
    echo "Starting Launcher..."
    $PYTHON_CMD -u launcher.py &
    LAUNCHER_PID=$!

    # 4. Start Camera Service (Port 8004)
    # echo "Starting Camera Service..."
    # $PYTHON_CMD -u scripts/calibration_server.py &
    # CAMERA_PID=$!

    # 5. Start Cloudflare Tunnel
    echo "Starting Cloudflare Tunnel..."
    if pgrep -f "cloudflared.*tunnel run" >/dev/null; then
        echo "Cloudflare Tunnel is already running."
    else
        if ! sudo systemctl start cloudflared.service 2>/dev/null; then
            if [ -f "$HOME/.cloudflared/config.yml" ]; then
                echo "Starting Cloudflare Tunnel in user-space..."
                mkdir -p logs
                nohup cloudflared --config "$HOME/.cloudflared/config.yml" tunnel run > logs/cloudflared.log 2>&1 &
            else
                echo "Cloudflare config not found. Tunnel cannot be started."
            fi
        fi
    fi
fi


echo "LFG!"
echo -e "   Go to: ${CYAN}https://$(hostname -I | awk '{print $1}'):8000/help.html${NC}"
echo -e "   ${DIM}(Self-signed cert: Click 'Advanced' -> 'Proceed' in browser)${NC}"
echo -e "   Follow the guide to register your own Client ID & Secret."
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

# Robust Protocol Detection
PROTOCOL="http"
[ -f "cert.pem" ] && PROTOCOL="https"

echo ""
echo "👉 Manager:    ${PROTOCOL}://$LAN_IP:8000/manager.html"
echo "👉 Visualizer: ${PROTOCOL}://$LAN_IP:8000/visualdmx.html"
echo "👉 Remote:     ${PROTOCOL}://$LAN_IP:8000/remote.html"
echo "👉 Setup:      ${PROTOCOL}://$LAN_IP:8000/setup.html"
echo ""
if [ "$PROTOCOL" = "https" ]; then
    echo -e "${YELLOW}🔒 HTTPS Mode Active:${NC} Browser will warn about self-signed cert."
    echo -e "   Click ${CYAN}'Advanced' -> 'Proceed'${NC} to bypass on first load."
fi
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
