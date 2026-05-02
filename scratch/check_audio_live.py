
import asyncio
import websockets
import json

async def check_audio():
    uri = "ws://localhost:8765"
    try:
        async with websockets.connect(uri) as websocket:
            # Wait for one message
            message = await websocket.recv()
            data = json.loads(message)
            if 'audio' in data:
                audio = data['audio']
                print(f"Current Audio State:")
                print(f"  Vol: {audio.get('vol', 0):.3f}")
                print(f"  Bins: {[round(b, 3) for b in audio.get('bins', [])]}")
                print(f"  BPM: {audio.get('bpm', 0):.1f}")
                print(f"  Vibe: {audio.get('vibe', 'unknown')}")
            else:
                print("No audio data in packet.")
                print(f"Keys available: {list(data.keys())}")
    except Exception as e:
        print(f"Error connecting to websocket: {e}")

asyncio.run(check_audio())
