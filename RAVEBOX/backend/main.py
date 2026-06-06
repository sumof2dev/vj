import asyncio
import websockets
import json
import numpy as np
import sounddevice as sd
import serial
import serial.tools.list_ports
import pulsectl
import time
import os
import ssl
import random
import base64
from dmx_engine import DMXEngine
from vibe_engine import VibeEngine
from audio_analyzer import AudioAnalyzer
from recorder_service import Recorder
from datetime import datetime
import wave

try:
    import evdev
    from evdev import ecodes
    HAS_EVDEV = True
except ImportError:
    HAS_EVDEV = False
    print("⚠️  evdev not found. Gamepad support disabled.")

def get_gamepad():
    """Find the first Xbox/Microsoft controller available"""
    if not HAS_EVDEV: return None
    try:
        devices = [evdev.InputDevice(path) for path in evdev.list_devices()]
        for device in devices:
            if "Microsoft" in device.name or "Xbox" in device.name:
                print(f"🎮 Found Gamepad: {device.name}")
                return device
    except:
        pass
    return None

async def gamepad_task():
    if not HAS_EVDEV:
        print("🎮 Gamepad support disabled (evdev missing)")
        return
    global gamepad_state
    print("🎮 Gamepad Watchdog Started")
    
    while True:
        device = get_gamepad()
        if not device:
            await asyncio.sleep(5)
            continue
            
        try:
            print(f"🎮 Connected to {device.name}")
            async for event in device.async_read_loop():
                # Raw event debugging
                if event.type in [ecodes.EV_KEY, ecodes.EV_ABS]:
                     print(f"🎮 GP EVENT: Type={hex(event.type)}, Code={hex(event.code)}, Val={event.value}", flush=True)

                if event.type == ecodes.EV_KEY:
                    # Debug print for keys
                    print(f"🎮 GP Key: Code={hex(event.code)}, Val={event.value}")
                    # LS Click = Reset L1/L2 to Auto
                    if event.code == ecodes.BTN_THUMBL and event.value == 1:
                        if dmx_engine:
                            dmx_engine.clear_device_overrides("L1")
                            dmx_engine.clear_device_overrides("L2")
                            print("🎮 L1/L2 Reset to AUTO")

                    # Update global button states
                    BTN_MAP = {
                        ecodes.BTN_SOUTH: "btn_a", ecodes.BTN_EAST: "btn_b", 
                        ecodes.BTN_WEST: "btn_x", ecodes.BTN_NORTH: "btn_y",
                        ecodes.BTN_TL: "btn_lb", ecodes.BTN_TR: "btn_rb",
                        ecodes.BTN_THUMBL: "btn_ls", ecodes.BTN_THUMBR: "btn_rs",
                        ecodes.BTN_SELECT: "btn_select", ecodes.BTN_START: "btn_start"
                    }
                    if event.code in BTN_MAP:
                        gamepad_state[BTN_MAP[event.code]] = event.value

                elif event.type == ecodes.EV_ABS:
                    # Debug print for ABS (only for sticks and triggers to avoid spam)
                    if event.code in [ecodes.ABS_X, ecodes.ABS_Y, ecodes.ABS_Z, ecodes.ABS_RZ]:
                         print(f"🎮 GP ABS: Code={hex(event.code)}, Val={event.value}")

                    # Left Joystick X (Axis 0) -> L1/L2 X Position
                    if event.code == ecodes.ABS_X:
                        abs_info = device.absinfo(event.code)
                        if abs_info:
                            v_min, v_max = abs_info.min, abs_info.max
                            norm = (event.value - v_min) / float(v_max - v_min)
                            gamepad_state["ls_x"] = norm
                            x_val = int(norm * 255)
                            # dmx_engine.apply_overrides([[7, x_val], [24, x_val]])
                            pass

                    # Left Joystick Y (Axis 1) -> L1/L2 Y Position
                    elif event.code == ecodes.ABS_Y:
                        abs_info = device.absinfo(event.code)
                        if abs_info:
                            v_min, v_max = abs_info.min, abs_info.max
                            norm = (event.value - v_min) / float(v_max - v_min)
                            gamepad_state["ls_y"] = norm
                            y_val = int(norm * 255)
                            if dmx_engine:
                                # dmx_engine.apply_overrides([[8, y_val], [25, y_val]])
                                pass
                            
                    # Triggers = Amplitude (ABS_Z = LT, ABS_RZ = RT)
                    elif event.code == ecodes.ABS_Z: # LT
                        abs_info = device.absinfo(event.code)
                        if abs_info:
                            norm = event.value / float(abs_info.max)
                            gamepad_state["lt"] = norm
                    elif event.code == ecodes.ABS_RZ: # RT
                        abs_info = device.absinfo(event.code)
                        if abs_info:
                            norm = event.value / float(abs_info.max)
                            gamepad_state["rt"] = norm

                    # Right Stick
                    elif event.code == ecodes.ABS_RX:
                        abs_info = device.absinfo(event.code)
                        if abs_info:
                            v_min, v_max = abs_info.min, abs_info.max
                            gamepad_state["rs_x"] = (event.value - v_min) / float(v_max - v_min)
                    elif event.code == ecodes.ABS_RY:
                        abs_info = device.absinfo(event.code)
                        if abs_info:
                            v_min, v_max = abs_info.min, abs_info.max
                            gamepad_state["rs_y"] = (event.value - v_min) / float(v_max - v_min)

                    # D-Pad
                    elif event.code == ecodes.ABS_HAT0X:
                        gamepad_state["dpad_left"] = 1 if event.value == -1 else 0
                        gamepad_state["dpad_right"] = 1 if event.value == 1 else 0
                    elif event.code == ecodes.ABS_HAT0Y:
                        gamepad_state["dpad_up"] = 1 if event.value == -1 else 0
                        gamepad_state["dpad_down"] = 1 if event.value == 1 else 0
                    
        except Exception as e:
            print(f"🎮 Gamepad Lost: {e}")
            await asyncio.sleep(2)

import collections
import concurrent.futures
import spotipy
from spotipy.oauth2 import SpotifyOAuth, CacheFileHandler
import queue
import struct
import threading

# --- CONFIGURATION ---
WS_PORT = 8765
DMX_BAUD = 250000
SAMPLE_RATE = 44100
BLOCK_SIZE = 2048  # Increased to 2048 to prevent dropouts under load

# --- GLOBAL STATE ---
CONFIG_FILE = "vj_remote_settings.json"
SPOT_CREDS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "spotify_creds.json")
broadcast_state = {"active_grace": 0}
recorder = Recorder()

# Default credentials (fallback)
SPOT_CLIENT_ID = ''
SPOT_CLIENT_SECRET = ''
SPOTIFY_REDIRECT_URI = 'https://ravebox.love/callback'

# try to load from spotify_creds.json
if os.path.exists(SPOT_CREDS_FILE):
    try:
        with open(SPOT_CREDS_FILE, 'r') as f:
            creds = json.load(f)
            if creds.get("SPOT_CLIENT_ID"): SPOT_CLIENT_ID = creds["SPOT_CLIENT_ID"]
            if creds.get("SPOT_CLIENT_SECRET"): SPOT_CLIENT_SECRET = creds["SPOT_CLIENT_SECRET"]
            if creds.get("SPOTIFY_REDIRECT_URI"): SPOTIFY_REDIRECT_URI = creds["SPOTIFY_REDIRECT_URI"]
            print(f"🎵 Spotify: Loaded custom credentials from {SPOT_CREDS_FILE}")
    except Exception as e:
        print(f"⚠️ Spotify: Failed to load {SPOT_CREDS_FILE}: {e}")

SPOTIFY_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".spotify_cache")
SESSION_ID = int(time.time())
SERVER_START_TIME = time.time()
GLOBAL_CLOCK = 0.0
DMX_ENABLED = True
active_clients = set()
last_callback_time = time.time()
dmx_port = None
network_dmx_node = None
audio_state = { "bass": 0.0, "mid": 0.0, "high": 0.0, "vol": 0.0, "flux": 0.0, "beat": False, "device_name": "None", "bpm": 120.0 }
audio_state_lock = threading.Lock()
gamepad_state = {
    "ls_x": 0.5, "ls_y": 0.5, "rs_x": 0.5, "rs_y": 0.5,
    "lt": 0.0, "rt": 0.0,
    "btn_a": 0, "btn_b": 0, "btn_x": 0, "btn_y": 0,
    "btn_lb": 0, "btn_rb": 0, "btn_ls": 0, "btn_rs": 0,
    "dpad_up": 0, "dpad_down": 0, "dpad_left": 0, "dpad_right": 0,
    "btn_select": 0, "btn_start": 0
}
visual_states = { "bg": -1, "fg": -1, "ov": -1, "fx": -1 }
audio_queue = queue.Queue(maxsize=100) 
last_injection_time = 0.0  
current_audio_mode = "auto" # 'auto', 'system', 'spotify'
dmx_engine = None  
vibe_engine = None
connected_clients = set()
dmx_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
dmx_ready = True
audio_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
is_usb_dmx = False
dmx_interface = "HAT" # "HAT" or "USB"
last_binary_payload = b""
last_state_payload = "{}"
last_broadcast_time = 0.0 # Signal all handlers to send when updated
broadcast_version = 0 # Monotonic version for WS sync
state_broadcast_version = 0 # Track JSON state version
training_mode_active = True # Default to Live shadow analysis
training_log_done = False
track_start_time = None
current_saved_bpm = None

# True background shadow node for continuous ML logging regardless of sync mode
shadow_analyzer = AudioAnalyzer()

# Cache for visualizer params to persist them even if frontend isn't active
visual_params_cache = {
    "speed": 0.6,
    "amplitude": 3.5,
    "sensitivity": 1.0,
    "layerFreq": 2,
    "baseLayer": "auto",
    "effect": "auto",
    "triggers": {}
}

class DMXNetworkNode:
    def __init__(self, ip, port=5002):
        import socket
        self.ip = ip
        self.port = port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def send(self, universe):
        try:
            self.sock.sendto(universe, (self.ip, self.port))
            # Independent logging tracker for network
            if not hasattr(self, '_last_tx_log'): self._last_tx_log = 0
            now = time.time()
            if now - self._last_tx_log > 1.0:
                print(f"📡 TX Network DMX: {len(universe)} bytes to {self.ip}:{self.port}")
                self._last_tx_log = now
        except Exception as e:
            if not hasattr(self, '_last_err_log'): self._last_err_log = 0
            now = time.time()
            if now - self._last_err_log > 5.0:
                print(f"⚠️ Network DMX Send Error to {self.ip}: {e}")
                self._last_err_log = now

