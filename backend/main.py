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
import wave

try:
    import evdev
    from evdev import ecodes
    HAS_EVDEV = True
except ImportError:
    HAS_EVDEV = False
    print("⚠️  evdev not found. Gamepad support disabled.")

# --- SYNTH ENGINE ---
class SimpleSynth:
    """A lightweight, zero-dependency Sine Wave synthesizer for the Easter Egg mode."""
    def __init__(self, sr=44100):
        self.sr = sr
        self.phase = 0.0
        self.freq = 440.0
        self.amp = 0.0
        self.stream = None
        try:
            print("🎹 Opening Synth Stream on 'pulse' or default...")
            # Try to find pulse device index
            pulse_idx = None
            try:
                for i, d in enumerate(sd.query_devices()):
                    if 'pulse' in d['name'].lower():
                        pulse_idx = i
                        break
            except: pass

            self.stream = sd.OutputStream(
                device=pulse_idx,
                samplerate=self.sr,
                channels=2,
                callback=self.audio_callback,
                blocksize=1024
            )
            self.stream.start()
            print(f"🎹 Easter Egg Synth Initialized (Stereo Mode) on device {pulse_idx or 'default'}")
        except Exception as e:
            print(f"⚠️ Synth init error: {e}")

    def audio_callback(self, outdata, frames, time_info, status):
        if self.amp < 0.001:
            outdata.fill(0)
            return
            
        # Correct FM Synthesis: Phase is the integral of frequency
        # We calculate the phase increment per sample
        dt = 1.0 / self.sr
        # Create an array of phases for this block
        # New phase = Old phase + (2 * pi * freq * sample_index * dt)
        indices = np.arange(frames)
        block_phases = self.phase + (2 * np.pi * self.freq * indices * dt)
        
        wave = np.sin(block_phases) * self.amp
        
        # Update global phase for next block
        self.phase = (block_phases[-1] + (2 * np.pi * self.freq * dt)) % (2 * np.pi)
        
        try:
            outdata[:, 0] = wave
            outdata[:, 1] = wave
        except IndexError:
            outdata[:] = wave.reshape(-1, 1)

    def set_tone(self, freq, amp):
        self.freq = freq
        self.amp = amp

# synth = SimpleSynth() # Moved inside main()
hardware_synth_enabled = True # Enabled by default for direct test

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
    global hardware_synth_enabled, gamepad_state
    print("🎮 Gamepad Watchdog Started")
    
    while True:
        device = get_gamepad()
        if not device:
            await asyncio.sleep(5)
            continue
            
        try:
            print(f"🎮 Connected to {device.name}")
            # Map for state tracking
            gp_state = {"amp": 0.0, "freq": 440.0}
            
            async for event in device.async_read_loop():
                # Raw event debugging
                if event.type in [ecodes.EV_KEY, ecodes.EV_ABS]:
                     print(f"🎮 GP EVENT: Type={hex(event.type)}, Code={hex(event.code)}, Val={event.value}", flush=True)

                if event.type == ecodes.EV_KEY:
                    # Debug print for keys
                    print(f"🎮 GP Key: Code={hex(event.code)}, Val={event.value}")
                    # LB (Left Bumper) = Toggle Synth
                    if event.code == ecodes.BTN_TL and event.value == 1:
                        hardware_synth_enabled = not hardware_synth_enabled
                        print(f"🎮 Hardware Synth: {'ON' if hardware_synth_enabled else 'OFF'}")
                    
                    # LS Click = Reset L1/L2 to Auto
                    elif event.code == ecodes.BTN_THUMBL and event.value == 1:
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
                            
                            # Synth Pitch: Map norm 0..1 (up to down) to 2000Hz down to 200Hz
                            gp_state["freq"] = 200 + ((1.0 - norm) * 1800)
                            if hardware_synth_enabled:
                                print(f"🎵 Synth Freq Change: {int(gp_state['freq'])}Hz (Norm: {norm:.2f})", flush=True)
                    
                    # Triggers = Amplitude (ABS_Z = LT, ABS_RZ = RT)
                    elif event.code == ecodes.ABS_Z: # LT
                        abs_info = device.absinfo(event.code)
                        if abs_info:
                            norm = event.value / float(abs_info.max)
                            gp_state["amp"] = norm
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
                    
                    # Update Synth if enabled
                    if hardware_synth_enabled and synth:
                        synth.set_tone(gp_state["freq"], gp_state["amp"])

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
# --- GLOBAL STATE ---
CONFIG_FILE = "vj_remote_settings.json"
SPOT_CREDS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "spotify_creds.json")

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
DMX_ENABLED = True
active_clients = set()
last_callback_time = time.time()
dmx_port = None
audio_state = { "bass": 0.0, "mid": 0.0, "high": 0.0, "vol": 0.0, "flux": 0.0, "beat": False, "device_name": "None", "bpm": 120.0 }
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
dmx_engine = None  
vibe_engine = None
connected_clients = set()
dmx_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
dmx_ready = True
audio_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
is_usb_dmx = False
last_binary_payload = b""
last_state_payload = "{}"
last_broadcast_time = 0.0 # Signal all handlers to send when updated
broadcast_version = 0 # Monotonic version for WS sync
state_broadcast_version = 0 # Track JSON state version

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

