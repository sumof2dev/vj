#!/bin/bash
# VJ System - Visualizer Deployment Utility
# This script builds the React visualizer and syncs web assets to GCS.

# Ensure we are in the script's directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "🚀 Starting Visualizer Deployment from root..."

# Update version timestamps in JS & HTML to prevent cache issues
VERSION_CODE=$(date +%-m%-d%y%H%M)
echo "📅 Updating version timestamp to $VERSION_CODE..."

# 1. Update window.APP_VERSION in shared_setup.js
sed -i -E "s/(window\.APP_VERSION = \")[^\"]+(\";)/\1$VERSION_CODE\2/" shared_setup.js

# 2. Update version strings in HTML files
echo "📅 Updating version strings in HTML headers..."
sed -i -E "s/(VJ Manager v)[0-9]+/\1$VERSION_CODE/g" setup.html manager.html
sed -i -E "s/(VJ Console v)[0-9]+/\1$VERSION_CODE/g" console.html
sed -i -E "s/(VJ Player v)[0-9]+/\1$VERSION_CODE/g" player.html
sed -i -E "s/(VJ Standalone v)[0-9]+/\1$VERSION_CODE/g" standalone.html
sed -i -E "s/(VJ Profile Editor starting \(v)[0-9]+(\))/\1$VERSION_CODE\2/g" profile.html
sed -i -E "s/(Core Ready \(v)[0-9]+(\))/\1$VERSION_CODE\2/g" shared_setup.js

# 3. Update "Initializing" logic in manager.html
sed -i -E "s/(btn\.innerText = action === 'start' \? \(isNodePref \? \"INITIALIZING NODE\" : \")[0-9]+(\"\) : \"SHUTDOWN SEQUENCE\";)/\1$VERSION_CODE\2/" manager.html


if [ ! -d "visualizer_src" ]; then
    echo "❌ Error: visualizer_src directory not found!"
    exit 1
fi

# Run the optimized deploy command from the subdirectory
cd visualizer_src
npm run deploy

# Check exit status
if [ $? -eq 0 ]; then
    echo "🧹 Invalidating GCS/Cloudflare caches for HTML & JS assets..."
    gsutil -m setmeta -h "Cache-Control:no-store, no-cache, must-revalidate, max-age=0" gs://ravebox/*.js gs://ravebox/*.html gs://ravebox/assets/* 2>/dev/null || true
    echo "✅ Visualizer deployed successfully to GCS!"
else
    echo "❌ Deployment failed."
    exit 1
fi
