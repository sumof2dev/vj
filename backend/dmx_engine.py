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

class LogicMatrix:
    """The modular core. Generates continuous LFOs and Envelopes."""
    def __init__(self):
        self.phases = {'A': 0.0, 'B': 0.0, 'C': 0.0}
        self.beat_env = 0.0
        self.beat_count = 0
        self.state = {}

    def update(self, dt, audio, transient, speed_mult=1.0, master_intensity=1.0):
        # 1. Update Beat Envelope (Sharp attack, exponential decay)
        if audio.get('beat', False):
            self.beat_env = 1.0
            self.beat_count += 1
        else:
            self.beat_env = max(0.0, self.beat_env - (4.0 * dt))

        # 2. Extract EQ Bins
        bins = audio.get('bins', [0.0]*11)
        sub_nrg = (bins[0] + bins[1]) / 2.0
        mid_nrg = (bins[3] + bins[4] + bins[5]) / 3.0
        hi_nrg  = (bins[8] + bins[9] + bins[10]) / 3.0

        # 3. Calculate Frequencies (Vibe-independent static ratios)
        freq_a = 0.2 * speed_mult
        freq_b = 0.5 * speed_mult
        freq_c = 1.0 * speed_mult

        # 4. Advance Phases
        self.phases['A'] += dt * freq_a
        self.phases['B'] += dt * freq_b
        self.phases['C'] += dt * freq_c

        axis_a = math.sin(self.phases['A'])
        axis_d = math.sin(self.phases['A'] + math.pi/2)
        axis_b = math.sin(self.phases['B'])
        axis_e = math.sin(self.phases['B'] + math.pi/2)
        axis_c = math.sin(self.phases['C'])
        
        intensity_val = (master_intensity * 2.0) - 1.0

        if transient == 'tension':
            axis_a = 0.0
            axis_b = 0.0
            axis_c = 0.0
            axis_d = 0.0
            axis_e = 0.0
            intensity_val = -1.0

        # 5. Generate Raw Matrix Output
        self.state = {
            # Bipolar (-1.0 to 1.0)
            'axis_a': axis_a,
            'axis_d': axis_d,
            
            'axis_b': axis_b,
            'axis_e': axis_e,
            
            'axis_c': axis_c,
            
            'intensity': intensity_val,
            
            # Unipolar (0.0 to 1.0)
            'bass': audio.get('bass', 0.0),
            'flux': audio.get('flux', 0.0),
            'beat': self.beat_env,
            
            # Constants
            'static': 1.0,
            'zero': 0.0,
            'dimmer': 1.0,
            'mode': 0.0
        }

