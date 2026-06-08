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

echo "📦 Running build and deploy tool locally first..."
./deploy.sh
if [ $? -ne 0 ]; then
    echo "❌ Local build or GCS deploy failed, aborting push update."
    exit 1
fi

REMOTE_PATH="/home/$REMOTE_USER/vj"
PI_PASS="qwaszx"

echo "🛰️ Pushing update to $REMOTE_USER@$TARGET..."

# Exclude list:
# - venv/ (too big, device-specific)
# - .git/
# - .cloudflared/ /etc/cloudflared/ (tunnel config)
# - cert.pem / key.pem (IP-specific)
# - *.log / __pycache__ / .wrangler / .spotify_cache
# - node_modules / dist (if any)
# - scratch / .agent (internal data)

sshpass -p "$PI_PASS" rsync -avz --progress \
    --exclude='venv' \
    --exclude='.git' \
    --exclude='.cloudflared' \
    --exclude='cert.pem' \
    --exclude='key.pem' \
    --exclude='*.pem' \
    --exclude='.antigravity' \
    --exclude='*creds*.json' \
    --exclude='*credentials*.json' \
    --exclude='crawled_audio' \
    --exclude='crawled_scratch' \
    --exclude='.env' \
    --exclude='*.env' \
    --exclude='*.log' \
    --exclude='logs' \
    --exclude='__pycache__' \
    --exclude='.wrangler' \
    --exclude='.spotify_cache' \
    --exclude='node_modules' \
    --exclude='visualizer_src/dist' \
    --exclude='visualizer_src/node_modules' \
    --exclude='.agent' \
    --exclude='scratch' \
    --exclude='recordings' \
    --exclude='fixtures' \
    --exclude='venv_local' \
    --exclude='training_data' \
    --exclude='backup-unused' \
    --exclude='tmp' \
    --exclude='tuning_config' \
    --exclude='.lgd-nfy0' \
    --exclude='crawler.py' \
    --exclude='offline_audit_engine.py' \
    --exclude='song_database' \
    --exclude='models' \
    --exclude='dev' \
    --exclude='scripts/acoustic_tokenization.py' \
    -e "ssh -o StrictHostKeyChecking=no" \
    ./ "$REMOTE_USER@$TARGET:$REMOTE_PATH/"

# Determine if we should set up as a node
SETUP_FLAGS="--non-interactive"
if [[ "$*" == *"--node"* ]]; then
    echo "Configuring services as Node on $TARGET..."
    SETUP_FLAGS="--node $SETUP_FLAGS"
else
    echo "Configuring services as Master on $TARGET..."
fi

sshpass -p "$PI_PASS" ssh -tt -o StrictHostKeyChecking=no "$REMOTE_USER@$TARGET" "cd $REMOTE_PATH && ./setup_service.sh $SETUP_FLAGS"

echo "Update complete on $TARGET!"

# Reboot the Pi (remote machine, NOT local)
# echo "Rebooting $TARGET..."
# sshpass -p "$PI_PASS" ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$TARGET" "echo $PI_PASS | sudo -S reboot" || true
# echo "Reboot command sent. Pi will be back in ~30s."
