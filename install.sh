#!/bin/bash
# =================================================================
# VJ Engine - Master Installation Script (v2.6)
# Target Device: Raspberry Pi 5 (Recommended)
# =================================================================

set -e # Exit on error

# Colors for UX
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
DIM='\033[2m' # Dim text
MAGENTA='\033[0;35m' # Magenta text

echo ""
echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}   🚀 RaveBox VJ Engine - Full Installation        ${NC}"
echo -e "${CYAN}====================================================${NC}"

# 1. System Dependencies
echo ""
echo -e "${YELLOW}[Step 1/6] Installing System Dependencies...${NC}"
sudo apt update
sudo apt install -y python3-venv libasound2-dev libpulse0 pulseaudio-utils \
                     gpiod libgpiod-dev openssl fuser jq curl

# 2. Hardware Mapping (/boot/firmware/config.txt)
echo ""
echo -e "${YELLOW}[Step 2/6] Configuring Hardware Overlays (UART/I2S)...${NC}"
CONFIG_FILE="/boot/firmware/config.txt"
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}⚠️  $CONFIG_FILE not found. Trying legacy /boot/config.txt...${NC}"
    CONFIG_FILE="/boot/config.txt"
fi

MODS=(
    "dtparam=uart0=on"
    "dtoverlay=disable-bt"
    "enable_uart=1"
    "dtoverlay=uart0-pi5"
    "dtparam=audio=off"
    "dtoverlay=hifiberry-dacplus"
)

for mod in "${MODS[@]}"; do
    if ! grep -q "^$mod" "$CONFIG_FILE"; then
        echo -e "   + Adding: $mod"
        echo "$mod" | sudo tee -a "$CONFIG_FILE" > /dev/null
    else
        echo -e "   - Already set: $mod"
    fi
done

# 3. Python Environment Setup
echo ""
echo -e "${YELLOW}[Step 3/6] Setting up Python Virtual Environment...${NC}"
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}✅ venv created.${NC}"
fi

source venv/bin/activate
echo -e "📦 Installing Python requirements..."
pip install --upgrade pip
pip install -r backend/requirements.txt
deactivate

# 4. Clean Identity Templates
echo ""
echo -e "${YELLOW}[Step 4/6] Initializing Clean Identity Templates...${NC}"
if [ ! -f "spotify_creds.json" ]; then
    echo -e "   + Creating blank spotify_creds.json"
    echo '{"SPOT_CLIENT_ID":"", "SPOT_CLIENT_SECRET":"", "SPOTIFY_REDIRECT_URI":"https://ravebox.love/callback"}' > spotify_creds.json
else
    echo -e "   - spotify_creds.json already exists (preserving)."
fi

# 5. Security & Mobile Support
echo ""
echo -e "${YELLOW}[Step 5/6] Generating SSL Certificates...${NC}"
chmod +x generate_cert.sh
./generate_cert.sh

# 6. Service Installation
echo ""
echo -e "${YELLOW}[Step 6/6] Installing System Services...${NC}"
chmod +x setup_service.sh
./setup_service.sh

echo ""
echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}   ✨ INSTALLATION COMPLETE (Almost!)               ${NC}"
echo -e "${CYAN}====================================================${NC}"
echo -e "To reach ${GREEN}FULL FUNCTION${NC}, you must complete these three steps:"
echo ""
echo -e "${YELLOW}1. REBOOT${NC} to activate high-speed UART and HifiBerry drivers:"
echo -e "   > sudo reboot"
echo ""
echo -e "${YELLOW}2. SPOTIFY API${NC} (Bypassing developer tokens):"
echo -e "   Go to: ${CYAN}https://$(hostname -I | awk '{print $1}'):8000/help.html${NC}"
echo -e "   Follow the guide to register your own Client ID & Secret."
echo ""
echo -e "${YELLOW}3. GLOBAL ACCESS${NC} (Remote 'Secret Code' via ravebox.love):"
echo -e "   Run our new automation script:"
echo -e "   > ${YELLOW}chmod +x setup_tunnel.sh && ./setup_tunnel.sh${NC}"
echo ""
echo -e "${GREEN}LFG! Your RaveBox is ready. See you at ravebox.love${NC}"
echo ""
