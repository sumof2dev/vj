#!/bin/bash
echo "⚙️ Updating vj-server.service systemd unit..."
sudo tee /etc/systemd/system/vj-server.service << 'EOF'
[Unit]
Description=VJ Static Server (Port 8000)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=sumof2
# CRITICAL: Allow service to access User Audio (PulseAudio/Pipewire)
Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=PULSE_RUNTIME_PATH=/run/user/1000/pulse
WorkingDirectory=/home/sumof2/projects/RAVEBOX
ExecStart=/home/sumof2/projects/RAVEBOX/start.sh --server-only
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "🔄 Reloading systemd and restarting service..."
sudo systemctl daemon-reload
sudo systemctl restart vj-server.service
echo "✅ Done! Live audio stream should now work."
