#!/usr/bin/env python3
import http.server
import socketserver
import subprocess
import json
import os
import urllib.parse
import ssl

PORT = 8001

class LauncherHandler(http.server.SimpleHTTPRequestHandler):
    def address_string(self):
        return str(self.client_address[0])

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_path.query)
        path = parsed_path.path

        if path in ['/start', '/api/start']:
            use_node = query.get('node', ['false'])[0] == 'true'
            svc = 'vj-node.service' if use_node else 'vj-engine.service'
            self.run_systemd('start', svc)
        elif path in ['/stop', '/api/stop']:
            use_node = query.get('node', ['false'])[0] == 'true'
            svc = 'vj-node.service' if use_node else 'vj-engine.service'
            self.run_systemd('stop', svc)
        elif path in ['/restart', '/api/restart']:
            use_node = query.get('node', ['false'])[0] == 'true'
            svc = 'vj-node.service' if use_node else 'vj-engine.service'
            self.run_systemd('restart', svc)
        elif path in ['/status', '/api/status']:
            # Return status for BOTH engine and node
            self.get_full_status()
        elif path in ['/camera/start', '/api/camera/start']:
            self.run_systemd('start', 'vj-camera.service')
        elif path in ['/camera/stop', '/api/camera/stop']:
            self.run_systemd('stop', 'vj-camera.service')
        elif path in ['/camera/status', '/api/camera/status']:
            self.run_systemd('is-active', 'vj-camera.service')
        elif self.path.startswith('/api/spotify/auth'):
            self.handle_spotify_auth()
        elif self.path.startswith('/api/smart/control'):
            self.handle_smart_control()
        elif self.path.startswith('/api/usergen'):
            # Forward usergen API calls to the main setup server (8000)
            host = self.headers.get('Host').split(':')[0]
            redirect_host = 'api-' + host if (host.endswith('.ravebox.love') and not host.startswith('api-')) else host
            schema = 'https' if host.endswith('.ravebox.love') else 'http'
            port_str = '' if host.endswith('.ravebox.love') else ':8000'
            
            self.send_response(302)
            self.send_header('Location', f'{schema}://{redirect_host}{port_str}{self.path}')
            self.end_headers()
            return
        elif self.path.startswith('/shell'):
            self.handle_shell_command()
            return
        elif self.path.startswith('/capture'):
            self.proxy_to_camera(self.path)
            return
            
        # Universal Serving: Allow both 8000 and 8001 to serve the UI to prevent Dashboard port-swap 404s
        elif self.path == '/robot_sim':
            self.send_response(302)
            self.send_header('Location', '/robot_sim.html')
            self.end_headers()
            return
        else:
            return super().do_GET()

    def do_PUT(self):
        if self.path == '/spotify_creds.json':
            try:
                content_length = int(self.headers['Content-Length'])
                put_data = self.rfile.read(content_length)
                with open(os.path.join(BASE_DIR, 'spotify_creds.json'), 'wb') as f:
                    f.write(put_data)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode())
            except Exception as e:
                self.error_response(str(e))
        else:
            self.send_response(404)
            self.end_headers()

    def get_full_status(self):
        """Returns the status of both engine and node services."""
        engine = self._get_svc_status('vj-engine.service')
        node = self._get_svc_status('vj-node.service')
        
        # Legacy compatibility: 'active' and 'status' reflect the primary engine
        # but the UI will now look for 'node' specifically
        response = {
            "status": engine['status'],
            "active": engine['active'],
            "engine": engine,
            "node": node
        }
        
        payload = json.dumps(response).encode()
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _get_svc_status(self, service):
        try:
            cmd = ['sudo', 'systemctl', 'is-active', service]
            result = subprocess.run(cmd, capture_output=True, text=True)
            status = result.stdout.strip() if result.returncode == 0 else "inactive"
            is_active = (status == 'active')
            
            if not is_active:
                # Fallback check
                pattern = 'backend/main.py' if 'engine' in service else 'backend/dmx_node.py'
                manual_check = subprocess.run(['pgrep', '-f', pattern], capture_output=True)
                if manual_check.returncode == 0:
                    status = 'active (manual)'
                    is_active = True
            
            return {"status": status, "active": is_active}
        except:
            return {"status": "unknown", "active": False}

    def run_systemd(self, action, service='vj-engine.service'):
        try:
            # We use sudo for systemctl. 
            cmd = ['sudo', 'systemctl', action, service]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            # --- FALLBACK FOR MANUAL RESTART/STOP ---
            if result.returncode != 0 and action in ['restart', 'stop', 'start', 'status']:
                pattern = 'backend/main.py' if 'engine' in service else 'backend/dmx_node.py'
                
                if action == 'stop' or action == 'restart':
                    subprocess.run(['pkill', '-f', pattern])
                
                if action == 'start' or action == 'restart':
                    # Start manual process in background
                    log_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs', f'{service}.log')
                    os.makedirs(os.path.dirname(log_file), exist_ok=True)
                    
                    cmd_manual = f"nohup venv/bin/python3 -u {pattern} > {log_file} 2>&1 &"
                    subprocess.Popen(cmd_manual, shell=True, preexec_fn=os.setpgrp)
                
                if action != 'status' and action != 'is-active':
                    response = {
                        "success": True,
                        "action": action,
                        "service": service,
                        "mode": "manual_fallback",
                        "output": f"Manual {action} executed"
                    }
                    payload = json.dumps(response).encode()
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return

            if action == 'is-active' or action == 'status':
                svc_status = self._get_svc_status(service)
                response = {
                    "status": svc_status['status'],
                    "active": svc_status['active'],
                    "service": service
                }
            else:
                response = {
                    "success": result.returncode == 0,
                    "action": action,
                    "service": service,
                    "output": result.stdout,
                    "error": result.stderr
                }
                
            payload = json.dumps(response).encode()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            
            self.wfile.write(payload)
        except Exception as e:
            self.error_response(str(e))



    def handle_smart_control(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        ip = query.get('ip', [None])[0]
        state = query.get('state', [None])[0]
        
        if not ip or not state:
            self.error_response("Missing ip or state parameter")
            return
            
        try:
            # Use kasa cli: kasa --host 192.168.x.x on/off
            action = 'on' if state.lower() == 'on' else 'off'
            cmd = ['kasa', '--host', ip, action]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            response = {
                "success": result.returncode == 0,
                "ip": ip,
                "state": action,
                "output": result.stdout,
                "error": result.stderr
            }
            self.wfile.write(json.dumps(response).encode())
        except Exception as e:
            self.error_response(str(e))

    def handle_spotify_auth(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        code = query.get('code', [None])[0]
        
        if not code:
            self.error_response("Missing code parameter")
            return
            
        try:
            print(f"🎬 Running Spotify Auth with code: {code[:10]}...")
            BASE_DIR = os.path.dirname(os.path.abspath(__file__))
            script_path = os.path.join(BASE_DIR, "spotify_auth.py")
            
            # Run the auth script
            cmd = ['python3', script_path, code]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            response = {
                "success": result.returncode == 0,
                "output": result.stdout,
                "error": result.stderr
            }
            self.wfile.write(json.dumps(response).encode())
        except Exception as e:
            self.error_response(str(e))

    def handle_shell_command(self):
        """
        [SECURITY WARNING]
        This endpoint allows arbitrary shell command execution. 
        It is intended for local maintenance on RaveBox hardware.
        Do NOT expose this to the public internet.
        """
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        cmd = query.get('cmd', [None])[0]
        
        if not cmd:
            self.error_response("Missing cmd parameter")
            return
            
        try:
            print(f"📟 Remote Shell execution: {cmd}")
            # Security Note: This allows arbitrary command execution on the host. 
            # In local ravebox scenarios this is highly convenient but use with caution.
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            response = {
                "success": True,
                "exit_code": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr
            }
            self.wfile.write(json.dumps(response).encode())
        except Exception as e:
            self.error_response(f"Execution Error: {str(e)}")

    def proxy_to_camera(self, subpath):
        import urllib.request
        try:
            # Proxy to the camera service on 8004
            url = f"http://127.0.0.1:8004{subpath}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=5) as response:
                self.send_response(200)
                for header, value in response.getheaders():
                    if header.lower() in ['content-type', 'content-length']:
                        self.send_header(header, value)
                self.end_headers()
                self.wfile.write(response.read())
        except Exception as e:
            print(f"❌ Launcher Camera Proxy Error: {e}")
            self.send_response(404)
            self.end_headers()

    def error_response(self, message):
        self.send_response(500)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode())

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

if __name__ == '__main__':
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), LauncherHandler) as httpd:
        BASE_DIR = os.path.dirname(os.path.abspath(__file__))
        cert_path = os.path.join(BASE_DIR, 'cert.pem')
        key_path = os.path.join(BASE_DIR, 'key.pem')
        protocol = "http"
        if os.path.exists(cert_path) and os.path.exists(key_path):
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certfile=cert_path, keyfile=key_path)
            httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
            protocol = "https"
            print(f"🔒 SSL Enabled (Using {cert_path})")

        print(f"🚀 Launcher Service running at port {PORT} ({protocol})")
        print(f"👉 Manager UI: {protocol}://localhost:8000/manager.html")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Launcher stopped")
