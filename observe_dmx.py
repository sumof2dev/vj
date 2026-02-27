import asyncio
import websockets
import json

async def observe():
    uri = "ws://localhost:8765"
    async with websockets.connect(uri) as websocket:
        print(f"Connected to {uri}")
        # Send get_params to initialize
        await websocket.send(json.dumps({"type": "get_params"}))
        
        count = 0
        while count < 20: # Capture 20 frames
            try:
                msg = await websocket.recv()
                data = json.loads(msg)
                if data.get("type") == "audio":
                    dmx = data.get("dmx", {})
                    # Filter for Zoom and Position roles
                    monitored = {k: v for k, v in dmx.items() if "zoom" in k or "pos_x" in k or "pos_y" in k}
                    vibe = data.get("data", {}).get("vibe", "unknown")
                    scene = data.get("active_scene", "unknown")
                    print(f"[{count}] Vibe: {vibe} | Scene: {scene} | DMX: {monitored}")
                    count += 1
            except Exception as e:
                print(f"Error: {e}")
                break

if __name__ == "__main__":
    asyncio.run(observe())
