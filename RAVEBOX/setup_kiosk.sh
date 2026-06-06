#!/bin/bash
# RaveBox - Kiosk Setup Utility for Pi 4 (Wayland + Cage)
set -e

echo "🖥️ Starting RaveBox Kiosk Installer (Wayland + Cage)..."

# 1. Privilege Check
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run this script with sudo (e.g., sudo ./setup_kiosk.sh)"
  exit 1
fi

# Identify the actual non-root user who executed the script via sudo
REAL_USER=${SUDO_USER:-$USER}
USER_HOME=$(eval echo ~$REAL_USER)
USER_ID=$(id -u "$REAL_USER")

echo "👤 Configuring kiosk for user: $REAL_USER (UID: $USER_ID)"

# 2. Package Installation
echo "📦 Installing system kiosk packages (cage, chromium/chromium-browser, xwayland)..."
apt-get update

# Dynamically resolve package name
if apt-cache policy chromium 2>/dev/null | grep -qE "Candidate: [^ (]"; then
  CHROMIUM_PKG="chromium"
  CHROMIUM_CMD="chromium"
elif apt-cache policy chromium-browser 2>/dev/null | grep -qE "Candidate: [^ (]"; then
  CHROMIUM_PKG="chromium-browser"
  CHROMIUM_CMD="chromium-browser"
else
  echo "⚠️ Could not find installable chromium or chromium-browser in apt cache, defaulting to 'chromium'..."
  CHROMIUM_PKG="chromium"
  CHROMIUM_CMD="chromium"
fi

apt-get install -y cage "$CHROMIUM_PKG" xwayland seatd libportaudio2

# 3. Hardware Group Permissions
echo "🔧 Adding $REAL_USER to required hardware groups..."
EXISTING_GROUPS=""
for group in video render input audio dialout tty seat; do
  if getent group "$group" >/dev/null; then
    usermod -a -G "$group" "$REAL_USER"
    if [ -z "$EXISTING_GROUPS" ]; then
      EXISTING_GROUPS="$group"
    else
      EXISTING_GROUPS="$EXISTING_GROUPS $group"
    fi
  fi
done

# 3.5. Create udev rule to tag card0 and card1 for systemd tracking
echo "🏷️ Creating udev rule for graphics device tracking..."
echo 'ACTION=="add", SUBSYSTEM=="drm", KERNEL=="card*", TAG+="systemd"' > /etc/udev/rules.d/99-dev-dri-card.rules
udevadm control --reload-rules
udevadm trigger

# 3.6. Create udev rule for touchscreen calibration & output mapping (rotate=90 portrait layout)
echo "🏷️ Creating udev rule for touchscreen calibration & mapping..."
# Uses 90 degree clockwise rotation matrix to align touch with rotate=90 display orientation.
echo 'ACTION=="add|change", KERNEL=="event*", ATTRS{name}=="ADS7846 Touchscreen", ENV{LIBINPUT_CALIBRATION_MATRIX}="0 -1 1 1 0 0 0 0 1", ENV{WL_OUTPUT}="SPI-1"' > /etc/udev/rules.d/98-touchscreen-cal.rules
udevadm control --reload-rules
udevadm trigger

# 4. Generate systemd service for Cage kiosk
KIOSK_SERVICE="/etc/systemd/system/vj-kiosk.service"
echo "⚙️ Generating systemd service at $KIOSK_SERVICE..."

cat > "$KIOSK_SERVICE" << EOF
[Unit]
Description=RaveBox Wayland Kiosk Visualizer
After=vj-server.service vj-engine.service network.target dev-dri-card0.device systemd-logind.service seatd.service plymouth-quit-wait.service getty@tty1.service
Wants=vj-server.service vj-engine.service dev-dri-card0.device systemd-logind.service seatd.service plymouth-quit-wait.service
Requires=dev-dri-card0.device
Conflicts=getty@tty1.service

[Service]
User=$REAL_USER
# Explicitly assign group privileges for graphics and input hardware access
SupplementaryGroups=$EXISTING_GROUPS
Type=simple
PAMName=login
TimeoutStopSec=2s

# Bind service to tty1 to register a local active seat session in logind
TTYPath=/dev/tty1
StandardInput=tty-force
StandardOutput=journal
StandardError=journal

# Create a reliable, isolated Wayland runtime environment independent of login timings
RuntimeDirectory=vj-kiosk
RuntimeDirectoryMode=0700
Environment=XDG_RUNTIME_DIR=/run/vj-kiosk
Environment=HOME=$USER_HOME

Environment=MOZ_ENABLE_WAYLAND=1
# Route output to the GPIO display (card2) or fallback to card1/card0
Environment=WLR_DRM_DEVICES=/dev/dri/card2:/dev/dri/card1:/dev/dri/card0
# Force Pixman software renderer (SPI displays do not support GLES/EGL page flips)
Environment=WLR_RENDERER=pixman
# Disable DRM modifiers to allow simple buffer allocations
Environment=WLR_DRM_NO_MODIFIERS=1
# Run cage pointing directly to the local RaveBox visualizer
# Note: WLR_LIBINPUT_NO_DEVICES is omitted to allow auto-hiding the cursor on touch-only seats.
ExecStart=/usr/bin/cage -- $CHROMIUM_CMD \\
  --user-data-dir=$USER_HOME/.config/chromium-kiosk \\
  --app=http://localhost:8000/managerlite.html \\
  --noerrdialogs \\
  --disable-infobars \\
  --no-first-run \\
  --autoplay-policy=no-user-gesture-required \\
  --enable-features=UseOzonePlatform \\
  --ozone-platform=wayland \\
  --force-device-scale-factor=1.0 \\
  --window-size=320,480 \\
  --touch-events=enabled \\
  --enable-logging=stderr \\
  --v=1



Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 5. Enable Logind Lingering
echo "🔧 Enabling loginctl user session lingering..."
loginctl enable-linger "$REAL_USER"

# 6. Apply systemd configurations
echo "🔄 Reloading systemd daemon..."
systemctl daemon-reload

echo "🚀 Enabling vj-kiosk service on boot..."
systemctl enable vj-kiosk.service

# 7. Set default systemd target to graphical
echo "🖥️ Setting default systemd boot target to graphical.target..."
systemctl set-default graphical.target

echo "✅ Kiosk setup completed! To start immediately, run: sudo systemctl start vj-kiosk"
echo ""
echo "⚠️ IMPORTANT: For 3.5-inch SPI LCD screens, please ensure you have"
echo "configured /boot/firmware/config.txt with the following overlay and rebooted:"
echo "--------------------------------------------------------"
echo "dtparam=spi=on"
echo "dtoverlay=piscreen,drm,rotate=90"
echo "--------------------------------------------------------"
echo "Note: If the display is upside down, change 'rotate=90' to 'rotate=270' and update the"
echo "udev rule matrix in /etc/udev/rules.d/98-touchscreen-cal.rules to:"
echo "ENV{LIBINPUT_CALIBRATION_MATRIX}=\"0 -1 1 1 0 0 0 0 1\""
