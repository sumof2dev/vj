import socket
import sys
import time

UDP_IP = "192.168.1.89"
UDP_PORT = 5002

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
data = bytearray([0] * 513)
data[0] = 0x00 # Start code
data[1] = 255  # Channel 1 to Full

print(f"Sending test DMX packet to {UDP_IP}:{UDP_PORT}")
for i in range(10):
    sock.sendto(data, (UDP_IP, UDP_PORT))
    print(".", end="", flush=True)
    time.sleep(0.5)
print("\nDone.")
