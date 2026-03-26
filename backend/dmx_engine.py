import time
import math
import random
import os
import json
import collections
from typing import Dict
import threading

class ChannelConfig:
    """Pre-resolved channel mapping rules for hot-loop performance."""
    __slots__ = ['mod_name', 'rules', 'states', 'default_val', 'is_controller', 'smoothing', 'threshold']
    def __init__(self, rules, states, default_val, smoothing=0.0, threshold=0.0, mod_name='static'):
        self.rules = rules # List of dicts: layer, mod, vibe, cal: [min, center, max], lfo, state_map, etc.
        self.states = states
        self.default_val = default_val
        self.is_controller = False
        self.smoothing = smoothing
        self.threshold = threshold
        self.mod_name = mod_name

    def get_active_rule(self, current_vibe):
        """Returns the specific vibe rule if it exists, otherwise falls back to 'any'."""
        fallback = None
        for r in self.rules:
            if r.get('vibe') == current_vibe:
                return r
            if r.get('vibe') == 'any' and fallback is None:
                fallback = r
        return fallback

class LogicMatrix:
    # Same as before
    def __init__(self):
        self.phases = collections.defaultdict(float)
        self.beat_env = 0.0
        self.beat_count = 0
        self.state = {}
        self.hold_timers = collections.defaultdict(float)
        self.hold_values = collections.defaultdict(float)

    def update(self, dt, audio, transient, speed_mult=1.0, master_intensity=1.0, active_lfos=None):
        if audio.get('beat', False):
            self.beat_env = 1.0
            self.beat_count += 1
        else:
            self.beat_env = max(0.0, self.beat_env - (4.0 * dt))

        bins = audio.get('bins', [0.0]*11)

        self.state = {}
        if active_lfos:
            for lfo_id, cfg in active_lfos.items():
                shape = cfg.get('shape', 'sine')
                bin_idx = int(cfg.get('bin', 0))
                base_speed = float(cfg.get('speed', 0.5))
                reactivity = float(cfg.get('react', 0.5))
                invert = cfg.get('invert', False)
                
                # Removed raw_bin_map. Using direct 6-band native mapping.
                bin_energy = bins[bin_idx] if bin_idx < len(bins) else 0.0
                
                return_to_min = cfg.get('return_to_min', False)
                threshold = float(cfg.get('threshold', 0.1))
                
                if return_to_min and bin_energy < threshold:
                    target_val = 1.0 if invert else -1.0
                    current_val = self.state.get(lfo_id, 0.0)
                    decay_rate = dt * reactivity * 10.0
                    if current_val < target_val: val = min(target_val, current_val + decay_rate)
                    else: val = max(target_val, current_val - decay_rate)
                    freq = 0
                else:
                    freq = (base_speed + (bin_energy * reactivity))
                    if base_speed == 0 and freq < 0.05:
                        p_current = (self.phases[lfo_id] / (2 * math.pi)) % 1.0
                        should_complete = False
                        if shape == 'sawtooth' and p_current > 0.05: should_complete = True
                        elif shape == 'triangle' and abs(p_current - 0.5) > 0.05: should_complete = True
                        elif shape == 'square' and p_current < 0.5: should_complete = True
                        if should_complete: freq = 10.0
                        else: freq = 0.0

                    self.phases[lfo_id] += dt * freq * 2.0 * math.pi
                    p = (self.phases[lfo_id] / (2 * math.pi)) % 1.0
                    if shape == 'sawtooth': val = (p * 2.0) - 1.0
                    elif shape == 'triangle': val = 4.0 * abs(p - 0.5) - 1.0
                    elif shape == 'square': val = 1.0 if p < 0.5 else -1.0
                    else: val = math.sin(self.phases[lfo_id])

                    if invert: val = -val
                    amp_scale = (1.0 - reactivity) + (bin_energy * reactivity * 2.0)
                    val = val * max(0.0, min(1.0, amp_scale))
                    
                hold_time = float(cfg.get('hold', 0.0))
                if hold_time > 0:
                    self.hold_timers[lfo_id] += dt
                    if self.hold_timers[lfo_id] >= hold_time or lfo_id not in self.hold_values:
                        self.hold_timers[lfo_id] = 0
                        self.hold_values[lfo_id] = val
                    val = self.hold_values[lfo_id]
                else:
                    self.hold_timers.pop(lfo_id, None)
                    self.hold_values.pop(lfo_id, None)

                self.state[lfo_id] = val

        intensity_val = (master_intensity * 2.0) - 1.0
        intensity_val = (master_intensity * 2.0) - 1.0
        self.state.update({
            'intensity': intensity_val,
            'bass': (audio.get('bass', 0.0) * 2.0) - 1.0,
            'flux': (audio.get('flux', 0.0) * 2.0) - 1.0,
            'beat': (self.beat_env * 2.0) - 1.0,
            'audio': (audio.get('vol', 0.0) * 2.0) - 1.0,
            'frequency': (max(audio.get('bins', [0.0]*6)[:6]) * 2.0) - 1.0 if audio.get('bins') else -1.0,
            'static': 1.0,
            'zero': -1.0,
            'dimmer': 1.0,
            'mode': -1.0
        })

