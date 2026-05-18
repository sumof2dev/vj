#!/bin/bash
# RaveBox - Local Packaging Utility
# Generates a clean tar.gz for local-only deployment on a new device.

set -e

PACKAGE_NAME="vj_local_install.tar.gz"
EXCLUDE_FILE=".package_exclude"

echo "📦 Preparing Local-Only Package..."

# Create a temporary exclude file
cat > $EXCLUDE_FILE << EOF
venv
.git
.cloudflared
.agent
scratch
recordings
logs/*.log
*.log
__pycache__
.spotify_cache
node_modules
visualizer_src/node_modules
visualizer_src/dist
cert.pem
key.pem
vj_local_install.tar.gz
vj_secondary_install.tar.gz
.lgd-nfy0
EOF

# Package the directory
# We use --exclude-from to keep the command clean
# We use -C to ensure the tarball contains 'vj/' as the root folder if desired, 
# but usually for these installs we want the contents of the current dir.
# The user wants to "package and deploy the codebase", so we'll package the current directory.

echo "🗜️ Compressing files into $PACKAGE_NAME..."
tar -czf $PACKAGE_NAME --exclude-from=$EXCLUDE_FILE .

# Cleanup
rm $EXCLUDE_FILE

echo "✅ Package created: $PACKAGE_NAME"
echo "📏 Size: $(du -h $PACKAGE_NAME | cut -f1)"
