import socket
import struct
import time

def probe_dmx():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.connect(('localhost', 8765))
        # Wait for binary payload
        while True:
            data = sock.recv(2048)
            if not data: break
            if len(data) >= 599:
                # Header is 86 bytes, DMX starts at 86
                dmx = data[86:86+513]
                print(f"Address 75: {dmx[75]}")
                print(f"Address 76: {dmx[76]}")
                print(f"Address 77: {dmx[77]}")
                print(f"Address 78: {dmx[78]}")
                break
    except Exception as e:
        print(f"Error: {e}")
    finally:
        sock.close()

probe_dmx()
