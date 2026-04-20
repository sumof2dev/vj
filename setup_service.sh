#!/bin/bash

# VJ Engine - System Service Setup
# This makes the VJ Engine run automatically when the device boots.

IS_EVT=false
for arg in "$@"; do
    if [ "$arg" == "--evt" ]; then
        IS_EVT=true
        echo "🧪 EVT Mode: Using isolated service names."
    fi
done

SERVICE_NAME="vj-engine.service"
SERVER_SERVICE="vj-server.service"
LAUNCHER_SERVICE="vj-launcher.service"
CAMERA_SERVICE="vj-camera.service"

if [ "$IS_EVT" = true ]; then
    SERVICE_NAME="vj-engine-evt.service"
    SERVER_SERVICE="vj-server-evt.service"
    LAUNCHER_SERVICE="vj-launcher-evt.service"
    CAMERA_SERVICE="vj-camera-evt.service"
fi

CURRENT_DIR=$(pwd)

echo "🔧 Setting up VJ Engine as a System Service ($SERVICE_NAME)..."

# 1. Prepare temporary service files
TMP_DIR=$(mktemp -d)
cp "vj-engine.service" "$TMP_DIR/$SERVICE_NAME"
cp "vj-server.service" "$TMP_DIR/$SERVER_SERVICE"
cp "vj-launcher.service" "$TMP_DIR/$LAUNCHER_SERVICE"
cp "vj-camera.service" "$TMP_DIR/$CAMERA_SERVICE"

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

echo "   - Configured paths for user: $USER"

# 3. Copy to systemd
echo "   - Installing service files..."
sudo cp "$TMP_DIR/$SERVICE_NAME" /etc/systemd/system/
sudo cp "$TMP_DIR/$SERVER_SERVICE" /etc/systemd/system/
sudo cp "$TMP_DIR/$LAUNCHER_SERVICE" /etc/systemd/system/
sudo cp "$TMP_DIR/$CAMERA_SERVICE" /etc/systemd/system/
rm -rf "$TMP_DIR"

# 4. Ensure user can run systemctl for these services without password
echo "   - Setting up sudo permissions for remote management..."
SUDOERS_FILE="/etc/sudoers.d/vj-launcher"
if [ "$IS_EVT" = true ]; then
    SUDOERS_FILE="/etc/sudoers.d/vj-launcher-evt"
fi
SUDO_CMD="$USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start $SERVICE_NAME, /usr/bin/systemctl stop $SERVICE_NAME, /usr/bin/systemctl restart $SERVICE_NAME, /usr/bin/systemctl start $CAMERA_SERVICE, /usr/bin/systemctl stop $CAMERA_SERVICE, /usr/bin/systemctl restart $CAMERA_SERVICE"
echo "$SUDO_CMD" | sudo tee "$SUDOERS_FILE" > /dev/null
sudo chmod 440 "$SUDOERS_FILE"

# 5. Reload and Enable
echo "   - Reloading systemd..."
sudo systemctl daemon-reload
echo "   - Enabling auto-start on boot..."
sudo systemctl disable $SERVICE_NAME 2>/dev/null || true
sudo systemctl enable $SERVER_SERVICE
sudo systemctl enable $LAUNCHER_SERVICE
sudo systemctl enable $CAMERA_SERVICE
sudo systemctl start $LAUNCHER_SERVICE
sudo systemctl start $SERVER_SERVICE
sudo systemctl start $CAMERA_SERVICE

# 4. Start immediately?
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
