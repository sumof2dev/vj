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

# 0. Ghost Purge (SD Clone Protection)
# Aggressively delete local configs to prevent split-brain routing from cloned devices
echo -e "\n${YELLOW}[Step 1/3] Hunting for Ghost Configurations...${NC}"
if systemctl is-active --quiet cloudflare-tunnel.service; then
    echo -e "${RED}   - Stopping active cloudflare-tunnel.service${NC}"
    sudo systemctl stop cloudflare-tunnel.service || true
fi

if systemctl is-enabled --quiet cloudflare-tunnel.service 2>/dev/null; then
    echo -e "${RED}   - Disabling cloudflare-tunnel.service${NC}"
    sudo systemctl disable cloudflare-tunnel.service || true
fi

GHOST_CLEARED=false
if [ -d "$HOME/.cloudflared" ]; then
    echo -e "${MAGENTA}   - Purging local ~/.cloudflared directory${NC}"
    rm -rf "$HOME/.cloudflared"
    GHOST_CLEARED=true
fi

if [ -d "/etc/cloudflared" ]; then
    echo -e "${MAGENTA}   - Purging system /etc/cloudflared directory${NC}"
    sudo rm -rf "/etc/cloudflared"
    GHOST_CLEARED=true
fi

if [ "$GHOST_CLEARED" = true ]; then
    echo -e "${GREEN}✅ Ghost Configurations Purged. Device is purely sandboxed.${NC}"
else
    echo -e "${GREEN}✅ No Ghost Configurations found. System is clean.${NC}"
fi

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

# 3. Halt and Provide Manual Instructions
echo -e "\n${YELLOW}[Step 3/3] Readiness & Manual Mapping${NC}"
echo -e "This installation script intentionally ${RED}DOES NOT${NC} connect to Cloudflare."
echo -e "Your device remains completely sandboxed on its local network."
echo -e ""
echo -e "To access this device remotely, you must pair it via the Zero Trust Dashboard:"
echo -e "1. Go to your Cloudflare Zero Trust Dashboard -> Access -> Tunnels"
echo -e "2. Create a new tunnel (or select the specific one for this device)"
echo -e "3. Copy the installation terminal command:"
echo -e "   ${DIM}(e.g. sudo cloudflared service install eyJhb...)${NC}"
echo -e "4. Paste and run that explicit command in this terminal."
echo -e ""
echo -e "${YELLOW}Optional: Armor the Tunnel${NC}"
echo -e "Once you have installed the service, you can run this to bind it to this specific hardware:"
echo -e "   ${DIM}sudo sed -i '/\\[Service\\]/a ExecStartPre=/home/sumof2/vj/tunnel_guardian.sh' /etc/systemd/system/cloudflare-tunnel.service && sudo systemctl daemon-reload${NC}"
echo -e ""
echo -e "${GREEN}LFG! Device is sandboxed and ready for your command.${NC}"
