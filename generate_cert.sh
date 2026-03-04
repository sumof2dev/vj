#!/bin/bash
# Generate self-signed SSL certificate for PWA support on local network

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "🔐 Generating self-signed certificate..."

# Get Local IP
LAN_IP=$(hostname -I | awk '{print $1}')
if [ -z "$LAN_IP" ]; then
    LAN_IP="127.0.0.1"
fi

openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -sha256 -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=RaveBox/OU=Dev/CN=$LAN_IP" \
  -addext "subjectAltName = IP:$LAN_IP,IP:127.0.0.1,DNS:localhost"

echo "✅ Generated cert.pem and key.pem"
echo "⚠️  Android Chrome will show a certificate warning. "
echo "   You must 'Proceed to $LAN_IP (unsafe)' once in the browser."
echo "   After that, the PWA should launch in standalone mode."
