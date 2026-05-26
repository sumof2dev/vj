#!/bin/bash
# RaveBox - Full System Restart

echo "🔄 Restarting all VJ services..."

sudo systemctl restart vj-launcher.service
sudo systemctl restart vj-server.service
sudo systemctl restart vj-camera.service
sudo systemctl restart vj-engine.service

echo "✅ All services restarted."
./vjstatus.sh