# GoveeLANNode removed

def save_training_snippet(snippet):
    """Save a captured training snippet as a 'playable' session in the recordings folder"""
    try:
        rec_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "recordings")
        ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        label = snippet.get('label', 'unlabeled')
        
        # Create a folder name that indicates it's a training snippet
        folder_name = f"SNIPPET_{ts_str}_{label}"
        folder_path = os.path.join(rec_root, folder_name)
        
        if not os.path.exists(folder_path):
            os.makedirs(folder_path)
        
        # 1. Save the frames as dmx.json (player.html expectation)
        # We need to make sure 't' (time) starts at 0 for the player's timeline
        frames = snippet.get('frames', [])
        if frames:
            start_t = frames[0]['t']
            for f in frames:
                f['t'] = round(f['t'] - start_t, 3)
                # Ensure the player sees an empty 'v' (DMX) object to avoid key errors
                f['v'] = {}
        
        with open(os.path.join(folder_path, "dmx.json"), 'w') as f:
            json.dump(frames, f)
            
        # 2. Save meta.json for the browser list
        meta = {
            "name": f"Snippet: {label.upper()} ({ts_str})",
            "timestamp": datetime.now().isoformat(),
            "duration": frames[-1]['t'] if frames else 0,
            "addresses": [],
            "is_snippet": True,
            "label": label
        }
        with open(os.path.join(folder_path, "meta.json"), 'w') as f:
            json.dump(meta, f, indent=4)
            
        print(f"🧠 [Collector] Saved snippet to recordings/{folder_name}")
    except Exception as e:
        print(f"❌ Failed to save training snippet: {e}")


def save_live_defaults():
    """Save current performance parameters to disk"""
    try:
        data = {
            "master": {
                "sensitivity": float(analyzer.gain),
                "audio_source": current_audio_mode,
                "vibe_splits": vibe_engine.vibe_splits if vibe_engine else {"chillMid": 33, "midHigh": 66},
                "speed": dmx_engine.base_speed if dmx_engine else 1.0,
                "intensity": dmx_engine.base_intensity if dmx_engine else 1.0,
                "sceneFreq": dmx_engine.scene_freq if dmx_engine else 1,
                "node_ip": network_dmx_node.ip if network_dmx_node else getattr(main, 'node_ip_cache', ""),
                "node_active": network_dmx_node is not None,
                "dmx_interface": dmx_interface
            },
            "laser": {
                "speed": dmx_engine.base_speed if dmx_engine else 1.0,
                "audioSensitivity": dmx_engine.audio_sensitivity if dmx_engine else 1.0,
                "amplitude": dmx_engine.base_intensity if dmx_engine else 1.0
            },
            "visual": visual_params_cache
        }
        with open(CONFIG_FILE, "w") as f:
            json.dump(data, f, indent=4)
        print(f"💾 [Persistence] Saved defaults to {CONFIG_FILE}")
    except Exception as e:
        print(f"❌ Failed to save defaults: {e}")

def load_live_defaults():
    """Load performance parameters from new settings file"""
    if not os.path.exists(CONFIG_FILE):
        return
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
            
            # 1. Master Section
            m_data = data.get("master", {})
            if "sensitivity" in m_data: analyzer.set_gain(m_data["sensitivity"])
            if "audio_source" in m_data: 
                global current_audio_mode
                current_audio_mode = m_data["audio_source"]
            if "vibe_splits" in m_data and vibe_engine: vibe_engine.vibe_splits = m_data["vibe_splits"]
            if "speed" in m_data and dmx_engine: dmx_engine.set_speed(m_data["speed"])
            if "intensity" in m_data and dmx_engine: dmx_engine.set_intensity(m_data["intensity"])
            if "sceneFreq" in m_data and dmx_engine: dmx_engine.scene_freq = m_data["sceneFreq"]
            node_ip = m_data.get("node_ip")
            node_active = m_data.get("node_active", True)
            node_type = m_data.get("node_type", "dmx")
            
            global dmx_interface
            dmx_interface = m_data.get("dmx_interface", "HAT")
            
            # Cache the IP even if not active, so save_live_defaults doesn't lose it
            import __main__ as main
            main.node_ip_cache = node_ip
            
            if node_ip and node_active and node_type == "dmx":
                global network_dmx_node
                network_dmx_node = DMXNetworkNode(node_ip)
                print(f"🌐 Loaded Network DMX Target: {node_ip} (ACTIVE)")
            else:
                network_dmx_node = None
                if node_ip and node_type == "dmx":
                    print(f"🌐 Network DMX Target: {node_ip} (DISABLED)")

            # Govee loading removed

            # 2. Laser Section
            l_data = data.get("laser", {})
            if dmx_engine:
                if "speed" in l_data: dmx_engine.set_speed(l_data["speed"]) 
                
                # New Params
                if "audioSensitivity" in l_data: dmx_engine.set_audio_sensitivity(l_data["audioSensitivity"])
                
                
                if "amplitude" in l_data: dmx_engine.set_intensity(l_data["amplitude"]) # Laser amplitude = intensity
                
            # 3. Visual Section
            global visual_params_cache
            v_data = data.get("visual", {})
            if v_data:
                visual_params_cache.update(v_data)
                
            # (Axes removed - moved to per-channel LFO config in Fixture Profiles)

        print(f"📖 [Persistence] Loaded defaults from {CONFIG_FILE}")
    except Exception as e:
        print(f"⚠️ Failed to load defaults: {e}")

# --- AUDIO ENGINE (Spectral Flux) ---
# --- LEAN AUDIO ENGINE (NO LIBROSA) ---
from audio_analyzer import AudioAnalyzer

analyzer = AudioAnalyzer()

class CachedTrackManager:
    def __init__(self, database_dir="song_database"):
        self.database_dir = database_dir
        self.current_track_id = None
        self.track_data = None
        self.timeline = np.array([])
        self.stft_timeline = np.array([])
        self.vibes = []
        self.transients = []
        
    def load_track(self, track_id):
        if track_id == self.current_track_id:
            return
        
        self.current_track_id = track_id
        if not track_id:
            self.track_data = None
            self.timeline = np.array([])
            self.stft_timeline = np.array([])
            self.vibes = []
            self.transients = []
            return
            
        json_path = os.path.join(self.database_dir, f"{track_id}.json")
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r') as f:
                    self.track_data = json.load(f)
                print(f"🎵 [HYBRID] Loaded ground truth for track {track_id}")
                self._precompute_states()
            except Exception as e:
                print(f"⚠️ [HYBRID] Failed to load cached track data for {track_id}: {e}")
                self.track_data = None
                self.timeline = np.array([])
                self.stft_timeline = np.array([])
                self.vibes = []
                self.transients = []
        else:
            self.track_data = None
            self.timeline = np.array([])
            self.stft_timeline = np.array([])
            self.vibes = []
            self.transients = []
            
    def _precompute_states(self):
        if not self.track_data:
            return
        
        print("🧠 [HYBRID] Precomputing vibe and transient states sequentially...")
        self.timeline = np.array(self.track_data.get("timeline", []))
        self.stft_timeline = np.array(self.track_data.get("stft_timeline", []))
        
        if len(self.stft_timeline) == 0:
            return
            
        temp_vibe_engine = VibeEngine()
        self.vibes = []
        self.transients = []
        
        beat_times = np.array(self.track_data.get("beat_times", []))
        flux_truth = np.array(self.track_data.get("flux_truth", []))
        
        perc_bass = np.array(self.track_data.get("perc_bass", []))
        perc_mid = np.array(self.track_data.get("perc_mid", []))
        perc_high = np.array(self.track_data.get("perc_high", []))
        harm_bass = np.array(self.track_data.get("harm_bass", []))
        harm_mid = np.array(self.track_data.get("harm_mid", []))
        harm_high = np.array(self.track_data.get("harm_high", []))
        bass_truth = np.array(self.track_data.get("bass_truth", []))
        mid_truth = np.array(self.track_data.get("mid_truth", []))
        high_truth = np.array(self.track_data.get("high_truth", []))
        vol_truth = np.array(self.track_data.get("vol_truth", []))
        vol_h_truth = np.array(self.track_data.get("vol_h_truth", []))
        spectral_complexity_h = np.array(self.track_data.get("spectral_complexity_h", []))
        
        prev_t = 0.0
        for i, t in enumerate(self.stft_timeline):
            has_beat = np.any((beat_times > prev_t) & (beat_times <= t))
            flux_val = float(np.interp(t, self.timeline, flux_truth)) if self.timeline.size > 0 else 0.0
            
            frame_state = {
                "bass": float(bass_truth[i]) if i < len(bass_truth) else 0.0,
                "mid": float(mid_truth[i]) if i < len(mid_truth) else 0.0,
                "high": float(high_truth[i]) if i < len(high_truth) else 0.0,
                "bass_p": float(perc_bass[i]) if i < len(perc_bass) else 0.0,
                "mid_p": float(perc_mid[i]) if i < len(perc_mid) else 0.0,
                "high_p": float(perc_high[i]) if i < len(perc_high) else 0.0,
                "bass_h": float(harm_bass[i]) if i < len(harm_bass) else 0.0,
                "mid_h": float(harm_mid[i]) if i < len(harm_mid) else 0.0,
                "high_h": float(harm_high[i]) if i < len(harm_high) else 0.0,
                "vol": float(vol_truth[i]) if i < len(vol_truth) else 0.0,
                "flux": flux_val,
                "beat": has_beat,
                "vol_h": float(vol_h_truth[i]) if i < len(vol_h_truth) else 0.0,
                "spectral_complexity_h": float(spectral_complexity_h[i]) if i < len(spectral_complexity_h) else 0.5,
            }
            
            res = temp_vibe_engine.update(frame_state, now=t)
            self.vibes.append(res["vibe"])
            self.transients.append(res["transient"])
            prev_t = t
            
        print(f"🧠 [HYBRID] Precomputation complete. Generated {len(self.vibes)} states.")
        
    def get_lookup_state(self, progress_sec, lookahead_sec=2.0):
        if not self.track_data or len(self.stft_timeline) == 0:
            return None
            
        t = max(0.0, min(self.stft_timeline[-1], progress_sec))
        t_lookahead = max(0.0, min(self.stft_timeline[-1], progress_sec + lookahead_sec))
        
        def interp(vals):
            return float(np.interp(t, self.stft_timeline, vals))
            
        idx = np.searchsorted(self.stft_timeline, t)
        idx = max(0, min(len(self.stft_timeline) - 1, idx))
        
        idx_lookahead = np.searchsorted(self.stft_timeline, t_lookahead)
        idx_lookahead = max(0, min(len(self.stft_timeline) - 1, idx_lookahead))
        
        vibe = self.vibes[idx]
        transient = self.transients[idx]
        vibe_lookahead = self.vibes[idx_lookahead]
        transient_lookahead = self.transients[idx_lookahead]
        
        beat_times = np.array(self.track_data.get("beat_times", []))
        bpm = float(self.track_data.get("global_bpm", 120.0))
        
        if len(beat_times) > 0:
            idx_beat = np.searchsorted(beat_times, t)
            if idx_beat == 0:
                beat_phase = (t / beat_times[0]) % 1.0 if beat_times[0] > 0 else 0.0
            elif idx_beat >= len(beat_times):
                last_b = beat_times[-1]
                beat_period = 60.0 / bpm
                beat_phase = ((t - last_b) / beat_period) % 1.0
            else:
                prev_b = beat_times[idx_beat - 1]
                next_b = beat_times[idx_beat]
                beat_phase = (t - prev_b) / (next_b - prev_b)
        else:
            beat_phase = (t * bpm / 60.0) % 1.0
            
        return {
            "vibe": vibe,
            "transient": transient,
            "lookahead_vibe": vibe_lookahead,
            "lookahead_transient": transient_lookahead,
            "beat_phase": beat_phase,
            "bpm": bpm,
            "bass": interp(self.track_data["bass_truth"]),
            "mid": interp(self.track_data["mid_truth"]),
            "high": interp(self.track_data["high_truth"]),
            "bass_p": interp(self.track_data["perc_bass"]),
            "mid_p": interp(self.track_data["perc_mid"]),
            "high_p": interp(self.track_data["perc_high"]),
            "bass_h": interp(self.track_data["harm_bass"]),
            "mid_h": interp(self.track_data["harm_mid"]),
            "high_h": interp(self.track_data["harm_high"]),
            "vol": interp(self.track_data["vol_truth"]),
            "vol_h": interp(self.track_data["vol_h_truth"]),
            "flux": float(np.interp(t, self.timeline, self.track_data["flux_truth"])) if self.timeline.size > 0 else 0.0,
            
            # Lookahead values
            "lookahead_vol_500ms": float(np.interp(t + 0.5, self.stft_timeline, self.track_data["vol_truth"])),
            "lookahead_vol_1s": float(np.interp(t + 1.0, self.stft_timeline, self.track_data["vol_truth"])),
            "lookahead_vol_2s": float(np.interp(t + 2.0, self.stft_timeline, self.track_data["vol_truth"])),
            "lookahead_flux_500ms": float(np.interp(t + 0.5, self.timeline, self.track_data["flux_truth"])) if self.timeline.size > 0 else 0.0,
            "lookahead_flux_1s": float(np.interp(t + 1.0, self.timeline, self.track_data["flux_truth"])) if self.timeline.size > 0 else 0.0,
            "lookahead_flux_2s": float(np.interp(t + 2.0, self.timeline, self.track_data["flux_truth"])) if self.timeline.size > 0 else 0.0,
        }

