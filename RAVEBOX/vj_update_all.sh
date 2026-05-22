#!/bin/bash
# RaveBox - Multi-Device Update Orchestrator
# This script pushes the current code to all devices in scripts/targets.txt

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
TARGETS_FILE="$DIR/scripts/targets.txt"

if [ ! -f "$TARGETS_FILE" ]; then
    if [ -n "$1" ]; then
        echo "📍 No targets.txt found. Pushing to provided target: $1"
        "$DIR/push_update.sh" "$1"
        exit 0
    else
        echo "❌ Error: No targets found. Create scripts/targets.txt or provide user@ip as an argument."
        exit 1
    fi
fi

echo "🚀 Pushing updates to all known devices..."
while IFS= read -r target || [[ -n "$target" ]]; do
    [[ "$target" =~ ^#.*$ ]] && continue # Skip comments
    [[ -z "$target" ]] && continue       # Skip empty lines
    
    echo "----------------------------------------------------"
    "$DIR/push_update.sh" "$target"
done < "$TARGETS_FILE"

echo "🏁 All updates complete."
