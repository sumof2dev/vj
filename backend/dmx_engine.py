# ============================================================================== 
# FILE: dmx_engine.py 
# ==============================================================================
import time
import math
import random
import os
import json
import collections
from typing import Dict
import threading

class LogicMatrix:
    """The modular core. Generates continuous LFOs and Envelopes."""
    def __init__(self):
        self.phases = collections.defaultdict(float)
        self.beat_env = 0.0
        self.beat_count = 0
        self.state = {}

    def update(self, dt, audio, transient, speed_mult=1.0, master_intensity=1.0, active_lfos=None):
        # 1. Update Beat Envelope (Sharp attack, exponential decay)
        if audio.get('beat', False):
            self.beat_env = 1.0
            self.beat_count += 1
        else:
            self.beat_env = max(0.0, self.beat_env - (4.0 * dt))

        # 2. Extract EQ Bins (0-10)
        bins = audio.get('bins', [0.0]*11)

        # 3. Process dynamic channel-level LFOs
        self.state = {}
        if active_lfos:
            for lfo_id, cfg in active_lfos.items():
                shape = cfg.get('shape', 'sine')
                bin_idx = cfg.get('bin', 0)
                base_speed = cfg.get('speed', 0.5)
                reactivity = cfg.get('react', 0.5)
                invert = cfg.get('invert', False)
                
                bin_energy = bins[bin_idx] if 0 <= bin_idx < len(bins) else 0.0
                freq = (base_speed + (bin_energy * reactivity)) * speed_mult
                
                self.phases[lfo_id] += dt * freq
                p = (self.phases[lfo_id] / (2 * math.pi)) % 1.0
                
                # Generate bipolar waveform output (-1.0 to 1.0)
                if shape == 'sawtooth':
                    val = (p * 2.0) - 1.0
                elif shape == 'triangle':
                    val = 4.0 * abs(p - 0.5) - 1.0
                elif shape == 'square':
                    val = 1.0 if p < 0.5 else -1.0
                else:  # Default to sine
                    val = math.sin(self.phases[lfo_id])
                
                if invert:
                    val = -val

                # if transient == 'tension':
                #     val = 0.0
                    
                self.state[lfo_id] = val

        # 4. Global State Metadata
        intensity_val = (master_intensity * 2.0) - 1.0
        # if transient == 'tension':
        #     intensity_val = -1.0
            
        self.state.update({
            'intensity': intensity_val,
            'bass': audio.get('bass', 0.0),
            'flux': audio.get('flux', 0.0),
            'beat': self.beat_env,
            'static': 1.0,
            'zero': 0.0,
            'dimmer': 1.0,
            'mode': 0.0
        })