cached_manager = CachedTrackManager()
last_lookup_t = None

def audio_callback(indata, frames, time_info, status):
    global audio_state, last_callback_time
    last_callback_time = time.time()
    
    # if status:
    #     print(status)
    
    # PRIORITY: If we received injected audio recently (which shouldn't happen anymore), return
    if time.time() - last_injection_time < 2.0:
        return

    # Push raw audio to queue for processing in main thread
    # Must copy because indata buffer is reused by sounddevice
    try:
        audio_queue.put_nowait(indata.copy())
    except queue.Full:
        pass

def get_monitor_source(mode="auto"):
    """Finds the 'Monitor' source based on mode ('auto', 'system', 'spotify')"""
    try:
        with pulsectl.Pulse('audio-grabber') as p:
            sinks = p.sink_list()
            
            # Prioritize the Ravebox Virtual Audio Bridge if present
            bridge = next((s for s in sinks if "Ravebox-Bridge" in s.name), None)
            if bridge:
                return bridge.monitor_source_name
            
            if mode == "spotify":
                # Look specifically for Raspotify/Librespot
                target = next((s for s in sinks if "spotify" in s.name.lower() or "librespot" in s.name.lower()), None)
                if target:
                    print(f"🎵 Spotify Source found: {target.description}")
                    return target.monitor_source_name
            
            elif mode == "system":
                # Look for hardware-like sinks (HDMI, Analog, etc.)
                # Usually contain 'alsa' and NOT 'spotify'
                target = next((s for s in sinks if "alsa" in s.name.lower() and "spotify" not in s.name.lower()), None)
                if target:
                    print(f"🎧 Hardware Source found: {target.description}")
                    return target.monitor_source_name

            # Default / 'auto' logic: Use default sink
            server_info = p.server_info()
            default_sink_name = server_info.default_sink_name
            sink = next((s for s in sinks if s.name == default_sink_name), None)
            
            if sink:
                # print(f"🎧 Monitor Source: {sink.description}")
                return sink.monitor_source_name
            return None
    except Exception as e: 
        print(f"⚠️ PulseAudio Error: {e}")
        return None


def find_best_audio_device(mode="auto"):
    """Robustly finds the best available input device."""
    devices = sd.query_devices()
    # print("\n🎤 --- Available Audio Devices ---")
    # for i, d in enumerate(devices):
    #     print(f"[{i}] {d['name']} (In: {d['max_input_channels']})")
    # print("---------------------------------\n")

    # 1. Try PulseAudio Monitor (Linux specific, best for loopback)
    pa_source = get_monitor_source(mode)
    if pa_source:
        for i, d in enumerate(devices):
            if d['name'] == pa_source:
                return i, d['name']
    
    # "Monitor" = PulseAudio/Pipewire term for listening to output (HDMI, Analog, etc.)
    # "Stereo Mix" = Windows term
    # "Loopback" = ALSA term
    print("⚠️ PulseAudio Monitor search failed. Searching device names for system loopback...")
    target_keywords = ["monitor", "stereo mix", "loopback"]

    for i, d in enumerate(devices):
        if d['max_input_channels'] > 0:
            name_lower = d['name'].lower()
            # If ANY keyword matches, we assume this is the system audio capture
            if any(keyword in name_lower for keyword in target_keywords):
                return i, d['name']

    # 3. Fallback to default input
    try:
        default_in = sd.query_devices(kind='input')
        return None, f"Default: {default_in['name']}" # Index None = Default
    except:
        return None, "System Default"

# --- 3. DMX HARDWARE ---
# Waveshare 14882 RS485 CAN HAT: SP3485 handles auto TX/RX direction.
# Manual RSE pin = GPIO 4 (NOT GPIO 18 — that's the I2S BCK for the DAC HAT).
# GPIO direction control is disabled by default since the HAT is auto-sensing.
DIR_PIN = 4  # Waveshare 14882 RSE pin (GPIO 4), only used if manual mode soldered
use_gpio = False
_gpio_req = None

# Set to True ONLY if you solder the 0-ohm resistor for manual RS485 direction
ENABLE_MANUAL_RS485_DIR = False

if ENABLE_MANUAL_RS485_DIR:
    try:
        import gpiod
        _gpio_req = gpiod.request_lines(
            '/dev/gpiochip0',
            consumer='vj-dmx',
            config={DIR_PIN: gpiod.LineSettings(direction=gpiod.line.Direction.OUTPUT, output_value=gpiod.line.Value.INACTIVE)}
        )
        use_gpio = True
        print(f"📟 RS485: GPIO {DIR_PIN} initialized for Transmit Enable (gpiod v2)")
    except Exception as e:
        print(f"⚠️ RS485 GPIO Init Error: {e}")
else:
    print("📟 RS485: Auto direction mode (Waveshare 14882 SP3485)")

def set_rs485_tx(enabled):
    if use_gpio and _gpio_req:
        _gpio_req.set_value(DIR_PIN, gpiod.line.Value.ACTIVE if enabled else gpiod.line.Value.INACTIVE)

def send_dmx_break(port):
    """Send DMX512 break signal.
    Uses break_condition for USB (FTDI) and baud-rate trick for native UART.
    """
    if is_usb_dmx:
        # USB/FTDI optimized break
        port.break_condition = True
        time.sleep(0.0001) # 100us Break
        port.break_condition = False
        time.sleep(0.00001) # 10us MAB
    else:
        # Native UART baud rate trick (more precise timing for Pi pins)
        original_baud = port.baudrate
        port.baudrate = 57600
        port.write(b'\x00')
        port.flush() 
        # Mark After Break (Crucial for Pi 5 timing)
        time.sleep(0.00002) # 20us
        port.baudrate = original_baud

def sync_send_dmx(port, universe):
    """Synchronous DMX send meant to be run in a thread."""
    try:
        if port:
            set_rs485_tx(True)
            send_dmx_break(port)
            if universe[1] > 0 or universe[10] > 0: # Log some activity
                # print(f"📡 Sending DMX: {universe[1:20].hex(' ')}")
                pass
            port.write(universe)
            port.flush()
            set_rs485_tx(False)
    except Exception as e:
        print(f"❌ Threaded DMX Error: {e}")

