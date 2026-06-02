#!/bin/bash
# VJ Tunnel Setup - Pure Sandbox & Zero-Trust Installer
# -----------------------------------------------------------------

set -e
NC='\033[0m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
MAGENTA='\033[0;35m'

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}   🚀 RaveBox Zero-Trust Tunnel Installer          ${NC}"
echo -e "${CYAN}====================================================${NC}"

# 0. Safe Environment Check (Sandbox Verification)
# Checks for existing tunnel processes without destroying stored development keys
echo -e "\n${YELLOW}[Step 1/3] Checking Environment Sanity...${NC}"
if systemctl is-active --quiet cloudflared.service; then
    echo -e "${YELLOW}   - Active background system tunnel detected.${NC}"
fi

if [ -f "$HOME/.cloudflared/config.yml" ]; then
    echo -e "${GREEN}   - Stored development config found (Preserving local data).${NC}"
else
    echo -e "${DIM}   - No localized config profiles detected.${NC}"
fi
echo -e "${GREEN}✅ Environment verification complete.${NC}"

# 1. Architecture Detection
echo -e "\n${YELLOW}[Step 2/3] Resolving Dependencies...${NC}"
ARCH=$(uname -m)
case "$ARCH" in
    aarch64)  CF_ARCH="arm64" ;;
    armv7l)   CF_ARCH="arm" ;;
    x86_64)   CF_ARCH="amd64" ;;
    *)        CF_ARCH="amd64" ;;
esac

# 2. Package Installation
if ! command -v cloudflared &> /dev/null; then
    echo "📦 Downloading cloudflared for $ARCH..."
    curl -L --output cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CF_ARCH.deb"
    sudo dpkg -i cloudflared.deb
    rm cloudflared.deb
    echo -e "${GREEN}✅ cloudflared installed successfully.${NC}"
else
    echo -e "${GREEN}✅ cloudflared is already installed.${NC}"
fi

# 3. Parameter and Mode Resolution
BOX_NAME=""
NON_INTERACTIVE=false
for arg in "$@"; do
    if [ "$arg" == "-y" ] || [ "$arg" == "--non-interactive" ]; then
        NON_INTERACTIVE=true
    fi
    if [[ ! "$arg" =~ ^- ]]; then
        BOX_NAME="$arg"
    fi
done

if [ -z "$BOX_NAME" ]; then
    if [ "$NON_INTERACTIVE" = true ]; then
        BOX_NAME=$(hostname)
    else
        DEFAULT_BOX_NAME=$(hostname)
        read -p "🔑 Enter your unique RaveBox subdomain name (default: $DEFAULT_BOX_NAME): " input_name
        BOX_NAME=${input_name:-$DEFAULT_BOX_NAME}
    fi
