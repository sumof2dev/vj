#!/bin/bash
# RaveBox - Full System Restart

echo "🔄 Restarting all VJ services..."

sudo systemctl restart vj-launcher
sudo systemctl restart vj-server
sudo systemctl restart vj-camera
sudo systemctl restart vj-engine

echo "✅ All services restarted."
./vjstatus.sh
