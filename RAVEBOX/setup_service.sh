#!/bin/bash

# VJ Engine - System Service Setup
# This makes the VJ Engine run automatically when the device boots.

IS_EVT=false
IS_NODE=false
for arg in "$@"; do
    if [ "$arg" == "--evt" ]; then
        IS_EVT=true
        echo "🧪 EVT Mode: Using isolated service names."
    fi
    if [ "$arg" == "--node" ]; then
        IS_NODE=true
    fi
    if [ "$arg" == "-y" ] || [ "$arg" == "--non-interactive" ]; then
        NON_INTERACTIVE=true
    fi
done

SERVICE_NAME="vj-engine.service"
SERVER_SERVICE="vj-server.service"
LAUNCHER_SERVICE="vj-launcher.service"
CAMERA_SERVICE="vj-camera.service"
NODE_SERVICE="vj-node.service"

if [ "$IS_EVT" = true ]; then
    SERVICE_NAME="vj-engine-evt.service"
    SERVER_SERVICE="vj-server-evt.service"
    LAUNCHER_SERVICE="vj-launcher-evt.service"
    CAMERA_SERVICE="vj-camera-evt.service"
    NODE_SERVICE="vj-node-evt.service"
fi

CURRENT_DIR=$(pwd)

# --- Bootstrap Virtual Environment if missing ---
if [ -d "venv" ]; then
    if ! venv/bin/python3 -c "import sys" &>/dev/null; then
        echo "⚠️ Virtual environment 'venv' is broken or from a different Python version. Purging..."
        rm -rf venv
    fi
fi

if [ ! -d "venv" ]; then
    echo "📦 Virtual environment 'venv' not found. Bootstrapping..."
    if ! command -v python3 &> /dev/null; then
        echo "❌ python3 is not installed. Please install it first."
        exit 1
    fi
    
    python3 -m venv venv || {
        echo "❌ Failed to create virtual environment. Attempting to install python3-venv..."
        sudo apt-get update && sudo apt-get install -y python3-venv
        python3 -m venv venv
    }
fi

# --- Ensure dependencies are installed ---
VENV_PY="$CURRENT_DIR/venv/bin/python3"
echo "📦 Verifying virtual environment dependencies..."
"$VENV_PY" -m pip install --upgrade pip --quiet || true

if [ "$IS_NODE" = true ]; then
    if ! "$VENV_PY" -c "import serial" &>/dev/null; then
        echo "📦 Installing pyserial in venv..."
        "$VENV_PY" -m pip install pyserial
    fi
else
    if [ -f "$CURRENT_DIR/backend/requirements.txt" ]; then
        echo "📦 Verifying/Installing backend requirements..."
        "$VENV_PY" -m pip install -r "$CURRENT_DIR/backend/requirements.txt"
    else
        if ! "$VENV_PY" -c "import serial" &>/dev/null; then
            echo "📦 Installing pyserial in venv..."
            "$VENV_PY" -m pip install pyserial
        fi
    fi
fi
echo "✅ Virtual environment dependencies verified."

echo "🔧 Setting up VJ Engine as a System Service ($SERVICE_NAME)..."

# 1. Prepare temporary service files
TMP_DIR=$(mktemp -d)
cp "vj-engine.service" "$TMP_DIR/$SERVICE_NAME"
cp "vj-server.service" "$TMP_DIR/$SERVER_SERVICE"
cp "vj-launcher.service" "$TMP_DIR/$LAUNCHER_SERVICE"
cp "vj-camera.service" "$TMP_DIR/$CAMERA_SERVICE"
cp "vj-node.service" "$TMP_DIR/$NODE_SERVICE"

# 2. Update the service files with the correct path
sed -i "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" "$TMP_DIR/$SERVICE_NAME"
sed -i "s|ExecStart=.*|ExecStart=$CURRENT_DIR/start.sh --engine-only|g" "$TMP_DIR/$SERVICE_NAME"
sed -i "s|User=.*|User=$USER|g" "$TMP_DIR/$SERVICE_NAME"

sed -i "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" "$TMP_DIR/$SERVER_SERVICE"
sed -i "s|ExecStart=.*|ExecStart=$CURRENT_DIR/start.sh --server-only|g" "$TMP_DIR/$SERVER_SERVICE"
sed -i "s|User=.*|User=$USER|g" "$TMP_DIR/$SERVER_SERVICE"

sed -i "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" "$TMP_DIR/$LAUNCHER_SERVICE"
sed -i "s|ExecStart=.*|ExecStart=/usr/bin/python3 $CURRENT_DIR/launcher.py|g" "$TMP_DIR/$LAUNCHER_SERVICE"
sed -i "s|User=.*|User=$USER|g" "$TMP_DIR/$LAUNCHER_SERVICE"

sed -i "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" "$TMP_DIR/$CAMERA_SERVICE"
sed -i "s|ExecStart=.*|ExecStart=$CURRENT_DIR/venv/bin/python3 $CURRENT_DIR/scripts/calibration_server.py|g" "$TMP_DIR/$CAMERA_SERVICE"
sed -i "s|User=.*|User=$USER|g" "$TMP_DIR/$CAMERA_SERVICE"

