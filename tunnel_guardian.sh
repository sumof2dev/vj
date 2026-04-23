#!/bin/bash
# Tunnel Guardian - Hardware Clone Protection
# -----------------------------------------------------------------
# Ensures the Cloudflare Tunnel ONLY runs on the original authorized hardware.
# If an SD card is cloned and booted on a new Raspberry Pi, this script 
# detects the hardware mismatch and cleanly aborts the tunnel connection,
# preventing "tunnel hijacking" away from production.

LOCK_FILE="/home/sumof2/.cloudflared/locked_hardware_serial.txt"
# Extract the unique 16-character hardware serial from the Pi's CPU
CURRENT_SERIAL=$(cat /proc/cpuinfo | grep Serial | awk '{print $3}')

if [ -z "$CURRENT_SERIAL" ]; then
    echo "⚠️  Tunnel Guardian: Could not determine hardware serial. Allowing fallback..."
    exit 0
fi

# Initial Golden Run: Lock the Serial
if [ ! -f "$LOCK_FILE" ]; then
    echo "🔒 Tunnel Guardian: Initializing lock file."
    echo "   Tunnel is now permanently bound to Hardware Serial -> $CURRENT_SERIAL"
    echo "$CURRENT_SERIAL" > "$LOCK_FILE"
    exit 0
fi

LOCKED_SERIAL=$(cat "$LOCK_FILE")

# The Clone Detection Trap
if [ "$CURRENT_SERIAL" != "$LOCKED_SERIAL" ]; then
    echo "🚨 STOP: HARDWARE MISMATCH DETECTED 🚨"
    echo "   This SD Card was cloned to a new Raspberry Pi."
    echo "   Original Board:  $LOCKED_SERIAL"
    echo "   Current Board:   $CURRENT_SERIAL"
    echo "----------------------------------------------------------------"
    echo "The Cloudflare Tunnel startup has been ABORTED to prevent"
    echo "hijacking your active production tunnel."
    echo "If you intend to use this device as a new backend, you must run:"
    echo "⚠️ ./setup_tunnel.sh to purge ghost configs and relink the hardware."
    
    # We exit 1 to cause systemd to abort the ExecStart phase.
    exit 1
fi

echo "✅ Tunnel Guardian: Hardware Serial matches ($CURRENT_SERIAL). Proceeding."
exit 0
