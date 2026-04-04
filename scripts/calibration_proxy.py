import cv2, os, json, time, ssl, queue, threading, asyncio, websockets
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

SAVE_DIR = "/home/sumof2/vj/tmp/calibration_results"
os.makedirs(f"{SAVE_DIR}/frames", exist_ok=True)

CAL_PORT = 8002  # Dedicated port - avoids 8000 (server.py) and 8001 (launcher.py)

class CalibrationSuite:
    def __init__(self):
        self.cap = cv2.VideoCapture(0)
        self.frame = None
        self.running = True
        self.lock = threading.Lock()
        self.current_phase = "idle"
        self.progress = 0
        self.active_fixture = "Left1"
        self.config = None
        self.dmx_queue = queue.Queue()
        self.loop = asyncio.new_event_loop()

    def start_hardware(self):
        def cam_loop():
            while self.running:
                ret, frame = self.cap.read()
                if ret:
                    with self.lock: self.frame = frame.copy()
                else: time.sleep(0.5)
        threading.Thread(target=cam_loop, daemon=True).start()

        def ws_loop():
            asyncio.set_event_loop(self.loop)
            self.loop.create_task(self.ws_worker())
            self.loop.run_forever()
        threading.Thread(target=ws_loop, daemon=True).start()

    async def ws_worker(self):
        ctx_ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx_ssl.check_hostname = False
        ctx_ssl.verify_mode = ssl.CERT_NONE
        while self.running:
            try:
                async with websockets.connect("wss://localhost:8765", ssl=ctx_ssl) as ws:
                    print("✅ LINKED TO DMX ENGINE (wss://localhost:8765)")
                    while self.running:
                        try:
                            overrides = self.dmx_queue.get_nowait()
                            await ws.send(json.dumps({"type": "laser_override", "overrides": overrides}))
                        except queue.Empty:
                            await asyncio.sleep(0.01)
                        except:
                            break
            except:
                await asyncio.sleep(2)

    def send_dmx(self, overrides):
        self.dmx_queue.put(overrides)

    def get_frame(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

suite = CalibrationSuite()
suite.start_hardware()

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    allow_reuse_address = True

class CalHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        path = args[0] if args else ""
        if "/status" not in str(path) and "/capture" not in str(path):
            print(f"[{time.strftime('%H:%M:%S')}] {format % args}")

    def send_json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path == '/status':
            frames = len([f for f in os.listdir(f"{SAVE_DIR}/frames") if f.endswith('.jpg')])
            self.send_json({"phase": suite.current_phase, "progress": suite.progress, "frames": frames})
            return

        if parsed.path == '/capture':
            frame = suite.get_frame()
            if frame is not None:
                _, jpeg = cv2.imencode('.jpg', frame)
                self.send_response(200)
                self.send_header('Content-type', 'image/jpeg')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(jpeg.tobytes())
            else:
                self.send_error(503, "Camera not ready")
            return

        if parsed.path == '/start_phase':
            phase = query.get('phase', ['zoom'])[0]
            suite.active_fixture = query.get('fixture', ['Left1'])[0]
            print(f"🔥 SCAN START: {phase} for {suite.active_fixture}")
            threading.Thread(target=run_phase, args=(phase,), daemon=True).start()
            self.send_json({"status": "started", "phase": phase, "fixture": suite.active_fixture})
            return

        if parsed.path == '/load_config':
            path = "/home/sumof2/vj/fixtures/ravebox_config.json"
            with open(path) as f:
                cfg = json.load(f)
            suite.config = cfg
            self.send_json(cfg)
            return

        # Serve calibration.html for root
        if parsed.path in ['/', '/calibration.html']:
            html_path = "/home/sumof2/vj/calibration.html"
            if os.path.exists(html_path):
                self.send_response(200)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                with open(html_path, 'rb') as f:
                    self.wfile.write(f.read())
                return

        self.send_error(404)


def get_addrs():
    """Resolve DMX addresses for the active fixture."""
    if not suite.config:
        with open("/home/sumof2/vj/fixtures/ravebox_config.json") as f:
            suite.config = json.load(f)

    target = next((s for s in suite.config['stage'] if s['id'].lower() == suite.active_fixture.lower()), None)
    if not target:
        print(f"❌ Fixture '{suite.active_fixture}' not found in stage config")
        return None

    fix = next((f for f in suite.config['fixtures'] if f['id'] == target['fixtureId']), None)
    base = int(target['address']) + int(target.get('offset', 0))

    addrs = {}
    for ch_idx, ch in enumerate(fix['channels']):
        role = ch.get('role', '')
        if role:
            addr = base + int(ch.get('addrOffset', ch_idx))
            addrs[role] = addr

    print(f"📋 Address map for {suite.active_fixture}: {addrs}")
    return addrs


def run_phase(name):
    suite.current_phase = name
    suite.progress = 0

    addrs = get_addrs()
    if not addrs:
        suite.current_phase = "idle"
        return

    dim = addrs.get("dim")
    group = addrs.get("group")
    zoom = addrs.get("zoom")
    pattern = addrs.get("pattern")
    x_pos = addrs.get("x_pos")
    y_pos = addrs.get("y_pos")
    x_rot = addrs.get("x_rot")
    y_rot = addrs.get("y_rot")
    z_rot = addrs.get("z_rot")

    def base_on():
        """Keep the laser ON with consistent dimmer/group."""
        return [{"address": dim, "value": 215}, {"address": group, "value": 250}]

    if name == "zoom":
        suite.send_dmx(base_on())
        time.sleep(1.5)
        sweep = list(range(0, 256, 4))
        for i, dmx in enumerate(sweep):
            suite.progress = i / len(sweep)
            suite.send_dmx(base_on() + [{"address": zoom, "value": dmx}])
            time.sleep(0.5 if dmx < 124 else 3.5)
            frame = suite.get_frame()
            if frame is not None:
                cv2.imwrite(f"{SAVE_DIR}/frames/zoom_{dmx:03d}.jpg", frame)
        print("✅ ZOOM COMPLETE")

    elif name == "pattern":
        # Reset zoom to a medium value first
        suite.send_dmx(base_on() + [{"address": zoom, "value": 50}])
        time.sleep(1.0)
        for dmx in range(0, 97):
            suite.progress = dmx / 96.0
            suite.send_dmx(base_on() + [{"address": zoom, "value": 50}, {"address": pattern, "value": dmx}])
            time.sleep(0.4)
            frame = suite.get_frame()
            if frame is not None:
                cv2.imwrite(f"{SAVE_DIR}/frames/pat_{dmx:03d}.jpg", frame)
        print("✅ PATTERN COMPLETE")

    elif name == "position":
        # Small dot for position tracking
        suite.send_dmx(base_on() + [{"address": zoom, "value": 20}, {"address": pattern, "value": 0}])
        time.sleep(1.0)
        steps = list(range(0, 256, 16))
        total = len(steps) * len(steps)
        count = 0
        for x in steps:
            for y in steps:
                suite.progress = count / total
                suite.send_dmx(base_on() + [
                    {"address": zoom, "value": 20},
                    {"address": pattern, "value": 0},
                    {"address": x_pos, "value": x},
                    {"address": y_pos, "value": y}
                ])
                time.sleep(0.2)
                frame = suite.get_frame()
                if frame is not None:
                    cv2.imwrite(f"{SAVE_DIR}/frames/pos_{x:03d}_{y:03d}.jpg", frame)
                count += 1
        print("✅ POSITION COMPLETE")

    elif name == "rotation":
        # Use a triangle pattern at medium zoom for rotation visibility
        suite.send_dmx(base_on() + [{"address": zoom, "value": 80}, {"address": pattern, "value": 6}])
        time.sleep(1.0)
        axes = [("x_rot", x_rot), ("y_rot", y_rot), ("z_rot", z_rot)]
        for axis_name, addr in axes:
            if addr is None:
                continue
            steps = list(range(0, 256, 8))
            for i, dmx in enumerate(steps):
                suite.progress = i / len(steps)
                suite.send_dmx(base_on() + [
                    {"address": zoom, "value": 80},
                    {"address": pattern, "value": 6},
                    {"address": addr, "value": dmx}
                ])
                time.sleep(0.3)
                frame = suite.get_frame()
                if frame is not None:
                    cv2.imwrite(f"{SAVE_DIR}/frames/rot_{axis_name}_{dmx:03d}.jpg", frame)
        print("✅ ROTATION COMPLETE")

    suite.current_phase = "idle"
    suite.progress = 1.0


if __name__ == "__main__":
    server = ThreadedHTTPServer(('0.0.0.0', CAL_PORT), CalHandler)
    print(f"🚀 CALIBRATION ENGINE running on port {CAL_PORT}")
    print(f"   Open: http://192.168.86.39:{CAL_PORT}/calibration.html")
    server.serve_forever()
