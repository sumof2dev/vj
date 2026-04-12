#!/usr/bin/env python3
"""
VJ Dev Server (HTTP only)
Port: 8080
Purpose: Standalone server for local development without SSL/TLS overhead.
Includes the same persistence API as server.py.
"""

import http.server
import socketserver
import json
import os
import sys
import subprocess
import ssl
import socket
import time
from urllib.parse import urlparse
import urllib.request

# --- CONFIGURATION ---
PORT = 8085
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, 'backend')

# Ensure we are using the backend for imports if needed
sys.path.insert(0, BACKEND_DIR)

class DevHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler for local VJ Development"""
    
    def end_headers(self):
        # Enable CORS for easy local testing from different ports/hosts
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Simple heartbeat
        if path == '/api/ping':
            self._send_json({"status": "available", "mode": "dev"})
            return

        # API: List Fixtures
        if path == '/api/fixtures':
            self._handle_list_fixtures()
            return

        # API: Get Specific Fixture or Stage Config
        if path.startswith('/api/fixtures/'):
            # Allow full relative path after the API prefix
            fname = path[len('/api/fixtures/'):]
            self._handle_get_fixture(fname)
            return

        return super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API: Save Fixture
        if path.startswith('/api/fixtures/'):
            # Allow full relative path after the API prefix
            fname = path[len('/api/fixtures/'):]
            self._handle_save_fixture(fname)
            return

        # Legacy saves (config.json, etc)
        if not self.handle_save_legacy():
            self.send_error(501, "Not Implemented")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        # API: Proxy Engine Restart
        if path == '/api/restart':
            try:
                # Still try to talk to the SSL launcher if it exists, or HTTP if not
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                
                # Try 8001 (Production Launcher)
                req = urllib.request.Request("https://127.0.0.1:8001/restart")
                with urllib.request.urlopen(req, timeout=3, context=ctx) as response:
                    print("🔄 DevServer: Triggered system restart via launcher (8001)")
                    self._send_json({"status": "restarting"})
            except Exception as e:
                self.send_error(500, f"Failed to hit local launcher: {e}")
            return
            
        # NEW: Add Premade Descriptor
        if path == '/api/descriptors':
            self._handle_add_descriptor()
            return
 
        # API: Update Premade Descriptor Default
        if path == '/api/descriptors/update':
            self._handle_update_descriptor()
            return

        self.do_PUT()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        # API: Soft Delete Fixture/Profile
        if path.startswith('/api/fixtures/'):
            fname = path[len('/api/fixtures/'):]
            if '..' in fname:
                self.send_error(403, "Invalid filename")
                return

            fpath = os.path.abspath(os.path.join(BASE_DIR, 'fixtures', fname))
            if not fpath.startswith(os.path.join(BASE_DIR, 'fixtures')):
                self.send_error(403, "Permission Denied")
                return

            if os.path.exists(fpath):
                try:
                    # SOFT DELETE: Move to backup
                    backup_dir = os.path.join(BASE_DIR, 'fixtures', 'backup')
                    if not os.path.exists(backup_dir): os.makedirs(backup_dir)
                    
                    target_name = os.path.basename(fname)
                    # Add timestamp to prevent name collisions in backup
                    backup_name = f"{int(time.time())}_{target_name}"
                    backup_path = os.path.join(backup_dir, backup_name)
                    
                    os.rename(fpath, backup_path)
                    print(f"🗑️ SOFT DELETE: Moved {fname} to backup/{backup_name}")
                    self._send_json({"status": "ok", "archived": backup_name})
                except Exception as e:
                    self.send_error(500, str(e))
            else:
                self.send_error(404, "File not found")
            return

        self.send_error(501, "Not Implemented")

    def _handle_list_fixtures(self):
        fixtures_dir = os.path.join(BASE_DIR, 'fixtures')
        if not os.path.exists(fixtures_dir): os.makedirs(fixtures_dir)
        try:
            found_files = []
            for root, dirs, files in os.walk(fixtures_dir):
                # Ignore the backup directory during listing
                if 'backup' in dirs:
                    dirs.remove('backup')
                    
                for f in files:
                    if f.endswith('.json'):
                        # Create relative path from fixtures_dir
                        rel_path = os.path.relpath(os.path.join(root, f), fixtures_dir)
                        found_files.append(rel_path)
            self._send_json(found_files)
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_get_fixture(self, fname):
        # Decode URL path segments to support 'profiles/name.json'
        # Basic security: no '..' allowed
        if '..' in fname:
            self.send_error(403, "Invalid filename")
            return
        # Normalize/sanitise to prevent absolute path escapes
        fpath = os.path.abspath(os.path.join(BASE_DIR, 'fixtures', fname))
        if not fpath.startswith(os.path.join(BASE_DIR, 'fixtures')):
            self.send_error(403, "Permission Denied")
            return
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
        # Basic security: no '..' allowed
        if '..' in fname:
            self.send_error(403, "Invalid filename")
            return
        # Support subdirs - ensuring target directory exists
        fpath = os.path.abspath(os.path.join(BASE_DIR, 'fixtures', fname))
        if not fpath.startswith(os.path.join(BASE_DIR, 'fixtures')):
            self.send_error(403, "Permission Denied")
            return
        target_dir = os.path.dirname(fpath)
        if not os.path.exists(target_dir): os.makedirs(target_dir)
        length = int(self.headers['Content-Length'])
        body = self.rfile.read(length)
        try:
            json.loads(body)
            fpath = os.path.join(BASE_DIR, 'fixtures', fname)
            with open(fpath, 'wb') as f:
                f.write(body)
            print(f"📦 DEV: Saved fixture: {fname}")
            self._send_json({"status": "ok", "file": fname})
        except Exception as e:
            self.send_error(500, str(e))

    def _send_json(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode('utf-8'))

    def _handle_update_descriptor(self):
        """Update an existing premade descriptor's defaults in shared_setup.js"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error(400, "Empty request")
                return
            
            data = json.loads(self.rfile.read(content_length).decode('utf-8'))
            id_to_update = data.get('id')
            if not id_to_update:
                self.send_error(400, "Missing descriptor id")
                return

            setup_path = os.path.join(BASE_DIR, 'shared_setup.js')
            with open(setup_path, 'r') as f:
                lines = f.readlines()

            import re
            updated = False
            new_lines = []
            
            for line in lines:
                if re.search(rf'["\']?id["\']?\s*:\s*["\']{id_to_update}["\']', line):
                    new_entry = {
                        "id": id_to_update,
                        "label": data.get('label', id_to_update),
                        "behavior": data.get('behavior', 'sine'),
                        "source": data.get('source', 'vol'),
                        "speed": data.get('speed', 0.1),
                        "react": data.get('react', 0.5),
                        "hold_type": data.get('hold_type', 'none'),
                        "rel_center": data.get('rel_center', 0.5)
                    }
                    if new_entry['behavior'] == 'static':
                        new_entry['value'] = data.get('value', 127)
                    
                    js_entry = f"    {json.dumps(new_entry)},"
                    new_lines.append(js_entry + "\n")
                    updated = True
                else:
                    new_lines.append(line)

            if updated:
                with open(setup_path, 'w') as f:
                    f.writelines(new_lines)
                self._export_descriptors_json(new_lines)
                self._send_json({"status": "ok", "descriptor": data})
            else:
                self.send_error(404, f"Descriptor {id_to_update} not found in shared_setup.js")
        except Exception as e:
            self.send_error(500, str(e))

    def _handle_add_descriptor(self):
        """Add a new premade descriptor to shared_setup.js"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error(400, "Empty request")
                return
            
            data = json.loads(self.rfile.read(content_length).decode('utf-8'))
            label = data.get('label', 'New Behavior')
            import re
            desc_id = re.sub(r'[^a-zA-Z0-9_]', '_', label.lower())
            if not desc_id: desc_id = f"custom_{int(time.time())}"
            
            new_entry = {
                "id": desc_id,
                "label": label,
                "behavior": data.get('behavior', 'sine'),
                "source": data.get('source', 'vol'),
                "speed": data.get('speed', 0.1),
                "react": data.get('react', 0.5),
                "hold_type": data.get('hold_type', 'none'),
                "rel_center": data.get('rel_center', 0.5)
            }
            if new_entry['behavior'] == 'static':
                new_entry['value'] = data.get('value', 127)

            setup_path = os.path.join(BASE_DIR, 'shared_setup.js')
            with open(setup_path, 'r') as f:
                lines = f.readlines()

            new_lines = []
            inserted = False
            for line in lines:
                new_lines.append(line)
                if "// PREMADE_ANCHOR" in line:
                    js_entry = f"    {json.dumps(new_entry)},"
                    new_lines.insert(-1, js_entry + "\n")
                    inserted = True
            
            if inserted:
                with open(setup_path, 'w') as f:
                    f.writelines(new_lines)
                self._export_descriptors_json(new_lines)
                self._send_json({"status": "ok", "descriptor": new_entry})
            else:
                self.send_error(500, "Could not find PREMADE_ANCHOR in shared_setup.js")
        except Exception as e:
            self.send_error(500, str(e))

    def _export_descriptors_json(self, lines):
        """Extract EASY_DESCRIPTORS and write to backend/descriptors.json"""
        import re
        descriptors = []
        in_descriptors = False
        for line in lines:
            if "window.EASY_DESCRIPTORS = [" in line or "var EASY_DESCRIPTORS = [" in line:
                in_descriptors = True
                continue
            if in_descriptors and "];" in line:
                in_descriptors = False
                break
            if in_descriptors:
                match = re.search(r'\{(.*)\}', line)
                if match:
                    try:
                        raw = match.group(0).rstrip(',').strip()
                        json_str = re.sub(r'([{,])\s*([a-zA-Z0-9_]+)\s*:', r'\1"\2":', raw)
                        json_str = json_str.replace("'", '"')
                        json_str = json_str.replace(',}', '}').replace(', ]', ']').replace(',]', ']')
                        data = json.loads(json_str)
                        descriptors.append(data)
                    except: continue
        
        if descriptors:
            dest_path = os.path.join(BASE_DIR, 'backend', 'descriptors.json')
            with open(dest_path, 'w') as f:
                json.dump(descriptors, f, indent=4)
            print(f"📦 Exported {len(descriptors)} descriptors to {dest_path}")

    def handle_save_legacy(self):
        parsed_path = urlparse(self.path)
        valid_paths = {
            '/config.json': 'config.json',
            '/shapes.json': 'shapes.json',
            '/roles.json': 'roles.json',
            '/spotify_creds.json': 'spotify_creds.json'
        }
        target_file = valid_paths.get(parsed_path.path)
        if target_file:
            length = int(self.headers['Content-Length'])
            body = self.rfile.read(length)
            try:
                abs_path = os.path.join(BASE_DIR, target_file)
                with open(abs_path, 'wb') as f:
                    f.write(body)
                print(f"📦 DEV: Saved legacy {target_file}")
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Saved successfully")
                return True
            except Exception as e:
                self.send_error(500, str(e))
                return True
        return False

# Add MIME types
http.server.SimpleHTTPRequestHandler.extensions_map.update({
    '.json': 'application/json',
    '.manifest': 'application/manifest+json',
    '.webmanifest': 'application/manifest+json',
    '.js': 'application/javascript',
    '.css': 'text/css'
})

if __name__ == '__main__':
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    os.chdir(BASE_DIR)
    
    server_address = ("0.0.0.0", PORT)
    httpd = socketserver.ThreadingTCPServer(server_address, DevHandler)
    
    print(f"\n🛠️  VJ DEV SERVER STARTED")
    print(f"📂 Home Dir: {BASE_DIR}")
    print(f"👉 Local: http://localhost:{PORT}/manager.html")
    
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        print(f"📱 LAN:   http://{lan_ip}:{PORT}/manager.html")
        s.close()
    except: pass
    
    print("\n[Log] Serving requests...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
