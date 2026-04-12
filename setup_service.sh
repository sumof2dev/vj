#!/bin/bash

# VJ Engine - System Service Setup
# This makes the VJ Engine run automatically when the device boots.

SERVICE_NAME="vj-engine.service"
SERVER_SERVICE="vj-server.service"
LAUNCHER_SERVICE="vj-launcher.service"
CAMERA_SERVICE="vj-camera.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
SERVER_PATH="/etc/systemd/system/$SERVER_SERVICE"
LAUNCHER_PATH="/etc/systemd/system/$LAUNCHER_SERVICE"
CAMERA_PATH="/etc/systemd/system/$CAMERA_SERVICE"
CURRENT_DIR=$(pwd)

echo "🔧 Setting up VJ Engine as a System Service..."

# 1. Update the service files with the correct path
sed -i "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" "$SERVICE_NAME"
sed -i "s|ExecStart=.*|ExecStart=$CURRENT_DIR/start.sh --engine-only|g" "$SERVICE_NAME"
sed -i "s|User=.*|User=$USER|g" "$SERVICE_NAME"

sed -i "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" "$SERVER_SERVICE"
sed -i "s|ExecStart=.*|ExecStart=$CURRENT_DIR/start.sh --server-only|g" "$SERVER_SERVICE"
sed -i "s|User=.*|User=$USER|g" "$SERVER_SERVICE"

sed -i "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" "$LAUNCHER_SERVICE"
sed -i "s|ExecStart=.*|ExecStart=/usr/bin/python3 $CURRENT_DIR/launcher.py|g" "$LAUNCHER_SERVICE"
sed -i "s|User=.*|User=$USER|g" "$LAUNCHER_SERVICE"

sed -i "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" "$CAMERA_SERVICE"
sed -i "s|ExecStart=.*|ExecStart=$CURRENT_DIR/venv/bin/python3 $CURRENT_DIR/scripts/calibration_server.py|g" "$CAMERA_SERVICE"
sed -i "s|User=.*|User=$USER|g" "$CAMERA_SERVICE"

echo "   - Configured paths for user: $USER"

# 2. Copy to systemd
echo "   - Installing service files..."
sudo cp "$SERVICE_NAME" /etc/systemd/system/
sudo cp "$SERVER_SERVICE" /etc/systemd/system/
sudo cp "$LAUNCHER_SERVICE" /etc/systemd/system/
sudo cp "$CAMERA_SERVICE" /etc/systemd/system/

# 2.5 Ensure user can run systemctl for these services without password
echo "   - Setting up sudo permissions for remote management..."
SUDOERS_FILE="/etc/sudoers.d/vj-launcher"
SUDO_CMD="$USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start $SERVICE_NAME, /usr/bin/systemctl stop $SERVICE_NAME, /usr/bin/systemctl restart $SERVICE_NAME, /usr/bin/systemctl start $CAMERA_SERVICE, /usr/bin/systemctl stop $CAMERA_SERVICE, /usr/bin/systemctl restart $CAMERA_SERVICE"
echo "$SUDO_CMD" | sudo tee "$SUDOERS_FILE" > /dev/null
sudo chmod 440 "$SUDOERS_FILE"

# 3. Reload and Enable
echo "   - Reloading systemd..."
sudo systemctl daemon-reload
echo "   - Enabling auto-start on boot..."
sudo systemctl disable $SERVICE_NAME
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
