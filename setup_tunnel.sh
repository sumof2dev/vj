#!/bin/bash
# VJ Tunnel Setup - Automates the Cloudflare Global Ingress (Option 1)
# -----------------------------------------------------------------

set -e
NC='\033[0m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}   🚀 RaveBox Global Access - Tunnel Setup          ${NC}"
echo -e "${CYAN}====================================================${NC}"

# 0. Safety Guard - Cloud-Managed Detection
if cloudflared tunnel list | grep -q "ravebox-backend"; then
    echo -e "${RED}⚠️  CLOUD-MANAGED TUNNEL DETECTED (ravebox-backend)${NC}"
    echo -e "This system is configured for a ${GREEN}Cloud-First Production Flow${NC}."
    echo -e "Manual scripts are strictly forbidden from modifying this configuration."
    echo -e ""
    echo -e "To change ingress rules or hostnames, use the ${CYAN}Cloudflare Zero Trust Dashboard${NC}."
    echo -e "Refer to ${YELLOW}setup.md${NC} for documentation on the Golden Architecture."
    exit 1
fi


# Architecture Detection
ARCH=$(uname -m)
case "$ARCH" in
    aarch64)  CF_ARCH="arm64" ;;
    armv7l)   CF_ARCH="arm" ;;
    x86_64)   CF_ARCH="amd64" ;;
    *)        CF_ARCH="amd64" ;;
esac

# Check for cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "📦 Downloading cloudflared for $ARCH..."
    curl -L --output cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CF_ARCH.deb"
    sudo dpkg -i cloudflared.deb
    rm cloudflared.deb
fi

# 1. Login
echo -e "\n${YELLOW}[Step 1/3] Cloudflare Authentication${NC}"
echo "Opening browser for login (or follow the link displayed below)..."
echo -e "${DIM}Note: You only need to do this once per device.${NC}"
cloudflared tunnel login

# 2. Name & Create Tunnel
echo -e "\n${YELLOW}[Step 2/3] Define Your Secret Code${NC}"
read -p "Enter your unique RaveBox Code (e.g. 'vibe-machine'): " BOX_NAME

if [[ -z "$BOX_NAME" ]]; then
    echo -e "${RED}❌ Error: Box Name cannot be empty.${NC}"
    exit 1
fi

echo "Creating tunnel for $BOX_NAME..."
cloudflared tunnel create "$BOX_NAME" || { echo -e "${YELLOW}⚠️ Tunnel already exists? Attempting to recover...${NC}"; }

# 3. Auto-Configure Ingress
echo -e "\n${YELLOW}[Step 3/3] Generating Ingress Rules${NC}"
CONFIG_DIR="$HOME/.cloudflared"
mkdir -p "$CONFIG_DIR"
CONFIG_FILE="$CONFIG_DIR/config.yml"

# Get Tunnel ID
TUNNEL_ID=$(cloudflared tunnel list | grep "$BOX_NAME" | awk '{print $1}')
if [[ -z "$TUNNEL_ID" ]]; then
    echo -e "${RED}❌ Error: Could not find Tunnel ID for $BOX_NAME.${NC}"
    exit 1
fi
CRED_FILE="$CONFIG_DIR/$TUNNEL_ID.json"

cat <<EOF > "$CONFIG_FILE"
tunnel: $TUNNEL_ID
credentials-file: $CRED_FILE

ingress:
  # 1. Main UI & Static Assets (Port 8000)
  - hostname: $BOX_NAME.ravebox.love
    service: https://localhost:8000
    originRequest:
      noTLSVerify: true
  
  # 2. System Admin / Launcher (Port 8001)
  - hostname: api-$BOX_NAME.ravebox.love
    service: https://localhost:8001
    originRequest:
      noTLSVerify: true

  # 3. DMX Engine WebSocket (Port 8765)
  - hostname: ws-$BOX_NAME.ravebox.love
    service: https://localhost:8765
    originRequest:
      noTLSVerify: true

  - service: http_status:404
EOF

echo -e "\n${GREEN}LFG! Your Secret Code '$BOX_NAME' is ready for remote work.${NC}"

echo -e "\n${GREEN}LFG! Your Secret Code '$BOX_NAME' is ready for remote work.${NC}"