class DMXEngine:
    def __init__(self):
        self.universe = bytearray(513)
        self.universe[0] = 0x00
        self.overrides = {}
        self._dt = 0.016
        
        # Engines - 3 Independent Spatial Matrices
        self.logic = LogicMatrix()
        self.logic_l = LogicMatrix()
        self.logic_r = LogicMatrix()
        
        # Global Modifiers
        self.intensity = 1.0
        self.speed = 1.0 
        self.scene_freq = 1
        self.audio_sensitivity = 1.0
        self.transient = "steady" 
        
        # Drops & Visual Sync
        self._one_shot_active = False
        self._last_drop_time = 0.0
        self.current_base_layer = 0 
        self.current_fx_layer = 6  
        self.rot_state = 'IDLE' 
        self._last_scene_switch_beat = 0
        self._last_vibe = 'mid'
        
        # System State Detectors (Bass Styles & Rhythm)
        self.rhythm_state = {'boots': False, 'cats': False, 'cha': False}
        
        # Bass Style Detection State
        self._bass_bins_history = collections.deque(maxlen=30)
        self._bass_delta_history = collections.deque(maxlen=30)
        self._mid_history = collections.deque(maxlen=30)
        self._current_bass_style = None
        self._bass_style_holdoff = 0.0
        
        # Config Storage
        self.fixtures = {}
        self.active_lfos = {} # Gathered from profiles
        self.stage_config = {}
        self.presets = {}
        self.zone_map = []
        
        # Controller Mapping State
        self.gamepad = {}
        self.prev_gamepad = {}
        self.channel_latches = {} # role -> index into calibration list
        
        self._stage_config_path = os.path.join('fixtures', 'stage_config.json')
        self._presets_config_path = os.path.join('fixtures', 'presets.json')
        self._last_reload_check = 0
        self._fixture_mtimes = {} 
        self._fast_cache = {}
        
        self._load_profiles()
        
        # Background Disk I/O for Hot Reloading
        self._reload_thread = threading.Thread(target=self._hot_reload_loop, daemon=True)
        self._reload_thread.start()

    def _load_profiles(self):
        fixtures_dir = 'fixtures'
        if not os.path.exists(fixtures_dir): return

        if os.path.exists(self._stage_config_path):
            with open(self._stage_config_path, 'r') as f:
                self.stage_config = json.load(f)
                if 'lasers' in self.stage_config:
                    if 'devices' not in self.stage_config: self.stage_config['devices'] = {}
                    self.stage_config['devices'].update(self.stage_config['lasers'])
                self.zone_map = list(self.stage_config.get('devices', {}).keys())

        if os.path.exists(self._presets_config_path):
            with open(self._presets_config_path, 'r') as f:
                self.presets = json.load(f)

        for filename in os.listdir(fixtures_dir):
            if filename.endswith('.json') and filename not in ['stage_config.json', 'vibe_config.json', 'presets.json']:
                with open(os.path.join(fixtures_dir, filename), 'r') as f:
                    fix_name = filename.replace('.json', '')
                    self.fixtures[fix_name] = json.load(f)
                    
        self._build_fast_cache()

    def _build_fast_cache(self):
        """Flattens nested dictionaries to prevent CPU overhead in the 60fps render loop."""
        self._fast_cache = {}
        self.active_lfos = {}
        for fix_name, fixture in self.fixtures.items():
            self._fast_cache[fix_name] = {}
            for role in fixture.get('channels', {}).keys():
                mods = fixture.get('modifiers', {})
                mod_name = mods.get(role, 'static')
                
                # Auto-migrate legacy axis strings to local LFOs
                if mod_name.startswith('axis_'):
                    mod_name = 'lfo'
                    
                # Register the channel's LFO if needed
                lfo_data = fixture.get('lfo_data', {}).get(role, {})
                if mod_name == 'lfo':
                    self.active_lfos[f"{fix_name}_{role}"] = lfo_data
                
                cals = fixture.get('calibration', {}).get(role, [])
                if isinstance(cals, dict): cals = [cals]
                    
                states = fixture.get('state_data', {}).get(role, {})
                steps = list(fixture.get('step_data', {}).values())
                default_val = fixture.get('defaults', {}).get(role, 127)
                
                self._fast_cache[fix_name][role] = {
                    'mod_name': mod_name,
                    'cals': cals,
                    'states': states,
                    'steps': steps,
                    'default_val': default_val
                }

    def _hot_reload_loop(self):
        """Background thread to check for file changes without blocking the render loop."""
        while True:
            time.sleep(2.0)
            self._check_for_reload()

    def _check_for_reload(self):
        """Checks if fixture or stage config files have changed on disk."""

        fixtures_dir = 'fixtures'
        if not os.path.exists(fixtures_dir): return

        changed = False
        for filename in os.listdir(fixtures_dir):
            if not filename.endswith('.json'): continue
            if filename == 'vibe_config.json': continue

            fpath = os.path.join(fixtures_dir, filename)
            mtime = os.path.getmtime(fpath)

            if self._fixture_mtimes.get(filename) != mtime:
                self._fixture_mtimes[filename] = mtime
                changed = True

        if changed:
            print("🔄 Changes detected in fixtures directory. Reloading profiles...")
            self._load_profiles()

    def update(self, dt: float, audio: Dict, visual_states: Dict = None, gamepad: Dict = None):
        # print(f"🔄 ENGINE UPDATE: vibe={audio.get('vibe')}")
        self._dt = dt
        self.prev_gamepad = self.gamepad
        self.gamepad = gamepad or {}
        self.transient = audio.get('transient', 'steady')

        # 1. Update the pure math core for all 3 spatial fields using the active channel LFOs
        self.logic.update(dt, audio, self.transient, self.speed, self.intensity, self.active_lfos)
        if 'left' in audio and 'right' in audio:
            self.logic_l.update(dt, audio['left'], self.transient, self.speed, self.intensity, self.active_lfos)
            self.logic_r.update(dt, audio['right'], self.transient, self.speed, self.intensity, self.active_lfos)
        else:
            self.logic_l = self.logic
            self.logic_r = self.logic
        
        # 1.5 Update System Triggers (Bass Styles & Rhythm)
        self._detect_bass_style(audio, dt)
        
        bass_hit = audio.get('bass_onset', False)
        high_hit = audio.get('high_onset', False)
        self.rhythm_state['boots'] = bass_hit and not high_hit
        self.rhythm_state['cats'] = high_hit and not bass_hit
        self.rhythm_state['cha'] = bass_hit and high_hit
        
        # 2. Check for EDM Drops & Scene Changes
        current_vibe = audio.get('vibe', 'mid')
        should_switch = False

        # if self.transient == 'dropping' and not self._one_shot_active:
        #     if time.time() - self._last_drop_time > 8.0:
        #         self._one_shot_active = True
        #         self._last_drop_time = time.time()
        #         should_switch = True
                
        # if self._one_shot_active and time.time() - self._last_drop_time > 2.0:
        #     self._one_shot_active = False

        # Interval-based scene switching
        current_beat = audio.get('beat_count', 0)
        beats_passed = current_beat - self._last_scene_switch_beat
        
        if self.scene_freq == 0 and beats_passed >= 1: # Every Beat
            should_switch = True
        elif self.scene_freq == 1 and beats_passed >= 4: # 4th Beat
            should_switch = True
        elif self.scene_freq == 2 and beats_passed >= 8: # 2 Bars
            should_switch = True
        elif self.scene_freq == 3 and beats_passed >= 16: # 4 Bars
            should_switch = True
        elif self.scene_freq == 4 and current_vibe != self._last_vibe: # On Vibe Change
            should_switch = True

        if should_switch:
            self.current_base_layer = random.choice([0,1,2,3,4,5,6,7,8,9,10])
            self.current_fx_layer = random.choice([0,1,2,3,5,6])
            self._last_scene_switch_beat = current_beat
            
        self._last_vibe = current_vibe

        # 3. Process All Devices
        for i, (dev_name, dev_cfg) in enumerate(self.stage_config.get('devices', {}).items()):
            self._process_device(dev_name, dev_cfg, i, audio)

    def _process_device(self, dev_name, dev_cfg, zone_idx, audio):
        fixture = self.fixtures.get(dev_cfg.get('type'))
        if not fixture: return

        base_addr = dev_cfg['address'] + dev_cfg['offset']
        
        # Gather Active System Triggers for Preset Overlays
        active_triggers = []
        
        # 1. Transients (Drops, Tension, Building)
        # if self.transient and self.transient != 'steady':
        #     active_triggers.append(f"transient:{self.transient}")
            
        # 2. Bass Styles (Machine Gun, Tearout, Wonky, Sub)
        if self._current_bass_style:
            active_triggers.append(f"bass_style:{self._current_bass_style}")
            
        # 3. Rhythms (Boots, Cats, Cha)
        for k, v in self.rhythm_state.items():
            if v: active_triggers.append(f"rhythm:{k}")
            
        # 4. Global Vibe (Chill, Mid, High)
        current_vibe = audio.get('vibe', 'mid')
        active_triggers.append(f"vibe:{current_vibe}")
        
        for role, ch_offset in fixture.get('channels', {}).items():
            final_addr = base_addr + ch_offset
            
            # Layer 0: Determine Spatial Position (Left, Right, Center)
            pos = dev_cfg.get('position', 'center')
            if pos == 'left':
                active_audio = audio.get('left', audio)
                active_logic = self.logic_l
            elif pos == 'right':
                active_audio = audio.get('right', audio)
                active_logic = self.logic_r
            else:
                active_audio = audio
                active_logic = self.logic

            # Layer 1: Calculate the pure mapped math value
            val = self._calculate_channel(role, active_audio, active_logic, zone_idx, fixture, dev_cfg, dev_cfg.get('type'))
            
            # Layer 2: Preset Overrides (Manual UI Triggers & System Triggers)
            # BYPASS: If the channel is set to 'controller', we skip presets to allow absolute control
            cache = self._fast_cache.get(dev_cfg.get('type'), {}).get(role, {})
            is_controller = cache.get('mod_name') == 'controller'
            
            preset_override_val = None
            if not is_controller:
                # Helper to verify preset applies to this specific hardware profile, fixture, or behavior
                def is_preset_applicable(p_data, d_name):
                    target_fixtures = p_data.get('target_fixtures')
                    if target_fixtures is not None:
                        return d_name in target_fixtures
                    
                    prof_match = p_data.get('profile') is None or p_data.get('profile') == dev_cfg.get('type')
                    beh_match = p_data.get('target_behavior') is None or p_data.get('target_behavior') == dev_cfg.get('behavior', 'lead')
                    
                    return prof_match and beh_match
                
                #   A. Check standard active scene first (Base Overlay)
                scene_name = getattr(self, 'current_scene_name', '')
                if scene_name.startswith('PRESET:'):
                    p_name = scene_name.replace('PRESET:', '')
                    p_data = self.presets.get(p_name, {})
                    
                    if is_preset_applicable(p_data, dev_name):
                        # Check for fixture-specific override first, then fallback to global channels
                        p_fixture_data = p_data.get('fixture_payloads', {}).get(dev_name)
                        if p_fixture_data and role in p_fixture_data:
                            preset_override_val = p_fixture_data[role]
                        elif role in p_data.get('channels', {}):
                            preset_override_val = p_data['channels'][role]
                        
                #   B. Check System Triggers (Higher Priority than Base Scene)
                # Iterate all presets to see if their 'trigger' matches our active_triggers
                for p_name, p_data in self.presets.items():
                    p_trigger = p_data.get('trigger')
                    # Legacy: presets with only a 'vibe' field and no 'trigger'
                    if not p_trigger and p_data.get('vibe'):
                        vibe_val = p_data['vibe']
                        # Map known vibe names to proper trigger format
                        VIBE_TRIGGER_MAP = {
                            # 'drop': 'transient:dropping', 'dropping': 'transient:dropping',
                            # 'building': 'transient:building', 'tension': 'transient:tension',
                            'machine_gun': 'bass_style:machine_gun', 'tearout': 'bass_style:tearout',
                            'wonky': 'bass_style:wonky', 'sub': 'bass_style:sub',
                        }
                        p_trigger = VIBE_TRIGGER_MAP.get(vibe_val, f"vibe:{vibe_val}")
                    if p_trigger and p_trigger in active_triggers:
                        if is_preset_applicable(p_data, dev_name):
                            # Check for fixture-specific override first, then fallback to global channels
                            p_fixture_data = p_data.get('fixture_payloads', {}).get(dev_name)
                            if p_fixture_data and role in p_fixture_data:
                                preset_override_val = p_fixture_data[role]
                            elif role in p_data.get('channels', {}):
                                preset_override_val = p_data['channels'][role]
                            
                if preset_override_val is not None:
                    val = preset_override_val
                
            # Layer 3: Global Override (Live Test Tab - Absolute Highest Priority)
            if final_addr in self.overrides:
                val = self.overrides[final_addr]

            # Write to DMX buffer safely
            if 0 < final_addr < len(self.universe):
                self.universe[final_addr] = max(0, min(255, val))

    def _calculate_channel(self, role, audio, logic_matrix, zone_idx, fixture, dev_cfg, fixture_name):
        """The Universal Mapper: Subscribes to the Logic Matrix and applies 3-point scaling."""
        
        # Fetch Pre-compiled Routing & Calibration Config
        cache = self._fast_cache.get(fixture_name, {}).get(role, {})
        mod_name = cache.get('mod_name', 'static')
        cals = cache.get('cals', [])

        # --- CONTROLLER MODIFIER BYPASS ---
        # Channels with this selection WON'T be influenced by audio
        if mod_name == 'controller':
            if not cals: return 0
            
            # Manage latch index for this role
            if role not in self.channel_latches:
                self.channel_latches[role] = 0
            
            # D-pad Up/Down cycles the active range in the calibration list
            dpad_up = self.gamepad.get('dpad_up', 0) > 0.5 and not (self.prev_gamepad.get('dpad_up', 0) > 0.5)
            dpad_down = self.gamepad.get('dpad_down', 0) > 0.5 and not (self.prev_gamepad.get('dpad_down', 0) > 0.5)
            
            if dpad_up:
                self.channel_latches[role] = (self.channel_latches[role] + 1) % len(cals)
            elif dpad_down:
                self.channel_latches[role] = (self.channel_latches[role] - 1) % len(cals)

            # Get the currently selected mapping
            l_idx = self.channel_latches[role]
            mapping = cals[l_idx % len(cals)]
            
            control_id = mapping.get('control', 'static')
            m_min = int(mapping.get('min', 0))
            m_max = int(mapping.get('max', 255))
            
            # 1. STATIC MODE
            if control_id == 'static': return m_max
            
            # 2. INPUT MAPPING
            raw_val = self.gamepad.get(control_id, 0.0)
            
            # Joysticks: CENTER RESET with Deadzone
            if control_id in ['ls_x', 'ls_y', 'rs_x', 'rs_y']:
                norm = abs(raw_val - 0.5) * 2.0
                if norm < 0.1: norm = 0.0 # 10% Deadzone
                return int(m_min + (norm * (m_max - m_min)))
                
            # Triggers & Buttons: MOMENTARY
            else:
                return int(m_min + (raw_val * (m_max - m_min)))

        # --- AUDIO MAPPING LOGIC (Bypassed if Controller Mod active) ---
        current_vibe = audio.get('vibe', 'mid')
        active_range = None
        
        # Priority: Specific Vibe match, then 'any'
        for c in cals:
            if c.get('vibe') == current_vibe:
                active_range = c
                break
        if not active_range:
            for c in cals:
                if c.get('vibe', 'any') == 'any':
                    active_range = c
                    break
        
        # 3. Gating Logic: If no match, return 0 (ignores modifier until match) 
        if not active_range:
            return 0
            
        c_min = active_range.get('min')
        if c_min is None: c_min = 0
        
        default_val = cache.get('default_val', 127)
            
        c_center = active_range.get('center')
        if c_center is None: c_center = default_val
        
        c_max = active_range.get('max')
        if c_max is None: c_max = 255
        
        # --- DISCRETE HANDLERS (Arrays/Lookups) ---
        if mod_name == '4th beat':
            steps = cache.get('steps', [])
            if not steps: 
                # Fallback: slow cycle between min and max if no steps defined
                span = c_max - c_min
                cycle_len = 16 # 16 beats per full cycle
                val = c_min + ((logic_matrix.beat_count // 4) % 4) * (span // 4)
                return max(c_min, min(c_max, int(val)))
                
            # Random selection every 4 beats (seeded for stability)
            seed = (logic_matrix.beat_count // 4) + zone_idx + 42
            rng = random.Random(seed)
            val = rng.choice(steps)
            return max(c_min, min(c_max, val))
            
        if mod_name == 'beat':
            steps = cache.get('steps', [])
            if steps:
                # Random selection every beat (seeded for stability)
                seed = logic_matrix.beat_count + zone_idx + 7
                rng = random.Random(seed)
                val = rng.choice(steps)
                return max(c_min, min(c_max, val))

            # Legacy Fallback: Cycle through the range [c_min, c_max]
            if c_max <= c_min: return c_min
            span = c_max - c_min
            val = c_min + ((logic_matrix.beat_count * 17 + zone_idx * 13) % (span + 1))
            return max(c_min, min(c_max, val))

        # --- STATE MACHINE HANDLER (For Mode/Dimmer Combo Channels) ---
        if mod_name == 'state_machine':
            states = cache.get('states', {})
            
            # Helper to get sanitized state value
            def get_state_val(key, default):
                v = states.get(key)
                return v if v is not None else default

            # 1. Master Blackout (Tension state or UI Master Intensity slider)
            # The LogicMatrix outputs intensity from -1.0 to 1.0
            # if self.transient == 'tension' or logic_matrix.state.get('intensity', 1.0) < -0.8:
            if logic_matrix.state.get('intensity', 1.0) < -0.8:
                off_val = get_state_val('off', 0)
                if isinstance(off_val, list):
                    return off_val[0] if off_val and off_val[0] is not None else 0
                return off_val
            
            # 2. Standard Playback (Vibe based selection)
            # (Note: Drops are now handled via Preset Overlays rather than hardcoded logic)
            current_vibe = audio.get('vibe', 'mid')
            return get_state_val(current_vibe, get_state_val('default', 254))

        # --- THE FOLLOWING LOGIC IS BYPASSED IF CONTROLLER MOD IS ACTIVE ---

        # --- CONTINUOUS MATH MAPPING ---
        if mod_name == 'static':
            return c_center
            
        if mod_name == 'lfo':
            lfo_id = f"{fixture_name}_{role}"
            val_norm = logic_matrix.state.get(lfo_id, 0.0)
            

                    

        else:
            val_norm = logic_matrix.state.get(mod_name, 0.0)

        # 3-Point Calibration Map
        # Clamps normalized signal to -1.0 to 1.0
        val_norm = max(-1.0, min(1.0, val_norm))
        
        if val_norm < 0:
            # Scale -1.0 to 0.0 against Min -> Center
            out = c_center + val_norm * (c_center - c_min)
        else:
            # Scale 0.0 to 1.0 against Center -> Max
            out = c_center + val_norm * (c_max - c_center)
            
        # Final safety clamp to hardware calibration bounds
        return max(c_min, min(c_max, int(out)))

    # --- STANDARD ENGINE FUNCTIONS ---
    def get_universe(self): return self.universe[:]
    def set_intensity(self, val): self.intensity = float(val)
    def set_speed(self, val): self.speed = float(val)
    def set_audio_sensitivity(self, val): self.audio_sensitivity = float(val)
    def set_pattern_mode(self, mode): pass # Deprecated, handled by modifiers now
    def set_color_mode(self, mode): pass # Deprecated, handled by modifiers now
    
    def get_channel_state(self):
        res = {"values": {}, "effects": []}
        for name, cfg in self.stage_config.get('devices', {}).items():
            fixture = self.fixtures.get(cfg.get('type'))
            if not fixture: continue
            base = cfg['address'] + cfg['offset']
            for role, off in fixture.get('channels', {}).items():
                addr = base + off
                if 0 < addr < len(self.universe): res["values"][f"{name}_{role}"] = self.universe[addr]
        return res

    def _detect_bass_style(self, audio, dt):
        bins = audio.get('bins', [0.0] * 11)
        isolation = audio.get('isolation', 0.0)
        bass = audio.get('bass', 0.0)
        mid = audio.get('mid', 0.0)

        self._bass_bins_history.append(bass)
        prev_bass = self._bass_bins_history[-2] if len(self._bass_bins_history) >= 2 else 0.0
        bass_delta = abs(bass - prev_bass)
        self._bass_delta_history.append(bass_delta)
        self._mid_history.append(mid)

        if self._bass_style_holdoff > 0:
            self._bass_style_holdoff -= dt
            return

        detected = None
        if bins[0] > 0.5 and sum(bins[4:]) < 0.2 and isolation > 0.5:
            detected = 'sub'
        elif bass > 0.4 and sum(bins[5:]) > 1.2 and isolation < 0.35:
            detected = 'tearout'
        elif len(self._bass_delta_history) >= 15:
            deltas = list(self._bass_delta_history)
            avg_delta = sum(deltas) / len(deltas)
            crossings = sum(1 for i in range(1, len(deltas)) if (deltas[i] > avg_delta * 1.5) != (deltas[i-1] > avg_delta * 1.5))
            if crossings > 8 and bass > 0.25 and avg_delta > 0.08:
                detected = 'machine_gun'
                
        if detected is None and len(self._mid_history) >= 15 and bass > 0.3:
            mids = list(self._mid_history)
            sign_changes = 0
            for i in range(2, len(mids)):
                d1 = mids[i] - mids[i-1]
                d2 = mids[i-1] - mids[i-2]
                if (d1 > 0.02 and d2 < -0.02) or (d1 < -0.02 and d2 > 0.02):
                    sign_changes += 1
            bass_sustained = min(self._bass_bins_history) > 0.15 if len(self._bass_bins_history) >= 10 else False
            if sign_changes > 5 and bass_sustained:
                detected = 'wonky'

        if detected != self._current_bass_style:
            self._current_bass_style = detected
            self._bass_style_holdoff = 0.5 if detected else 0.0

    def apply_overrides(self, ol, sl=[]):
        for o in ol:
            if 'address' in o:
                self.overrides[int(o['address'])] = int(o.get('value', 0))
            else:
                z_idx = int(o.get('zone', 1))
                if z_idx <= len(self.zone_map):
                    dev_cfg = self.stage_config['devices'][self.zone_map[z_idx - 1]]
                    self.overrides[dev_cfg['address'] + dev_cfg['offset'] + int(o.get('channel', 1)) - 1] = int(o.get('value', 0))

    def clear_device_overrides(self, dev_name):
        dev_cfg = self.stage_config.get('devices', {}).get(dev_name)
        fixture = self.fixtures.get(dev_cfg.get('type')) if dev_cfg else None
        if not fixture: return
        base = dev_cfg['address'] + dev_cfg['offset']
        for ch_offset in fixture.get('channels', {}).values():
            if base + ch_offset in self.overrides: del self.overrides[base + ch_offset]