def setup_dmx():
    global dmx_port
    ports = list(serial.tools.list_ports.comports())
    
    # Prioritize candidates based on preference
    candidates = []
    
    raspberry_pi_uarts = ['/dev/ttyAMA0', '/dev/serial0', '/dev/ttyS0']
    usb_ports = []
    for p in ports:
        desc_lower = p.description.lower()
        if any(x in desc_lower for x in ['ftdi', 'ft232', 'usb', 'serial', 'ch340', 'cp210']) or 'ttyUSB' in p.device:
            usb_ports.append(p.device)

    if dmx_interface == "USB":
        print("🔌 DMX Priority: USB Preferred")
        candidates.extend(usb_ports)
        for uart in raspberry_pi_uarts:
            if os.path.exists(uart) and uart not in candidates:
                candidates.append(uart)
    else:
        print("🔌 DMX Priority: RS485 HAT Preferred")
        for uart in raspberry_pi_uarts:
            if os.path.exists(uart):
                candidates.append(uart)
        for p in usb_ports:
            if p not in candidates:
                candidates.append(p)

    for dmx_dev in candidates:
        try:
            dmx_port = serial.Serial(
                dmx_dev, 
                baudrate=DMX_BAUD, 
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_TWO,
                timeout=0,
                write_timeout=0.1
            )
            
            # Detect if this is USB
            global is_usb_dmx
            is_usb_dmx = any(x in dmx_dev.lower() for x in ['usb', 'ttyusb'])
            
            print(f"🔌 DMX Connected: {dmx_dev} @ {DMX_BAUD} baud (USB: {is_usb_dmx})")
            return # Success
        except Exception as e:
            print(f"⚠️ DMX: Found device {dmx_dev} but could not open: {e}")
            dmx_port = None
    
    if not candidates:
        print("⚠️ No DMX Hardware Found. Running in simulation mode.")
    else:
        print("⚠️ All DMX hardware candidates failed. Running in simulation mode.")

# --- 3.5 AUDIO WATCHDOG ---
async def audio_watchdog():
    """Monitors audio stream health and restarts if frozen."""
    global last_callback_time
    print("🐕 Audio Watchdog Started")
    
    while True:
        await asyncio.sleep(2.0)
        
        # If no callback for 4 seconds, restart
        if time.time() - last_callback_time > 4.0:
            print("⚠️ WATCHDOG: Audio stream died. Restarting...")
            try:
                restart_audio_stream(current_audio_mode) # Use saved mode
            except Exception as e:
                print(f"Watchdog restart failed: {e}")
            
            # Reset timer to give the restart time to work
            last_callback_time = time.time() + 5.0

def audio_worker_thread():
    """Consume audio frames from queue and run heavy analysis in a pure native thread."""
    global audio_state, last_lookup_t
    print("🧠 Audio Worker Thread Started")
    
    last_param_load = 0.0
    latency_offset = -0.150
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tuning_config', 'engine_params.json')
    
    while True:
        try:
            # Block until we get a frame, with timeout so we don't hang if injected/paused
            try:
                indata = audio_queue.get(block=True, timeout=0.1)
            except queue.Empty:
                continue

            if time.time() - last_injection_time < 2.0:
                audio_queue.task_done()
                continue
            
            # 1. Process Raw Audio (Or use ground-truth override)
            new_audio_state = analyzer.process(indata)
            
            # Feed the shadow tracker so it continuously learns organically
            shadow_analyzer.process(indata)
            
            # Hot-reload latency_offset every 5 seconds
            now = time.time()
            if now - last_param_load > 5.0:
                try:
                    if os.path.exists(config_path):
                        with open(config_path, 'r') as f:
                            p = json.load(f)
                            latency_offset = p.get("latency_offset", -0.150)
                except Exception as e:
                    print(f"⚠️ Failed to load latency_offset from params: {e}")
                last_param_load = now
            
            # 2. Check if Spotify is active and track is cached
            with audio_state_lock:
                spotify_info = audio_state.get('spotify', {}).copy()
            track_id = spotify_info.get('id')
            
            # [TESTING] Temporarily override track_id to disable offline audit telemetry
            track_id = None
            
            if track_id:
                cached_manager.load_track(track_id)
            else:
                cached_manager.load_track(None)
                
            if cached_manager.track_data:
                # [HYBRID PATH] Ground Truth Lookups
                progress_ms = spotify_info.get('progress_ms', 0)
                poll_time = spotify_info.get('poll_time', time.time())
                elapsed = time.time() - poll_time
                progress_sec = (progress_ms / 1000.0) + elapsed
                
                # Latency offset to match physical audio playback
                t = progress_sec + latency_offset
                
                lookup = cached_manager.get_lookup_state(t)
                if lookup:
                    new_audio_state.update({
                        "bass": lookup["bass"],
                        "mid": lookup["mid"],
                        "high": lookup["high"],
                        "bass_p": lookup["bass_p"],
                        "mid_p": lookup["mid_p"],
                        "high_p": lookup["high_p"],
                        "bass_h": lookup["bass_h"],
                        "mid_h": lookup["mid_h"],
                        "high_h": lookup["high_h"],
                        "vol": lookup["vol"],
                        "vol_h": lookup["vol_h"],
                        "flux": lookup["flux"],
                        "bpm": lookup["bpm"],
                        "beat_phase": lookup["beat_phase"],
                        
                        # Vibe/transient states
                        "vibe": lookup["vibe"],
                        "transient": lookup["transient"],
                        
                        # Look-ahead features
                        "lookahead_vibe": lookup["lookahead_vibe"],
                        "lookahead_transient": lookup["lookahead_transient"],
                        "lookahead_vol_500ms": lookup["lookahead_vol_500ms"],
                        "lookahead_vol_1s": lookup["lookahead_vol_1s"],
                        "lookahead_vol_2s": lookup["lookahead_vol_2s"],
                        "lookahead_flux_500ms": lookup["lookahead_flux_500ms"],
                        "lookahead_flux_1s": lookup["lookahead_flux_1s"],
                        "lookahead_flux_2s": lookup["lookahead_flux_2s"],
                    })
                    
                    # Beat detection matching
                    beat_times = np.array(cached_manager.track_data.get("beat_times", []))
                    is_beat = False
                    if last_lookup_t is not None and len(beat_times) > 0:
                        if t >= last_lookup_t and t - last_lookup_t < 2.0:
                            beats_in_range = beat_times[(beat_times > last_lookup_t) & (beat_times <= t)]
                            if len(beats_in_range) > 0:
                                is_beat = True
                                
                    new_audio_state["beat"] = is_beat
                    new_audio_state["bar"] = is_beat and (analyzer.beat_count % 4 == 0)
                    if is_beat:
                        analyzer.beat_count += 1
                        new_audio_state["beat_count"] = analyzer.beat_count
                        
                    # Build vibe mods structure matching vibe engine results
                    mods = {
                        "bass": lookup["bass"],
                        "high": lookup["high"],
                        "flux": lookup["flux"],
                        "vol": lookup["vol"],
                        "beat_phase": lookup["beat_phase"]
                    }
                    new_audio_state["mods"] = mods
                    
                    # Propagate to left/right sub-dicts
                    beat_cnt = new_audio_state.get("beat_count", analyzer.beat_count)
                    for side in ['left', 'right']:
                        if side in new_audio_state and isinstance(new_audio_state[side], dict):
                            new_audio_state[side].update({
                                "vibe": lookup["vibe"],
                                "transient": lookup["transient"],
                                "beat": is_beat,
                                "beat_count": beat_cnt,
                                "bar": is_beat and (beat_cnt % 4 == 0),
                                "beat_phase": lookup["beat_phase"],
                                "bpm": lookup["bpm"],
                                "bass": lookup["bass"],
                                "mid": lookup["mid"],
                                "high": lookup["high"],
                                "bass_p": lookup["bass_p"],
                                "mid_p": lookup["mid_p"],
                                "high_p": lookup["high_p"],
                                "bass_h": lookup["bass_h"],
                                "mid_h": lookup["mid_h"],
                                "high_h": lookup["high_h"],
                                "vol": lookup["vol"],
                                "vol_h": lookup["vol_h"],
                                "flux": lookup["flux"],
                                "mods": mods
                            })
                            
                    last_lookup_t = t
                else:
                    last_lookup_t = None
            else:
                # [UNINDEXED PATH] Fall back to live Vibe Engine state estimation
                last_lookup_t = None
                if vibe_engine:
                    vibe_results = vibe_engine.update(new_audio_state)
                    new_audio_state.update(vibe_results)
                    # Propagate vibe and mods to left/right sub-dicts
                    for key in ['vibe', 'mods']:
                        if key in vibe_results:
                            if 'left' in new_audio_state and isinstance(new_audio_state['left'], dict):
                                new_audio_state['left'][key] = vibe_results[key]
                            if 'right' in new_audio_state and isinstance(new_audio_state['right'], dict):
                                new_audio_state['right'][key] = vibe_results[key]
 
            # Write/mutate audio_state with lock:
            with audio_state_lock:
                # Latch transient beats and onsets so they aren't missed by ws tick rates
                if new_audio_state.get('beat', False):
                    audio_state['beat_pending'] = True
                if new_audio_state.get('bass_onset', False):
                    audio_state['bass_onset_pending'] = True
                if new_audio_state.get('high_onset', False):
                    audio_state['high_onset_pending'] = True
 
                # Preserve Spotify metadata injected by the async poller
                if 'spotify' in audio_state:
                    new_audio_state['spotify'] = audio_state['spotify']
                    
                audio_state.update(new_audio_state)
                
            audio_queue.task_done()

        except Exception as e:
            print(f"⚠️ Audio Worker Error: {e}")
            time.sleep(0.01)

