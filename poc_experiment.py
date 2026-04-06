import asyncio
import websockets
import ssl
import json
import urllib.request
import cv2
import numpy as np

ctx_ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ctx_ssl.check_hostname = False
ctx_ssl.verify_mode = ssl.CERT_NONE

def get_brightness():
    try:
        req = urllib.request.urlopen("http://localhost:8004/capture")
        arr = np.asarray(bytearray(req.read()), dtype=np.uint8)
        img = cv2.imdecode(arr, -1)
        if img is not None:
            return np.mean(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    except Exception as e:
        pass
    return None

async def run():
    print("Testing Live Camera Loop...")
    async with websockets.connect("wss://localhost:8765", ssl=ctx_ssl, ping_interval=None) as ws:
        
        # OFF
        await ws.send(json.dumps({"type": "laser_override", "overrides": [{"address": i, "value": 0} for i in range(1, 513)]}))
        await asyncio.sleep(1.0)
        print(f"1. Lights OFF Brightness: {get_brightness() or 'Error'}")

        # ON (Fix 1)
        await ws.send(json.dumps({"type": "laser_override", "overrides": [{"address": i, "value": 255} for i in range(1, 10)]}))
        await asyncio.sleep(1.0)
        print(f"2. Single Fixture ON Brightness: {get_brightness() or 'Error'}")

        # MAX
        await ws.send(json.dumps({"type": "laser_override", "overrides": [{"address": i, "value": 255} for i in range(1, 100)]}))
        await asyncio.sleep(1.0)
        print(f"3. Full Wash Brightness: {get_brightness() or 'Error'}")

        await ws.send(json.dumps({"type": "clear_overrides", "device": "all"}))
        print("Done!")

if __name__ == "__main__":
    asyncio.run(run())
