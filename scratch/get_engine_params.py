
import asyncio
import websockets
import json
import ssl

async def get_params():
    uri = "wss://localhost:8765"
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    try:
        async with websockets.connect(uri, ssl=ssl_context) as websocket:
            # Request params
            await websocket.send(json.dumps({"type": "get_params"}))
            
            for _ in range(50): # Wait for more messages to be sure
                message = await websocket.recv()
                if not isinstance(message, bytes):
                    data = json.loads(message)
                    if data.get('type') == 'current_params':
                        print("Current Engine Params:")
                        print(json.dumps(data, indent=4))
                        return
            print("Could not find current_params in 50 messages.")
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(get_params())