class DMXEngine:
    def __init__(self):
        self.universe = bytearray(513)
        self.universe[0] = 0x00
        self.overrides = {}
        self._dt = 0.016
        
        self.logic = LogicMatrix()
        self.logic_l = LogicMatrix()
        self.logic_r = LogicMatrix()
        
        self.intensity = 1.0
        self.speed = 0.6 
        self.scene_freq = 1
        self.audio_sensitivity = 1.0
        self.transient = "steady" 
        
        self._one_shot_active = False
        self._last_drop_time = 0.0
        self.current_base_layer = 0 
        self.current_fx_layer = 6  
        self.current_fg_layer = 0
        self.rot_state = 'IDLE' 
        self._last_scene_switch_beat = 0
        self._last_vibe = 'mid'
        self._last_transient = 'steady'
        self._preset_holds = {}
        self._silence_start = None
        
        # Removed legacy rhythm and bass style history
        
        # New V2 Arrays
        self.fixtures = {}
        self.profiles = {}
        self.stage_instances = []
        self.presets = []
        
        self.active_lfos = {}
        
        self.gamepad = {}
        self.prev_gamepad = {}
        self.channel_latches = {}
        self.prev_vals = collections.defaultdict(float)
        
        self._config_path = os.path.join('fixtures', 'ravebox_config.json')
        self._fixture_mtime = 0
        self._fast_cache = {} # Map[profile_id][channel_idx] -> ChannelConfig
        self.active_presets = [] # List of preset objects active in the current frame
        
        self._load_profiles()
        
        self._reload_thread = threading.Thread(target=self._hot_reload_loop, daemon=True)
        self._reload_thread.start()

    def _load_profiles(self):
        if not os.path.exists(self._config_path): return

        try:
            with open(self._config_path, 'r') as f:
                data = json.load(f)
        except Exception as e:
            print(f"Failed to parse config: {e}")
            return

        self.fixtures = {f['id']: f for f in data.get('fixtures', [])}
        self.profiles = {p['id']: p for p in data.get('profiles', [])}
        self.stage_instances = data.get('stage', [])
        self.presets = data.get('presets', [])
        
        # Determine highest channel address from stage instead of dict iteration
        self.zone_map = [inst['id'] for inst in self.stage_instances]
        print(f"📦 DMX Engine Loaded V2 Config! Instances: {len(self.stage_instances)}")
        
        self._build_fast_cache()

    def _build_fast_cache(self):
        self._fast_cache = {}
        self.active_lfos = {}
        
        for p_id, profile in self.profiles.items():
            self._fast_cache[p_id] = {}
            fixture = self.fixtures.get(profile.get('fixtureId'))
            if not fixture: continue
            
            mappings = profile.get('mappings', [])
            for ch_idx, channels in enumerate(fixture.get('channels', [])):
                if ch_idx < len(mappings):
                    rules = mappings[ch_idx]
                else:
                    rules = []
                    
                for rule_idx, rule in enumerate(rules):
                    mod_name = rule.get('mod', 'static')
                    if mod_name == 'lfo':
                        lfo_id = f"{p_id}_{ch_idx}_{rule_idx}"
                        lfo_cfg = rule.get('lfo', {})
                        self.active_lfos[lfo_id] = lfo_cfg
                        # Inject lfo_id directly into rule for fast lookup
                        rule['_lfo_id'] = lfo_id
                        
                default_val = 127
                self._fast_cache[p_id][ch_idx] = ChannelConfig(
                    rules=rules,
                    states={}, # State machine maps handled inside specific rules now
                    default_val=default_val,
                    smoothing=0.0,
                    threshold=0.0
                )

    def _hot_reload_loop(self):
        while True:
            time.sleep(2.0)
            if not os.path.exists(self._config_path): continue
            try: mtime = os.path.getmtime(self._config_path)
            except: continue
                
            if self._fixture_mtime != mtime:
                self._fixture_mtime = mtime
                print("🔄 Changes detected in ravebox_config.json. Reloading...")
                self._load_profiles()

    def update(self, dt: float, audio: Dict, visual_states: Dict = None, gamepad: Dict = None):
        self._dt = dt
        self.prev_gamepad = self.gamepad
        self.gamepad = gamepad or {}
        self.transient = audio.get('transient', 'steady')
        current_vibe = audio.get('vibe', 'mid')

        # Global Silence Tracking
        vol = audio.get('vol', 0.0)
        if vol < 0.03:
            if not hasattr(self, '_silence_timer'): self._silence_timer = 0
            self._silence_timer += dt
            if self._silence_timer > 2.0: self._global_silence = True
            else: self._global_silence = False
        else:
            self._silence_timer = 0
            self._global_silence = False

        self.logic.update(dt, audio, self.transient, self.speed, self.intensity, self.active_lfos)
        
        # Pre-calculate active presets (Global check once per frame)
        self.active_presets = []
        active_triggers = [f"vibe:{current_vibe}"]
        if self.transient: active_triggers.append(f"state:{self.transient}") # Support state triggers correctly

        for p_data in self.presets:
            triggers = p_data.get('triggers', [])
            if p_data.get('trigger'): triggers = [p_data.get('trigger')] # Legacy support
            
            is_active = False
            for trig in triggers:
                t_cat = trig.get('category') or trig.get('type')
                if t_cat == 'vibe' and trig.get('vibe') == current_vibe:
                    is_active = True
                elif t_cat == 'state' and (trig.get('state') == self.transient or trig.get('value') == self.transient):
                    is_active = True
                elif t_cat == 'volume':
                    target_v = trig.get('value', 'mid')
                    v = audio.get('vol', 0.0)
                    r = float(trig.get('range', 5)) / 100.0 # Convert UI percentage to 0.0-1.0
                    
                    if target_v == 'silence':
                        # Active from 0% to r%
                        if v <= r: is_active = True
                    elif target_v == 'loud':
                        # Active from (1.0 - r) to 1.0
                        if v >= (1.0 - r): is_active = True
                    elif target_v == 'mid':
                        # Active within +/- r/2 around 0.5
                        if abs(v - 0.5) <= (r / 2.0): is_active = True
                elif t_cat == 'bin':
                    bin_idx = int(trig.get('bin', 0))
                    threshold = float(trig.get('threshold', 0.8))
                    bins = audio.get('bins', [0.0]*11)
                    if bin_idx < len(bins) and bins[bin_idx] >= threshold:
                        is_active = True
                
                if is_active: break
                
            if is_active:
                self.active_presets.append(p_data)

        if 'left' in audio and 'right' in audio:
            self.logic_l.update(dt, audio['left'], self.transient, self.speed, self.intensity, self.active_lfos)
            self.logic_r.update(dt, audio['right'], self.transient, self.speed, self.intensity, self.active_lfos)
        else:
            self.logic_l = self.logic
            self.logic_r = self.logic
        
        # Removed legacy rhythm triggers
        
        should_switch = False
        current_beat = audio.get('beat_count', 0)
        beats_passed = current_beat - self._last_scene_switch_beat
        
        if self.scene_freq == 0 and beats_passed >= 1: should_switch = True
        elif self.scene_freq == 1 and beats_passed >= 4: should_switch = True
        elif self.scene_freq == 2 and beats_passed >= 8: should_switch = True
        elif self.scene_freq == 3 and beats_passed >= 16: should_switch = True
        elif self.scene_freq == 4 and self.transient != self._last_transient and self.transient in ['dropping', 'building']: should_switch = True

        if visual_states:
            if visual_states.get("bg", -1) != -1: self.current_base_layer = visual_states["bg"]
            if visual_states.get("fx", -1) != -1: self.current_fx_layer = visual_states["fx"]
            if visual_states.get("fg", -1) != -1: self.current_fg_layer = visual_states["fg"]

        if should_switch:
            if not visual_states or visual_states.get("bg", -1) == -1:
                # Dynamically include Spotify (Layer 11) only if metadata is present
                choices = [0,1,2,3,4,5,6,7,8,9,10]
                if audio.get('spotify'):
                    choices.append(11)
                self.current_base_layer = random.choice(choices)
            if not visual_states or visual_states.get("fx", -1) == -1:
                self.current_fx_layer = random.choice([0,1,2,3,5,6])
            self._last_scene_switch_beat = current_beat
            
        self._last_vibe = current_vibe
        self._last_transient = self.transient

        # Process All Instances
        for i, inst in enumerate(self.stage_instances):
            self._process_instance(inst, i, audio)

        for addr, val in self.overrides.items():
            if 0 < addr < len(self.universe):
                self.universe[addr] = max(0, min(255, int(val)))

    def _process_instance(self, inst, zone_idx, audio):
        profile = self.profiles.get(inst.get('profileId'))
        fixture = self.fixtures.get(inst.get('fixtureId'))
        if not profile or not fixture: return

        try:
            base_addr = int(inst.get('address', 1)) + int(inst.get('offset', 0))
        except: return
        
        active_triggers = []
        current_vibe = audio.get('vibe', 'mid')
        active_triggers.append(f"vibe:{current_vibe}")
        
        for ch_idx, ch_def in enumerate(fixture.get('channels', [])):
            # Use addrOffset if provided explicitly, otherwise fallback to index relative to base_addr
            offset = ch_def.get('addrOffset')
            if offset is None: offset = ch_idx
            
            final_addr = base_addr + int(offset)
            if not (0 < final_addr < len(self.universe)): continue
            
            # Simple global routing - Left/Right/Center usually inferred from zone name for now
            zone_str = str(inst.get('zone', '')).lower()
            if 'left' in zone_str: active_logic = self.logic_l; active_audio = audio.get('left', audio)
            elif 'right' in zone_str: active_logic = self.logic_r; active_audio = audio.get('right', audio)
            else: active_logic = self.logic; active_audio = audio
            
            cache = self._fast_cache.get(profile['id'], {}).get(ch_idx)
            if not cache: continue
            
            val = self._calculate_channel(ch_idx, active_audio, active_logic, zone_idx, cache, profile['id'])

            # Preset Overrides (Optimized)
            preset_override_val = None
            
            for p_data in self.active_presets:
                overrides = p_data.get('overrides', [])
                for ov in overrides:
                    if ov.get('type') == 'instance' and ov.get('id') == inst['id']:
                        for ov_ch in ov.get('channels', []):
                            if ov_ch.get('name') == ch_def.get('role', ch_def.get('name')):
                                preset_override_val = int(ov_ch.get('value', 0))
                    elif ov.get('type') == 'global' and ov.get('name') == ch_def.get('role', ch_def.get('name')):
                        preset_override_val = int(ov.get('value', 0))
            
            if preset_override_val is not None:
                val = preset_override_val
                
            self.universe[final_addr] = max(0, min(255, int(val)))

    def _calculate_channel(self, ch_idx, audio, logic_matrix, zone_idx, cache, profile_id):
        current_vibe = audio.get('vibe', 'mid')
        rule = cache.get_active_rule(current_vibe)
        if not rule: return cache.default_val
            
        mod_name = rule.get('mod', 'static')
        
        # Robust 3-point calibration parsing
        cal = rule.get('cal') or {}
        def get_int(d, k, default):
            try:
                v = d.get(k)
                return int(v) if v is not None else default
            except: return default

        c_min = get_int(cal, 'min', 0)
        c_max = get_int(cal, 'max', 255)
        c_center = get_int(cal, 'center', (c_min + c_max) // 2)
        
        # Global Silence Blackout (definitively prevents "crazy" behavior during pauses)
        if getattr(self, '_global_silence', False):
            return c_min
            
        if mod_name == '4th beat':
            seed = (logic_matrix.beat_count // 4) + zone_idx + 42
            rng = random.Random(seed)
            if c_max <= c_min: return rng.randint(c_max, c_min)
            return rng.randint(c_min, c_max)
            
        if mod_name == 'beat':
            seed = logic_matrix.beat_count + zone_idx + 7
            rng = random.Random(seed)
            if c_max <= c_min: return rng.randint(c_max, c_min)
            return rng.randint(c_min, c_max)

        if mod_name in ['static', 'state_machine']: 
            return rule.get('value', c_center)
            
        # 1. Apply Modifier-specific Reactivity / Smoothing / Threshold
        mod_settings = rule.get('audio', {}) if mod_name in ['bass', 'flux', 'audio'] else rule.get('lfo', {})
        
        # Extract tuning parameters with rule-level priority
        s_threshold = float(mod_settings.get('threshold', cache.threshold))
        s_smoothing = float(mod_settings.get('smoothing', cache.smoothing))
        s_react = float(mod_settings.get('react', 1.0))

        if mod_name == 'lfo':
            lfo_id = rule.get('_lfo_id', '')
            val_norm = logic_matrix.state.get(lfo_id, 0.0)
        elif mod_name == 'frequency':
            bins = audio.get('bins', [0.0]*11)
            freq_bins_subset = bins[:6]
            
            # Find bins with valid ranges and sort by amplitude descending
            # [(idx, amp), (idx, amp), ...]
            sorted_bins = sorted(enumerate(freq_bins_subset), key=lambda x: x[1], reverse=True)
            rule_freq_bins = rule.get('freq_bins', [])
            
            found = False
            for idx, amp in sorted_bins:
                if amp <= 0: continue
                if idx < len(rule_freq_bins):
                    r = rule_freq_bins[idx]
                    r_min = r.get('min')
                    r_max = r.get('max')
                    
                    # Treat None or empty string as "blank"
                    if r_min is not None and r_max is not None and r_min != "" and r_max != "":
                        try:
                            c_min = int(float(r_min))
                            c_max = int(float(r_max))
                            c_center = (c_min + c_max) // 2
                            val_norm = (amp * 2.0) - 1.0
                            found = True
                            break
                        except (ValueError, TypeError):
                            continue
            
            if not found:
                val_norm = -1.0
                if rule_freq_bins:
                    # Fallback to first bin min if possible
                    r0 = rule_freq_bins[0]
                    if r0.get('min') is not None and r0.get('min') != "":
                        try: c_min = int(float(r0.get('min')))
                        except: pass
        else:
            val_norm = logic_matrix.state.get(mod_name, 0.0)
            # Apply reactivity scaling to direct modifiers
            val_norm *= s_react

        # Apply Threshold
        if abs(val_norm) < s_threshold:
            val_norm = 0.0 if mod_name != 'intensity' else -1.0
            
        prev_id = f"{profile_id}_{ch_idx}_{zone_idx}"
        prev = self.prev_vals[prev_id]
        if s_smoothing > 0:
            val_norm = (val_norm * (1.0 - s_smoothing)) + (prev * s_smoothing)
        self.prev_vals[prev_id] = val_norm

        val_norm = max(-1.0, min(1.0, val_norm))
        if val_norm < 0: out = c_center + val_norm * (c_center - c_min)
        else: out = c_center + val_norm * (c_max - c_center)
            
        out_int = int(out)
        if c_min > c_max:
            return max(c_max, min(c_min, out_int))
        else:
            return max(c_min, min(c_max, out_int))

    def get_universe(self): return self.universe[:]
    def set_intensity(self, val): self.intensity = float(val)
    def set_speed(self, val): self.speed = float(val)
    def set_audio_sensitivity(self, val): self.audio_sensitivity = float(val)

    # Removed legacy _detect_bass_style

    def apply_overrides(self, ol, sl=[]):
        for o in ol:
            if 'address' in o:
                self.overrides[int(o['address'])] = int(o.get('value', 0))

    def clear_device_overrides(self, dev_id):
        # We now match by instance id or profile name
        inst = next((i for i in self.stage_instances if i['id'] == dev_id or i.get('profileName') == dev_id), None)
        if not inst: return
        fixture = self.fixtures.get(inst.get('fixtureId'))
        if not fixture: return
        
        base = int(inst.get('address', 1)) + int(inst.get('offset', 0))
        for ch in fixture.get('channels', []):
            addr = base + int(ch.get('addrOffset', 0))
            if addr in self.overrides: del self.overrides[addr]

    def clear_address_overrides(self, addresses):
        for addr in addresses:
            if int(addr) in self.overrides: del self.overrides[int(addr)]
