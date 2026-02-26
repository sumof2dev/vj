#!/usr/bin/env python3
import http.server
import socketserver
import subprocess
import json
import os
import urllib.parse

PORT = 8001

class LauncherHandler(http.server.SimpleHTTPRequestHandler):
    def address_string(self):
        return str(self.client_address[0])

    def do_GET(self):
        if self.path == '/start':
            self.run_systemd('start')
        elif self.path == '/stop':
            self.run_systemd('stop')
        elif self.path == '/restart':
            self.run_systemd('restart')
        elif self.path == '/status':
            self.run_systemd('is-active', 'vj-engine.service')
            
        elif self.path.startswith('/api/smart/control'):
            self.handle_smart_control()
            
        elif self.path in ['/', '/manager', '/manager.html', '/setup.html', '/visualdmx.html', '/remote.html']:
            # Redirect frontend apps to the main engine port (8000)
            host = self.headers.get('Host').split(':')[0]
            target_path = '/manager.html' if self.path in ['/', '/manager'] else self.path
            self.send_response(302)
            self.send_header('Location', f'http://{host}:8000{target_path}')
            self.end_headers()
            return
        else:
            return super().do_GET()

    def run_systemd(self, action, service='vj-engine.service'):


        try:
            # We use sudo for systemctl. 
            cmd = ['sudo', 'systemctl', action, service]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            # Helper for status checks
            if action == 'is-active':
                status = result.stdout.strip()
                response = {
                    "status": status,
                    "active": status == 'active',
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
            
            self.wfile.write(json.dumps(response).encode())
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
            self.send_header('Access-Control-Allow-Origin', '*')
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

    def error_response(self, message):
        self.send_response(500)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
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
        print(f"🚀 Launcher Service running at port {PORT}")
        print(f"👉 Manager UI: http://localhost:{PORT}/manager.html")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Launcher stopped")
