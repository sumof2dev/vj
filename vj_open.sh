#!/bin/bash
# RaveBox - Open Manager URL

LAN_IP=$(hostname -I | awk '{print $1}')
URL="https://$LAN_IP:8000/manager.html"

echo "🔗 VJ Manager: $URL"

# If in a desktop environment, attempt to open
if command -v xdg-open &> /dev/null; then
    xdg-open "$URL" >/dev/null 2>&1 || true
fi