def pack_binary_state(current_time):
    """
    Packs the system state into a compact little-endian ArrayBuffer.
    Layout (Total 599 bytes):
    - master_time (f32, offset 0)
    - flux, bass, mid, high, vol, bpm, beat_phase (7x f32, offset 4-31)
    - bins (6x f32, offset 32-55)
    - beat, b_onset, h_onset, intensity (4x u8, offset 56-59)
    - axis_a..e (5x f32, offset 60-79)
    - base, fx, fg layerIdx (3x u16, offset 80-85)
    - dmx (513x u8, offset 86-598)
    """
    global GLOBAL_CLOCK
    
    # Use the dmx_engine effective speed for the global visual clock
    # This ensures backend/frontend synchronization of "Time Warp" effects
    now = time.time()
    
    if not hasattr(pack_binary_state, 'last_t'):
        pack_binary_state.last_t = now
        
    dt_val = now - pack_binary_state.last_t
    pack_binary_state.last_t = now
    
    # Sanity check for dt (prevent jumps after deep sleep or heavy load)
    if dt_val > 1.0: dt_val = 0.016 
    
    speed_factor = dmx_engine.eff_speed if dmx_engine else 0.6
    GLOBAL_CLOCK += dt_val * speed_factor
    m_time = GLOBAL_CLOCK

    # Thread-safe copy of audio_state and popping of pending flags
    with audio_state_lock:
        state_copy = audio_state.copy()
        if not (dmx_engine and dmx_engine.is_paused):
            beat_pending = audio_state.pop('beat_pending', False)
            bass_pending = audio_state.pop('bass_onset_pending', False)
            high_pending = audio_state.pop('high_onset_pending', False)
        else:
            beat_pending = bass_pending = high_pending = False

    if dmx_engine and dmx_engine.is_paused:
        # Use frozen values to stop visualizer jitter while paused
        if not hasattr(pack_binary_state, 'frozen_audio'):
            pack_binary_state.frozen_audio = {
                'flux': state_copy.get('flux', 0.0),
                'bass': state_copy.get('bass', 0.0),
                'mid': state_copy.get('mid', 0.0),
                'high': state_copy.get('high', 0.0),
                'vol': state_copy.get('vol', 0.0),
                'bpm': state_copy.get('bpm', 120.0),
                'beat_phase': state_copy.get('beat_phase', 0.0),
                'bins': state_copy.get('bins', [0.0]*6)[:]
            }
        
        frozen = pack_binary_state.frozen_audio
        flux = frozen['flux']
        bass = frozen['bass']
        mid = frozen['mid']
        high = frozen['high']
        vol = frozen['vol']
        bpm = frozen['bpm']
        beat_phase = frozen['beat_phase']
        bins = frozen['bins']
        
        beat = 0
        b_onset = 0
        h_onset = 0
    else:
        # Clear frozen state when playing
        if hasattr(pack_binary_state, 'frozen_audio'):
            delattr(pack_binary_state, 'frozen_audio')
            
        flux = state_copy.get('flux', 0.0)
        bass = state_copy.get('bass', 0.0)
        mid = state_copy.get('mid', 0.0)
        high = state_copy.get('high', 0.0)
        vol = state_copy.get('vol', 0.0)
        bpm = state_copy.get('bpm', 120.0)
        beat_phase = state_copy.get('beat_phase', 0.0)
        
        bins = state_copy.get('bins', [0]*6)
        while len(bins) < 6: bins.append(0)
        
        beat = 1 if (state_copy.get('beat', False) or beat_pending) else 0
        b_onset = 1 if (state_copy.get('bass_onset', False) or bass_pending) else 0
        h_onset = 1 if (state_copy.get('high_onset', False) or high_pending) else 0
    
    ax_a = ax_b = ax_c = ax_d = ax_e = 0.0
    if dmx_engine and dmx_engine.logic:
        logic = dmx_engine.logic.state
        ax_a = float(logic.get('axis_a', 0.0))
        ax_b = float(logic.get('axis_b', 0.0))
        ax_c = float(logic.get('axis_c', 0.0))
        ax_d = float(logic.get('axis_d', 0.0))
        ax_e = float(logic.get('axis_e', 0.0))
        
    base_l = dmx_engine.current_base_layer if dmx_engine else 0
    fx_l = dmx_engine.current_fx_layer if dmx_engine else 0
    fg_l = dmx_engine.current_fg_layer if dmx_engine else 0
    
    univ = dmx_engine.get_universe() if dmx_engine else bytearray(513)
    
    # Pack header (86 bytes)
    header = struct.pack('<f fffffff ffffff BBBB fffff HHH',
        m_time,
        flux, bass, mid, high, vol, bpm, beat_phase,
        float(bins[0]), float(bins[1]), float(bins[2]), float(bins[3]), float(bins[4]), float(bins[5]),
        beat, b_onset, h_onset, max(0, min(255, int((dmx_engine.eff_intensity if dmx_engine else 1.0) * 255))),
        ax_a, ax_b, ax_c, ax_d, ax_e,
        int(base_l), int(fx_l), int(fg_l)
    )
    
    # Pack HPSS bands and percussive behaviors (36 bytes)
    hpss_payload = struct.pack('<fffffffff',
        float(state_copy.get('bass_p', 0.0)),
        float(state_copy.get('mid_p', 0.0)),
        float(state_copy.get('high_p', 0.0)),
        float(state_copy.get('bass_h', 0.0)),
        float(state_copy.get('mid_h', 0.0)),
        float(state_copy.get('high_h', 0.0)),
        float(state_copy.get('kick_behavior', 0.0)),
        float(state_copy.get('snare_behavior', 0.0)),
        float(state_copy.get('cymbal_behavior', 0.0))
    )
    
    # Return 86 + 513 + 36 = 635 bytes
    return header + bytes(univ)[:513].ljust(513, b'\x00') + hpss_payload


async def fast_broadcast_loop():
    """Handles 60FPS DMX updates and high-frequency WebSocket packet generation."""
    global audio_state, dmx_engine, dmx_port
    global last_binary_payload, last_state_payload
    global last_broadcast_time, broadcast_version, state_broadcast_version
    print("🚀 Fast Broadcast & DMX Loop Started")
    
    critical_error_sent = False
    last_dmx_update = 0.0
    dmx_update_interval = 1.0 / 60.0
    last_log = 0.0
    last_sent_state = "{}"
    
    while True:
        try:
            # Yield control frequently
            await asyncio.sleep(0.005) # ~200Hz base tick
            current_time = time.time()
            
            with audio_state_lock:
                audio_state_copy = audio_state.copy()
            
            # --- 1. DMX RATE-LIMITED UPDATE ---
            if dmx_engine and (current_time - last_dmx_update) >= dmx_update_interval:
                try:
                    dt = current_time - last_dmx_update if last_dmx_update > 0 else 0.016
                    dmx_engine.update(dt, audio_state_copy, visual_states, gamepad_state)
                    last_dmx_update = current_time
                    
                    if current_time - last_log > 0.5:
                        if dmx_port or network_dmx_node or dmx_engine:
                            health = analyzer.get_signal_health()
                            vibe_name = audio_state_copy.get('vibe', 'mid')
                            print(f"DMX_OUT: Healthy | Vol: {audio_state_copy['vol']:.2f} | Vibe: {vibe_name} | Signal: {health['status']} ({health['peak']:.1f})")
                            last_log = current_time

                    if dmx_port or network_dmx_node:
                        full_u = dmx_engine.get_universe()
                        
                        # NETWORK DMX STREAM
                        if network_dmx_node:
                            network_dmx_node.send(bytearray(full_u))
                            
                        # LOG DATA TO RECORDER IF ACTIVE
                        if recorder.is_recording:
                            # Capture names of active presets for timeline visualization
                            active_preset_names = dmx_engine.get_active_preset_names() if dmx_engine else []
                            recorder.log_dmx(full_u, audio_state=audio_state_copy, active_presets=active_preset_names)

                        max_addr = 0
                        for inst in dmx_engine.stage_instances:
                            profile = dmx_engine.profiles.get(inst.get('profileId'))
                            ch_count = 0
                            if profile:
                                ch_count = len(profile.get('channels', []))
                                if ch_count == 0:
                                    # Fallback legacy
                                    fixture = dmx_engine.fixtures.get(inst.get('fixtureId'))
                                    if fixture: ch_count = len(fixture.get('channels', []))
                            
                            if ch_count > 0:
                                try:
                                    addr = int(inst.get('address', 1)) if inst.get('address') != "" else 1
                                    dev_max = addr + (ch_count - 1)
                                    if dev_max > max_addr: max_addr = dev_max
                                except (ValueError, TypeError):
                                    continue
                        
                        global dmx_ready
                        if dmx_port and dmx_ready:
                            dmx_ready = False
                            if dmx_engine and dmx_engine.overrides:
                                max_o = max(dmx_engine.overrides.keys())
                                if max_o > max_addr: max_addr = max_o
                                
                            send_len = max(32, min(513, max_addr + 1))
                            universe = bytearray(full_u[:send_len])
                            
                            loop = asyncio.get_running_loop()
                            fut = loop.run_in_executor(dmx_executor, sync_send_dmx, dmx_port, universe)
                            def dmx_done_cb(f):
                                global dmx_ready
                                dmx_ready = True
                            fut.add_done_callback(dmx_done_cb)
    
                except ValueError as ve:
                    if not critical_error_sent:
                        print(f"🛑 CRITICAL RUNTIME ERROR: {ve}")
                        with audio_state_lock:
                            audio_state['error'] = str(ve) 
                        critical_error_sent = True
                        dmx_engine = None
                except Exception as e:
                    print(f"⚠️ DMX Update Error: {e}")

            # --- 2. WEBSOCKET BROADCAST PREPARATION ---
            if not connected_clients:
                continue
                
            # LOWER ACTION THRESHOLD and add grace period to prevent UI flickering on borderline signal
            raw_act = audio_state_copy.get('vol', 0.0) > 0.002 or audio_state_copy.get('beat', False)
            if raw_act: 
                broadcast_state["active_grace"] = 180 # ~3 seconds @ 60fps
            else:
                broadcast_state["active_grace"] = max(0, broadcast_state["active_grace"] - 1)
            
            is_active = broadcast_state["active_grace"] > 0
            broadcast_interval = 0.033 if is_active else 0.5 # Jump to 2fps only if totally dead
            
            if (current_time - last_broadcast_time) >= broadcast_interval:
                try:
                    # Update the binary image for listeners
                    last_binary_payload = pack_binary_state(current_time)
                    last_broadcast_time = current_time
                    broadcast_version += 1
                    
                    # Also prepare a lighter-weight JSON update for UI elements (Vibe changes, etc)
                    current_vibe = audio_state_copy.get('vibe', 'mid')
                    state_dict = {
                        "type": "state",
                        "session_id": SESSION_ID,
                        "vibe": current_vibe,
                        "vibe_variant": dmx_engine.sync_indices.get(current_vibe, 0) + 1 if dmx_engine else 1,
                        "transient": audio_state_copy.get('transient', 'steady'),
                        "active_presets": [p.get('id', p['name']) for p in dmx_engine.active_presets] if dmx_engine else [],
                        "manual_active_presets": list(dmx_engine.manual_active_presets) if dmx_engine else [],
                        "visual_commands": dmx_engine.active_visual_commands if dmx_engine else [],
                        "blackout": dmx_engine.blackout if dmx_engine else False,
                        "eff_speed": dmx_engine.eff_speed if dmx_engine else 0.6,
                        "eff_intensity": dmx_engine.eff_intensity if dmx_engine else 1.0,
                        "lab_dmx_val": dmx_engine.lab_dmx_val if dmx_engine else 0,
                        "overrides": list(dmx_engine.overrides.keys()) if dmx_engine else [],
                        "sensitivity": float(analyzer.gain),
                        "spotify": audio_state_copy.get('spotify')
                    }
                    if 'error' in audio_state_copy:
                         state_dict['error'] = audio_state_copy['error']
                    
                    new_state_str = json.dumps(state_dict)
                    if new_state_str != last_sent_state:
                         last_state_payload = new_state_str
                         last_sent_state = new_state_str
                         state_broadcast_version += 1
                         
                except Exception as serial_err:
                    print(f"⚠️ Serialization Failure: {serial_err}")
            await asyncio.sleep(0)  
            
        except Exception as e:
            print(f"⚠️ Audio Process Error: {e}")
            await asyncio.sleep(0.1)


