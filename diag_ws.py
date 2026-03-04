import asyncio
import websockets
import json

async def check_params():
    uri = "ws://localhost:8765"
    try:
        async with websockets.connect(uri) as websocket:
            await websocket.send(json.dumps({"type": "get_params"}))
            response = await websocket.recv()
            data = json.loads(response)
            if "axes" in data:
                print(f"✅ Axes found in response: {list(data['axes'].keys())}")
                print(json.dumps(data['axes'], indent=2))
            else:
                print("❌ Axes key missing from response!")
                print(f"Message keys: {list(data.keys())}")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_params())
