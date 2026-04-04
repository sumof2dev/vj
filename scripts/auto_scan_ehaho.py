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
CHANNEL_PATTERN = 3           
CHANNELS_TO_ENABLE = {0: 255, 13: 255, 14: 255} 
CAMERA_DEVICE = 0
SAVE_DIR = "/home/sumof2/vj/tmp/scan_results"
os.makedirs(SAVE_DIR, exist_ok=True)

async def scan():
    print(f"[*] Starting Secure Auto-Scan for {TARGET_INSTANCE_ID}...")
    
    cap = cv2.VideoCapture(CAMERA_DEVICE)
    if not cap.isOpened():
        print("[!] Could not open camera")
        return

    # Create SSL context to skip verification for self-signed certs
    ssl_context = ssl.SSLContext()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    try:
        # USE WSS and SSL context
        async with websockets.connect("wss://localhost:8765", ssl=ssl_context) as ws:
            results = []
            
            # PRE-CALIBRATION
            pre_overrides = []
            for ch, val in CHANNELS_TO_ENABLE.items():
                pre_overrides.append({"address": FIXTURE_ADDR + ch, "value": val})
            await ws.send(json.dumps({"type": "laser_override", "overrides": pre_overrides}))
            await asyncio.sleep(1.0) # Longer wait for laser to warm up/dimmer to open

            print("[*] Sweeping Patterns 0-127...")
            for p in range(128):
                # Set pattern
                await ws.send(json.dumps({"type": "laser_override", "overrides": [{"address": FIXTURE_ADDR + CHANNEL_PATTERN, "value": p}]}))
                await asyncio.sleep(0.2) # Faster scan? No, keep it safe
                
                ret, frame = cap.read()
                if not ret: continue
                
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                _, thresh = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY)
                edges = cv2.Canny(gray, 100, 200)
                edge_count = np.sum(edges > 0)
                brightness = np.sum(thresh > 0)
                is_active = brightness > 300 # Lower threshold?
                
                results.append({
                    "dmx": p,
                    "complexity": int(edge_count),
                    "brightness": int(brightness),
                    "active": bool(is_active)
                })
                
                if p % 5 == 0 or (is_active and edge_count > 4000):
                    cv2.imwrite(f"{SAVE_DIR}/pattern_{p:03d}.jpg", frame)

                print(f"  > P[{p:03d}]: Status={'OK' if is_active else 'EMPTY'} (B={brightness}, E={edge_count})")

            with open(f"{SAVE_DIR}/report.json", "w") as f:
                json.dump(results, f, indent=4)
            
            await ws.send(json.dumps({"type": "clear_overrides", "device": "all"}))
            print(f"[*] Scan complete! Results saved to {SAVE_DIR}/report.json")
    
    except Exception as e:
        print(f"[!] WebSocket Error: {e}")
    finally:
        cap.release()

if __name__ == "__main__":
    asyncio.run(scan())
