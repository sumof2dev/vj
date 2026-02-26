#!/bin/bash
echo "🏖️ Launching VJSetup Sandbox..."

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Check if ports are in use
if lsof -Pi :8081 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️ Port 8081 is already in use. Killing existing VJSetup Server..."
    lsof -t -i:8081 | xargs kill -9
fi

if lsof -Pi :8766 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️ Port 8766 is already in use. Killing existing Sandbox Engine..."
    lsof -t -i:8766 | xargs kill -9
fi

# Start HTTP Server (Background)
echo "🚀 Starting HTTP Server on Port 8081..."
python3 vjsetup/server.py > vjsetup/http.log 2>&1 &
HTTP_PID=$!

# Start WebSocket Engine (Background)
echo "🚀 Starting Sandbox Engine on Port 8766..."
cd vjsetup/backend && python3 main.py > ../ws.log 2>&1 &
WS_PID=$!

echo "✅ VJSetup Sandbox Running!"
echo "👉 Open: http://localhost:8081/index.html"
echo "📝 Logs: vjsetup/http.log, vjsetup/ws.log"
echo "Press Ctrl+C to stop servers."

# Wait for user interrupt
trap "kill $HTTP_PID $WS_PID; echo '🛑 Sandbox Stopped.'; exit" INT
wait