def save_live_defaults():
    """Save current performance parameters to disk"""
    try:
        data = {
            "master": {
                "sensitivity": analyzer.gain,
                "flux_sensitivity": analyzer.flux_sensitivity_percentage,
                "vibe_bias": vibe_engine.mid_vibe_bias if vibe_engine else 0.5,
                "speed": dmx_engine.speed if dmx_engine else 1.0,
                "intensity": dmx_engine.intensity if dmx_engine else 1.0,
                "sceneFreq": dmx_engine.scene_freq if dmx_engine else 1
            },
            "laser": {
                "speed": dmx_engine.speed if dmx_engine else 1.0,
                "audioSensitivity": dmx_engine.audio_sensitivity if dmx_engine else 1.0,
                "amplitude": dmx_engine.intensity if dmx_engine else 1.0
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
            if "flux_sensitivity" in m_data: analyzer.set_flux_sensitivity(m_data["flux_sensitivity"])
            if "vibe_bias" in m_data and vibe_engine: vibe_engine.mid_vibe_bias = m_data["vibe_bias"]
            if "speed" in m_data and dmx_engine: dmx_engine.set_speed(m_data["speed"])
            if "intensity" in m_data and dmx_engine: dmx_engine.set_intensity(m_data["intensity"])
            if "sceneFreq" in m_data and dmx_engine: dmx_engine.scene_freq = m_data["sceneFreq"]

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

def audio_callback(indata, frames, time_info, status):
    global audio_state, last_callback_time
    last_callback_time = time.time()
    
    if status:
        print(status)
    
    # PRIORITY: If we received injected audio recently (which shouldn't happen anymore), return
    if time.time() - last_injection_time < 2.0:
        return

    # Push raw audio to queue for processing in main thread
    # Must copy because indata buffer is reused by sounddevice
    try:
        audio_queue.put_nowait(indata.copy())
    except queue.Full:
        pass

def get_monitor_source():
    """Finds the 'Monitor' source of the default output (Spotify)"""
    try:
        with pulsectl.Pulse('audio-grabber') as p:
            # We want to record from the monitor of the default sink
            # 1. Get default sink name
            server_info = p.server_info()
            default_sink_name = server_info.default_sink_name
            
            # 2. Find that sink object
            sink_list = p.sink_list()
            sink = next((s for s in sink_list if s.name == default_sink_name), None)
            
            if sink:
                print(f"🎧 Found default sink: {sink.description}")
                return sink.monitor_source_name
            else:
                print("⚠️ Could not find default sink object.")
                return None
    except Exception as e: 
        print(f"⚠️ PulseAudio Error: {e}")
        return None

def route_stream_to_monitor(target_source_name):
    """Moves this application's recording stream to the specified monitor source."""
    if not target_source_name: return
    
    print(f"🔀 Attempting to route audio to: {target_source_name}")
    try:
        # Give the stream a moment to register with PulseAudio
        time.sleep(1.0) 
        
        with pulsectl.Pulse('audio-router') as p:
            # Find our stream (we look for a recording stream associated with python)
            # Note: sounddevice usually names the stream "python3" or similar
            sources = p.source_output_list()
            my_stream = None
            
            # Simple heuristic: Find the most recent stream or filter by name
            # Since we just started it, it should be there.
            for s in sources:
                # print(f"Debug: Found stream {s.name}")
                # We assume the stream we just started is the one we want to move
                # Check proplist for application info
                props = getattr(s, 'proplist', {})
                app_name = props.get('application.name', '')
                binary_name = props.get('application.process.binary', '')
                
                if 'python' in str(app_name).lower() or 'python' in str(binary_name).lower() or 'python' in str(s.name).lower():
                    my_stream = s
                    break
            
            if my_stream:
                # Look up the source index by name
                target_source = None
                for src in p.source_list():
                    if src.name == target_source_name:
                        target_source = src
                        break
                
                if target_source:
                    p.source_output_move(my_stream.index, target_source.index)
                    print(f"✅ Successfully routed stream {my_stream.index} to {target_source.name}!")
                else:
                    print(f"⚠️ Could not find source: {target_source_name}")
            else:
                print("⚠️ Could not find Python recording stream to route.")
                
    except Exception as e:
        print(f"❌ Routing Error: {e}")

def find_best_audio_device():
    """Robustly finds the best available input device."""
    devices = sd.query_devices()
    print("\n🎤 --- Available Audio Devices ---")
    for i, d in enumerate(devices):
        print(f"[{i}] {d['name']} (In: {d['max_input_channels']})")
    print("---------------------------------\n")

    # 1. Try PulseAudio Monitor (Linux specific, best for loopback)
    pa_source = get_monitor_source()
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
    
    # Prioritize candidates (User requested HAT priority)
    candidates = []
    
    # 1. Raspberry Pi Native UARTs (RS485 HATs) - HIGH PRIORITY
    raspberry_pi_uarts = ['/dev/ttyAMA0', '/dev/serial0', '/dev/ttyS0']
    for uart in raspberry_pi_uarts:
        if os.path.exists(uart):
            candidates.append(uart)
            
    # 2. Fallback to USB Serial
    for p in ports:
        desc_lower = p.description.lower()
        if any(x in desc_lower for x in ['ftdi', 'ft232', 'usb', 'serial', 'ch340', 'cp210']) or 'ttyUSB' in p.device:
            if p.device not in candidates:
                candidates.append(p.device)

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
                restart_audio_stream(None)  # None = Auto-select best
            except Exception as e:
                print(f"Watchdog restart failed: {e}")
            
            # Reset timer to give the restart time to work
            last_callback_time = time.time() + 5.0

def audio_worker_thread():
    """Consume audio frames from queue and run heavy analysis in a pure native thread."""
    global audio_state
    print("🧠 Audio Worker Thread Started")
    
    while True:
        try:
            # Block until we get a frame
            indata = audio_queue.get(block=True)
            # Heavy Analysis
            new_audio_state = analyzer.process(indata)
            
            # Preserve Spotify metadata injected by the async poller
            if 'spotify' in audio_state:
                new_audio_state['spotify'] = audio_state['spotify']
                
            audio_state.update(new_audio_state)
            
            # Vibe Engine Determination
            if vibe_engine:
                vibe_results = vibe_engine.update(audio_state)
                audio_state.update(vibe_results) # 'vibe', 'mods', etc.
                
            audio_queue.task_done()
        except Exception as e:
            print(f"⚠️ Audio Worker Error: {e}")
            time.sleep(0.01)

def pack_binary_state(current_time):
    """
    Packs the system state into a compact little-endian ArrayBuffer.
    Layout (Total 595 bytes):
    - master_time (f32, offset 0)
    - flux, bass, mid, high, vol, bpm (6x f32, offset 4-27)
    - bins (6x f32, offset 28-51)
    - beat, b_onset, h_onset, pad (4x u8, offset 52-55)
    - axis_a..e (5x f32, offset 56-75)
    - base, fx, fg layerIdx (3x u16, offset 76-81)
    - dmx (513x u8, offset 82-594)
    """
    m_time = (current_time - SERVER_START_TIME) * 0.6
    flux = audio_state.get('flux', 0.0)
    bass = audio_state.get('bass', 0.0)
    mid = audio_state.get('mid', 0.0)
    high = audio_state.get('high', 0.0)
    vol = audio_state.get('vol', 0.0)
    bpm = audio_state.get('bpm', 120.0)
    
    bins = audio_state.get('bins', [0]*6)
    while len(bins) < 6: bins.append(0)
    
    beat = 1 if audio_state.get('beat', False) else 0
    b_onset = 1 if audio_state.get('bass_onset', False) else 0
    h_onset = 1 if audio_state.get('high_onset', False) else 0
    
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
    
    # Pack header (82 bytes)
    header = struct.pack('<f ffffff ffffff BBBB fffff HHH',
        m_time,
        flux, bass, mid, high, vol, bpm,
        float(bins[0]), float(bins[1]), float(bins[2]), float(bins[3]), float(bins[4]), float(bins[5]),
        beat, b_onset, h_onset, 0,
        ax_a, ax_b, ax_c, ax_d, ax_e,
        int(base_l), int(fx_l), int(fg_l)
    )
    
    # Return 82 + 513 = 595 bytes
    return header + bytes(univ)[:513].ljust(513, b'\x00')

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
            
            # --- 1. DMX RATE-LIMITED UPDATE ---
            if dmx_engine and (current_time - last_dmx_update) >= dmx_update_interval:
                try:
                    dt = current_time - last_dmx_update if last_dmx_update > 0 else 0.016
                    dmx_engine.update(dt, audio_state, visual_states, gamepad_state)
                    last_dmx_update = current_time
                    
                    if current_time - last_log > 0.5:
                        if dmx_port or dmx_engine:
                            universe = dmx_engine.get_universe()
                            monitored = {addr: universe[addr] for addr in [1, 7, 8, 175, 182] if addr < len(universe)}
                            vibe_name = audio_state.get('vibe', 'mid')
                            q_size = audio_queue.qsize()
                            print(f"DMX_OUT: {monitored} | Vol: {audio_state['vol']:.2f} | Vibe: {vibe_name} | Q: {q_size}")
                            last_log = current_time

                    if dmx_port:
                        full_u = dmx_engine.get_universe()
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
                                dev_max = int(inst.get('address', 1)) + int(inst.get('offset', 0)) + (ch_count - 1)
                                if dev_max > max_addr: max_addr = dev_max
                        
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
                        audio_state['error'] = str(ve) 
                        critical_error_sent = True
                        dmx_engine = None
                except Exception as e:
                    print(f"⚠️ DMX Update Error: {e}")

            # --- 2. WEBSOCKET BROADCAST PREPARATION ---
            if not connected_clients:
                continue
                
            is_active = audio_state.get('vol', 0.0) > 0.01 or audio_state.get('beat', False)
            broadcast_interval = 0.033 if is_active else 1.0 # 30FPS for visualizers
            
            if (current_time - last_broadcast_time) >= broadcast_interval:
                try:
                    # Update the binary image for listeners
                    last_binary_payload = pack_binary_state(current_time)
                    last_broadcast_time = current_time
                    broadcast_version += 1
                    
                    # Also prepare a lighter-weight JSON update for UI elements (Vibe changes, etc)
                    state_dict = {
                        "type": "state",
                        "session_id": SESSION_ID,
                        "vibe": audio_state.get('vibe', 'mid'),
                        "transient": audio_state.get('transient', 'steady'),
                        "active_presets": [p['name'] for p in dmx_engine.active_presets] if dmx_engine else [],
                        "overrides": list(dmx_engine.overrides.keys()) if dmx_engine else [],
                        "spotify": audio_state.get('spotify')
                    }
                    if 'error' in audio_state:
                         state_dict['error'] = audio_state['error']
                    
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
        sp = spotipy.Spotify(auth_manager=auth_manager)
    except Exception as e:
        print(f"❌ Spotify Init Failed: {e}")
        return

    current_track_id = None
    loop = asyncio.get_running_loop()

    while True:
        try:
            # Run the network request in an executor so it doesn't freeze the DMX lasers
            current_playing = await loop.run_in_executor(None, sp.current_user_playing_track)
            
            if current_playing is not None and current_playing.get('item') is not None:
                track = current_playing['item']
                track_id = track['id']
                
                if track_id != current_track_id:
                    current_track_id = track_id
                    track_name = track['name']
                    artist_name = track['artists'][0]['name']
                    
                    # Extract Album Art (Spotify provides [High, Medium, Low] resolution)
                    images = track.get('album', {}).get('images', [])
                    
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
                
                audio_state['spotify'] = {
                    'name': f"{track_name} - {artist_name}",
                    'progress_ms': progress_ms,
                    'duration_ms': duration_ms,
                    'image_high': spotify_images.get('high'),
                    'image_low': spotify_images.get('low')
                }
            else:
                # Nothing playing
                if 'spotify' in audio_state:
                    del audio_state['spotify']
                
        except spotipy.SpotifyException as se:
            print(f"⚠️ Spotify API Error: {se}")
        except Exception as e:
            err_str = str(e)
            print(f"⚠️ Spotify Poller generic error: {err_str}")
            if "EOF" in err_str or isinstance(e, EOFError):
                print("🛑 Spotify auth requires an interactive browser. Disabling poller for this session.")
                return
            
        await asyncio.sleep(3.0) # Check every 3 seconds

# --- 4. SERVER LOOP ---
async def ws_handler(websocket):
    global connected_clients, visual_params_cache
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
                                for k, v in inject.items():
                                    if k in audio_state:
                                        audio_state[k] = v
                                last_injection_time = time.time()
                                
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
                            # Clear overrides for a specific device (zone)
                            dev_name = data.get("device")
                            if dmx_engine and dev_name:
                                dmx_engine.clear_device_overrides(dev_name)
                        
                        elif msg_type == "clear_channel_overrides":
                            # Clear specific channel overrides
                            addresses = data.get("addresses", [])
                            if dmx_engine:
                                dmx_engine.clear_address_overrides(addresses)
                        
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
                            if "flux_sensitivity" in data:
                                analyzer.set_flux_sensitivity(float(data["flux_sensitivity"]))
                            if "vibe_bias" in data:
                                if vibe_engine:
                                    vibe_engine.mid_vibe_bias = float(data["vibe_bias"])
                            if "speed" in data and dmx_engine:
                                dmx_engine.set_speed(float(data["speed"]))
                            if "sceneFreq" in data and dmx_engine:
                                dmx_engine.scene_freq = int(data["sceneFreq"])
                        
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
                        
                        elif msg_type == "save_defaults":
                            # Persist current state as power-on default
                            save_live_defaults()
                            await websocket.send(json.dumps({"type": "status", "message": "Defaults saved to disk"}))

                        elif msg_type == "get_params":
                            # Send current system state to new clients
                            params = {
                                "type": "current_params",
                                "master": {
                                    "speed": dmx_engine.speed if dmx_engine else 1.0,
                                    "sensitivity": analyzer.gain,
                                    "flux_sensitivity": analyzer.flux_sensitivity_percentage,
                                    "vibe_bias": vibe_engine.mid_vibe_bias if vibe_engine else 0.5,
                                    "intensity": dmx_engine.intensity if dmx_engine else 1.0,
                                    "sceneFreq": dmx_engine.scene_freq if dmx_engine else 1
                                },
                                "laser": {
                                    "speed": dmx_engine.speed if dmx_engine else 1.0,
                                    "audioSensitivity": dmx_engine.audio_sensitivity if dmx_engine else 1.0
                                },
                                "visual": visual_params_cache
                            }
                            await websocket.send(json.dumps(params))

                        elif msg_type == "run_calibration":
                            asyncio.create_task(run_calibration_task(websocket))

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

async def run_calibration_task(websocket):
    """Background task to run audio engine sanity check and stream results"""
    try:
        wav_path = os.path.join(os.path.dirname(__file__), "..", "tests", "calibration", "calibration_audio.wav")
        truth_path = os.path.join(os.path.dirname(__file__), "..", "tests", "calibration", "calibration_truth.json")

        if not os.path.exists(wav_path) or not os.path.exists(truth_path):
            await websocket.send(json.dumps({"type": "calibration_error", "message": "Calibration files missing. Run generator first."}))
            return

        await websocket.send(json.dumps({"type": "calibration_start"}))
        
        with open(truth_path, 'r') as f:
            truth = json.load(f)

        wf = wave.open(wav_path, 'rb')
        num_frames = wf.getnframes()
        
        # Sync with LIVE settings to test the current environment
        cal_analyzer = AudioAnalyzer()
        cal_analyzer.set_gain(analyzer.gain)
        cal_analyzer.set_flux_sensitivity(analyzer.flux_sensitivity_percentage)
        
        cal_vibe = VibeEngine()
        cal_vibe.mid_vibe_bias = vibe_engine.mid_vibe_bias
        
        results = {"beats": [], "vibe_states": [], "transients": [], "bpm": []}
        processed_frames = 0
        
        # To avoid blocking the WS loop for too long, we process in chunks and yield
        chunk_count = 0
        while processed_frames < num_frames:
            data = wf.readframes(BLOCK_SIZE)
            if not data: break
            
            samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32767.0
            samples = samples.reshape(-1, 1)
            
            t = processed_frames / SAMPLE_RATE
            audio_state = cal_analyzer.process(samples, now=t)
            vibe_state = cal_vibe.update(audio_state, now=t)
            
            if audio_state['beat']: results["beats"].append(t)
            results["vibe_states"].append((t, vibe_state['vibe']))
            results["transients"].append((t, vibe_state['transient']))
            results["bpm"].append((t, audio_state['bpm']))
            
            processed_frames += len(samples)
            chunk_count += 1
            
            # Update UI every 0.5s of virtual audio
            if chunk_count % 10 == 0:
                await websocket.send(json.dumps({
                    "type": "calibration_progress", 
                    "progress": processed_frames / num_frames,
                    "bpm": audio_state['bpm']
                }))
                await asyncio.sleep(0.01) # Yield to event loop

        wf.close()

        # Evaluate (Same logic as run_calibration.py)
        # 1. Beats
        all_truth_beats = []
        for s in truth["sections"]:
            if "beats" in s: all_truth_beats.extend(s["beats"])
        matches = 0
        for tb in all_truth_beats:
            closest = min(results["beats"], key=lambda db: abs(db - tb)) if results["beats"] else 999
            if abs(closest - tb) < 0.1: matches += 1
        recall = matches / len(all_truth_beats) if all_truth_beats else 0
        
        # 2. Vibe/Transient Score
        vibe_checks = []
        transient_checks = []
        for s in truth["sections"]:
            mid_t = (s["start"] + s["end"]) / 2.0
            if "expected_vibe" in s:
                _, actual = min(results["vibe_states"], key=lambda x: abs(x[0] - mid_t))
                vibe_checks.append({"name": s["name"], "pass": actual == s["expected_vibe"], "actual": actual, "expected": s["expected_vibe"]})
            if "expected_transient" in s:
                _, actual = min(results["transients"], key=lambda x: abs(x[0] - mid_t))
                transient_checks.append({"name": s["name"], "pass": actual == s["expected_transient"], "actual": actual, "expected": s["expected_transient"]})

        # 3. Final BPM (Section 1)
        mid_s1 = (truth["sections"][0]["start"] + truth["sections"][0]["end"]) / 2.0
        _, actual_bpm = min(results["bpm"], key=lambda x: abs(x[0] - mid_s1))

        # 4. SIGNAL HEALTH AUDIT (The logic we just added)
        health = analyzer.get_signal_health()

        await websocket.send(json.dumps({
            "type": "calibration_report",
            "recall": recall,
            "vibe_checks": vibe_checks,
            "transient_checks": transient_checks,
            "bpm_accuracy": {
                "expected": truth["bpm"],
                "actual": actual_bpm,
                "error": abs(actual_bpm - truth["bpm"])
            },
            "signal_health": health, # Tell the user if their Spotify/Main vol is the issue
            "settings": {
                "gain": analyzer.gain,
                "reactivity": analyzer.flux_sensitivity_percentage
            }
        }))

    except Exception as e:
        print(f"❌ Calibration Task Error: {e}")
        try:
            await websocket.send(json.dumps({"type": "calibration_error", "message": str(e)}))
        except: pass

async def main():
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
        
        # Now that engines are ready, load persisted defaults
        load_live_defaults()
        
        # Initialize Synth Easter Egg
        global synth
        synth = SimpleSynth()
        
    except Exception as e:
        print(f"❌ SYSTEM CRITICAL FAILURE: {e}")
        print("🛑 Engine functionality suspended.")
        dmx_engine = None
        

    
    # Audio Setup
    restart_audio_stream(None) # Auto-select best

    print(f"🚀 Engine Running on port {WS_PORT}. Connect Browser now.")
    
    # Start websocket server and tasks with optional SSL
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    cert_path = os.path.join(BASE_DIR, '..', 'cert.pem')
    key_path = os.path.join(BASE_DIR, '..', 'key.pem')

    # WS: Plain mode preferred for Cloudflare Tunnels
    ssl_context = None
    if os.path.exists(cert_path) and os.path.exists(key_path):
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(certfile=cert_path, keyfile=key_path)
        print(f"🔒 WS SSL Enabled (wss://0.0.0.0:{WS_PORT})")
    else:
        print(f"🔓 WS running in plain mode (ws://0.0.0.0:{WS_PORT})")

    # Start the native audio worker thread
    worker = threading.Thread(target=audio_worker_thread, daemon=True)
    worker.start()

    async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT, ssl=ssl_context):
        await asyncio.gather(
            fast_broadcast_loop(),
            audio_watchdog(),
            spotify_poller(),
            gamepad_task()
        )

# Global stream variable
audio_stream = None

def restart_audio_stream(device_index):
    global audio_stream
    
    if audio_stream:
        print("Stopping existing audio stream...")
        try:
            audio_stream.stop()
            audio_stream.close()
        except: pass
        audio_stream = None

    idx = device_index
    name = "Auto"
    
    if idx is None:
         idx, name = find_best_audio_device()
    else:
         try:
             d = sd.query_devices(idx)
             name = d['name']
         except:
             name = "Unknown"

    print(f"🎤 Starting Audio Stream on Device {idx}: {name}")
    
    try:
        audio_stream = sd.InputStream(device=idx, channels=1, callback=audio_callback, blocksize=BLOCK_SIZE, samplerate=SAMPLE_RATE)
        audio_stream.start()
        audio_state["device_name"] = name
        print("✅ Audio Stream Started")
        
        # EXPERIMENTAL: Auto-route to monitor if strictly needed
        # Only try routing if we auto-selected (None) or explicitly asked
        if idx is not None:
             # Check if it looks like a monitor request or loopback
             pass 

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
