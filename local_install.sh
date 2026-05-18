#!/bin/bash
# =================================================================
# VJ Engine - Local Installation Script (v1.0)
# Target: Local-Only Deployment (localhost / LAN)
# =================================================================

set -e # Exit on error

# Colors for UX
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}   🏠 RaveBox VJ Engine - Local Installation       ${NC}"
echo -e "${CYAN}====================================================${NC}"

# Detect Hardware
PI_MODEL=$(cat /proc/device-tree/model 2>/dev/null || echo "Unknown")
IS_PI=false
if [[ "$PI_MODEL" == *"Raspberry Pi"* ]]; then
    IS_PI=true
    echo -e "${GREEN}📍 Device Detected: $PI_MODEL${NC}"
else
    echo -e "${YELLOW}📍 Device Detected: Non-Pi ($PI_MODEL)${NC}"
fi

# 1. System Dependencies
echo ""
echo -e "${YELLOW}[Step 1/5] Installing System Dependencies...${NC}"

# Check for PipeWire (Common on Pop!_OS and newer Ubuntu)
USE_PIPEWIRE=false
if dpkg -l | grep -q "pipewire" || command -v pipewire > /dev/null; then
    USE_PIPEWIRE=true
    echo -e "${GREEN}🎵 PipeWire detected. Skipping legacy PulseAudio server to avoid conflicts.${NC}"
fi

# Define core dependencies
# Note: libglib2.0-0 is often replaced by libglib2.0-0t64 on newer systems; apt handles this.
DEPS="python3-venv libasound2-dev libpulse0 pulseaudio-utils libportaudio2 libportaudiocpp0 libgl1 libglib2.0-0"

# Add PulseAudio server ONLY if PipeWire isn't handling it
if [ "$USE_PIPEWIRE" = false ]; then
    DEPS="$DEPS pulseaudio"
fi

sudo apt update
sudo apt install -y $DEPS

# 2. Hardware Mapping (Pi-Specific)
if [ "$IS_PI" = true ]; then
    echo ""
    echo -e "${YELLOW}[Step 2/5] Configuring Hardware Overlays...${NC}"
    CONFIG_FILE="/boot/firmware/config.txt"
    if [ ! -f "$CONFIG_FILE" ]; then CONFIG_FILE="/boot/config.txt"; fi
    
    if [ -f "$CONFIG_FILE" ]; then
        MODS=("enable_uart=1" "dtoverlay=disable-bt")
        for mod in "${MODS[@]}"; do
            if ! grep -q "^$mod" "$CONFIG_FILE"; then
                echo "$mod" | sudo tee -a "$CONFIG_FILE" > /dev/null
            fi
        done
        echo -e "${GREEN}✅ Hardware configured in $CONFIG_FILE${NC}"
    fi
else
    echo ""
    echo -e "${YELLOW}[Step 2/5] Skipping Hardware Overlays (Non-Pi device)${NC}"
fi

# 3. Python Environment Setup
echo ""
echo -e "${YELLOW}[Step 3/5] Setting up Python Virtual Environment...${NC}"
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate
pip install --upgrade pip
if [ -f "backend/requirements.txt" ]; then
    pip install -r backend/requirements.txt
fi
deactivate
echo -e "${GREEN}✅ Python venv ready.${NC}"

# 4. SSL Certificates (For Local HTTPS)
echo ""
echo -e "${YELLOW}[Step 4/5] Generating SSL Certificates...${NC}"
chmod +x generate_cert.sh
./generate_cert.sh

# 5. Service Installation
echo ""
echo -e "${YELLOW}[Step 5/5] Installing System Services...${NC}"
chmod +x setup_service.sh
./setup_service.sh --non-interactive

echo ""
echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}   ✨ LOCAL INSTALLATION COMPLETE                  ${NC}"
echo -e "${CYAN}====================================================${NC}"
echo -e "Your RaveBox is now configured for ${GREEN}LOCAL-ONLY${NC} use."
echo ""
echo -e "${YELLOW}1. REBOOT${NC} if you are on a Raspberry Pi:"
echo -e "   > sudo reboot"
echo ""
echo -e "${YELLOW}2. ACCESS${NC} via local IP or localhost:"
LAN_IP=$(hostname -I | awk '{print $1}')
echo -e "   URL: ${CYAN}https://${LAN_IP:-localhost}:8000/manager.html${NC}"
echo ""
echo -e "${GREEN}LFG! No Cloudflare, no remote dependencies.${NC}"
echo ""
