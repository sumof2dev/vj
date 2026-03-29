#!/bin/bash
# VJ System - Visualizer Deployment Utility
# This script builds the React visualizer and syncs web assets to GCS.

# Ensure we are in the script's directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "🚀 Starting Visualizer Deployment from root..."

if [ ! -d "visualizer_src" ]; then
    echo "❌ Error: visualizer_src directory not found!"
    exit 1
fi

# Run the optimized deploy command from the subdirectory
cd visualizer_src
npm run deploy

# Check exit status
if [ $? -eq 0 ]; then
    echo "✅ Visualizer deployed successfully to GCS!"
else
    echo "❌ Deployment failed."
    exit 1
fi