async def spotify_poller():
    global audio_state
    print("🎵 Initializing Spotify Connection...")
    try:
        handler = CacheFileHandler(cache_path=SPOTIFY_CACHE_PATH)
        auth_manager = SpotifyOAuth(
            client_id=SPOT_CLIENT_ID,
            client_secret=SPOT_CLIENT_SECRET,
            redirect_uri=SPOTIFY_REDIRECT_URI,
            scope="user-read-currently-playing",
            cache_handler=handler,
            open_browser=False # Important for headless Pi
        )
        sp = spotipy.Spotify(auth_manager=auth_manager, retries=0, requests_timeout=5)
    except Exception as e:
        print(f"❌ Spotify Init Failed: {e}")
        return

    current_track_id = None
    track_name = ""
    artist_name = ""
    spotify_images = {}
    loop = asyncio.get_running_loop()
    inactive_since = None
    poll_interval = 5.0

    while True:
        try:
            # Run the network request in an executor so it doesn't freeze the DMX lasers
            current_playing = await loop.run_in_executor(None, sp.current_user_playing_track)
            
            is_active = current_playing is not None and current_playing.get('is_playing') is True and current_playing.get('item') is not None
            
            if not is_active:
                if inactive_since is None:
                    inactive_since = time.time()
                elif time.time() - inactive_since > 600:
                    # Enter Sleep Mode instead of exiting
                    poll_interval = 60.0 # Check once per minute
                
                # Update frontend if it was just paused
                with audio_state_lock:
                    if 'spotify' in audio_state:
                        del audio_state['spotify']
            else:
                inactive_since = None
                poll_interval = 5.0 # Standard active polling
                track = current_playing['item']
                track_id = track.get('id', 'unknown')
                
                if track_id != current_track_id:
                    current_track_id = track_id
                    track_name = track.get('name', 'Unknown')
                    artist_name = track['artists'][0]['name'] if track.get('artists') else "Unknown"
                    
                    # Extract Album Art (Spotify provides [High, Medium, Low] resolution)
                    images = track.get('album', {}).get('images', [])
                    
                    # Load Manual BPM Override if available
                    global current_saved_bpm, track_start_time, training_log_done
                    bpm_file = os.path.join(os.path.dirname(__file__), '..', 'tuning_config', 'manual_bpm.json')
                    current_saved_bpm = None
                    try:
                        if os.path.exists(bpm_file):
                            with open(bpm_file, 'r') as f:
                                overrides = json.load(f)
                            if track_id in overrides and 'bpm' in overrides[track_id]:
                                current_saved_bpm = overrides[track_id]['bpm']
                                print(f"⏱️ Loaded Ground-Truth BPM for {track_name}: {current_saved_bpm}")
                    except Exception as e:
                        print(f"⚠️ Failed to load manual BPM override: {e}")
                    
                    if not training_mode_active:
                        analyzer.manual_bpm_override = current_saved_bpm
                    else:
                        analyzer.manual_bpm_override = None
                    
                    track_start_time = time.time()
                    training_log_done = False
                    # Store these in the outer scope / global so they persist across polls 
                    # for the same track
                    spotify_images = {
                        'high': images[0]['url'] if len(images) > 0 else None,
                        'low': images[-1]['url'] if len(images) > 0 else None
                    }
                    
                    print(f"\n🎶 [SPOTIFY] NEW TRACK: {track_name} by {artist_name}")
                    
                # We update the state every cycle now to send the live playback progress
                progress_ms = current_playing.get('progress_ms', 0)
                duration_ms = track.get('duration_ms', 1)
                
                with audio_state_lock:
                    audio_state['spotify'] = {
                        'id': track_id,
                        'name': f"{track_name} - {artist_name}",
                        'artist': artist_name,
                        'track': track_name,
                        'progress_ms': progress_ms,
                        'duration_ms': duration_ms,
                        'image_high': spotify_images.get('high'),
                        'image_low': spotify_images.get('low'),
                        'poll_time': time.time()
                    }
                
                # Training Telemetry check (Execute 20 seconds into a new track)
                if not training_log_done and current_saved_bpm and track_start_time:
                    if (time.time() - track_start_time) > 20:
                        try:
                            telemetry_path = os.path.join(os.path.dirname(__file__), '..', 'tuning_config', 'training_telemetry.csv')
                            write_header = not os.path.exists(telemetry_path)
                            with open(telemetry_path, 'a') as f:
                                if write_header:
                                    f.write("timestamp,track_id,track_name,saved_bpm,guessed_bpm,delta\n")
                                delta = round(shadow_analyzer.bpm - current_saved_bpm, 2)
                                f.write(f"{int(time.time())},{track_id},{track_name},{current_saved_bpm},{round(shadow_analyzer.bpm, 2)},{delta}\n")
                            print(f"📊 Training Logged -> Truth: {current_saved_bpm} | Shadow Guess: {round(shadow_analyzer.bpm, 2)} | Delta: {delta}")
                        except Exception as e:
                            print(f"⚠️ Failed to write training telemetry: {e}")
                        training_log_done = True
                
        except spotipy.SpotifyException as se:
            err_str = str(se).lower()
            if "status: 429" in err_str or "429" in err_str:
                print(f"⚠️ Spotify API Rate Limited (429). Backing off for 60 seconds...")
                await asyncio.sleep(60)
            else:
                print(f"⚠️ Spotify API Error: {se}")
        except Exception as e:
            err_str = str(e)
            print(f"⚠️ Spotify Poller generic error: {err_str}")
            if "EOF" in err_str or isinstance(e, EOFError):
                print("🛑 Spotify auth requires an interactive browser. Re-checking in 10 minutes...")
                await asyncio.sleep(600)
                continue # Try again later instead of exiting
            
        await asyncio.sleep(poll_interval) 