sed -i "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" "$TMP_DIR/$NODE_SERVICE"
sed -i "s|ExecStart=.*|ExecStart=$CURRENT_DIR/venv/bin/python3 $CURRENT_DIR/backend/dmx_node.py|g" "$TMP_DIR/$NODE_SERVICE"
sed -i "s|User=.*|User=$USER|g" "$TMP_DIR/$NODE_SERVICE"

# Dynamic UID for PulseAudio
USER_ID=$(id -u $USER)
for svc in "$SERVICE_NAME" "$SERVER_SERVICE" "$LAUNCHER_SERVICE" "$CAMERA_SERVICE" "$NODE_SERVICE"; do
    sed -i "s|/run/user/1000|/run/user/$USER_ID|g" "$TMP_DIR/$svc"
done

echo "   - Configured paths for user: $USER"

# 3. Copy to systemd
echo "   - Installing service files..."
sudo cp "$TMP_DIR/$SERVICE_NAME" /etc/systemd/system/
sudo cp "$TMP_DIR/$SERVER_SERVICE" /etc/systemd/system/
sudo cp "$TMP_DIR/$LAUNCHER_SERVICE" /etc/systemd/system/
sudo cp "$TMP_DIR/$CAMERA_SERVICE" /etc/systemd/system/
sudo cp "$TMP_DIR/$NODE_SERVICE" /etc/systemd/system/
rm -rf "$TMP_DIR"

# 4. Ensure user is in the audio and dialout groups
echo "   - Ensuring $USER is in the audio group..."
sudo usermod -a -G audio $USER || true
echo "   - Ensuring $USER is in the dialout group for DMX serial access..."
sudo usermod -a -G dialout $USER || true

# 5. Ensure user can run systemctl for these services without password
echo "   - Setting up sudo permissions for remote management..."
SUDOERS_FILE="/etc/sudoers.d/vj-launcher"
if [ "$IS_EVT" = true ]; then
    SUDOERS_FILE="/etc/sudoers.d/vj-launcher-evt"
fi

# Define explicit services to avoid wildcard parser restrictions on command arguments
SERVICES=("$SERVICE_NAME" "$SERVER_SERVICE" "$LAUNCHER_SERVICE" "$CAMERA_SERVICE" "$NODE_SERVICE")
CMD_LIST=""
for svc in "${SERVICES[@]}"; do
    CMD_LIST="$CMD_LIST/usr/bin/systemctl start $svc, /usr/bin/systemctl stop $svc, /usr/bin/systemctl restart $svc, /usr/bin/systemctl status $svc, /usr/bin/systemctl is-active $svc, /usr/bin/systemctl enable $svc, /usr/bin/systemctl disable $svc, /usr/bin/journalctl -u $svc, "
done
CMD_LIST="${CMD_LIST}/usr/bin/systemctl restart raspotify, /usr/bin/systemctl status raspotify"

SUDO_CMD="$USER ALL=(ALL) NOPASSWD: $CMD_LIST"
echo "$SUDO_CMD" | sudo tee "$SUDOERS_FILE" > /dev/null
sudo chmod 440 "$SUDOERS_FILE"

# 5. Reload and Enable
echo "   - Reloading systemd..."
sudo systemctl daemon-reload
echo "   - Enabling auto-start on boot..."


if [ "$IS_NODE" = true ]; then
    echo "🌐 NODE MODE: Enabling node service, disabling others."
    sudo systemctl disable $SERVICE_NAME $SERVER_SERVICE $LAUNCHER_SERVICE $CAMERA_SERVICE 2>/dev/null || true
    sudo systemctl enable $NODE_SERVICE
    sudo systemctl stop $SERVICE_NAME $SERVER_SERVICE $LAUNCHER_SERVICE $CAMERA_SERVICE 2>/dev/null || true
    sudo systemctl restart $NODE_SERVICE
else
    sudo systemctl disable $NODE_SERVICE 2>/dev/null || true
    sudo systemctl enable $SERVICE_NAME
    sudo systemctl enable $SERVER_SERVICE
    sudo systemctl enable $LAUNCHER_SERVICE
    sudo systemctl enable $CAMERA_SERVICE
    sudo systemctl start $SERVICE_NAME
    sudo systemctl start $LAUNCHER_SERVICE
    sudo systemctl start $SERVER_SERVICE
    sudo systemctl start $CAMERA_SERVICE
fi

# 4. Start immediately?
if [ "$NON_INTERACTIVE" = true ]; then
    echo "✅ Setup Complete (Non-Interactive)."
    exit 0
fi

read -p "🚀 Do you want to start the service NOW? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    # Kill any existing instances first to avoid conflict
    ./start.sh --kill-only 2>/dev/null
    
    echo "   - Starting service..."
    sudo systemctl start $SERVICE_NAME
    echo "✅ Service Started! Check status with: sudo systemctl status $SERVICE_NAME"
else
    echo "✅ Setup Complete. Service will start on next reboot."
fi