fi
BOX_NAME=$(echo "$BOX_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g')
echo -e "   - Using subdomain prefix: ${CYAN}$BOX_NAME${NC}"

# 4. Master Cert Check
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
    echo -e "\n${RED}❌ ERROR: Master cert.pem missing from $HOME/.cloudflared/${NC}"
    echo -e "Please scp your master account certificate to this device before running setup."
    exit 1
else
    echo -e "\n${GREEN}✅ Master Cloudflare certificate verified.${NC}"
fi

# 5. Non-Interactive Tunnel Provisioning
echo -e "\n${YELLOW}[Step 4/6] Provisioning Private Cloudflare Tunnel...${NC}"
TUNNEL_NAME="vj-tunnel-$BOX_NAME"
EXISTING_TUNNEL_UUID=$(cloudflared tunnel list 2>/dev/null | grep -w "$TUNNEL_NAME" | awk '{print $1}' || true)

if [ -n "$EXISTING_TUNNEL_UUID" ]; then
    echo -e "   - Re-linking existing tunnel profile: ${CYAN}$TUNNEL_NAME${NC} ($EXISTING_TUNNEL_UUID)"
    TUNNEL_UUID=$EXISTING_TUNNEL_UUID
else
    echo -e "   - Generating fresh unique tunnel infrastructure: ${CYAN}$TUNNEL_NAME${NC}"
    CREATE_OUTPUT=$(cloudflared tunnel create "$TUNNEL_NAME" 2>&1)
    TUNNEL_UUID=$(echo "$CREATE_OUTPUT" | grep -oE "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}" | head -n 1 || true)
fi

if [ -z "$TUNNEL_UUID" ]; then
    echo -e "${RED}❌ Tunnel provisioning failed. Output: $CREATE_OUTPUT${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Active Tunnel ID: $TUNNEL_UUID${NC}"

# 6. Generate Clean Path-Based Configuration Profile (Matching App.tsx Flow B)
echo -e "\n${YELLOW}[Step 5/6] Writing Consolidated Ingress Profile...${NC}"
CONFIG_DIR="$HOME/.cloudflared"
mkdir -p "$CONFIG_DIR"
CONFIG_FILE="$CONFIG_DIR/config.yml"

# Purge existing hardware serial lock file to allow the new device to lock onto its own CPU serial
rm -f "$CONFIG_DIR/locked_hardware_serial.txt"

cat <<EOF > "$CONFIG_FILE"
tunnel: $TUNNEL_UUID
credentials-file: /etc/cloudflared/$TUNNEL_UUID.json
protocol: quic

ingress:
  # High-Frequency Audio Stream WebSocket Pipe
  # Routes over plain HTTP context to allow local unencrypted websocket transport upgrades
  - hostname: $BOX_NAME.ravebox.love
    path: /ws
    service: http://127.0.0.1:8765

  # Launcher: Specific system daemon controls
  - hostname: $BOX_NAME.ravebox.love
    path: /api/status
    service: http://127.0.0.1:8001

  - hostname: $BOX_NAME.ravebox.love
    path: /api/start
    service: http://127.0.0.1:8001

  - hostname: $BOX_NAME.ravebox.love
    path: /api/stop
    service: http://127.0.0.1:8001

  - hostname: $BOX_NAME.ravebox.love
    path: /api/restart
    service: http://127.0.0.1:8001

  - hostname: $BOX_NAME.ravebox.love
    path: /api/camera/*
    service: http://127.0.0.1:8001

  - hostname: $BOX_NAME.ravebox.love
    path: /api/spotify/auth*
    service: http://127.0.0.1:8001

  - hostname: $BOX_NAME.ravebox.love
    path: /api/smart/control*
    service: http://127.0.0.1:8001

  # Default to Main Setup Server (8000) for all other UI and API endpoints
  - hostname: $BOX_NAME.ravebox.love
    service: http://127.0.0.1:8000

  - service: http_status:404
EOF
echo -e "${GREEN}✅ Single-Subdomain Config written to $CONFIG_FILE${NC}"

# 7. Register Single DNS Entry Block
echo -e "\n${YELLOW}[Step 6/6] Mapping Domain pointer to Cloudflare DNS...${NC}"
echo -e "   - Routing $BOX_NAME.ravebox.love..."
cloudflared tunnel route dns "$TUNNEL_NAME" "$BOX_NAME.ravebox.love" || true
echo -e "${GREEN}✅ Subdomain route registered successfully.${NC}"

# 8. Deploy Service & Armor
echo -e "\n${YELLOW}[Step 7/7] Installing System Service & Hardware Lock...${NC}"
if systemctl is-active --quiet cloudflared.service 2>/dev/null; then
    echo -e "   - Stopping active cloudflared.service"
    sudo systemctl stop cloudflared.service || true
fi
if systemctl is-enabled --quiet cloudflared.service 2>/dev/null; then
    echo -e "   - Disabling cloudflared.service"
    sudo systemctl disable cloudflared.service || true
fi

# Clean up old service installation files if present
sudo cloudflared service uninstall 2>/dev/null || true

# Deploy to system /etc/cloudflared space
echo -e "   - Copying credentials and config files..."
sudo mkdir -p /etc/cloudflared
sudo cp "$CONFIG_DIR/$TUNNEL_UUID.json" /etc/cloudflared/
sudo cp "$CONFIG_FILE" /etc/cloudflared/config.yml

# Adjust credentials file path in the copy inside /etc/cloudflared
sudo sed -i "s|credentials-file: .*|credentials-file: /etc/cloudflared/$TUNNEL_UUID.json|g" /etc/cloudflared/config.yml

# Install the daemon service
echo -e "   - Registering systemd daemon service..."
sudo cloudflared service install

# Copy & Deploy Clone Protection
sudo cp tunnel_guardian.sh /usr/local/bin/
sudo chmod 755 /usr/local/bin/tunnel_guardian.sh

# Apply Hardware Lock dynamically to the local file-based Cloudflare service daemon instance
echo -e "   - Binding tunnel to local hardware signature..."
TRUE_SVC_FILE=""
if [ -f "/etc/systemd/system/cloudflared.service" ]; then
    TRUE_SVC_FILE="/etc/systemd/system/cloudflared.service"
else
    TRUE_SVC_FILE=$(ls /etc/systemd/system/cloudflared-tunnel-*.service 2>/dev/null | head -n 1 || true)
fi

if [ -n "$TRUE_SVC_FILE" ]; then
    TRUE_SVC_NAME=$(basename "$TRUE_SVC_FILE")
    echo -e "   - Injecting hardware lock wrapper into systemd container: ${CYAN}$TRUE_SVC_NAME${NC}"
    sudo sed -i '/\[Service\]/a ExecStartPre=/usr/local/bin/tunnel_guardian.sh' "$TRUE_SVC_FILE"
    sudo systemctl daemon-reload

    echo -e "   - Starting service..."
    sudo systemctl enable "$TRUE_SVC_NAME"
    sudo systemctl start "$TRUE_SVC_NAME"
else
    echo -e "${RED}❌ ERROR: Cloudflare systemd service file could not be discovered on disk.${NC}"
    exit 1
fi

echo -e "\n${GREEN}⚡ Done! RaveBox cloud tunnel is active and bound to this hardware. Enjoy!${NC}"
