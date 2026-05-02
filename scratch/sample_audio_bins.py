
import asyncio
import websockets
import json
import ssl
import struct
import numpy as np
import time

async def sample_audio():
    uri = "wss://localhost:8765"
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    bin_samples = [[] for _ in range(6)]
    vol_samples = []
    
    print("Sampling audio for 5 seconds...")
    try:
        async with websockets.connect(uri, ssl=ssl_context) as websocket:
            start_time = time.time()
            while time.time() - start_time < 5:
                message = await websocket.recv()
                if isinstance(message, bytes):
                    header = message[:86]
                    if len(header) < 86: continue
                    fmt = '<f fffffff ffffff BBBB fffff HHH'
                    data = struct.unpack(fmt, header)
                    
                    vol = data[5]
                    bins = data[8:14]
                    
                    vol_samples.append(vol)
                    for i in range(6):
                        bin_samples[i].append(bins[i])
            
            print("\nAudio Stats (Last 5s):")
            print(f"  Volume: Avg={np.mean(vol_samples):.3f}, Max={np.max(vol_samples):.3f}")
            for i in range(6):
                avg = np.mean(bin_samples[i])
                mx = np.max(bin_samples[i])
                print(f"  Bin {i}: Avg={avg:.3f}, Max={mx:.3f}")
                
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(sample_audio())
