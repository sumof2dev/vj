#!/usr/bin/env python3
"""
VJSetup HTTP Server (Production)
Port: 8000
API: Handles fixture and stage config persistence.
"""

import http.server
import socketserver
import json
import os
import sys
import subprocess
import ssl
from urllib.parse import urlparse

# --- CONFIGURATION ---
PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, 'backend')

# Ensure we are using the production backend for imports if needed
sys.path.insert(0, BACKEND_DIR)

class ProductionHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler for VJ Production"""
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API: List Fixtures
        if path == '/api/fixtures':
            self._handle_list_fixtures()
            return

        # API: Get Specific Fixture or Stage Config
        if path.startswith('/api/fixtures/'):
            fname = path.split('/')[-1]
            self._handle_get_fixture(fname)
            return
            

        # API: Launcher Stubs (Manual Mode)
        if path == '/status':
            self._handle_status()
            return
        if path in ['/start', '/stop', '/restart']:
            self._handle_lifecycle_stub(path)
            return

        return super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API: Save Fixture or Stage Config
        if path.startswith('/api/fixtures/'):
            fname = path.split('/')[-1]
            self._handle_save_fixture(fname)
            return
        
        # Legacy save support for root files
        self.handle_save_legacy()

    def _handle_status(self):
        try:
            cmd = ['sudo', 'systemctl', 'is-active', 'vj-engine.service']
            result = subprocess.run(cmd, capture_output=True, text=True)
            status = result.stdout.strip()
            self._send_json({
                "status": status,
                "active": status == 'active',
                "service": "vj-engine.service"
            })
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_lifecycle_stub(self, action):
        action = action.lstrip('/')
        try:
            cmd = ['sudo', 'systemctl', action, 'vj-engine.service']
            result = subprocess.run(cmd, capture_output=True, text=True)
            self._send_json({
                "success": result.returncode == 0,
                "action": action,
                "service": "vj-engine.service",
                "output": result.stdout,
                "error": result.stderr
            })
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_list_fixtures(self):
        """List all .json files in fixtures/"""
        fixtures_dir = os.path.join(BASE_DIR, 'fixtures')
        try:
            files = [f for f in os.listdir(fixtures_dir) if f.endswith('.json')]
            self._send_json(files)
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_get_fixture(self, fname):
        """Read a JSON file from fixtures/"""
        if '..' in fname or '/' in fname:
            self.send_error(403, "Invalid filename")
            return

        fpath = os.path.join(BASE_DIR, 'fixtures', fname)
        if not os.path.exists(fpath):
            self.send_error(404, "Fixture not found")
            return

        try:
            with open(fpath, 'r') as f:
                data = json.load(f)
            self._send_json(data)
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_save_fixture(self, fname):
        """Save a JSON file to fixtures/"""
        if '..' in fname or '/' in fname or not fname.endswith('.json'):
            self.send_error(403, "Invalid filename")
            return

        length = int(self.headers['Content-Length'])
        body = self.rfile.read(length)
        
        try:
            # Validate JSON
            json.loads(body)
            
            fpath = os.path.join(BASE_DIR, 'fixtures', fname)
            with open(fpath, 'wb') as f:
                f.write(body)
            
            print(f"✅ Saved fixture: {fname} (Body: {len(body)} bytes)")
            self._send_json({"status": "ok", "file": fname})
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
        except Exception as e:
            self.send_error(500, str(e))


    def _send_json(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode('utf-8'))

    def handle_save_legacy(self):
        """Support for direct setup.html-style PUIT to root files if needed"""
        parsed_path = urlparse(self.path)
        valid_paths = {
            '/config.json': 'config.json',
            '/shapes.json': 'shapes.json',
            '/roles.json': 'roles.json',
            '/vj/roles.json': 'roles.json',
            '/spotify_creds.json': 'spotify_creds.json'
        }
        
        target_file = valid_paths.get(parsed_path.path)
        print(f"[DEBUG] PUT request to: {parsed_path.path}, match: {target_file}")
        if target_file:
            length = int(self.headers['Content-Length'])
            body = self.rfile.read(length)
            try:
                abs_path = os.path.join(BASE_DIR, target_file)
                with open(abs_path, 'wb') as f:
                    f.write(body)
                print(f"✅ Legacy Saved {target_file} (Body: {len(body)} bytes)")
                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b"Saved successfully")
            except Exception as e:
                self.send_error(500, str(e))

# Add MIME types for PWA and assets
http.server.SimpleHTTPRequestHandler.extensions_map.update({
    '.json': 'application/json',
    '.manifest': 'application/manifest+json',
    '.webmanifest': 'application/manifest+json',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml'
})

if __name__ == '__main__':
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    
    server_address = ("0.0.0.0", PORT)
    httpd = socketserver.ThreadingTCPServer(server_address, ProductionHandler)
    
    # Check for SSL certificates
    cert_path = os.path.join(BASE_DIR, 'cert.pem')
    key_path = os.path.join(BASE_DIR, 'key.pem')
    
    protocol = "http"
    if os.path.exists(cert_path) and os.path.exists(key_path):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=cert_path, keyfile=key_path)
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        protocol = "https"
        print(f"🔒 SSL Enabled (Using {cert_path})")

    print(f"🚀 VJ Production Server running on port {PORT} ({protocol})")
    print(f"👉 {protocol}://localhost:{PORT}/")
    
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        print(f"👉 Network: {protocol}://{lan_ip}:{PORT}/")
        s.close()
    except:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
