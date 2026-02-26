import socket
import json
import time
import requests

class GoveeEngine:
    def __init__(self, device_ip, api_key="", device_mac="98:17:3C:05:94:40", model=""):
        # --- LAN CONTROL CONFIG (Fast) ---
        self.ip = device_ip
        self.port = 4001
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        
        # --- CLOUD CONTROL CONFIG (Slow, optional) ---
        self.api_key = api_key
        self.mac = device_mac
        self.model = model
        self.cloud_url = "https://developer-api.govee.com/v1/devices/control"

        # --- STATE TRACKING ---
        self.last_update = 0
        self.min_interval = 0.1  # Limit to ~10 updates/sec to prevent crashing device
        
        # Strobe State
        self.is_strobing = False
        self.strobe_timer = 0
        
        # Cache to prevent sending duplicate UDP packets
        self.last_r = -1
        self.last_g = -1
        self.last_b = -1
        self.last_bri = -1

    def send_packet(self, cmd_dict):
        """Wraps command in Govee JSON and fires UDP packet"""
        payload = {"msg": cmd_dict}
        try:
            msg = json.dumps(payload).encode('utf-8')
            self.sock.sendto(msg, (self.ip, self.port))
        except Exception as e:
            print(f"Govee LAN Error: {e}")

    def update(self, audio_state):
        """
        Main loop called by main.py.
        Syncs lighting to Audio Analysis.
        """
        now = time.time()
        
        # --- 1. STROBE LOGIC (High Intensity) ---
        # If Flux (energy change) is massive, we strobe.
        # Threshold 0.8 is "Hard Hit".
        if audio_state.get('flux', 0) > 0.8:
            # Bypass standard rate limit for strobe (allow 20Hz)
            if now - self.last_update > 0.05: 
                # Toggle: If bright, go dark. If dark, go bright.
                if self.last_bri > 10:
                    self.set_color_immediate(0, 0, 0, 0) # Black out
                else:
                    self.set_color_immediate(255, 255, 255, 100) # MAX WHITE
                self.last_update = now
            return

        # --- 2. RATE LIMITING (Standard Mode) ---
        if now - self.last_update < self.min_interval:
            return

        # --- 3. STANDARD REACTIVE LOGIC ---
        # Brightness based on Volume
        vol = audio_state.get('vol', 0)
        target_bri = int(min(100, max(0, vol * 100)))

        # Color based on Vibe
        vibe = audio_state.get('vibe', 'mid')
        
        if vibe == 'chill':
            # Cyan / Teal
            r, g, b = 0, 0, 255
            # Cap brightness for chill mode
            target_bri = min(50, target_bri)
            
        elif vibe == 'high':
            # Red / Orange / Aggressive
            r, g, b = 255, 0, 20
            
        else: # 'mid'
            # Purple / Pink
            r, g, b = 0, 255, 100

        # Beat Flash override (Visual Punch)
        if audio_state.get('beat', False):
            target_bri = 100
            # Optional: Flash white on beat
            # r, g, b = 255, 255, 255 

        # --- 4. EXECUTE ---
        # Only send if changed (saves network bandwidth)
        if (r, g, b) != (self.last_r, self.last_g, self.last_b):
            self.send_packet({
                "cmd": "color",
                "data": {"color": {"r": r, "g": g, "b": b}}
            })
            self.last_r, self.last_g, self.last_b = r, g, b

        if abs(target_bri - self.last_bri) > 5: # Threshold to stop jitter
            self.send_packet({
                "cmd": "brightness",
                "data": {"value": target_bri}
            })
            self.last_bri = target_bri

        self.last_update = now

    def set_color_immediate(self, r, g, b, bri):
        """Helper to force a state immediately (used by Strobe)"""
        self.send_packet({
            "cmd": "color",
            "data": {"color": {"r": r, "g": g, "b": b}}
        })
        self.send_packet({
            "cmd": "brightness",
            "data": {"value": bri}
        })
        self.last_r, self.last_g, self.last_b = r, g, b
        self.last_bri = bri

    def turn_on(self):
        self.send_packet({"cmd": "turn", "data": {"value": 1}})

    def turn_off(self):
        self.send_packet({"cmd": "turn", "data": {"value": 0}})

    def set_scene_via_cloud(self, scene_name):
        """
        Triggers a scene via Cloud (High Latency ~1s).
        Only works if you provided API Key and MAC Address.
        """
        if not self.api_key or not self.mac: 
            print("Govee: Missing API Key or MAC for Cloud Control")
            return

        # Note: Govee Cloud API for scenes is complex and varies by model.
        # This is a generic 'turn on' call as a placeholder.
        payload = {
            "device": self.mac,
            "model": self.model,
            "cmd": {
                "name": "turn",
                "value": "on"
            }
        }
        
        headers = {"Govee-API-Key": self.api_key, "Content-Type": "application/json"}
        try:
            requests.put(self.cloud_url, json=payload, headers=headers)
        except Exception as e:
            print(f"Govee Cloud Error: {e}")

# --- DISCOVERY UTILS ---
def find_govee_device(target_mac=None):
    """
    Scans for Govee devices via UDP Multicast.
    Returns the IP of the device matching target_mac, or the first one found if target_mac is None.
    Returns None if no device found.
    """
    MCAST_GRP = '239.255.255.250'
    MCAST_PORT = 4001
    SCAN_CMD = {"msg": {"cmd": "scan", "data": {"account_topic": "reserve"}}}
    
    print(f"📢 Broadcasting Govee discovery to {MCAST_GRP}:{MCAST_PORT}...")
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.settimeout(3) # Wait 3 seconds for reply

    try:
        msg = json.dumps(SCAN_CMD).encode('utf-8')
        sock.sendto(msg, (MCAST_GRP, MCAST_PORT))
        
        start_time = time.time()
        while time.time() - start_time < 3.0:
            try:
                data, addr = sock.recvfrom(1024)
                resp = json.loads(data.decode('utf-8'))
                
                device_data = resp.get("msg", {}).get("data", {})
                ip = device_data.get("ip")
                mac = device_data.get("device") # Govee calls MAC "device"
                sku = device_data.get("sku")
                
                if ip and mac:
                    print(f"   - Found: {ip} | MAC: {mac} | Model: {sku}")
                    
                    # Normalize MAC for comparison (caps)
                    mac_norm = mac.upper()
                    target_norm = target_mac.upper() if target_mac else None
                    
                    if target_norm is None or mac_norm == target_norm:
                        print(f"✅ MATCH FOUND! Using IP: {ip}")
                        return ip
                        
            except socket.timeout:
                break
            except Exception as e:
                # print(f"Error parsing packet: {e}")
                pass
                
    except Exception as e:
        print(f"Socket Error: {e}")
    finally:
        sock.close()
    
    print("❌ No matching Govee device found.")
    return None

# Example Usage Test (if run directly)
if __name__ == "__main__":
    # Test Discovery
    target_ip = find_govee_device(target_mac="98:17:3C:05:94:40")
    
    if target_ip:
        print(f"Testing Govee at {target_ip}...")
        engine = GoveeEngine(target_ip)
        
        print("Turning On...")
        engine.turn_on()
        time.sleep(1)
        
        print("Flashing Red...")
        engine.set_color_immediate(255, 0, 0, 100)
        time.sleep(1)
        
        print("Flashing Blue...")
        engine.set_color_immediate(0, 0, 255, 100)
        time.sleep(1)
        
        print("Turning Off...")
        engine.turn_off()
    else:
        print("Skipping test due to missing device.")
