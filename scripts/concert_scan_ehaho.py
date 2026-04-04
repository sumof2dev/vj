import cv2
import json
import time
import asyncio
import websockets
import numpy as np
import os
import ssl

# --- CONFIG ---
TARGET_INSTANCE_ID = "Left1" 
FIXTURE_ADDR = 1              
CHANNEL_PATTERN = 3           # CH 4
PATTERN_VAL = 89              # Known complex geometry
CHANNEL_DRAW_DELAY = 13       # CH 14
CHANNEL_DRAW = 14             # CH 15

# Matrix settings (10x10 = 100 samples)
STEPS = 10
SWEEP_RANGE = np.linspace(0, 255, STEPS, dtype=int)

SAVE_DIR = "/home/sumof2/vj/tmp/concert_results"
os.makedirs(SAVE_DIR, exist_ok=True)
REPORT_FILE = os.path.join(SAVE_DIR, "concert_report.json")

async def scan():
    print(f"[*] Starting RESILIENT CONCERT Scan for {TARGET_INSTANCE_ID}...")
    
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[!] Could not open camera")
        return

    ssl_context = ssl.SSLContext()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    results = []
    # Load existing if any
    if os.path.exists(REPORT_FILE):
        try:
            with open(REPORT_FILE, 'r') as f:
                results = json.load(f)
            print(f"[*] Resuming from {len(results)} existing records")
        except: pass

    try:
        async with websockets.connect("wss://localhost:8765", ssl=ssl_context) as ws:
            base_overrides = [
                {"address": FIXTURE_ADDR + 0, "value": 215}, # Dimmer
                {"address": FIXTURE_ADDR + 3, "value": PATTERN_VAL}, # Pattern
                {"address": FIXTURE_ADDR + 2, "value": 250}, # Group 0
            ]
            
            total = STEPS * STEPS
            count = 0
            
            for d_delay in SWEEP_RANGE:
                for d_draw in SWEEP_RANGE:
                    count += 1
                    
                    # Skip if already done (v1 logic)
                    if any(r['ch14_delay'] == int(d_delay) and r['ch15_draw'] == int(d_draw) for r in results):
                        continue
                    
                    overrides = base_overrides + [
                        {"address": FIXTURE_ADDR + CHANNEL_DRAW_DELAY, "value": int(d_delay)},
                        {"address": FIXTURE_ADDR + CHANNEL_DRAW, "value": int(d_draw)}
                    ]
                    
                    try:
                        await ws.send(json.dumps({"type": "laser_override", "overrides": overrides}))
                        await asyncio.sleep(1.0) 
                        
                        ret, frame = cap.read()
                        if not ret: continue
                        
                        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                        edges = cv2.Canny(gray, 100, 200)
                        edge_count = np.sum(edges > 0)
                        brightness = np.sum(gray > 50)
                        
                        res = {
                            "ch14_delay": int(d_delay),
                            "ch15_draw": int(d_draw),
                            "complexity": int(edge_count),
                            "brightness": int(brightness)
                        }
                        results.append(res)
                        
                        # SAVE EVERY STEP
                        with open(REPORT_FILE, "w") as f:
                            json.dump(results, f, indent=4)
                        
                        if count % 10 == 0:
                            cv2.imwrite(f"{SAVE_DIR}/concert_{d_delay:03d}_{d_draw:03d}.jpg", frame)

                        print(f"[{count}/{total}] D14={d_delay:03d} D15={d_draw:03d} | E={edge_count}, B={brightness}")
                    
                    except websockets.exceptions.ConnectionClosed:
                        print("[!] Connection lost, retrying in 5s...")
                        await asyncio.sleep(5)
                        # Re-connect logic would be better but let's just exit and rely on resume
                        return

            await ws.send(json.dumps({"type": "clear_overrides", "device": "all"}))
            print(f"[*] Concert Scan complete!")
    
    except Exception as e:
        print(f"[!] Error: {e}")
    finally:
        cap.release()

if __name__ == "__main__":
    asyncio.run(scan())
