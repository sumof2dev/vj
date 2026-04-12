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
sed -i -E "s/(window\.APP_VERSION = \")[0-9]+(\";)/\1$VERSION_CODE\2/" shared_setup.js

# 2. Update console logs in manager.html
sed -i -E "s/(btn\.innerText = action === 'start' \? \")[0-9]+(\" : \"Until next time\";)/\1$VERSION_CODE\2/" manager.html

# 3. Update APP_VERSION in other HTML files that still have it (legacy)
sed -i -E "s/(const APP_VERSION = \")[0-9]+(\";)/\1$VERSION_CODE\2/" fixture_ai.html

# 4. Global Cache Buster: Update ?v= tags in all HTML files
echo "🧹 Updating cache busters (?v=) in HTML files..."
sed -i -E "s/(\.js\?v=)[0-9]+/\1$VERSION_CODE/g" *.html
sed -i -E "s/(\.css\?v=)[0-9]+/\1$VERSION_CODE/g" *.html
sed -i -E "s/(VJ Manager v)[0-9]+/\1$VERSION_CODE/g" setup.html

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