# --- 4. SERVER LOOP ---
async def ws_handler(websocket):
    global connected_clients, visual_params_cache, synth, last_injection_time
    print("Client Connected")
    connected_clients.add(websocket)
    last_sent_version = 0 # Track which version of broadcast this client last received
    client_state_version = 0 
    
    try:
        while True:
            # Rx from Browser: Check for control messages
            try:
                # Use a small timeout to allow the loop to run and send audio data
                msg = await asyncio.wait_for(websocket.recv(), timeout=0.016)  # ~60 FPS
                
                if isinstance(msg, str):
                    # Handle JSON Control/Injection Messages
                    try:
                        data = json.loads(msg)
                        msg_type = data.get("type")
                        if msg_type not in ["audio_inject", "synth"]: # Skip spammy ones
                             print(f"📥 WS RX: {msg_type} from {websocket.remote_address}")
                        
                        if msg_type == "get_audio_devices":
                            devices = []
                            try:
                                devs = sd.query_devices()
                                for i, d in enumerate(devs):
                                    if d['max_input_channels'] > 0:
                                        devices.append({"index": i, "name": d['name']})
                                await websocket.send(json.dumps({"type": "audio_devices_list", "devices": devices}))
                            except Exception as e:
                                print(f"Error listing devices: {e}")

                        elif msg_type == "set_audio_device":
                             idx = data.get("index")
                             if idx is not None:
                                 restart_audio_stream(int(idx))

                        elif msg_type == "audio_inject":
                            # Remote audio injection fallback
                            inject = data.get("data", {})
                            if inject:
                                with audio_state_lock:
                                    for k, v in inject.items():
                                        audio_state[k] = v
                                    last_injection_time = time.time()
                                    
                                    # Ensure left/right channels have the updated audio parameters
                                    for side in ['left', 'right']:
                                        if side not in audio_state or not isinstance(audio_state[side], dict):
                                            audio_state[side] = {}
                                        for k, v in inject.items():
                                            audio_state[side][k] = v
                                    
                                    if vibe_engine:
                                        if "vibe" not in inject and "transient" not in inject:
                                            vibe_results = vibe_engine.update(audio_state, now=last_injection_time)
                                            audio_state.update(vibe_results)
                                            for key in ['vibe', 'mods']:
                                                if key in vibe_results:
                                                    if 'left' in audio_state and isinstance(audio_state['left'], dict):
                                                        audio_state['left'][key] = vibe_results[key]
                                                    if 'right' in audio_state and isinstance(audio_state['right'], dict):
                                                        audio_state['right'][key] = vibe_results[key]
                                        else:
                                            v_val = inject.get("vibe", "mid")
                                            t_val = inject.get("transient", "steady")
                                            mods = {
                                                "bass": audio_state.get("bass", 0.0),
                                                "high": audio_state.get("high", 0.0),
                                                "flux": audio_state.get("flux", 0.0),
                                                "vol": audio_state.get("vol", 0.0),
                                                "beat_phase": audio_state.get("beat_phase", 0.0)
                                            }
                                            audio_state["mods"] = mods
                                            for side in ['left', 'right']:
                                                if side in audio_state and isinstance(audio_state[side], dict):
                                                    audio_state[side]['vibe'] = v_val
                                                    audio_state[side]['transient'] = t_val
                                                    audio_state[side]['mods'] = mods
                                
                        elif msg_type == "synth":
                            if synth:
                                f = float(data.get("freq", 440.0))
                                a = float(data.get("amp", 0.0))
                                if a > 0:
                                    print(f"🎹 Synth Active: {f}Hz @ {a}")
                                synth.set_tone(f, a)
                                # Remote audio injection fallback
                                inject = data.get("data", {})
                                if inject:
                                    with audio_state_lock:
                                        for k, v in inject.items():
                                            if k in audio_state:
                                                audio_state[k] = v
                                    last_injection_time = time.time()
                        
                        elif msg_type == "gamepad_axis":
                            axis = data.get("axis")
                            val = data.get("val", 0.0) # 0..1
                            if axis in gamepad_state:
                                gamepad_state[axis] = val
                        
                        elif msg_type == "gamepad_button":
                            btn = data.get("button")
                            state = data.get("state", 0) # 0 or 1
                            if btn in gamepad_state:
                                gamepad_state[btn] = state
                        
                        elif msg_type == "params":
                            # Handle Parameter Updates from Frontend
                            # Sensitivity -> Input Gain
                            if "sensitivity" in data:
                                val = float(data["sensitivity"])
                                # Master Gain should only normalize the signal, not pump it.
                                # Send clean data, and let the Laser/Visual engines scale it independently.
                                analyzer.set_gain(val) 
                            
                            if dmx_engine:
                                if "intensity" in data:
                                    dmx_engine.set_intensity(float(data["intensity"]))
                                if "speed" in data:
                                    dmx_engine.set_speed(float(data["speed"]))
                        
                        elif msg_type == "laser_override":
                            # Apply direct channel overrides from Vibe Mapper
                            if dmx_engine:
                                overrides = data.get("overrides", [])
                                print(f"🔦 Applying {len(overrides)} overrides")
                                dmx_engine.apply_overrides(overrides, data.get("style_overrides", []))

                        elif msg_type == "clear_overrides":
                            # Clear overrides for a specific device (zone) or ALL
                            dev_name = data.get("device") or "all"
                            if dmx_engine:
                                dmx_engine.clear_device_overrides(dev_name)

                        elif msg_type == "toggle_training":
                            global training_mode_active
                            training_mode_active = not training_mode_active
                            print(f"🔄 Training Mode: {'LIVE (Logging)' if training_mode_active else 'SYNC (Locked)'}")
                            if not training_mode_active:
                                analyzer.manual_bpm_override = current_saved_bpm
                            else:
                                analyzer.manual_bpm_override = None

                        elif msg_type == "bpm_override":
                            bpm_val = data.get("bpm")
                            # 1. Update live analyzer
                            if bpm_val and float(bpm_val) > 0:
                                analyzer.manual_bpm_override = float(bpm_val)
                                print(f"⏱️ Manual BPM Override: {bpm_val}")
                            else:
                                analyzer.manual_bpm_override = None
                                print(f"⏱️ Manual BPM Override: Cleared")
                            
                            # 2. Save to tuning_config/manual_bpm.json keyed by track_id
                            track_id = None
                            with audio_state_lock:
                                spotify_info = audio_state.get('spotify', {})
                                if isinstance(spotify_info, dict):
                                    track_id = spotify_info.get('id')
                            
                            if track_id:
                                try:
                                    bpm_file = os.path.join(os.path.dirname(__file__), '..', 'tuning_config', 'manual_bpm.json')
                                    overrides = {}
                                    if os.path.exists(bpm_file):
                                        with open(bpm_file, 'r') as f:
                                            overrides = json.load(f)
                                    
                                    if bpm_val and float(bpm_val) > 0:
                                        if track_id not in overrides:
                                            overrides[track_id] = {}
                                        overrides[track_id]['bpm'] = float(bpm_val)
                                    else:
                                        if track_id in overrides and 'bpm' in overrides[track_id]:
                                            del overrides[track_id]['bpm']
                                    
                                    with open(bpm_file, 'w') as f:
                                        json.dump(overrides, f, indent=4)
                                    print(f"💾 Saved manual BPM to {bpm_file} for track {track_id}")
                                except Exception as e:
                                    print(f"⚠️ Failed to save manual BPM: {e}")
                        
                        elif msg_type == "clear_channel_overrides":
                            # Clear specific channel overrides
                            addresses = data.get("addresses", [])
                            if dmx_engine:
                                dmx_engine.clear_address_overrides(addresses)
                        
                        elif msg_type == "set_lab_rule":
                            if dmx_engine:
                                rule = data.get("rule")
                                dmx_engine.lab_probe_rule = rule
                                if rule:
                                    print(f"🔬 Lab Rule Synced: {rule.get('behavior')} on {rule.get('source')}")
                                else:
                                    dmx_engine.lab_probe_state = {}
                                    
                        elif msg_type == "set_pause":
                            # Toggle global engine pause (Freeze with debt)
                            state = data.get("state")
                            if dmx_engine:
                                dmx_engine.set_pause(state)

                        elif msg_type == "blackout":
                            # Toggle global blackout
                            state = data.get("state")
                            if dmx_engine:
                                # If state is provided, use it, otherwise toggle
                                new_state = state if state is not None else not dmx_engine.blackout
                                dmx_engine.set_blackout(new_state)
                        
                        elif msg_type == "toggle_preset":
                            preset_id = data.get("preset_id")
                            state = data.get("state") # optional
                            exclusive = data.get("exclusive", False)
                            inject_preset = data.get("preset") # For testing unsaved presets

                            if dmx_engine:
                                if inject_preset and state is True:
                                    # Temporary injection for testing
                                    dmx_engine.presets = [p for p in dmx_engine.presets if p.get('id') != inject_preset.get('id')]
                                    dmx_engine.presets.append(inject_preset)
                                    dmx_engine.toggle_manual_preset(inject_preset.get('id'), True, exclusive)
                                elif preset_id:
                                    dmx_engine.toggle_manual_preset(preset_id, state, exclusive)
                        
                        elif msg_type == "visual_states":
                            # Update synchronized visual layer indices
                            for k in ["bg", "fg", "ov", "fx"]:
                                if k in data:
                                    visual_states[k] = int(data[k])
                        

                        elif msg_type == "trigger_scene":
                            # Handle manual scene triggers
                            scene_name = data.get("scene", "hold")
                            if dmx_engine:
                                print(f"🔥 Manual Trigger: {scene_name}")
                                dmx_engine.current_scene_name = scene_name

                        elif msg_type == "reload_config":
                            print("🔄 REFRESH: Reload requested, but using static Laser Profile. No-op.")
                            # We could re-import the module, but that's complex for now.
                            await websocket.send(json.dumps({"type": "status", "message": "Using static profile. Restart server to apply changes."}))

                        elif msg_type == "remote_params":
                            # Handle per-system params from remote control
                            target = data.get("target")
                            if target == "laser" and dmx_engine:
                                if "speed" in data:
                                    dmx_engine.set_speed(float(data["speed"]))
                                if "amplitude" in data:
                                    dmx_engine.set_intensity(float(data["amplitude"]))
                                    
                                # MOVE AMPLITUDE & AUDIO SENS (Now verified to work with DMXEngine)
                                if "audioSensitivity" in data:
                                    dmx_engine.set_audio_sensitivity(float(data["audioSensitivity"]))
                                    
                                if "sensitivity" in data:
                                    # Restore direct sensitivity 1:1 mapping
                                    analyzer.set_gain(float(data["sensitivity"]))
                            elif target == "visual":
                                # Cache visual params for persistence
                                # Iterate to support partial updates without listing every field
                                for k, v in data.items():
                                    if k != "type" and k != "target":
                                        visual_params_cache[k] = v
                                # Broadcast to all connected clients for visual control
                                visual_msg = json.dumps({
                                    "type": "visual_params",
                                    **visual_params_cache
                                })
                                for client in connected_clients:
                                    try:
                                        asyncio.create_task(client.send(visual_msg))
                                    except:
                                        pass
                                    
                        elif msg_type in ["new_ai_shader", "cycle_shader", "vj_command"]:
                            # RELAY: AI VJ Controller messages to all puppets
                            for client in connected_clients:
                                if client != websocket:
                                    try:
                                        asyncio.create_task(client.send(msg))
                                    except: pass
                                    
                        elif msg_type == "master_params":
                            # Handle Global Performance Tuning
                            if "sensitivity" in data:
                                analyzer.set_gain(float(data["sensitivity"]))
                            if "vibe_splits" in data:
                                if vibe_engine:
                                    vibe_engine.vibe_splits = data["vibe_splits"]
                            if "speed" in data and dmx_engine:
                                dmx_engine.set_speed(float(data["speed"]))
                            if "sceneFreq" in data and dmx_engine:
                                dmx_engine.scene_freq = int(data["sceneFreq"])
                            if "audio_source" in data:
                                new_mode = str(data["audio_source"])
                                if new_mode != current_audio_mode:
                                    print(f"🔄 Audio Source change requested: {current_audio_mode} -> {new_mode}")
                                    restart_audio_stream(new_mode)
                            if "dmx_interface" in data:
                                global dmx_interface
                                dmx_interface = str(data["dmx_interface"])
                                print(f"🔌 DMX Interface Preference Updated: {dmx_interface}")
                            
                            # Save parameters to engine_params.json
                            if "latency_offset" in data or "contrast_scale" in data or "vibe_reactivity" in data:
                                ep_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tuning_config', 'engine_params.json')
                                try:
                                    ep = {}
                                    if os.path.exists(ep_path):
                                        with open(ep_path, 'r') as f:
                                            ep = json.load(f)
                                    
                                    if "latency_offset" in data:
                                        ep["latency_offset"] = float(data["latency_offset"])
                                    if "contrast_scale" in data:
                                        ep["contrast_scale"] = float(data["contrast_scale"])
                                        if vibe_engine:
                                            vibe_engine.contrast_scale = float(data["contrast_scale"])
                                    if "vibe_reactivity" in data:
                                        ep["vibe_reactivity"] = data["vibe_reactivity"]
                                        if dmx_engine:
                                            dmx_engine.vibe_reactivity = data["vibe_reactivity"]
                                            
                                    with open(ep_path, 'w') as f:
                                        json.dump(ep, f, indent=4)
                                except Exception as e:
                                    print(f"⚠️ Failed to update engine_params.json: {e}")
                        
                        elif msg_type == "force_refresh":
                            # Broadcast refresh signal to all clients
                            refresh_msg = json.dumps({"type": "force_refresh"})
                            for client in connected_clients:
                                try:
                                    asyncio.create_task(client.send(refresh_msg))
                                except:
                                    pass

                        elif msg_type == "system_volume":
                            # Adjust host system volume
                            delta = data.get("delta", 0.0)
                            try:
                                with pulsectl.Pulse('volume-control') as p:
                                    sink = p.get_sink_by_name(p.server_info().default_sink_name)
                                    volume = sink.volume
                                    new_vol = max(0.0, min(1.0, volume.value_flat + delta))
                                    p.volume_set_all_chans(sink, new_vol)
                                    print(f"🔊 System Volume: {int(new_vol * 100)}% (Delta: {delta})")
                            except Exception as e:
                                print(f"⚠️ System Volume Error: {e}")
                        
                        # add_govee and remove_govee handlers removed

                        elif msg_type == "save_defaults":
                            # Persist current state as power-on default
                            save_live_defaults()
                            await websocket.send(json.dumps({"type": "status", "message": "Defaults saved to disk"}))


                        elif msg_type == "get_params":
                            # Send current system state to new clients
                            lo_val = -0.150
                            cs_val = 0.18
                            vr_val = {"chill": 0.85, "mid": 1.0, "high": 2.0}
                            try:
                                ep_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tuning_config', 'engine_params.json')
                                if os.path.exists(ep_path):
                                    with open(ep_path, 'r') as f:
                                        ep = json.load(f)
                                        lo_val = ep.get("latency_offset", -0.150)
                                        cs_val = ep.get("contrast_scale", 0.18)
                                        vr_val = ep.get("vibe_reactivity", vr_val)
                            except: pass

                            params = {
                                "type": "current_params",
                                "master": {
                                    "speed": dmx_engine.base_speed if dmx_engine else 1.0,
                                    "sensitivity": float(analyzer.gain),
                                    "audio_source": current_audio_mode,
                                    "vibe_splits": vibe_engine.vibe_splits if vibe_engine else {"chillMid": 33, "midHigh": 66},
                                    "intensity": dmx_engine.base_intensity if dmx_engine else 1.0,
                                    "sceneFreq": dmx_engine.scene_freq if dmx_engine else 1,
                                    "latency_offset": lo_val,
                                    "contrast_scale": cs_val,
                                    "vibe_reactivity": vr_val
                                },
                                "laser": {
                                    "speed": dmx_engine.base_speed if dmx_engine else 1.0,
                                    "audioSensitivity": dmx_engine.audio_sensitivity if dmx_engine else 1.0
                                },
                                "visual": visual_params_cache
                            }
                            await websocket.send(json.dumps(params))

                        elif msg_type == "label_transient":
                            # Handle manual transient state labeling for ML training
                            s_id = data.get("sessionId")
                            start_t = data.get("start_t")
                            end_t = data.get("end_t")
                            label = data.get("label")
                            
                            success = recorder.save_training_sample(s_id, start_t, end_t, label)
                            await websocket.send(json.dumps({
                                "type": "label_status",
                                "success": success,
                                "message": "Training sample saved" if success else "Failed to save sample"
                            }))

                        elif msg_type == "start_recording":
                            name = data.get("name")
                            addresses = data.get("addresses", [])
                            roles = data.get("roles", {})
                            video_enabled = data.get("video_enabled", True)
                            
                            # Default name from Spotify if available
                            if not name:
                                spot_info = audio_state.get('spotify')
                                if spot_info and spot_info.get('artist') and spot_info.get('track'):
                                    name = f"{spot_info['artist']} - {spot_info['track']}"
                                elif spot_info and spot_info.get('name'):
                                    name = spot_info['name']
                            
                            if name:
                                # Sanitize name to prevent directory traversal or file creation issues
                                name = "".join([c for c in name if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
                            
                            # BACKEND FALLBACK: If roles are empty (e.g. browser cache), auto-resolve from engine state
                            if not roles and dmx_engine:
                                for inst in dmx_engine.stage_instances:
                                    addr_val = inst.get('address')
                                    if addr_val is None or addr_val == "": addr_val = 1
                                    base_addr = int(addr_val)
                                    
                                    profile = dmx_engine.profiles.get(inst.get('profileId'))
                                    if profile:
                                        for idx, ch in enumerate(profile.get('channels', [])):
                                            addr_offset = ch.get('addrOffset')
                                            if addr_offset is None or addr_offset == "":
                                                addr_offset = idx
                                            addr = base_addr + int(addr_offset)
                                            # We use string keys to match JSON expectations
                                            roles[str(addr)] = (ch.get('role') or ch.get('name') or "unknown").lower()
                            
                            print(f"🎬 REC START: {len(addresses)} addresses, Roles: {len(roles)} keys captured", flush=True)
                            success = recorder.start(name=name, addresses=addresses, roles=roles, video_enabled=video_enabled)
                            await websocket.send(json.dumps({"type": "recording_started", "success": success}))
 
                        elif msg_type == "stop_recording":
                            new_name = data.get("name")
                            
                            # If no new_name or user canceled prompt, try to fall back to spotify track info
                            if not new_name:
                                spot_info = audio_state.get('spotify')
                                if spot_info and spot_info.get('artist') and spot_info.get('track'):
                                    new_name = f"{spot_info['artist']} - {spot_info['track']}"
                                elif spot_info and spot_info.get('name'):
                                    new_name = spot_info['name']
                                    
                            path = recorder.stop(new_name=new_name)
                            await websocket.send(json.dumps({"type": "recording_stopped", "path": path}))

                    except json.JSONDecodeError:
                        pass
            except asyncio.TimeoutError:
                pass  # No message, check for broadcast
            except websockets.exceptions.ConnectionClosed:
                raise
            
            # Tx to Browser: Only send if we have fresh data to broadcast
            global broadcast_version, state_broadcast_version
            global last_binary_payload, last_state_payload
            
            # 1. Check for discrete state changes (JSON)
            if state_broadcast_version > client_state_version:
                try:
                    await websocket.send(last_state_payload)
                    client_state_version = state_broadcast_version
                except: pass
                
            # 2. Check for high-frequency binary updates
            if broadcast_version > last_sent_version:
                try:
                    await websocket.send(last_binary_payload)
                    last_sent_version = broadcast_version
                except: pass
            
            # Yield control
            await asyncio.sleep(0.008) # 120Hz check frequency

    except websockets.exceptions.ConnectionClosed:
        print("Client Disconnected")
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)


async def main():
    # Load persisted defaults early (for hardware preference, audio mode, etc)
    load_live_defaults()
    
    setup_dmx()    

    # Initialize Vibe Engine
    global vibe_engine
    vibe_engine = VibeEngine()
    print("✅ Vibe Engine initialized")
    
    # Initialize DMX Engine
    global dmx_engine
    try:
        dmx_engine = DMXEngine()
        print("✅ DMX Engine initialized with Laser Profile")
        
        # Re-apply defaults now that engines are initialized (speed, vibe splits, etc)
        load_live_defaults()
        
    except Exception as e:
        print(f"❌ SYSTEM CRITICAL FAILURE: {e}")
        print("🛑 Engine functionality suspended.")
        dmx_engine = None
        

    
    # Audio Setup
    restart_audio_stream(current_audio_mode) # Use persisted or default mode

    print(f"🚀 Engine Running on port {WS_PORT}. Connect Browser now.")
    
    # Start websocket server and tasks with optional SSL
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    cert_path = os.path.join(BASE_DIR, '..', 'cert.pem')
    key_path = os.path.join(BASE_DIR, '..', 'key.pem')

    # WS: SSL Enabled to match Remote Tunnel Config
    if os.path.exists(cert_path) and os.path.exists(key_path):
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(certfile=cert_path, keyfile=key_path)
        print(f"🔒 WS SSL Enabled (wss://0.0.0.0:{WS_PORT})")
    else:
        ssl_context = None
        print(f"🔓 WS running in plain mode (ws://0.0.0.0:{WS_PORT})")

    # Start the native audio worker thread
    worker = threading.Thread(target=audio_worker_thread, daemon=True)
    worker.start()

    # Robust server bind with retry logic for EADDRINUSE
    max_retries = 5
    for attempt in range(max_retries):
        try:
            async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT, ssl=ssl_context):
                await asyncio.gather(
                    fast_broadcast_loop(),
                    audio_watchdog(),
                    spotify_poller(),
                    gamepad_task()
                )
            break # Success
        except OSError as e:
            if e.errno == 98: # Address already in use
                print(f"⚠️  Port {WS_PORT} in use (Attempt {attempt+1}/{max_retries}). Waiting 2s...")
                await asyncio.sleep(2.0)
            else:
                raise e
        except Exception as e:
            print(f"❌ WebSocket Server Error: {e}")
            break

