#!/bin/bash
# RaveBox - Push Update Utility
# Usage: ./push_update.sh [REMOTE_IP_OR_HOST]

if [[ "$1" == *"@"* ]]; then
    REMOTE_USER=$(echo "$1" | cut -d'@' -f1)
    TARGET=$(echo "$1" | cut -d'@' -f2)
else
    REMOTE_USER=$(whoami)
    TARGET=$1
fi

if [ -z "$TARGET" ]; then
    echo "Usage: ./push_update.sh [user@]target"
    exit 1
fi

REMOTE_PATH="/home/$REMOTE_USER/vj"

echo "🛰️ Pushing update to $REMOTE_USER@$TARGET..."

# Exclude list:
# - venv/ (too big, device-specific)
# - .git/
# - .cloudflared/ /etc/cloudflared/ (tunnel config)
# - cert.pem / key.pem (IP-specific)
# - *.log / __pycache__ / .wrangler / .spotify_cache
# - node_modules / dist (if any)
# - scratch / .agent (internal data)

rsync -avz --progress \
    --exclude='venv' \
    --exclude='.git' \
    --exclude='.cloudflared' \
    --exclude='cert.pem' \
    --exclude='key.pem' \
    --exclude='*.log' \
    --exclude='__pycache__' \
    --exclude='.wrangler' \
    --exclude='.spotify_cache' \
    --exclude='node_modules' \
    --exclude='visualizer_src/dist' \
    --exclude='visualizer_src/node_modules' \
    --exclude='.agent' \
    --exclude='scratch' \
    ./ "$REMOTE_USER@$TARGET:$REMOTE_PATH/"

echo "🔄 Restarting services on $TARGET..."
ssh -t "$REMOTE_USER@$TARGET" "cd $REMOTE_PATH && sudo systemctl restart vj-*"

echo "✅ Update complete on $TARGET!"
