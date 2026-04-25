import socket
import serial
import serial.tools.list_ports
import time
import sys

# ------------------------------------------------------------------------------
# DMX UDP Node Controller (Enhanced with Auto-Discovery)
# ------------------------------------------------------------------------------

UDP_IP = "0.0.0.0" 
UDP_PORT = 5002    
BAUD = 250000

def log(msg):
    print(msg, flush=True)

def find_dmx_port():
    """Look for USB DMX adapters first, then GPIO UART"""
    candidates = []
    for p in serial.tools.list_ports.comports():
        if any(x in p.device.lower() for x in ['usb', 'ttyusb', 'ama0', 'serial0', 'uart0', 'uart2']):
            candidates.append(p.device)
    
    # Prioritize USB
    candidates.sort(key=lambda x: 'usb' in x.lower(), reverse=True)
    
    for dev in candidates:
        try:
            ser = serial.Serial(
                dev, 
                baudrate=BAUD, 
                stopbits=2, 
                timeout=0,
                write_timeout=0.1
            )
            is_usb = any(x in dev.lower() for x in ['usb', 'ttyusb'])
            log(f"🔌 DMX Connected: {dev} @ {BAUD} baud (USB: {is_usb})")
            return ser, is_usb
        except Exception as e:
            log(f"⚠️ Could not open {dev}: {e}")
    
    return None, False

def send_dmx_break(port, is_usb):
    if is_usb:
        # Hardware break for FTDI/USB
        port.break_condition = True
        time.sleep(0.0001) # 100us
        port.break_condition = False
        time.sleep(0.00001) # 10us MAB
    else:
        # Baud-rate trick for Pi Pins
        original_baud = port.baudrate
        port.baudrate = 57600
        port.write(b'\x00')
        port.flush() 
        time.sleep(0.00002) # 20us MAB
        port.baudrate = original_baud

def run_node():
    ser, is_usb = find_dmx_port()
    if not ser:
        log("❌ CRITICAL: No DMX Hardware found (USB or GPIO).")
        # We will keep running the UDP loop anyway in case hardware is plugged in later
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    
    log(f"📡 DMX Node active. Listening on UDP {UDP_PORT}")
    
    last_log = time.time()
    packet_count = 0
    
    try:
        while True:
            try:
                sock.settimeout(2.0)
                data, addr = sock.recvfrom(513)
                
                if ser:
                    try:
                        send_dmx_break(ser, is_usb)
                        ser.write(data)
                        ser.flush()
                    except Exception as e:
                        log(f"⚠️ Write Error: {e}")
                        ser.close()
                        ser = None # Trigger re-discovery logic if we wanted, but for now just fail
                
                packet_count += 1
                if time.time() - last_log > 1.0:
                    log(f"📥 RX: {len(data)} bytes from {addr[0]} | Total: {packet_count}")
                    last_log = time.time()
            except socket.timeout:
                log(f"💓 NODE HEARTBEAT: Waiting for Master on port {UDP_PORT}...")
                last_log = time.time()
                
    except KeyboardInterrupt:
        log("\n🛑 Node Shutting Down.")
        if ser: ser.close()
        sock.close()

if __name__ == "__main__":
    run_node() 