# Global stream variable
audio_stream = None

def restart_audio_stream(device_input):
    global audio_stream
    
    if audio_stream:
        print("Stopping existing audio stream...")
        try:
            audio_stream.stop()
            audio_stream.close()
        except: pass
        audio_stream = None

    idx = None
    name = "Auto"
    
    if isinstance(device_input, (int, float)):
         idx = int(device_input)
         try:
             d = sd.query_devices(idx)
             name = d['name']
         except:
             name = "Unknown"
    else:
         # It's a mode string ('auto', 'system', 'spotify') or None
         mode = device_input if device_input else "auto"
         global current_audio_mode
         current_audio_mode = mode
         idx, name = find_best_audio_device(mode)

    print(f"🎤 Starting Audio Stream ({current_audio_mode}): {name} (Index: {idx})")
    
    try:
        audio_stream = sd.InputStream(device=idx, channels=2, callback=audio_callback, blocksize=BLOCK_SIZE, samplerate=SAMPLE_RATE)
        audio_stream.start()
        audio_state["device_name"] = name
        print(f"✅ Audio Stream Started: {name}")

    except Exception as e:
        print(f"❌ Audio Stream Error: {e}")
        audio_state["error"] = str(e)



if __name__ == "__main__":
    import signal
    
    def handle_exit(sig, frame):
        print(f"\n🛑 Received signal {sig}. Stopping...")
        if dmx_executor:
            print("⏳ Shutting down DMX executor...")
            dmx_executor.shutdown(wait=False)
        # Raising SystemExit will trigger finally blocks if any, 
        # but here we are at top level.
        os._exit(0) # Force exit to ensure background threads don't hang

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    try:
        asyncio.run(main())
    except Exception as e:
        print(f"❌ Main Loop Error: {e}")
    finally:
        handle_exit(None, None)
