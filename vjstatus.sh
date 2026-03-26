#!/bin/bash
# VJ System Status Check

BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
RED="\033[31m"
CYAN="\033[36m"
YELLOW="\033[33m"
RESET="\033[0m"

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$LAN_IP" ] && LAN_IP="unknown"

echo ""
echo -e "${BOLD}🔎 VJ System Status${RESET}  ${DIM}($LAN_IP)${RESET}"
echo -e "${DIM}──────────────────────────────────────${RESET}"

# --- Systemd Services ---
echo -e "\n${BOLD}Services${RESET}"
for svc in vj-server vj-launcher vj-engine; do
    status=$(systemctl is-active ${svc}.service 2>/dev/null)
    if [ "$status" = "active" ]; then
        echo -e "  ${GREEN}●${RESET} ${svc}  ${GREEN}running${RESET}"
    else
        echo -e "  ${RED}○${RESET} ${svc}  ${DIM}stopped${RESET}"
    fi
done

# --- Port Check ---
echo -e "\n${BOLD}Ports${RESET}"
declare -A PORTS
PORTS[8000]="Server (HTTPS)"
PORTS[8001]="Launcher"
PORTS[8765]="Engine WS"
PORTS[8085]="Dev Server (HTTP)"

for port in 8000 8001 8765 8085; do
    pid=$(fuser ${port}/tcp 2>/dev/null | awk '{print $1}')
    if [ -n "$pid" ]; then
        proc=$(ps -p $pid -o comm= 2>/dev/null)
        echo -e "  ${GREEN}●${RESET} :${port}  ${PORTS[$port]}  ${DIM}(pid $pid — $proc)${RESET}"
    else
        echo -e "  ${RED}○${RESET} :${port}  ${PORTS[$port]}"
    fi
done

# --- Cloudflare Tunnel ---
echo -e "\n${BOLD}Tunnel${RESET}"
cf_pid=$(pgrep -f cloudflared 2>/dev/null | head -1)
if [ -n "$cf_pid" ]; then
    echo -e "  ${GREEN}●${RESET} cloudflared  ${GREEN}running${RESET}  ${DIM}(pid $cf_pid)${RESET}"
else
    echo -e "  ${RED}○${RESET} cloudflared  ${DIM}not running${RESET}"
fi

# --- Remote Access Test ---
echo -e "\n${BOLD}Connectivity${RESET}"

# Local server reachable?
if curl -sk --max-time 2 https://127.0.0.1:8000/ >/dev/null 2>&1; then
    echo -e "  ${GREEN}●${RESET} Local HTTPS (8000)  ${GREEN}reachable${RESET}"
elif curl -s --max-time 2 http://127.0.0.1:8000/ >/dev/null 2>&1; then
    echo -e "  ${GREEN}●${RESET} Local HTTP (8000)  ${GREEN}reachable${RESET}"
else
    echo -e "  ${RED}○${RESET} Local (8000)  ${DIM}unreachable${RESET}"
fi

# Dev server?
if curl -s --max-time 2 http://127.0.0.1:8085/ >/dev/null 2>&1; then
    echo -e "  ${GREEN}●${RESET} Dev Server (8085)  ${GREEN}reachable${RESET}"
else
    echo -e "  ${RED}○${RESET} Dev Server (8085)  ${DIM}not running${RESET}"
fi

# GCS / remote frontend
if curl -s --max-time 3 https://ravebox.love/ >/dev/null 2>&1; then
    echo -e "  ${GREEN}●${RESET} Remote Frontend  ${GREEN}ravebox.love up${RESET}"
else
    echo -e "  ${YELLOW}○${RESET} Remote Frontend  ${DIM}ravebox.love unreachable${RESET}"
fi

echo -e "\n${DIM}──────────────────────────────────────${RESET}"
echo ""