class DMXEngine:
    def __init__(self):
        self.universe = bytearray(513)
        self.universe[0] = 0x00
        self.overrides = {}
        self._dt = 0.016
        
        # Engines
        self.logic = LogicMatrix()
        
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
        
        # System State Detectors (Bass Styles & Rhythm)
        self._bass_bins_history = collections.deque(maxlen=30)
        self._bass_delta_history = collections.deque(maxlen=30)
        self._mid_history = collections.deque(maxlen=30)
        self._current_bass_style = None
        self._bass_style_holdoff = 0.0
        self.rhythm_state = {'boots': False, 'cats': False, 'cha': False}
        
        # Config Storage
        self.fixtures = {}
        self.stage_config = {}
        self.presets = {}
        self.zone_map = []
        
        self._stage_config_path = os.path.join('fixtures', 'stage_config.json')
        self._presets_config_path = os.path.join('fixtures', 'presets.json')
        self._last_reload_check = 0
        self._fixture_mtimes = {} 
        
        self._load_profiles()

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
                    self.fixtures[filename.replace('.json', '')] = json.load(f)

    def _check_for_reload(self):
        """Checks if fixture or stage config files have changed on disk."""
        now = time.time()
        if now - self._last_reload_check < 2.0: return
        self._last_reload_check = now

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

    def update(self, dt: float, audio: Dict, visual_states: Dict = None):
        self._dt = dt
        self.transient = audio.get('transient', 'steady')

        # 0. Check for disk changes (Hot Reload)
        self._check_for_reload()

        # 1. Update the pure math core
        self.logic.update(dt, audio, self.transient, self.speed, self.intensity)
        
        # 1.5 Update System Triggers (Bass Styles & Rhythm)
        self._detect_bass_style(audio, dt)
        
        bass_hit = audio.get('bass_onset', False)
        high_hit = audio.get('high_onset', False)
        self.rhythm_state['boots'] = bass_hit and not high_hit
        self.rhythm_state['cats'] = high_hit and not bass_hit
        self.rhythm_state['cha'] = bass_hit and high_hit
        
        # 2. Check for EDM Drops
        if self.transient == 'dropping' and not self._one_shot_active:
            if time.time() - self._last_drop_time > 8.0:
                self._one_shot_active = True
                self._last_drop_time = time.time()
                # Randomize visual layers on drop
                self.current_base_layer = random.choice([0,1,2,3,4,5,6,7,8,9,10])
                self.current_fx_layer = random.choice([0,1,2,3,5,6])
                
        if self._one_shot_active and time.time() - self._last_drop_time > 2.0:
            self._one_shot_active = False

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
        if self.transient and self.transient != 'steady':
            active_triggers.append(f"transient:{self.transient}")
            
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
            
            # Layer 1: Calculate the pure mapped math value
            val = self._calculate_channel(role, audio, zone_idx, fixture, dev_cfg)
            
            # Layer 2: Preset Overrides (Manual UI Triggers & System Triggers)
            preset_override_val = None
            
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

    def _calculate_channel(self, role, audio, zone_idx, fixture, dev_cfg):
        """The Universal Mapper: Subscribes to the Logic Matrix and applies 3-point scaling."""
        
        # 1. Fetch Routing Config
        mod_dict = fixture.get('modifiers', {})
        mod_name = mod_dict.get(role) if role in mod_dict else 'static'
        if not mod_name: mod_name = 'static'
        
        # 2. Calibration Range Selection (Vibe Gating)
        cals = fixture.get('calibration', {}).get(role, [])
        if isinstance(cals, dict): # Migration for single object calibration
            cals = [cals]
        
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
        
        default_val = fixture.get('defaults', {}).get(role)
        if default_val is None:
            default_val = 127
            
        c_center = active_range.get('center')
        if c_center is None: c_center = default_val
        
        c_max = active_range.get('max')
        if c_max is None: c_max = 255
        
        # --- DISCRETE HANDLERS (Arrays/Lookups) ---
        if mod_name == '4th beat':
            steps = list(fixture.get('step_data', {}).values())
            if not steps: 
                # Fallback: slow cycle between min and max if no steps defined
                span = c_max - c_min
                cycle_len = 16 # 16 beats per full cycle
                val = c_min + ((self.logic.beat_count // 4) % 4) * (span // 4)
                return max(c_min, min(c_max, int(val)))
                
            # Random selection every 4 beats (seeded for stability)
            seed = (self.logic.beat_count // 4) + zone_idx + 42
            rng = random.Random(seed)
            val = rng.choice(steps)
            return max(c_min, min(c_max, val))
            
        if mod_name == 'beat':
            steps = list(fixture.get('step_data', {}).values())
            if steps:
                # Random selection every beat (seeded for stability)
                seed = self.logic.beat_count + zone_idx + 7
                rng = random.Random(seed)
                val = rng.choice(steps)
                return max(c_min, min(c_max, val))

            # Legacy Fallback: Cycle through the range [c_min, c_max]
            if c_max <= c_min: return c_min
            span = c_max - c_min
            val = c_min + ((self.logic.beat_count * 17 + zone_idx * 13) % (span + 1))
            return max(c_min, min(c_max, val))

        # --- STATE MACHINE HANDLER (For Mode/Dimmer Combo Channels) ---
        if mod_name == 'state_machine':
            states = fixture.get('state_data', {}).get(role, {})
            
            # Helper to get sanitized state value
            def get_state_val(key, default):
                v = states.get(key)
                return v if v is not None else default

            # 1. Master Blackout (Tension state or UI Master Intensity slider)
            # The LogicMatrix outputs intensity from -1.0 to 1.0
            if self.transient == 'tension' or self.logic.state.get('intensity', 1.0) < -0.8:
                off_val = get_state_val('off', 0)
                if isinstance(off_val, list):
                    return off_val[0] if off_val and off_val[0] is not None else 0
                return off_val
            
            # 2. Standard Playback (Vibe based selection)
            # (Note: Drops are now handled via Preset Overlays rather than hardcoded logic)
            current_vibe = audio.get('vibe', 'mid')
            return get_state_val(current_vibe, get_state_val('default', 254))

        # --- CONTINUOUS MATH MAPPING ---
        if mod_name == 'static':
            return c_center
            
        val_norm = self.logic.state.get(mod_name, 0.0)
        
        # Apply Hardware Inversions cleanly via the Logic Matrix Axis instead of string name
        if mod_name == 'axis_a' and dev_cfg.get('invert_x'):
            val_norm = -val_norm
        if mod_name == 'axis_b' and dev_cfg.get('invert_y'):
            val_norm = -val_norm
                
        # PROCEDURAL DROP AMPLITUDE BOOST: Maximize the math sweep if music is intense
        # (Explicit shapes and macros should now be triggered via UI Presets, not here)
        if self.transient == 'dropping' or self._one_shot_active:
            val_norm = max(-1.0, min(1.0, val_norm * 2.0))

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
        if bins[0] > 0.8 and sum(bins[4:]) < 0.2 and isolation > 0.7:
            detected = 'sub'
        elif bass > 0.7 and sum(bins[5:]) > 2.0 and isolation < 0.2:
            detected = 'tearout'
        elif len(self._bass_delta_history) >= 15:
            deltas = list(self._bass_delta_history)
            avg_delta = sum(deltas) / len(deltas)
            crossings = sum(1 for i in range(1, len(deltas)) if (deltas[i] > avg_delta * 1.5) != (deltas[i-1] > avg_delta * 1.5))
            if crossings > 8 and bass > 0.4 and avg_delta > 0.15:
                detected = 'machine_gun'
                
        if detected is None and len(self._mid_history) >= 15 and bass > 0.5:
            mids = list(self._mid_history)
            sign_changes = 0
            for i in range(2, len(mids)):
                d1 = mids[i] - mids[i-1]
                d2 = mids[i-1] - mids[i-2]
                if (d1 > 0.02 and d2 < -0.02) or (d1 < -0.02 and d2 > 0.02):
                    sign_changes += 1
            bass_sustained = min(self._bass_bins_history) > 0.3 if len(self._bass_bins_history) >= 10 else False
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