#!/bin/bash

# Kill background processes on exit (Ctrl+C)
trap 'kill %1; kill %2' SIGINT

# Ensure we are in the script's directory (Robust for Symlinks)
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE" # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located
done
DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
cd "$DIR" || exit

echo "🧹 Cleaning up old processes..."
fuser -k 8765/tcp > /dev/null 2>&1
fuser -k 8000/tcp > /dev/null 2>&1
sleep 1

echo "🚀 Starting Hybrid VJ Engine..."
echo "📂 Serving from: $(pwd)"

# 1. Start Backend (Unbuffered output for logging)
# 1. Start Backend (Unbuffered output for logging)
if [ -f ".venv/bin/python3" ]; then
    PYTHON_CMD=".venv/bin/python3"
else
    PYTHON_CMD="python3"
fi
$PYTHON_CMD -u backend/main.py &

# 2. Start Shairport Sync (AirPlay) as User
# Outputs to PulseAudio so Backend can hear it
if command -v shairport-sync &> /dev/null; then
    echo "📻 Starting AirPlay Receiver..."
    pkill shairport-sync # Kill any existing user instances
    # Run in background (user mode) to output to PulseAudio
    shairport-sync -o pa > /tmp/shairport.log 2>&1 &
fi

# Start Frontend Server
# We serve the current directory on port 8000
python3 -m http.server 8000 &

echo "✅ Systems UP!"
echo "👉 Open: http://localhost:8000/debug_app.html"
echo "   (Press Ctrl+C to stop)"

# Launch Browser in "App Mode"
# This creates a standalone window without address bar/tabs
URL="http://localhost:8000/debug_app.html"
if command -v chromium-browser &> /dev/null; then
    chromium-browser --app="$URL" --user-data-dir="/tmp/vj_browser_profile" &
elif command -v chromium &> /dev/null; then
    chromium --app="$URL" --user-data-dir="/tmp/vj_browser_profile" &
elif command -v google-chrome &> /dev/null; then
    google-chrome --app="$URL" --user-data-dir="/tmp/vj_browser_profile" &
elif command -v open &> /dev/null; then
    # MacOS Fallback (standard browser)
    open "$URL"
else
    echo "⚠️ Browser not found. Please open $URL manually."
fi

# Wait for processes
wait
