
import asyncio
import websockets
import json
import ssl

async def check_audio():
    uri = "wss://localhost:8765"
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    try:
        async with websockets.connect(uri, ssl=ssl_context) as websocket:
            # Wait for one message
            message = await websocket.recv()
            
            # Check if it's binary or JSON
            if isinstance(message, bytes):
                import struct
                # Header Layout (Total 86 bytes for header):
                # - master_time (f32)
                # - flux, bass, mid, high, vol, bpm, beat_phase (7x f32)
                # - bins (6x f32)
                # - beat, b_onset, h_onset, intensity (4x u8)
                header = message[:86]
                fmt = '<f fffffff ffffff BBBB fffff HHH'
                data = struct.unpack(fmt, header)
                
                print(f"Current Audio State (Binary Packet):")
                print(f"  Time: {data[0]:.3f}")
                print(f"  Vol: {data[5]:.3f}")
                print(f"  Bins: {[round(x, 3) for x in data[8:14]]}")
                print(f"  BPM: {data[6]:.1f}")
            else:
                data = json.loads(message)
                if 'audio' in data:
                    audio = data['audio']
                    print(f"Current Audio State (JSON):")
                    print(f"  Vol: {audio.get('vol', 0):.3f}")
                    print(f"  Bins: {[round(b, 3) for b in audio.get('bins', [])]}")
                    print(f"  BPM: {audio.get('bpm', 0):.1f}")
                else:
                    print("No audio data in JSON packet.")
                    print(f"Keys: {list(data.keys())}")
    except Exception as e:
        print(f"Error connecting to websocket: {e}")

asyncio.run(check_audio())
