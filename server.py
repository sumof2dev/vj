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
import time
from urllib.parse import urlparse

# --- CONFIGURATION ---
PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, 'backend')

# Ensure we are using the production backend for imports if needed
sys.path.insert(0, BACKEND_DIR)

class ProductionHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler for VJ Production"""
    
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')
        print(f"DEBUG: GET Request Path: {path} (Full: {self.path})")

        # Handle root or default
        if path == '':
            self.send_response(302)
            self.send_header('Location', '/manager.html')
            self.end_headers()
            return

        # API: List UserGen Shaders
        if path.startswith('/api/usergen/list') or path.startswith('/api/usergen2/list'):
            query = parsed.query
            layer_type = None
            if 'type=' in query:
                layer_type = query.split('type=')[1].split('&')[0]
            self._handle_list_shaders(layer_type, is_sandbox=path.startswith('/api/usergen2'))
            return

        # API: List Fixtures
        if path == '/api/fixtures':
            self._handle_list_fixtures()
            return

        # API: List Recordings
        if path == '/api/recordings':
            self._handle_list_recordings()
            return

        # API: List Images
        if path == '/api/images/list':
            self._handle_list_images()
            return

        # API: Get Specific Fixture or Stage Config
        if path.startswith('/api/fixtures/'):
            subpath = path[len('/api/fixtures/'):]
            self._handle_get_fixture(subpath)
            return

        # NEW: Global Proxy for Launcher Status (if hit on 8000)
        if path == '/status':
             self._proxy_to_launcher('/status')
             return

        if path == '/capture':
             self._proxy_to_camera(self.path) # Forward the full query string with t= timestamp
             return

        if path == '/start':
             self._proxy_to_launcher('/start')
             return

        if path == '/stop':
             self._proxy_to_launcher('/stop')
             return

        if path == '/restart' or path == '/api/restart':
             self._proxy_to_launcher('/restart')
             return
        
        if path == '/shell':
             self._proxy_to_launcher(self.path) # Forward the full query string
             return

        return super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        # API: Save Fixture
        if path.startswith('/api/fixtures/'):
            subpath = path[len('/api/fixtures/'):]
            self._handle_save_fixture(subpath)
            return

        # Legacy saves (config.json, etc)
        if not self.handle_save_legacy():
            self.send_error(501, "Not Implemented")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')
        
        # API: Save UserGen Shader
        if path.startswith('/api/usergen/save') or path.startswith('/api/usergen2/save'):
            self._handle_save_shader(is_sandbox=path.startswith('/api/usergen2'))
            return

        # API: Save Image
        if path == '/api/images/save':
            self._handle_save_image()
            return

        # NEW: Add Premade Descriptor
        if path == '/api/descriptors':
            self._handle_add_descriptor()
            return
 
        # API: Update Premade Descriptor Default
        if path == '/api/descriptors/update':
            self._handle_update_descriptor()
            return

        # API: Rename UserGen Shader (Metadata prompt)
        if path.startswith('/api/usergen/rename') or path.startswith('/api/usergen2/rename'):
            self._handle_rename_shader(is_sandbox=path.startswith('/api/usergen2'))
            return

        # API: Proxy Engine Restart
        if path == '/api/restart' or path == '/restart':
            self._proxy_to_launcher('/restart')
            return

        if path == '/start':
            self._proxy_to_launcher('/start')
            return

        if path == '/stop':
            self._proxy_to_launcher('/stop')
            return

        self.do_PUT()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')
        
        # API: Delete Image
        if path == '/api/images/delete':
            self._handle_delete_image(parsed.query)
            return
        
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

        # API: Delete UserGen Shader (Existing Logic)
        if path.startswith('/api/usergen/delete') or path.startswith('/api/usergen2/delete'):
            is_sandbox = path.startswith('/api/usergen2')
            from urllib.parse import parse_qs, unquote
            qs = parse_qs(parsed.query)
            fname = qs.get('file', [None])[0]
            
            if not fname or '..' in fname:
                self.send_error(400, "Invalid filename")
                return

            lib_root = os.path.join(BASE_DIR, 'library2' if is_sandbox else 'library')
            fpath = os.path.join(lib_root, fname)
            
            if os.path.exists(fpath):
                try:
                    os.remove(fpath)
                    # Delete metadata in same directory
                    if os.path.exists(fpath + ".json"):
                        os.remove(fpath + ".json")
                    
                    # Also cleanup orphan JSON in root if it exists (legacy compatibility)
                    fname_only = os.path.basename(fname)
                    root_json = os.path.join(lib_root, fname_only + ".json")
                    if os.path.exists(root_json):
                        os.remove(root_json)
                        print(f"🧹 Cleaned up orphan metadata in root: {fname_only}.json")

                    print(f"🗑️ Deleted UserGen Shader: {fname}")
                    self._send_json({"status": "ok"})
                except Exception as e:
                    self.send_error(500, str(e))
            else:
                self.send_error(404, f"File not found: {fname}")
            return

        self.send_error(501, "Not Implemented")

    def _handle_list_fixtures(self):
        """Recursively list all .json files in fixtures/"""
        fixtures_dir = os.path.join(BASE_DIR, 'fixtures')
        try:
            if not os.path.exists(fixtures_dir):
                os.makedirs(fixtures_dir)
                os.makedirs(os.path.join(fixtures_dir, 'configs'))
                os.makedirs(os.path.join(fixtures_dir, 'profiles'))

            results = []
            for root, dirs, files in os.walk(fixtures_dir):
                # Ignore the backup directory during listing
                if 'backup' in dirs:
                    dirs.remove('backup')
                
                for f in files:
                    if f.endswith('.json') and not f.startswith('.'):
                        # Calculate path relative to 'fixtures'
                        rel_path = os.path.relpath(os.path.join(root, f), fixtures_dir)
                        results.append(rel_path)
            self._send_json(results)
        except Exception as e:
            print(f"❌ Error listing fixtures: {e}")
            self.send_error(500, str(e))

    def _handle_get_fixture(self, fname):
        """Read a JSON file from fixtures/ (allows subdirectories)"""
        if '..' in fname:
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
        """Save a JSON file to fixtures/ (allows subdirectories)"""
        if '..' in fname or not fname.endswith('.json'):
            self.send_error(403, "Invalid filename")
            return

        try:
            length = int(self.headers['Content-Length'])
            body = self.rfile.read(length)
            
            # Validate JSON
            json.loads(body)
            
            fpath = os.path.join(BASE_DIR, 'fixtures', fname)
            fdir = os.path.dirname(fpath)
            if not os.path.exists(fdir):
                os.makedirs(fdir)
            
            with open(fpath, 'wb') as f:
                f.write(body)
            
            print(f"✅ Saved Fixture: {fname} ({len(body)} bytes)")
            self._send_json({"status": "ok", "file": fname})
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
        except Exception as e:
            print(f"❌ Error saving fixture to {fname}: {e}")
            self.send_error(500, str(e))
        except Exception as e:
            self.send_error(500, str(e))


    def _handle_list_shaders(self, filter_type=None, is_sandbox=False):
        """List all .frag files in library/ (recursive)"""
        lib_root = os.path.join(BASE_DIR, 'library2' if is_sandbox else 'library')
        try:
            if not os.path.exists(lib_root):
                os.makedirs(lib_root)
                os.makedirs(os.path.join(lib_root, 'base'))
                os.makedirs(os.path.join(lib_root, 'fx'))
            
            results = []
            
            # Walk the library directory
            for root, dirs, files in os.walk(lib_root):
                # Calculate relative path from lib_root (e.g. "base" or "")
                rel_dir = os.path.relpath(root, lib_root)
                if rel_dir == ".": rel_dir = ""
                
                # Filter by type if requested
                if filter_type and rel_dir and filter_type not in rel_dir.lower():
                    continue

                for f in files:
                    if not f.endswith('.frag'): continue
                    
                    fpath = os.path.join(root, f)
                    meta_path = fpath + ".json"
                    prompt = "Hand-coded Shaders"
                    
                    # File relative to library/ for frontend fetching
                    rel_file = os.path.join(rel_dir, f) if rel_dir else f
                    
                    # Default type based on directory
                    ltype = "fx" if "fx" in rel_dir.lower() else "base"
                    
                    if os.path.exists(meta_path):
                        with open(meta_path, 'r') as m:
                            try:
                                meta = json.load(m)
                                prompt = meta.get('prompt', prompt)
                                # Trust metadata type if it explicitly exists
                                if 'type' in meta:
                                    ltype = meta['type']
                            except: pass
                    
                    results.append({
                        "file": rel_file, 
                        "prompt": prompt, 
                        "type": ltype,
                        "mtime": os.path.getmtime(fpath)
                    })
            
            # Sort by most recent
            results.sort(key=lambda x: x['mtime'], reverse=True)
            self._send_json(results)
        except Exception as e:
            print(f"❌ Error listing shaders: {e}")
            self.send_error(500, str(e))

    def _handle_save_shader(self, is_sandbox=False):
        """Save a shader .frag file to library/"""
        length = int(self.headers['Content-Length'])
        body = self.rfile.read(length)
        
        try:
            data = json.loads(body)
            code = data.get('code')
            prompt = data.get('prompt', 'Unlabeled')
            layer_type = data.get('layer_type', 'base').lower() # default to base
            
            if layer_type not in ['base', 'fx']:
                layer_type = 'base'

            if not code:
                self.send_error(400, "Missing code")
                return

            lib_root = os.path.join(BASE_DIR, 'library2' if is_sandbox else 'library')
            target_dir = os.path.join(lib_root, layer_type)
            if not os.path.exists(target_dir):
                os.makedirs(target_dir)

            # Filename based on timestamp
            ts = int(time.time() * 1000)
            fname = f"vj_shader_{ts}.frag"
            fpath = os.path.join(target_dir, fname)
            
            # Save the code
            with open(fpath, 'w') as f:
                f.write(code)
            
            # Save metadata
            with open(fpath + ".json", 'w') as f:
                json.dump({"prompt": prompt, "timestamp": ts, "id": ts, "type": layer_type}, f)

            print(f"🎨 Saved UserGen {layer_type.upper()} Shader: {fname}")
            # Return relative path for UI consistency
            self._send_json({"status": "ok", "file": f"{layer_type}/{fname}", "prompt": prompt, "type": layer_type})
        except Exception as e:
            print(f"❌ Error saving shader: {e}")
            self.send_error(500, str(e))

    def _handle_rename_shader(self, is_sandbox=False):
        """Update the prompt (label) of a shader in its metadata file"""
        length = int(self.headers['Content-Length'])
        body = self.rfile.read(length)
        
        try:
            data = json.loads(body)
            fname = data.get('file')
            new_prompt = data.get('new_prompt')
            
            if not fname or not new_prompt or '..' in fname:
                self.send_error(400, "Invalid input")
                return

            lib_root = os.path.join(BASE_DIR, 'library2' if is_sandbox else 'library')
            meta_path = os.path.join(lib_root, fname + ".json")
            
            meta = {}
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r') as f:
                        meta = json.load(f)
                except Exception as e:
                    print(f"⚠️ Error reading existing meta for {fname}: {e}")
            
            meta['prompt'] = new_prompt
            # If it's a new meta, we might want to infer type from path
            if 'type' not in meta:
                meta['type'] = 'fx' if '/fx' in fname else 'base'
            
            with open(meta_path, 'w') as f:
                json.dump(meta, f)
            
            print(f"📝 Renamed Shader: {fname} -> {new_prompt}")
            self._send_json({"status": "ok"})
        except Exception as e:
            print(f"❌ Error renaming shader: {e}")
            self.send_error(500, str(e))

    def _handle_list_recordings(self):
        """List all recording session directories in recordings/"""
        rec_root = os.path.join(BASE_DIR, 'recordings')
        try:
            if not os.path.exists(rec_root):
                os.makedirs(rec_root)
            results = []
            for d in os.listdir(rec_root):
                dpath = os.path.join(rec_root, d)
                if os.path.isdir(dpath) and not d.startswith('.'):
                    # Try to get metadata for a richer UI
                    meta = {}
                    meta_path = os.path.join(dpath, 'meta.json')
                    if os.path.exists(meta_path):
                        with open(meta_path, 'r') as f:
                            try: meta = json.load(f)
                            except: pass
                    
                    results.append({
                        "id": d,
                        "name": meta.get('name', d),
                        "mtime": os.path.getmtime(dpath),
                        "duration": meta.get('duration'),
                        "channels": len(meta.get('addresses', []))
                    })
            # Sort by most recent
            results.sort(key=lambda x: x['mtime'], reverse=True)
            self._send_json(results)
        except Exception as e:
            print(f"❌ Error listing recordings: {e}")
            self.send_error(500, str(e))

    def _handle_list_images(self):
        """List all saved image files in library/images/"""
        img_root = os.path.join(BASE_DIR, 'library', 'images')
        try:
            if not os.path.exists(img_root):
                os.makedirs(img_root)
            results = []
            for f in os.listdir(img_root):
                if f.endswith(('.png', '.jpg', '.jpeg', '.webp')):
                    fpath = os.path.join(img_root, f)
                    results.append({
                        "file": f"library/images/{f}",
                        "name": f,
                        "mtime": os.path.getmtime(fpath)
                    })
            results.sort(key=lambda x: x['mtime'], reverse=True)
            self._send_json(results)
        except Exception as e:
            print(f"❌ Error listing images: {e}")
            self.send_error(500, str(e))

    def _handle_save_image(self):
        """Save a base64 encoded image to library/images/"""
        length = int(self.headers['Content-Length'])
        body = self.rfile.read(length)
        import base64
        import time
        try:
            data = json.loads(body)
            b64_data = data.get('image')
            
            if not b64_data or ',' not in b64_data:
                self.send_error(400, "Invalid base64 image data")
                return

            header, encoded = b64_data.split(",", 1)
            ext = 'png'
            if 'jpeg' in header or 'jpg' in header: ext = 'jpg'
            elif 'webp' in header: ext = 'webp'

            img_bytes = base64.b64decode(encoded)
            img_root = os.path.join(BASE_DIR, 'library', 'images')
            if not os.path.exists(img_root):
                os.makedirs(img_root)

            ts = int(time.time() * 1000)
            fname = f"vj_image_{ts}.{ext}"
            fpath = os.path.join(img_root, fname)

            with open(fpath, "wb") as f:
                f.write(img_bytes)

            print(f"📸 Saved Image Texture: {fname} ({len(img_bytes)} bytes)")
            self._send_json({"status": "ok", "file": f"library/images/{fname}", "name": fname})
        except Exception as e:
            print(f"❌ Error saving image: {e}")
            self.send_error(500, str(e))

    def _handle_delete_image(self, query_string):
        """Delete an image from library/images/"""
        from urllib.parse import parse_qs
        qs = parse_qs(query_string)
        fname = qs.get('file', [None])[0]
        
        if not fname or '..' in fname or '/' in fname:
            self.send_error(400, "Invalid filename")
            return

        img_root = os.path.join(BASE_DIR, 'library', 'images')
        fpath = os.path.join(img_root, fname)
        
        if os.path.exists(fpath):
            try:
                os.remove(fpath)
                print(f"🗑️ Deleted Image: {fname}")
                self._send_json({"status": "ok"})
            except Exception as e:
                self.send_error(500, str(e))
        else:
            self.send_error(404, f"File not found: {fname}")

    def _proxy_to_camera(self, subpath):
        """Proxy a request to the camera service on 8004"""
        import urllib.request
        from urllib.error import HTTPError, URLError
        try:
             # Camera service on 8004 is usually internal HTTP (no SSL)
             url = f"http://127.0.0.1:8004{subpath}"
             
             req = urllib.request.Request(url)
             with urllib.request.urlopen(req, timeout=3) as response:
                 self.send_response(200)
                 # MJPEG/JPEG content type 
                 for header, value in response.getheaders():
                     if header.lower() in ['content-type', 'content-length']:
                         self.send_header(header, value)
                 self.end_headers()
                 self.wfile.write(response.read())
        except HTTPError as e:
             print(f"⚠️ Camera HTTP Error: {e.code}")
             self._send_placeholder_img(e.code)
        except URLError as e:
             print(f"❌ Camera Connection Error: {e.reason}")
             self._send_placeholder_img(503)
        except Exception as e:
             print(f"❌ Camera Proxy Exception: {e}")
             self._send_placeholder_img(500)

    def _send_placeholder_img(self, code=404):
        """Sends a 1x1 gray pixel or the specified error code"""
        if code == 503 or code == 500:
             # Return a 1x1 gray GIF to prevent broken image icons if it's a transient error
             self.send_response(200)
             self.send_header('Content-Type', 'image/gif')
             self.end_headers()
             # 1x1 gray GIF
             self.wfile.write(b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x80\x80\x80\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x01D\x00;')
        else:
             self.send_response(code)
             self.end_headers()

    def _proxy_to_launcher(self, subpath):
        """Proxy a request to the launcher service on 8001"""
        import urllib.request
        import ssl
        try:
             # Ignore SSL verification for local launcher proxy
             ctx = ssl.create_default_context()
             ctx.check_hostname = False
             ctx.verify_mode = ssl.CERT_NONE

             # Launcher might use http or https (check for certs)
             protocol = 'https' if os.path.exists(os.path.join(BASE_DIR, 'cert.pem')) else 'http'
             url = f"{protocol}://127.0.0.1:8001{subpath}"
             
             req = urllib.request.Request(url)
             with urllib.request.urlopen(req, timeout=20, context=ctx) as response:
                 self.send_response(200)
                 self.send_header('Content-Type', 'application/json')
                 self.end_headers()
                 self.wfile.write(response.read())
        except Exception as e:
             print(f"❌ Proxy Error to {subpath}: {e}")
             self.send_error(500, f"Launcher Proxy Error: {e}")

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
            
            # Use a more robust check for the ID field that handles both "id": and id:
            for line in lines:
                # Matches "id": "my_id" or id: 'my_id' or id: "my_id"
                if re.search(rf'["\']?id["\']?\s*:\s*["\']{id_to_update}["\']', line):
                    # Found the line! Replace it.
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
                    
                    # Convert to JS object format
                    js_entry = f"    {json.dumps(new_entry)},"
                    new_lines.append(js_entry + "\n")
                    updated = True
                    print(f"🔄 Updated Premade Descriptor Default: {id_to_update}")
                else:
                    new_lines.append(line)

            if updated:
                with open(setup_path, 'w') as f:
                    f.writelines(new_lines)
                
                # BRIDGE: Write to backend/descriptors.json for DMX engine
                try:
                    self._export_descriptors_json(new_lines)
                except Exception as e:
                    print(f"⚠️ Bridge Error (JSON export): {e}")

                self._send_json({"status": "ok", "descriptor": data})
            else:
                self.send_error(404, f"Descriptor {id_to_update} not found in shared_setup.js")
        except Exception as e:
            print(f"❌ Error updating descriptor: {e}")
            self.send_error(500, str(e))

    def _export_descriptors_json(self, lines):
        """Extract EASY_DESCRIPTORS from lines and write to backend/descriptors.json"""
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
                # Try to parse the object from the line
                # Matches: { id: '...', ... } or {"id": "...", ...}
                match = re.search(r'\{(.*)\}', line)
                if match:
                    try:
                        # Convert JS-like object to JSON
                        raw = match.group(0).rstrip(',').strip()
                        # Replace unquoted keys with quoted keys for json.loads
                        # (Basic regex replacement for simple cases)
                        json_str = re.sub(r'([{,])\s*([a-zA-Z0-9_]+)\s*:', r'\1"\2":', raw)
                        # Replace single quotes with double quotes
                        json_str = json_str.replace("'", '"')
                        # Remove trailing commas inside objects
                        json_str = json_str.replace(',}', '}').replace(', ]', ']').replace(',]', ']')
                        
                        data = json.loads(json_str)
                        descriptors.append(data)
                    except:
                        continue
        
        if descriptors:
            dest_path = os.path.join(BASE_DIR, 'backend', 'descriptors.json')
            with open(dest_path, 'w') as f:
                json.dump(descriptors, f, indent=4)
            print(f"📦 Exported {len(descriptors)} descriptors to {dest_path}")

    def _handle_add_descriptor(self):
        """Add a new premade descriptor to shared_setup.js"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error(400, "Empty request")
                return
            
            data = json.loads(self.rfile.read(content_length).decode('utf-8'))
            label = data.get('label', 'New Behavior')
            # Generate ID from label
            import re
            desc_id = re.sub(r'[^a-zA-Z0-9_]', '_', label.lower())
            if not desc_id: desc_id = f"custom_{int(time.time())}"
            
            # Check for collisions and append suffix if needed
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
                    # Insert BEFORE the anchor
                    new_lines.insert(-1, js_entry + "\n")
                    inserted = True
            
            if inserted:
                with open(setup_path, 'w') as f:
                    f.writelines(new_lines)
                
                # BRIDGE: Write to backend/descriptors.json
                self._export_descriptors_json(new_lines)
                
                print(f"✨ Added New Premade Descriptor: {desc_id}")
                self._send_json({"status": "ok", "descriptor": new_entry})
            else:
                self.send_error(500, "Could not find PREMADE_ANCHOR in shared_setup.js")
        except Exception as e:
            print(f"❌ Error adding descriptor: {e}")
            self.send_error(500, str(e))


    def _send_json(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
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
            '/spotify_creds.json': 'spotify_creds.json',
            '/presets.json': 'presets.json',
            '/stage_config.json': 'stage_config.json',
            '/live_console.json': 'live_console.json'
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
                self.end_headers()
                self.wfile.write(b"Saved successfully")
                return True
            except Exception as e:
                self.send_error(500, str(e))
                return True # We technically handled it (with error)
        return False

# Add MIME types for PWA and assets
http.server.SimpleHTTPRequestHandler.extensions_map.update({
    '.json': 'application/json',
    '.frag': 'text/plain',
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
