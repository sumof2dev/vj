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
import random
from dmx_engine import DMXEngine
from vibe_engine import VibeEngine

import collections
import concurrent.futures

# --- CONFIGURATION ---
WS_PORT = 8765
DMX_BAUD = 250000
SAMPLE_RATE = 44100
BLOCK_SIZE = 2048  # Increased to 2048 to prevent dropouts under load

# --- GLOBAL STATE ---
# --- GLOBAL STATE ---
CONFIG_FILE = "vj_remote_settings.json"
SESSION_ID = str(time.time()) # Unique ID per engine restart
last_callback_time = time.time()
dmx_port = None
audio_state = { "bass": 0.0, "mid": 0.0, "high": 0.0, "vol": 0.0, "flux": 0.0, "beat": False, "device_name": "None", "bpm": 120.0 }
visual_states = { "bg": -1, "fg": -1, "ov": -1, "fx": -1 }
audio_queue = collections.deque(maxlen=50) 
last_injection_time = 0.0  
dmx_engine = None  
vibe_engine = None
govee_engine = None
connected_clients = set()
dmx_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
is_usb_dmx = False

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
                "flux_sensitivity": (3.0 - analyzer.flux_threshold_mult) / 1.9 if analyzer.flux_threshold_mult else 0.5,
                "vibe_bias": vibe_engine.mid_vibe_bias if vibe_engine else 0.5,
                "speed": dmx_engine.speed if dmx_engine else 1.0,
                "intensity": dmx_engine.intensity if dmx_engine else 1.0,
                "sceneFreq": dmx_engine.scene_freq if dmx_engine else 1
            },
            "laser": {
                "speed": dmx_engine.speed if dmx_engine else 1.0,
                "pattern": dmx_engine.pattern_mode if dmx_engine else 'auto',
                "color": dmx_engine.color_mode if dmx_engine else 'auto',
                "color_multi": dmx_engine.color_multi if dmx_engine else 0.0,
                "color_solid": dmx_engine.color_solid if dmx_engine else 0.0,
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
                if "pattern" in l_data: dmx_engine.set_pattern_mode(l_data["pattern"])
                if "color" in l_data: dmx_engine.set_color_mode(l_data["color"])
                if "color_multi" in l_data: dmx_engine.set_color_multi(l_data["color_multi"])
                if "color_solid" in l_data: dmx_engine.set_color_solid(l_data["color_solid"])
                
                # New Params
                if "audioSensitivity" in l_data: dmx_engine.set_audio_sensitivity(l_data["audioSensitivity"])
                
                
                if "amplitude" in l_data: dmx_engine.set_intensity(l_data["amplitude"]) # Laser amplitude = intensity
                
            # 3. Visual Section
            global visual_params_cache
            v_data = data.get("visual", {})
            if v_data:
                visual_params_cache.update(v_data)
                
        print(f"📖 [Persistence] Loaded defaults from {CONFIG_FILE}")
    except Exception as e:
        print(f"⚠️ Failed to load defaults: {e}")

# --- AUDIO ENGINE (Spectral Flux) ---
# --- LEAN AUDIO ENGINE (NO LIBROSA) ---
class AudioAnalyzer:
    def __init__(self):
        # WLED Frequency Ranges (Hz)
        self.wled_freqs = [
            86, 129, 216, 301, 430, 560, 818, 1120, 
            1421, 1895, 2412, 3015, 3704, 4479, 7106, 9259
        ]
        
        # Audio History for Rolling Normalization
        self.rolling_window_size = 300 # Approx 5-10 seconds @ 30-60 updates/sec
        self.history_bass = collections.deque(maxlen=self.rolling_window_size)
        self.history_mid  = collections.deque(maxlen=self.rolling_window_size)
        self.history_high = collections.deque(maxlen=self.rolling_window_size)
        self.history_flux = collections.deque(maxlen=self.rolling_window_size)

        # Beat Detection State
        self.last_beat_time = 0.0
        self.bpm_list = []
        self.bpm = 120.0
        self.prev_beat_timestamp = time.time()
        self.beat_intervals = collections.deque(maxlen=4)
        
        # Confidence State
        self.confidence = 0.0
        self.isolation = 0.0
        
        # Silence Detection
        self.last_sound_time = time.time()

        # Gain (Sensitivity)
        self.gain = 0.5 # Default gain (1.0 = Normal)
        
        # Flux Threshold Tuning
        self.flux_threshold_mult = 2.05 # Flux Sens 0.5
        self.flux_threshold_abs = 0.35  # Flux Sens 0.5
        
        # Simple Timer for pattern switching
        self.frames_since_switch = 0
        self.auto_switch_threshold = 400 
        self.prev_bands = [0.0, 0.0, 0.0]
        self.prev_bins = [0.0] * 11
        self.beat_count = 0

    def set_gain(self, val: float):
        """Set normalization gain (Sensitivity)"""
        self.gain = max(0.01, min(5.0, float(val)))

    def set_flux_sensitivity(self, val: float):
        """Set flux threshold multiplier (Higher = less sensitive to beats)"""
        # Map 0.0-1.0 to thresholds
        # val 0.5 (Default) -> mult 1.5, abs 0.25
        # val 1.0 (Highest Sens) -> mult 1.1, abs 0.1
        # val 0.0 (Lowest Sens) -> mult 3.0, abs 0.6
        self.flux_threshold_mult = 3.0 - (float(val) * 1.9)
        self.flux_threshold_abs = 0.6 - (float(val) * 0.5)

    def _normalize(self, val, history):
        """Perform rolling normalization (val - history_min) / (history_max - history_min)"""
        history.append(val)
        if len(history) < 10: return 0.5 # Not enough data
        
        min_val = min(history)
        max_val = max(history)
        
        # SANE PEAK: Instead of normalizing against absolute max in history (which might be noise),
        # use a minimum baseline for the 'max' so tiny sounds aren't boosted to 100%.
        sane_peak = max(0.4, max_val)
        
        if sane_peak - min_val < 0.0001: return 0.0
        
        norm = (val - min_val) / (sane_peak - min_val)
        return min(1.0, max(0.0, norm))

    def process(self, indata):
        if indata.size == 0: return self.get_empty_state()

        # 1. Clean & FFT
        mono = np.mean(indata, axis=1)
        mono = mono - np.mean(mono)
        fft_raw = np.abs(np.fft.rfft(mono))
        freqs = np.fft.rfftfreq(len(mono), 1/44100) 
        
        # 2. Map to 16 WLED Bins
        wled_bins = [0.0] * 16
        current_fft_idx = 1
        for i, cutoff in enumerate(self.wled_freqs):
            start = current_fft_idx
            while current_fft_idx < len(freqs) and freqs[current_fft_idx] < cutoff:
                current_fft_idx += 1
            if current_fft_idx == start: current_fft_idx += 1 
            chunk = fft_raw[start:current_fft_idx]
            if chunk.size > 0: wled_bins[i] = np.mean(chunk)

        # 3. Calculate Raw Bands
        raw_bass = np.mean(wled_bins[0:4])
        raw_mid  = np.mean(wled_bins[4:11])
        raw_high = np.mean(wled_bins[11:16])
        
        # 3.5 Calculate 11 Frequency Bins (logarithmically spaced from wled_bins)
        # Bin 0: Sub-bass (86 Hz)
        # Bin 1: Bass (129-216 Hz)
        # Bin 2: Low-mid (216-301 Hz)
        # Bin 3: Mid (301-430 Hz)  
        # Bin 4: Upper-mid (430-560 Hz)
        # Bin 5: Presence (560-818 Hz)
        # Bin 6: Upper presence (818-1120 Hz)
        # Bin 7: Low treble (1120-1895 Hz)
        # Bin 8: Treble (1895-3015 Hz)
        # Bin 9: High treble (3015-4479 Hz)
        # Bin 10: Brilliance (4479-9259 Hz)
        raw_bins = [
            wled_bins[0],
            np.mean(wled_bins[1:3]),
            wled_bins[3],
            wled_bins[4],
            wled_bins[5],
            wled_bins[6],
            wled_bins[7],
            np.mean(wled_bins[8:10]),
            np.mean(wled_bins[10:12]),
            np.mean(wled_bins[12:14]),
            np.mean(wled_bins[14:16])
        ]
        
        # 4. Silence Reset
        raw_vol = (raw_bass + raw_mid + raw_high) / 3.0
        now = time.time()
        if raw_vol > 0.01: # Signal detected
            self.last_sound_time = now
        elif now - self.last_sound_time > 5.0:
            # Silence for > 5 seconds, reset state
            self.bpm = 120.0
            self.bpm_list = []
            return self.get_empty_state()

        # 5. ROLLING NORMALIZATION
        # Auto-scales raw input to 0.0-1.0 range
        out_bass = self._normalize(raw_bass, self.history_bass)
        out_mid  = self._normalize(raw_mid, self.history_mid)
        out_high = self._normalize(raw_high, self.history_high)
        
        # Apply Logic Gain Slider (User preference)
        out_bass = min(1.0, out_bass * self.gain)
        out_mid  = min(1.0, out_mid * self.gain)
        out_high = min(1.0, out_high * self.gain)
        
        # 6. FLUX CALCULATION (Moved before Beat Detection)
        # Spectral Flux = Positive change in energy across bands
        # This is a much better onset detector than raw volume
        bass_delta = max(0, out_bass - self.prev_bands[0])
        high_delta = max(0, out_high - self.prev_bands[2])
        flux = bass_delta + \
               max(0, out_mid - self.prev_bands[1]) + \
               high_delta

        # 6.5 PER-BAND ONSET DETECTION
        # Independent triggers for bass drops vs hi-hat/cymbal hits
        bass_onset = bass_delta > 0.15
        high_onset = high_delta > 0.12

        self.prev_bands = [out_bass, out_mid, out_high]
        
        # Normalize 11 bins (simple smoothing against previous frame)
        out_bins = [0.0] * 11
        for bi in range(11):
            # Simple peak-hold with decay for each bin
            raw_val = float(raw_bins[bi]) * self.gain
            # Smooth: 70% previous + 30% new (prevents jitter)
            out_bins[bi] = min(1.0, max(0.0, self.prev_bins[bi] * 0.7 + raw_val * 0.3))
        self.prev_bins = out_bins
        
        # Maintain Flux History for Adaptive Threshold
        self.history_flux.append(flux)
        
        # 7. ADAPTIVE BEAT DETECTION (Flux-Based)
        is_beat = False
        
        # Calculate trailing average (Cumulative Average)
        if len(self.history_flux) > 0:
            avg_flux = sum(self.history_flux) / len(self.history_flux)
            
            # Threshold: Flux must be > mult * average AND > absolute threshold
            if flux > avg_flux * self.flux_threshold_mult and flux > self.flux_threshold_abs:
                # DEBOUNCE: Max 170 BPM (60/170 = ~0.35s)
                if now - self.prev_beat_timestamp > 0.35:
                    is_beat = True
                    self.beat_count += 1
                    print(f"🥁 BEAT DETECTED #{self.beat_count} | BPM: {self.bpm:.1f} | Flux: {flux:.2f}")
                    
                    # Update BPM
                    delta = now - self.prev_beat_timestamp
                    new_bpm = 60.0 / delta
                    self.prev_beat_timestamp = now
                    
                    # Outlier Rejection
                    self.bpm_list.append(new_bpm)
                    if len(self.bpm_list) > 4:
                        self.bpm_list.pop(0)
                        
                    # Smooth BPM
                    avg_bpm = sum(self.bpm_list) / len(self.bpm_list)
                    self.bpm = avg_bpm

                    # Update Beat Stability (Confidence component)
                    self.beat_intervals.append(delta)

        # 7.2 BEAT PHASE TRACKING
        # Position within the current beat cycle (0.0 = on beat, 1.0 = next beat)
        # Enables beat-synced effects that anticipate or land precisely
        if self.bpm > 0:
            beat_phase = ((now - self.prev_beat_timestamp) * self.bpm / 60.0) % 1.0
        else:
            beat_phase = 0.0
        
        # 7.5. CONFIDENCE CALCULATION
        # A) Beat Stability: How consistent are the intervals?
        stability = 0.0
        if len(self.beat_intervals) >= 3:
            intervals = list(self.beat_intervals)
            avg_int = sum(intervals) / len(intervals)
            # Calculate variance/deviation
            dev = sum(abs(x - avg_int) for x in intervals) / len(intervals)
            # Stability = 1.0 (perfect) to 0.0 (erratic)
            stability = max(0.0, 1.0 - (dev / (avg_int * 0.5 + 0.01)))
            
        # B) Frequency Isolation: Clear signal vs Muddy noise
        # Compare Peak bin vs Average of all bins
        isolation = 0.0
        if any(wled_bins):
            peak = max(wled_bins)
            avg_bins = sum(wled_bins) / len(wled_bins)
            # Isolation = Peak/Avg ratio, normalized
            # Clear signal (one instrument) has high peak/avg.
            # Pink noise (muddy) has low peak/avg.
            ratio = peak / (avg_bins + 0.001)
            isolation = min(1.0, (ratio - 1.0) / 4.0) # 5.0x ratio = 100% isolation
        self.isolation = isolation

        # C) Flux Magnitude: Sharpness of transients
        flux_mag = min(1.0, flux * 2.0)

        # FINAL CONFIDENCE SCORE (Weighted)
        # 40% Stability, 40% Isolation, 20% Flux
        new_conf = (stability * 0.4) + (isolation * 0.4) + (flux_mag * 0.2)
        
        # Smooth Confidence to prevent jitter
        self.confidence += (new_conf - self.confidence) * 0.1
        self.confidence = max(0.0, min(1.0, self.confidence))

        # 8. Pattern Switching logic
        suggested_shape = None
        self.frames_since_switch += 1
        if is_beat and self.frames_since_switch > self.auto_switch_threshold:
            suggested_shape = "random"
            self.frames_since_switch = 0

        return {
            "bass": float(out_bass),
            "mid": float(out_mid),
            "high": float(out_high),
            "vol":  float(max(out_bass, out_mid, out_high)),
            "flux": float(flux),
            "beat": bool(is_beat),
            "bass_onset": bool(bass_onset),
            "high_onset": bool(high_onset),
            "beat_phase": float(beat_phase),
            "beat_count": int(self.beat_count),
            "bpm": float(self.bpm),
            "confidence": float(self.confidence),
            "isolation": float(self.isolation),
            "suggested_animation": suggested_shape,
            "bins": [float(b) for b in out_bins]
        }

    def get_empty_state(self):
         return { 
             "bass": 0.0, "mid": 0.0, "high": 0.0, "vol": 0.0, "flux": 0.0, 
             "beat": False, "bpm": 120.0, "confidence": 0.0, "isolation": 0.0,
             "bass_onset": False, "high_onset": False, "beat_phase": 0.0,
             "suggested_animation": None, "vibe": "chill", "transient": "steady",
             "bins": [0.0] * 11
         }

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
    audio_queue.append(indata.copy())

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
DIR_PIN = 18 # Common RS485 HAT Transmit Enable pin
use_gpio = False

try:
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(DIR_PIN, GPIO.OUT)
    GPIO.output(DIR_PIN, GPIO.LOW) # Default to Read
    use_gpio = True
    print(f"📟 RS485: GPIO {DIR_PIN} initialized for Transmit Enable")
except:
    pass

def set_rs485_tx(enabled):
    if use_gpio:
        GPIO.output(DIR_PIN, GPIO.HIGH if enabled else GPIO.LOW)

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

# --- 3.6 AUDIO PROCESSOR (CONSUMER) ---
async def process_audio_queue():
    """Consume audio frames from queue and run heavy analysis."""
    global audio_state, dmx_engine, dmx_port, govee_engine
    print("🧠 Audio Processor Started")
    
    # Global Error State Tracking
    critical_error_sent = False
    
    # DMX Rate Limiting (prevent excessive updates)
    last_dmx_update = 0.0
    dmx_update_interval = 1.0 / 60.0  # 60 FPS max
    last_log = 0.0
    
    while True:
        try:
            if not audio_queue:
                await asyncio.sleep(0.005)
                continue
            
            # Get oldest frame
            indata = audio_queue.popleft()
            
            # --- HEAVY ANALYSIS ---
            # indata is float32 array (Frames, Channels) from sounddevice
            
            # Process (Analysis includes mean-subtraction DC filter)
            audio_state = analyzer.process(indata)
            
            # --- VIBE ENGINE DETERMINATION ---
            if vibe_engine:
                vibe_results = vibe_engine.update(audio_state)
                audio_state.update(vibe_results) # This adds 'vibe' and 'mods' to audio_state
            
            # DMX Update (Rate Limited)
            current_time = time.time()
            if dmx_engine and (current_time - last_dmx_update) >= dmx_update_interval:
                try:
                    dt = current_time - last_dmx_update if last_dmx_update > 0 else 0.016
                    dmx_engine.update(dt, audio_state, visual_states)
                    last_dmx_update = current_time
                    
                    if current_time - last_log > 0.5:
                        # Corrected Logging: Read from universe directly (Indices are 1-based)
                        if dmx_port or dmx_engine:
                            universe = dmx_engine.get_universe()
                            # Monitoring: R1(1), R2(18), L1(35), L2(52), B1(75), B2(92)
                            # Watching zoom for R2(22) and L2(56) and Lead B1/B2(79, 96)
                            monitored = {addr: universe[addr] for addr in [1, 5, 18, 22, 52, 56, 75, 79, 92, 96] if addr < len(universe)}
                            vibe_name = audio_state.get('vibe', 'mid')
                            q_size = len(audio_queue)
                            print(f"DMX_OUT: {monitored} | Vol: {audio_state['vol']:.2f} | Vibe: {vibe_name} | Q: {q_size}")
                            
                            if q_size > 40:
                                print(f"⚠️ High Audio Pressure: Queue size {q_size}")
                                # AGGRESSIVE: If we are drowning, skip some analysis or flush queue
                                if q_size > 48:
                                    print("🚒 EMERGENCY: Flushing audio queue to catch up")
                                    while len(audio_queue) > 5: audio_queue.popleft()
                            
                            last_log = current_time

                    if dmx_port:
                        universe = bytearray(dmx_engine.get_universe()) # Snapshot
                        loop = asyncio.get_running_loop()
                        loop.run_in_executor(dmx_executor, sync_send_dmx, dmx_port, universe)
                except ValueError as ve:
                    # STRICT ERROR CAUGHT DURING RUNTIME
                    if not critical_error_sent:
                        print(f"🛑 CRITICAL RUNTIME ERROR: {ve}")
                        # Broadcast error via audio_state
                        audio_state['error'] = str(ve) 
                        critical_error_sent = True
                        # DISABLE ENGINE to prevent further damage
                        dmx_engine = None
                except Exception as e:
                    print(f"⚠️ DMX Update Error: {e}")

            # If we had a critical startup error, we need to broadcast it once connected
            if dmx_engine is None and not critical_error_sent and 'CRITICAL' in audio_state.get('error', ''):
                 # Already set in audio_state, waiting for broadcast
                 pass
                   
            # Yield to ensure other tasks run
            await asyncio.sleep(0)  
            
        except Exception as e:
            print(f"⚠️ Audio Process Error: {e}")
            await asyncio.sleep(0.1)

# --- 4. SERVER LOOP ---
async def ws_handler(websocket):
    print("Client Connected")
    connected_clients.add(websocket)
    
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
                            global last_injection_time
                            inject = data.get("data", {})
                            if inject:
                                for k, v in inject.items():
                                    if k in audio_state:
                                        audio_state[k] = v
                                last_injection_time = time.time()
                        
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
                                dmx_engine.apply_overrides(data.get("overrides", []), data.get("style_overrides", []))

                        elif msg_type == "clear_overrides":
                            # Clear overrides for a specific device (zone)
                            dev_name = data.get("device")
                            if dmx_engine and dev_name:
                                dmx_engine.clear_device_overrides(dev_name)
                        
                        elif msg_type == "visual_states":
                            # Update synchronized visual layer indices
                            global visual_states
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
                                if "pattern" in data:
                                    dmx_engine.set_pattern_mode(data["pattern"])
                                if "color" in data:
                                    dmx_engine.set_color_mode(data["color"])
                                if "color_multi" in data:
                                    dmx_engine.set_color_multi(data["color_multi"])
                                if "color_solid" in data:
                                    dmx_engine.set_color_solid(data["color_solid"])
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
                                        await client.send(visual_msg)
                                    except:
                                        pass
                                    
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
                                    await client.send(refresh_msg)
                                except:
                                    pass
                        
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
                                    "flux_sensitivity": (3.0 - analyzer.flux_threshold_mult) / 1.9 if analyzer.flux_threshold_mult else 0.5,
                                    "vibe_bias": vibe_engine.mid_vibe_bias if vibe_engine else 0.5,
                                    "intensity": dmx_engine.intensity if dmx_engine else 1.0,
                                    "sceneFreq": dmx_engine.scene_freq if dmx_engine else 1
                                },
                                "laser": {
                                    "speed": dmx_engine.speed if dmx_engine else 1.0,
                                    "audioSensitivity": dmx_engine.audio_sensitivity if dmx_engine else 1.0,
                                    "pattern": dmx_engine.pattern_mode if dmx_engine else 'auto',
                                    "color": dmx_engine.color_mode if dmx_engine else 'auto',
                                    "color_multi": dmx_engine.color_multi if dmx_engine else 0.0,
                                    "color_solid": dmx_engine.color_solid if dmx_engine else 0.0
                                },
                                "visual": visual_params_cache
                            }
                            await websocket.send(json.dumps(params))

                    except json.JSONDecodeError:
                        pass
            except asyncio.TimeoutError:
                pass  # No message, continue
            except websockets.exceptions.ConnectionClosed:
                raise
            
            # Tx to Browser: Audio Analysis + DMX State
            dmx_info = dmx_engine.get_channel_state() if dmx_engine else {"values": {}, "effects": []}
            rot_state = dmx_engine.rot_state if dmx_engine else 'IDLE'
            active_scene = dmx_engine.current_scene_name if dmx_engine else 'none'
            vibe = audio_state.get("vibe", "mid")
            
            await websocket.send(json.dumps({
                "type": "audio", 
                "session_id": SESSION_ID,
                "data": audio_state,
                "dmx": dmx_info["values"],
                "effects": dmx_info["effects"],
                "active_scene": active_scene,
                "rot_state": rot_state,
                "base_layer": dmx_engine.current_base_layer if dmx_engine else 0,
                "fg_layer": dmx_engine.current_fx_layer if dmx_engine else -1,
                "fx_layer": dmx_engine.current_fx_layer if dmx_engine else 6
            }))
            
            # Tiny sleep to yield control if needed, though await_for handles this
            # await asyncio.sleep(0) 

    except websockets.exceptions.ConnectionClosed:
        print("Client Disconnected")
    finally:
        connected_clients.remove(websocket)

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
        
    except Exception as e:
        print(f"❌ SYSTEM CRITICAL FAILURE: {e}")
        print("🛑 Engine functionality suspended.")
        dmx_engine = None
        

    
    # Audio Setup
    restart_audio_stream(None) # Auto-select best

    print(f"🚀 Engine Running on port {WS_PORT}. Connect Browser now.")
    
    # Start websocket server and tasks
    async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT):
        await asyncio.gather(
            process_audio_queue(),
            audio_watchdog()
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
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Server Stopping...")
