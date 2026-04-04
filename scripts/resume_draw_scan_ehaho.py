import asyncio
import websockets
import json
import cv2
import numpy as np
import os
import ssl

# --- CONFIGURATION ---
WS_URL = "wss://localhost:8765"
SAVE_DIR = "/home/sumof2/vj/tmp/multi_axis_results"
os.makedirs(SAVE_DIR, exist_ok=True)

# Ehaho channel addresses (1-indexed DMX)
CH_DIM     = 1
CH_PATTERN = 4
CH_ZOOM    = 5
CH_DRAW    = 14   # "draw" channel (CH 13 in fixture, addr offset 13)
CH_DRAWING = 15   # "drawing" channel (CH 14 in fixture, addr offset 14)

BASE_PATTERN = 5
BASE_ZOOM    = 255
BASE_DIM     = 215

GRID_SIZE = 8
STEPS = [int(x) for x in np.linspace(0, 255, GRID_SIZE)]

def already_captured(draw, drawing):
    return os.path.exists(os.path.join(SAVE_DIR, f"draw_{draw:03d}_{drawing:03d}.jpg"))

async def send_dmx(ws, overrides):
    msg = {"type": "laser_override", "overrides": overrides}
    await ws.send(json.dumps(msg))

def analyze_frame(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
    brightness = int(np.sum(gray) // 1000)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    complexity = sum(len(c) for c in contours)
    return complexity, brightness

async def run_scan():
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    # ping_interval keeps the connection alive through long DMX holds
    async with websockets.connect(WS_URL, ssl=ssl_context, ping_interval=20, ping_timeout=60) as ws:
        cap = cv2.VideoCapture(0)
        results = []

        # Set base state
        await send_dmx(ws, [
            {"address": CH_DIM,     "value": BASE_DIM},
            {"address": CH_PATTERN, "value": BASE_PATTERN},
            {"address": CH_ZOOM,    "value": BASE_ZOOM},
        ])
        await asyncio.sleep(1.0)

        print("[*] Resuming Drawing Interaction scan (skipping already captured frames)...")

        skipped = 0
        for draw in STEPS:
            for drawing in STEPS:
                if already_captured(draw, drawing):
                    skipped += 1
                    continue

                await send_dmx(ws, [
                    {"address": CH_DRAW,    "value": draw},
                    {"address": CH_DRAWING, "value": drawing},
                ])
                await asyncio.sleep(0.55)

                ret, frame = cap.read()
                if ret:
                    comp, bright = analyze_frame(frame)
                    filename = f"draw_{draw:03d}_{drawing:03d}.jpg"
                    cv2.imwrite(os.path.join(SAVE_DIR, filename), frame)
                    results.append({
                        "type": "drawing", "draw": draw, "drawing": drawing,
                        "complexity": comp, "brightness": bright, "file": filename
                    })
                    print(f"  [Draw] D1:{draw} D2:{drawing} -> Comp:{comp}")

        cap.release()
        print(f"[*] Done. {len(results)} new frames captured. {skipped} skipped (already done).")

if __name__ == "__main__":
    asyncio.run(run_scan())
