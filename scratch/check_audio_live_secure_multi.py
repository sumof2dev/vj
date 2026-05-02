
import asyncio
import websockets
import json
import ssl
import struct

async def check_audio():
    uri = "wss://localhost:8765"
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    try:
        async with websockets.connect(uri, ssl=ssl_context) as websocket:
            for _ in range(20): # Check up to 20 messages
                message = await websocket.recv()
                
                if isinstance(message, bytes):
                    # Header Layout (Total 86 bytes for header):
                    # - master_time (f32)
                    # - flux, bass, mid, high, vol, bpm, beat_phase (7x f32)
                    # - bins (6x f32)
                    header = message[:86]
                    if len(header) < 86: continue
                    
                    # Correct format based on main.py:
                    # struct.pack('<f fffffff ffffff BBBB fffff HHH', ...)
                    # f: 4 bytes, B: 1 byte, H: 2 bytes
                    # 1*4 + 7*4 + 6*4 + 4*1 + 5*4 + 3*2 = 4 + 28 + 24 + 4 + 20 + 6 = 86 bytes
                    fmt = '<f fffffff ffffff BBBB fffff HHH'
                    data = struct.unpack(fmt, header)
                    
                    bins = data[8:14]
                    print(f"Current Audio State (Binary Packet):")
                    print(f"  Vol: {data[5]:.3f}")
                    print(f"  Bins: {[round(x, 3) for x in bins]}")
                    print(f"  BPM: {data[6]:.1f}")
                    return
                else:
                    try:
                        js = json.loads(message)
                        if js.get('type') == 'audio':
                            print(f"Current Audio State (JSON audio):")
                            print(f"  Vol: {js.get('vol', 0):.3f}")
                            print(f"  Bins: {js.get('bins', [])}")
                            return
                    except: pass
            print("No audio packet found in 20 messages.")
    except Exception as e:
        print(f"Error connecting to websocket: {e}")

asyncio.run(check_audio())
