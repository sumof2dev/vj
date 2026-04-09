import cv2, os, json, time, ssl, queue
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
import threading
import websockets
import asyncio

# Configuration
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVE_DIR = os.path.join(BASE_DIR, "tmp", "calibration_results")
os.makedirs(SAVE_DIR, exist_ok=True)
os.makedirs(os.path.join(SAVE_DIR, "frames"), exist_ok=True)

# Global State
class CalibrationContext:
    def __init__(self):
        self.cap = None
        self.frame = None
        self.running = True
        self.lock = threading.Lock()
        self.current_phase = "idle"
        self.progress = 0
        self.active_fixture = "Left1"
        self.config = None
        self.loop = asyncio.new_event_loop()
        self.dmx_queue = queue.Queue()
        self.ws = None 

        # Auto-probe for camera
        print("📸 Probing for camera...")
        found = False
        for idx in [0, 1, 2, 3, 4, 20, 21]: # Try common indices including RPi5 offsets
            try:
                cap = cv2.VideoCapture(idx)
                if cap.isOpened():
                    ret, frame = cap.read()
                    if ret:
                        print(f"✅ Camera found and delivering frames at index {idx}")
                        self.cap = cap
                        found = True
                        break
                    cap.release()
            except Exception as e:
                print(f"⚠️ Index {idx} probe error: {e}")
        
        if not found:
            print("❌ No working camera found during probe. Defaulting to index 0.")
            self.cap = cv2.VideoCapture(0)

    def start_camera(self):
        def loop():
            while self.running:
                ret, frame = self.cap.read()
                if ret:
                    with self.lock: self.frame = frame.copy()
                else: time.sleep(0.5)
        threading.Thread(target=loop, daemon=True).start()

    def get_frame(self):
        with self.lock: return self.frame.copy() if self.frame is not None else None

    async def ws_worker(self):
        ctx_ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx_ssl.check_hostname = False
        ctx_ssl.verify_mode = ssl.CERT_NONE
        
        while self.running:
            try:
                async with websockets.connect("wss://localhost:8765", ssl=ctx_ssl, ping_interval=None) as ws:
                    print("✅ WS WORKER: Linked to Engine")
                    while self.running:
                        try:
                            # Non-blocking get from thread-safe queue
                            overrides = self.dmx_queue.get_nowait()
                            await ws.send(json.dumps({"type": "laser_override", "overrides": overrides}))
                        except queue.Empty:
                            await asyncio.sleep(0.01)
                        except Exception as e:
                            print(f"❌ WS Send Error: {e}")
                            break
            except:
                await asyncio.sleep(2)

    def send_dmx(self, overrides):
        self.dmx_queue.put(overrides)

ctx = CalibrationContext()
ctx.start_camera()

def start_async():
    asyncio.set_event_loop(ctx.loop)
    ctx.loop.create_task(ctx.ws_worker())
    ctx.loop.run_forever()
threading.Thread(target=start_async, daemon=True).start()

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer): pass

class CalibrationHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        if "/status" not in self.path:
            print(f"[{time.strftime('%H:%M:%S')}] {format%args}")

    def send_cors_headers(self, response_code=200, content_type="application/json"):
        self.send_response(response_code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Content-type', content_type)
        self.end_headers()

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        query = parse_qs(urlparse(self.path).query)

        if self.path.startswith('/start_phase'):
            phase = query.get('phase', ['zoom'])[0]
            ctx.active_fixture = query.get('fixture', ['Left1'])[0]
            print(f"🔥 SCAN TRIGGER: {phase} for {ctx.active_fixture}")
            threading.Thread(target=self.run_calibration_logic, args=(phase,), daemon=True).start()
            self.send_cors_headers(200); self.wfile.write(b'{"status":"started"}')
            return

        if self.path.startswith('/capture'):
            frame = ctx.get_frame()
            if frame is not None:
                _, jpeg = cv2.imencode('.jpg', frame)
                self.send_cors_headers(200, "image/jpeg")
                self.wfile.write(jpeg.tobytes())
            else: self.send_error(503)
        elif self.path == '/status':
            self.send_cors_headers(200)
            self.wfile.write(json.dumps({"phase": ctx.current_phase, "progress": ctx.progress}).encode())
        elif self.path == '/load_config':
            path = os.path.join(BASE_DIR, "fixtures", "ravebox_config.json")
            if os.path.exists(path):
                with open(path) as f: ctx.config = json.load(f)
                self.send_cors_headers(200)
                self.wfile.write(json.dumps(ctx.config).encode())

    def run_calibration_logic(self, name):
        ctx.current_phase = name
        ctx.progress = 0
        if not ctx.config:
            config_path = os.path.join(BASE_DIR, "fixtures", "ravebox_config.json")
            with open(config_path) as f: ctx.config = json.load(f)

        def get_addr(role):
            target = next((s for s in ctx.config['stage'] if s['id'].lower() == ctx.active_fixture.lower()), None)
            if not target: return None
            fix = next((f for f in ctx.config['fixtures'] if f['id'] == target['fixtureId']), None)
            base = int(target['address']) + int(target.get('offset', 0))
            ch = next((c for c in fix['channels'] if c.get('role') == role), None)
            if not ch: return None
            return base + int(ch.get('addrOffset', fix['channels'].index(ch)))

        addrs = {role: get_addr(role) for role in ["dim", "group", "zoom", "pattern"]}
        if any(v is None for v in addrs.values()):
            print(f"❌ Mapping fail: {addrs}")
            ctx.current_phase = "idle"; return

        if name == "zoom":
            ctx.send_dmx([{"address": addrs["dim"], "value": 215}, {"address": addrs["group"], "value": 250}])
            time.sleep(2.0)
            sweep = list(range(0, 128, 4)) + list(range(129, 256, 4))
            for i, dmx in enumerate(sweep):
                ctx.progress = i / len(sweep)
                ctx.send_dmx([
                    {"address": addrs["dim"], "value": 215}, 
                    {"address": addrs["group"], "value": 250},
                    {"address": addrs["zoom"], "value": dmx}
                ])
                time.sleep(0.5 if dmx < 124 else 3.5)
                frame = ctx.get_frame()
                if frame is not None:
                    cv2.imwrite(f"{SAVE_DIR}/frames/zoom_{dmx}.jpg", frame)
            ctx.current_phase = "idle"
            print("✅ ZOOM COMPLETE")

        elif name == "pattern":
            ctx.send_dmx([{"address": addrs["zoom"], "value": 50}])
            time.sleep(1.0)
            for dmx in range(0, 97):
                ctx.progress = dmx / 96.0
                ctx.send_dmx([
                    {"address": addrs["dim"], "value": 215},
                    {"address": addrs["group"], "value": 250},
                    {"address": addrs["pattern"], "value": dmx}
                ])
                time.sleep(0.4)
                frame = ctx.get_frame()
                if frame is not None:
                    cv2.imwrite(f"{SAVE_DIR}/frames/pat_{dmx}.jpg", frame)
            ctx.current_phase = "idle"
            print("✅ PATTERN COMPLETE")

    def do_OPTIONS(self):
        self.send_cors_headers(200)

def run_server():
    server = ThreadedHTTPServer(('0.0.0.0', 8004), CalibrationHandler)
    print("📸 Calibration Engine (v14-ISOLATED) running on port 8004")
    server.serve_forever()

if __name__ == "__main__":
    run_server()
