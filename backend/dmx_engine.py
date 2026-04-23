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

    def get_active_rule(self, current_vibe, current_transient=None, instance_key=None, global_sync_indices=None):
        """Returns the specific vibe rule if it exists, cycling through multiple matches when the vibe re-activates."""
        if not self.rules: return None
        
        # 1. Initialize/Retrieve persistence for this instance
        if instance_key not in self.states:
            self.states[instance_key] = {'last_vibe': None, 'indices': {}}
        state = self.states[instance_key]

        # 2. Determine the requested vibe category
        search_vibe = current_vibe
        is_transient = False
        if current_transient in ['building', 'dropping']:
            search_vibe = 'build' if current_transient == 'building' else 'drop'
            is_transient = True

        # 4. Sync Group Logic (Priority Search)
        # If a rule for "vibe X" is tagged with the current active sync variant, it takes precedence.
        matching_indices = []
        if global_sync_indices and not is_transient:
            variant = global_sync_indices.get(search_vibe, 0) + 1
            tagged_vibe = f"{search_vibe} {variant}"
            matching_indices = [i for i, r in enumerate(self.rules) if r.get('vibe') == tagged_vibe]
            
        if not matching_indices:
            # Fallback to standard vibe matching
            matching_indices = [i for i, r in enumerate(self.rules) if r.get('vibe') == search_vibe]
        
        # Handle fallback to 'any' for non-transient vibes
        if not matching_indices and not is_transient:
            is_fallback = True
            search_vibe = 'any_fallback' # Unique key for state tracking
            
            # Check for synchronized fallback (e.g. "any 1")
            if global_sync_indices:
                variant = global_sync_indices.get('any', 0) + 1
                tagged_any = f"any {variant}"
                matching_indices = [i for i, r in enumerate(self.rules) if r.get('vibe') == tagged_any]

            if not matching_indices:
                matching_indices = [i for i, r in enumerate(self.rules) if r.get('vibe') in ['any', 'any/fallback']]

        # 4. Absolute Fallback: If still nothing, use the first non-disabled rule
        if not matching_indices:
            for r in self.rules:
                if r.get('vibe') != 'never':
                    return r
            return None # Revert to default channel value

        # 5. Random Logic: If vibe category changed, pick a random rule from the matching set
        if state['last_vibe'] != search_vibe:
            state['last_vibe'] = search_vibe
            if len(matching_indices) > 1:
                # Try to pick a new random index that isn't the current one if possible
                prev_idx = state['indices'].get(search_vibe, 0)
                new_idx = random.randrange(len(matching_indices))
                if new_idx == prev_idx:
                    new_idx = (new_idx + 1) % len(matching_indices)
                state['indices'][search_vibe] = new_idx
            else:
                state['indices'][search_vibe] = 0
            
        # 6. Bounds-safe retrieval
        idx = state['indices'].get(search_vibe, 0)
        if idx >= len(matching_indices):
            idx = 0
            state['indices'][search_vibe] = 0
            
        final_idx = matching_indices[idx]
        return self.rules[final_idx]

class LogicMatrix:
    def __init__(self):
        self.states = collections.defaultdict(dict) # {key: {pos, vel, phase, bucket, step, hold_val, hold_timer}}
        self.beat_count = 0
        self.bar_count = 0

    def _hash1d(self, x):
        return (math.sin(x) * 43758.5453123) % 1.0

    def _noise1d(self, t):
        i = math.floor(t)
        f = t - i
        u = f * f * f * (f * (f * 6 - 15) + 10)
        v0 = self._hash1d(i)
        v1 = self._hash1d(i + 1)
        return v0 + (v1 - v0) * u

    def update(self, dt, audio, transient, speed_mult=1.0, master_intensity=1.0, active_lfos=None, active_pattern="Figure-8"):
        self.speed_mult = speed_mult
        self.master_intensity = master_intensity
        
        if audio.get('beat', False):
            self.beat_count += 1
            if audio.get('bar', False):
                self.bar_count += 1

        # Canonical Source Mapping
        # 'beat' and 'bar' are now AMPLITUDE drivers (0-1 phase ramp)
        # 'vol', 'bass', 'mid', 'high' are the primary keys
        beat_phase = float(audio.get('beat_phase', 0.0))
        # Musical Phasing: 1/4/8/16 beat cycles
        self.beat_count = int(audio.get('beat_count', self.beat_count))
        bar_phase = ((self.beat_count % 4) + beat_phase) / 4.0
        two_bar_phase = ((self.beat_count % 8) + beat_phase) / 8.0
        four_bar_phase = ((self.beat_count % 16) + beat_phase) / 16.0

        self.state = {
            'bass': float(audio.get('bass', 0.0)),
            'mids': float(audio.get('mid', 0.0)),
            'highs': float(audio.get('high', 0.0)),
            'volume': float(audio.get('vol', 0.0)),
            'spectral flux': float(audio.get('flux', 0.0)),
            'impact': float(audio.get('impact', 0.0)),
            'beat phase': beat_phase,
            'bar phase': bar_phase,
            '2 bar phase': two_bar_phase,
            '4 bar phase': four_bar_phase,
            'static': 1.0,
            'zero': 0.0
        }

        # Add specific frequency bins (0-5)
        for i, val in enumerate(audio.get('bins', [0.0]*6)):
            if i < 6:
                # Increase sensitivity since individual bins are not locally normalized like broad bands
                self.state[f'bin {i}'] = min(1.0, float(val) * 2.0)

class DMXEngine:
    def __init__(self):
        self.universe = bytearray(513)
        self.universe[0] = 0x00
        self.overrides = {}
        self._dt = 0.016
        
        self.logic = LogicMatrix()
        self.logic_l = LogicMatrix()
        self.logic_r = LogicMatrix()
        
        self.speed = 0.6 
        self.intensity = 1.0
        self.scene_freq = 1
        self.audio_sensitivity = 1.0
        self.active_presets = []
        
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
        self._preset_sweep_phases = {}
        self._silence_start = None
        self.blackout = False
        self._was_silent = False
        
        self.behavior_defaults = {}
        self._descriptors_path = os.path.join('backend', 'descriptors.json')
        self._descriptors_mtime = 0
        
        self.sync_indices = {
            'chill': 0, 'mid': 0, 'high': 0, 'any': 0, 'build': 0, 'drop': 0
        }
        
        self.lab_probe_rule = None
        self.lab_probe_state = {} # Isolated state for Behavior Laboratory calculations

        # Removed legacy rhythm and bass style history
        
        # New V2 Arrays
        self.fixtures = {}
        self.profiles = {}
        self.stage_instances = []
        self.presets = []
        
        self.gamepad = {}
        self.prev_gamepad = {}
        self.channel_latches = {}
        self.prev_vals = collections.defaultdict(float)
        
        self._configs_dir = os.path.join('fixtures', 'configs')
        self._profiles_dir = os.path.join('fixtures', 'profiles')
        self._stage_path = os.path.join('fixtures', 'stage_config.json')
        self._presets_path = os.path.join('fixtures', 'presets.json')
        
        self._fixture_mtime = 0
        self._fast_cache = {} 
        self.active_presets = [] 
        self.manual_active_presets = set() # Set of preset IDs manually forced ON
        self.active_visual_commands = []
        
        self._load_profiles()
        self._load_descriptors()
        
        self._reload_thread = threading.Thread(target=self._hot_reload_loop, daemon=True)
        self._reload_thread.start()

    def _resolve_spectral_variant(self, audio):
        """Returns (variant_index 0-2, dominant_bin 0-5) based on most energetic bin pair."""
        raw_bins = audio.get('bins', [0.0] * 6)
        bins = [float(b) for b in raw_bins] if raw_bins else [0.0] * 6
        dominant = bins.index(max(bins)) if bins and max(bins) > 0 else 0
        if dominant <= 1:
            return 0, dominant   # variant 1: sub/bass
        elif dominant <= 3:
            return 1, dominant   # variant 2: kick/low-mid
        else:
            return 2, dominant   # variant 3: mid/high

    def _load_profiles(self):
        print("🔄 DMX Engine Loading Modular Config...")
        
        # 1. Load Hardware Configs
        self.fixtures = {}
        if os.path.exists(self._configs_dir):
            for f in os.listdir(self._configs_dir):
                if f.endswith('.json'):
                    try:
                        with open(os.path.join(self._configs_dir, f), 'r') as file:
                            data = json.load(file)
                            if 'id' in data: self.fixtures[data['id']] = data
                    except: pass
        
        # Legacy Monolithic Load
        legacy_fixtures = os.path.join('fixtures', 'fixtures.json')
        if os.path.exists(legacy_fixtures):
            try:
                with open(legacy_fixtures, 'r') as f:
                    data = json.load(f)
                    for fix in data:
                        if 'id' in fix: self.fixtures[fix['id']] = fix
            except: pass

        # 2. Load Mated Profiles
        self.profiles = {}
        if os.path.exists(self._profiles_dir):
            for f in os.listdir(self._profiles_dir):
                if f.endswith('.json'):
                    try:
                        with open(os.path.join(self._profiles_dir, f), 'r') as file:
                            data = json.load(file)
                            if 'id' in data: self.profiles[data['id']] = data
                    except: pass

        # Legacy Monolithic Load
        legacy_profiles = os.path.join('fixtures', 'profiles.json')
        if os.path.exists(legacy_profiles):
            try:
                with open(legacy_profiles, 'r') as f:
                    data = json.load(f)
                    for prof in data:
                        if 'id' in prof: self.profiles[prof['id']] = prof
            except: pass

        # 3. Load Stage Layout
        self.stage_instances = []
        if os.path.exists(self._stage_path):
            try:
                with open(self._stage_path, 'r') as f:
                    self.stage_instances = json.load(f)
            except: pass

        # 4. Load Presets
        self.presets = []
        if os.path.exists(self._presets_path):
            try:
                with open(self._presets_path, 'r') as f:
                    self.presets = json.load(f)
            except: pass
        
        self.zone_map = [inst['id'] for inst in self.stage_instances]
        print(f"✅ Loaded: {len(self.fixtures)} Fixtures, {len(self.profiles)} Profiles, {len(self.stage_instances)} Stage Instances")
        
        self._build_fast_cache()

    def _load_descriptors(self):
        if os.path.exists(self._descriptors_path):
            try:
                with open(self._descriptors_path, 'r') as f:
                    data = json.load(f)
                    # Convert list of {id, behavior, ...} to dict {id: {behavior, ...}}
                    self.behavior_defaults = { d['id']: d for d in data }
                    self._descriptors_mtime = os.path.getmtime(self._descriptors_path)
                print(f"📡 DMX Engine synced {len(self.behavior_defaults)} Global Behavior Defaults")
            except Exception as e:
                print(f"⚠️ Error loading descriptors: {e}")

    def _build_fast_cache(self):
        self._fast_cache = {}
        for p_id, profile in self.profiles.items():
            self._fast_cache[p_id] = {}
            channels = profile.get('channels', [])
            if not channels: continue
            
            mappings = profile.get('mappings', [])
            for ch_idx, ch in enumerate(channels):
                rules = mappings[ch_idx] if ch_idx < len(mappings) else []
                default_val = ch.get('default', 127)
                self._fast_cache[p_id][ch_idx] = ChannelConfig(
                    rules=rules,
                    states={}, 
                    default_val=default_val,
                    smoothing=0.0,
                    threshold=0.0
                )

    def _hot_reload_loop(self):
        while True:
            time.sleep(2.0)
            
            # Watch for directory or file updates
            try:
                # Check Stage Layout or Presets mtime as a trigger
                stage_mtime = os.path.getmtime(self._stage_path) if os.path.exists(self._stage_path) else 0
                presets_mtime = os.path.getmtime(self._presets_path) if os.path.exists(self._presets_path) else 0
                max_mtime = max(stage_mtime, presets_mtime)

                if self._fixture_mtime != max_mtime:
                    self._fixture_mtime = max_mtime
                    print(f"🔄 Configuration Change detected (Stage: {stage_mtime}, Presets: {presets_mtime}). Reloading...")
                    self._load_profiles()
                
                # Hot reload descriptors independently
                desc_mtime = os.path.getmtime(self._descriptors_path) if os.path.exists(self._descriptors_path) else 0
                if desc_mtime != self._descriptors_mtime:
                    self._load_descriptors()
            except Exception as e:
                # print(f"Hot reload error: {e}")
                pass

    def update(self, dt: float, audio: Dict, visual_states: Dict = None, gamepad: Dict = None):
        self._dt = dt
        self.eff_speed = self.speed
        self.eff_intensity = self.intensity
        self._eff_dt = dt

        self.prev_gamepad = self.gamepad
        self.gamepad = gamepad or {}
        self.transient = audio.get('transient', 'steady')
        current_vibe = audio.get('vibe', 'mid')
        
        # Pre-calculate active presets (Global check once per frame)
        self.active_presets = []
        
        active_triggers = [f"vibe:{current_vibe}"]
        if self.transient: active_triggers.append(f"state:{self.transient}") # Support state triggers correctly

        for p_data in self.presets:
            if not p_data.get('active', True): continue
            triggers = p_data.get('triggers', [])
            if p_data.get('trigger'): triggers = [p_data.get('trigger')] # Legacy support
            
            # NEW STANDARD: All triggers in the list must be met (AND logic)
            is_active = len(triggers) > 0
            
            for trig in triggers:
                trig_matched = False
                t_cat = trig.get('category') or trig.get('type')
                
                if not t_cat or t_cat == "":
                    # Warn the user about the broken preset they planned to fix manually
                    if not hasattr(self, '_warned_presets'): self._warned_presets = set()
                    p_name = p_data.get('name', 'Unknown')
                    if p_name not in self._warned_presets:
                        print(f"⚠️  Preset '{p_name}' contains an empty/invalid trigger and will not activate. Please fix in UI.")
                        self._warned_presets.add(p_name)
                    is_active = False
                    break
                
                # Numeric range helper
                def check_range(val, t):
                    lt = t.get('less_than')
                    gt = t.get('greater_than')
                    if lt is not None and val > float(lt): return False
                    if gt is not None and val < float(gt): return False
                    return True

                if t_cat == 'vibe' and trig.get('vibe', trig.get('value')) == current_vibe:
                    trig_matched = True
                elif t_cat == 'state' and (trig.get('state') == self.transient or trig.get('value') == self.transient):
                    trig_matched = True
                elif t_cat == 'volume':
                    v_pct = audio.get('vol', 0.0) * 100.0
                    if 'less_than' in trig or 'greater_than' in trig:
                        if check_range(v_pct, trig): trig_matched = True
                    else:
                        # Legacy keyword support
                        target_v = trig.get('value', 'mid')
                        v = audio.get('vol', 0.0)
                        r = float(trig.get('range', 5)) / 100.0 
                        if target_v == 'silence' and v <= r: trig_matched = True
                        elif target_v == 'loud' and v >= (1.0 - r): trig_matched = True
                        elif target_v == 'mid' and abs(v - 0.5) <= (r / 2.0): trig_matched = True

                elif t_cat == 'bin':
                    bins = audio.get('bins', [0.0]*6)
                    target = trig.get('target', 'BASS')
                    bin_map = {
                        'SUB': 0, 'BASS': 1, 'KICK': 2, 'LOW_MID': 3, 'MID': 4, 'HIGH_MID': 5, 
                        'PRESENCE': 4, 'BRILLIANCE': 5,
                        'BIN 0': 0, 'BIN 1': 1, 'BIN 2': 2, 'BIN 3': 3, 'BIN 4': 4, 'BIN 5': 5,
                        'bin 0': 0, 'bin 1': 1, 'bin 2': 2, 'bin 3': 3, 'bin 4': 4, 'bin 5': 5
                    }
                    b_idx = bin_map.get(target, int(trig.get('bin', 1)))
                    
                    if b_idx < len(bins):
                        val = bins[b_idx] * 100.0
                        if check_range(val, trig): trig_matched = True

                elif t_cat == 'channel':
                    addr = int(trig.get('target', 0))
                    if 0 < addr < len(self.universe):
                        val = self.universe[addr]
                        if check_range(val, trig): trig_matched = True

                elif t_cat == 'function':
                    # Search logic matrix state for matching keys
                    target = trig.get('target', '').lower()
                    val = None
                    for k, v in self.logic.state.items():
                        if k.lower() == target:
                            val = v * 100.0 if isinstance(v, (int, float)) else None
                            break
                    
                    if val is not None:
                        if check_range(val, trig): trig_matched = True
                
                # If ANY trigger fails, the whole preset is inactive (AND logic)
                if not trig_matched:
                    is_active = False
                    break
                
            if is_active:
                self.active_presets.append(p_data)
                
        # --- MERGE MANUAL PRESETS ---
        for p_data in self.presets:
            if not p_data.get('active', True): continue
            p_id = p_data.get('id', p_data.get('name'))
            if p_id in self.manual_active_presets:
                if p_data not in self.active_presets:
                    self.active_presets.append(p_data)

        self.active_visual_commands = []
        force_next_visual = False
        force_next_fx = False
        for p_data in self.active_presets:
            p_id = p_data.get('id', p_data.get('name'))
            for ov in p_data.get('overrides', []):
                if ov.get('target') == 'visualdmx':
                    for ch in ov.get('channels', []):
                        fn = ch.get('name', 'none').lower()
                        ov_key = f"visual_{p_id}_{fn}"
                        # Use the raw dt for preset sweeps; they handle their own time-warping via speed logic if needed
                        # Wait, for consistency across the engine, we use raw dt here and apply eff_speed multiplier to the result
                        resolved_val = self._resolve_preset_value(ov_key, ch.get('value', 0), dt)
                        self.active_visual_commands.append({
                            "function": fn,
                            "value": resolved_val
                        })
                        if fn == 'next_visual': force_next_visual = True
                        if fn == 'next_fx': force_next_fx = True
                elif ov.get('target') == 'system':
                    for ch in ov.get('channels', []):
                        fn = ch.get('name', 'none').lower()
                        ov_key = f"system_{p_id}_{fn}"
                        resolved_val = self._resolve_preset_value(ov_key, ch.get('value', 100), dt)
                        
                        # Apply multiplier directly to engine speed/intensity
                        multiplier = resolved_val / 100.0
                        if fn in ['speed', 'rate', 'dt']:
                            self.speed = 0.6 * multiplier # Restore base-speed awareness
                        elif fn == 'intensity':
                            self.intensity = 1.0 * multiplier

        if 'left' in audio and 'right' in audio:
            self.logic_l.update(dt, audio['left'], self.transient, self.speed, self.intensity)
            self.logic_r.update(dt, audio['right'], self.transient, self.speed, self.intensity)
        else:
            self.logic_l = self.logic
            self.logic_r = self.logic
            self.logic.update(dt, audio, self.transient, self.speed, self.intensity)
        
        # Removed legacy rhythm triggers
        
        # --- Vibe/Variant/Transient Change Detection ---
        is_silent = audio.get('vol', 0.0) < 0.03
        vibe_changed = current_vibe != self._last_vibe
        silence_recovered = self._was_silent and not is_silent
        transient_changed = self.transient != self._last_transient
        variant_changed = False
        
        # Spectral Resolution (Determines synchronized 1, 2, or 3 variant)
        if vibe_changed or silence_recovered or transient_changed:
            old_variant = self.sync_indices.get(current_vibe, 0)
            variant, dominant = self._resolve_spectral_variant(audio)
            
            if variant != old_variant:
                variant_changed = True
            
            self.sync_indices[current_vibe] = variant
            self.sync_indices['any'] = variant
            
            # Also update transient-specific indices
            eff_transient_vibe = None
            if self.transient == 'building': eff_transient_vibe = 'build'
            elif self.transient == 'dropping': eff_transient_vibe = 'drop'
            if eff_transient_vibe and transient_changed:
                self.sync_indices[eff_transient_vibe] = variant

            reason = 'vibe' if vibe_changed else ('silence recovery' if silence_recovered else f'transient → {self.transient}')
            print(f"🎚️ Sync Variant [{reason}]: {current_vibe} → {variant + 1} (dominant bin: {dominant})")

        should_switch = False
        current_beat = audio.get('beat_count', 0)
        beats_passed = current_beat - self._last_scene_switch_beat
        
        # PHRASING LOGIC
        if self.scene_freq == -1: should_switch = False # MANUAL MODE
        elif self.scene_freq == 0 and beats_passed >= 1: should_switch = True
        elif self.scene_freq == 1 and beats_passed >= 4: should_switch = True
        elif self.scene_freq == 2 and beats_passed >= 8: should_switch = True
        elif self.scene_freq == 3 and beats_passed >= 16: should_switch = True
        elif self.scene_freq == 4:
            if vibe_changed or variant_changed:
                should_switch = True
            elif transient_changed and self.transient in ['dropping', 'building']:
                should_switch = True

        if visual_states:
            if visual_states.get("bg", -1) != -1: self.current_base_layer = visual_states["bg"]
            if visual_states.get("fx", -1) != -1: self.current_fx_layer = visual_states["fx"]
            if visual_states.get("fg", -1) != -1: self.current_fg_layer = visual_states["fg"]

        if should_switch or force_next_visual:
            if not visual_states or visual_states.get("bg", -1) == -1:
                # Pick a global index for the base layer (UserGen uses this to index library)
                self.current_base_layer = (self.current_base_layer + 1) % 1000
            self._last_scene_switch_beat = current_beat
            
            # Debug log for visual evolution
            reason = "manual" if force_next_visual else (f"freq {self.scene_freq}")
            if self.scene_freq == 4:
                reason = "vibe change" if vibe_changed else ("variant change" if variant_changed else "transient drop/build")
            print(f"🎬 Scene Toggle Triggered [{reason}] -> Base Index: {self.current_base_layer}")

        if force_next_fx:
            if not visual_states or visual_states.get("fx", -1) == -1:
                self.current_fx_layer = (self.current_fx_layer + 1) % 1000

        self.logic.state['scene_trigger'] = 1.0 if should_switch else -1.0
            
        self._was_silent = is_silent
        self._last_vibe = current_vibe
        self._last_transient = self.transient

        # Update Probe if active
        if self.lab_probe_rule:
            self.lab_dmx_val = self._apply_rule_math(self.lab_probe_rule, self.lab_probe_state, audio, self.logic)
        else:
            self.lab_dmx_val = 0

        # Process All Instances
        for i, inst in enumerate(self.stage_instances):
            self._process_instance(inst, i, audio, self.sync_indices)

        for addr, val in self.overrides.items():
            if 0 < addr < len(self.universe):
                self.universe[addr] = max(0, min(255, int(val)))

        # GLOBAL BLACKOUT OVERRIDE
        if self.blackout:
            for i in range(1, len(self.universe)):
                self.universe[i] = 0

    def get_active_preset_names(self):
        """Returns a list of names for currently active presets."""
        names = []
        for p in self.active_presets:
            names.append(p.get('name', 'unnamed'))
        return list(set(names)) # De-duplicate names

    def set_blackout(self, state):
        self.blackout = bool(state)
        print(f"🔦 Global Blackout: {'ON' if self.blackout else 'OFF'}")

    def _process_instance(self, inst, zone_idx, audio, sync_indices=None):
        profile = self.profiles.get(inst.get('profileId'))
        if not profile: return

        # Unified Architecture: Channels are now part of the profile!
        # Fallback to legacy fixtureId if channels key is missing (for transition support)
        channels = profile.get('channels', [])
        if not channels:
            fixture = self.fixtures.get(inst.get('fixtureId'))
            if fixture:
                channels = fixture.get('channels', [])
        
        if not channels: return

        try:
            base_addr = int(inst.get('address', 1)) + int(inst.get('offset', 0))
        except: return
        
        active_triggers = []
        current_vibe = audio.get('vibe', 'mid')
        active_triggers.append(f"vibe:{current_vibe}")
        
        # Simple global routing - Left/Right/Center usually inferred from zone name for now
        zone_str = str(inst.get('zone', '')).lower()
        if 'left' in zone_str: active_logic = self.logic_l; active_audio = audio.get('left', audio)
        elif 'right' in zone_str: active_logic = self.logic_r; active_audio = audio.get('right', audio)
        else: active_logic = self.logic; active_audio = audio
        


        for ch_idx, ch_def in enumerate(channels):

            # Use addrOffset if provided explicitly, otherwise fallback to index relative to base_addr
            offset = ch_def.get('addrOffset')
            if offset is None: offset = ch_idx
            
            final_addr = base_addr + int(offset)
            if not (0 < final_addr < len(self.universe)): continue
            
            
            cache = self._fast_cache.get(profile['id'], {}).get(ch_idx)
            if not cache: continue
            
            val = self._calculate_channel(ch_idx, active_audio, active_logic, zone_idx, cache, profile['id'], ch_def, sync_indices)

            # Preset Overrides (Optimized)
            preset_override_val = None
            
            for p_data in self.active_presets:
                overrides = p_data.get('overrides', [])
                p_id = p_data.get('id', p_data.get('name', 'unknown'))
                for ov in overrides:
                    ov_type = ov.get('type')
                    ov_name = ov.get('name', '')
                    target_role = ch_def.get('role', ch_def.get('name'))
                    
                    matched_ov_ch = None
                    
                    if ov_type == 'instance' and ov.get('id') == inst['id']:
                        for ov_ch in ov.get('channels', []):
                            if ov_ch.get('name') == target_role:
                                matched_ov_ch = ov_ch
                    elif ov_type == 'global':
                        if ov_name == target_role or ov_name == f"Global: {target_role}":
                            for ov_ch in ov.get('channels', []):
                                if ov_ch.get('name') == target_role:
                                    matched_ov_ch = ov_ch
                                    break
                            # Fallback to direct 'value' for legacy global presets
                            if matched_ov_ch is None and 'value' in ov:
                                ov_key = f"dimmer_{p_id}_{ov_name}_{inst['id']}"
                                # Use warped dt for global value sweeps
                                preset_override_val = self._resolve_preset_value(ov_key, ov.get('value', 0), self._eff_dt)
                    
                    if matched_ov_ch is not None:
                        if matched_ov_ch.get('mode') == 'behavior':
                            # Dynamic behavior override — evaluate like a profile rule
                            bkey = f"preset_{p_id}_{ov.get('id','g')}_{target_role}_{zone_idx}"
                            preset_override_val = self._evaluate_preset_behavior(
                                matched_ov_ch, active_audio, active_logic, bkey
                            )
                        else:
                            ov_key = f"dmx_{p_id}_{target_role}_{inst['id']}"
                            # Use warped dt for instance value sweeps
                            preset_override_val = self._resolve_preset_value(ov_key, matched_ov_ch.get('value', 0), self._eff_dt)
            
            if preset_override_val is not None:
                val = preset_override_val
                
            self.universe[final_addr] = max(0, min(255, int(val)))



    def _calculate_channel(self, ch_idx, audio, logic_matrix, zone_idx, cache, profile_id, ch_def=None, sync_indices=None):
        current_vibe = audio.get('vibe', 'mid')
        current_transient = audio.get('transient', 'steady')
        instance_key = f"{profile_id}_{ch_idx}_{zone_idx}"
        rule = cache.get_active_rule(current_vibe, current_transient, instance_key, sync_indices)
        if not rule: return cache.default_val

        # State Maintenance for this specific rule instance
        st = logic_matrix.states[instance_key]
        return self._apply_rule_math(rule, st, audio, logic_matrix, ch_def)

    def _apply_rule_math(self, rule, st, audio, logic_matrix, ch_def=None):
        """Standardized math engine for all DMX channels."""
        behavior = rule.get('behavior', 'static').lower()
        source = rule.get('source', 'volume').lower()
        mods = rule.get('modifiers', {'speed': 0.5, 'react': 0.5, 'hold_type': 'none'})
        
        easy_id = rule.get('easy_id')
        if easy_id and easy_id in self.behavior_defaults:
            default = self.behavior_defaults[easy_id]
            behavior = default.get('behavior', behavior)
            source = default.get('source', source)
            mods['speed'] = default.get('speed', mods.get('speed', 0.5))
            mods['react'] = default.get('react', mods.get('react', 0.5))
            mods['hold_type'] = default.get('hold_type', mods.get('hold_type', 'none'))

        speed = float(mods.get('speed', 0.5))
        react = float(mods.get('react', 0.5))
        hold_type = str(mods.get('hold_type', 'none')).lower()
        
        # Calibration
        cal = rule.get('cal') or {}
        fixture_cal = ch_def.get('calibration') or {} if ch_def else {}
        c_min = int(cal.get('min', fixture_cal.get('min', 0)))
        c_max = int(cal.get('max', fixture_cal.get('max', 255)))
        c_center = int(cal.get('center', fixture_cal.get('center', (c_min + c_max) // 2)))

        r_center = rule.get('rel_center')
        if r_center is None and easy_id and easy_id in self.behavior_defaults:
            r_center = self.behavior_defaults[easy_id].get('rel_center')
        if r_center is not None:
             c_center = c_min + (float(r_center) * (c_max - c_min))

        # 1. Resolve Driver Magnitude (E)
        E = logic_matrix.state.get(source, 0.0)

        # 2. State Maintenance (Non-Physics)
        if 'phase' not in st: 
            st.update({'phase': 0.0, 't': 0.0, 'hold_active': False, 'held_dmx': c_center})

        # 3. Hold Logic (Musical Durations)
        is_beat = audio.get('beat', False)
        trigger_hold = False
        beat_count = logic_matrix.beat_count

        if hold_type == 'beat' and is_beat: trigger_hold = True
        elif hold_type == 'bar' and is_beat and (beat_count % 4 == 0): trigger_hold = True
        elif hold_type == '2 bar' and is_beat and (beat_count % 8 == 0): trigger_hold = True
        elif hold_type == '4 bar' and is_beat and (beat_count % 16 == 0): trigger_hold = True

        if trigger_hold: 
            st['hold_active'] = True
            st.pop('held_dmx', None) # Allow capture of NEW value
        elif hold_type == 'none':
            st['hold_active'] = False

        # 4. Behavior Logic (Non-Physics)
        y = 0.0 
        dt = self._dt

        if behavior == 'static':
            return max(0, min(255, int(rule.get('value', c_max))))
        
        elif behavior == 'direct':
            y = (E * 2.0) - 1.0 # Centered unipolar-to-bipolar for calibration mapping
            
        elif behavior in ['sine', 'square', 'saw']:
            freq = (speed * 0.1) + (E * 5.0 * react) # Variable frequency based on energy
            st['phase'] = (st['phase'] + dt * freq) % 1.0
            p = st['phase']
            amp = react # Use react as amplitude scale
            
            if behavior == 'sine': y = amp * math.sin(p * 2.0 * math.pi)
            elif behavior == 'saw': y = amp * ((p * 2.0) - 1.0)
            elif behavior == 'square': y = amp if p < 0.5 else -amp

        elif behavior == 'noise':
            st['t'] += dt * (speed * 0.5 + E * react * 2.0)
            y = (logic_matrix._noise1d(st['t']) * 2.0) - 1.0

        elif behavior == 'beat phase':
            p = logic_matrix.state.get('beat phase', 0.0)
            y = (p * 2.0 * E) - 1.0 # Ramp scaled by amplitude (E)
            
        elif behavior == 'bar phase':
            p = logic_matrix.state.get('bar phase', 0.0)
            y = (p * 2.0 * E) - 1.0

        # Mapping normalized y to DMX
        y = max(-1.0, min(1.0, y))
        if y >= 0: final_dmx = c_center + (y * (c_max - c_center))
        else: final_dmx = c_center + (y * (c_center - c_min))
        
        # Hold persistence
        if hold_type != 'none':
            if st['hold_active']:
                if 'held_dmx' not in st: st['held_dmx'] = final_dmx
                final_dmx = st['held_dmx']
            else:
                st.pop('held_dmx', None)
        
        return max(0, min(255, int(round(final_dmx))))

    def _resolve_preset_value(self, ov_key, val, dt):
        """
        Resolves a preset value string to an integer.
        Supports:
          - Integers/Floats: "255"
          - Linear Sweeps: "0-255"
          - Sequences: "30, 50-100, 255"
          - Offsets: "32-96+32" (Starts at 64)
          - Hybrid: "30, 50-100, 30 + 16"
          - Reverse Sweeps: "255-0"
        """
        if isinstance(val, (int, float)):
            return int(val)
        if not isinstance(val, str):
            return 0

        # 1. Parse Offset (at the very end of the string)
        offset = 0.0
        main_val = val
        if '+' in val:
            parts = val.rsplit('+', 1)
            main_val = parts[0].strip()
            try:
                offset = float(parts[1].strip())
            except:
                pass

        # 2. Parse Sequence (split by comma)
        seq_parts = [p.strip() for p in main_val.split(',')]
        num_parts = len(seq_parts)
        if num_parts == 0: return 0

        # 3. Maintain/Update Phase Accumulator
        if ov_key not in self._preset_sweep_phases:
            self._preset_sweep_phases[ov_key] = 0.0
        
        # Rate: 60 bits per second (Legacy speed standard)
        rate = 60.0 
        self._preset_sweep_phases[ov_key] += dt * rate
        
        # Each part occupies a consistent "64 bit" phase window
        part_duration = 64.0
        total_cycle = num_parts * part_duration
        
        # Apply offset and wrap
        eff_phase = (self._preset_sweep_phases[ov_key] + offset) % total_cycle
        
        # Determine which part of the sequence we are in
        part_idx = min(int(eff_phase // part_duration), num_parts - 1)
        local_phase = eff_phase % part_duration # 0.0 to 64.0
        
        part_str = seq_parts[part_idx]

        # 4. Resolve the specific part (Value or Sweep)
        if '-' in part_str:
            try:
                # Handle multi-dash chains like "32-96-32"
                points = [float(p.strip()) for p in part_str.split('-') if p.strip()]
                num_points = len(points)
                if num_points < 2: return int(points[0]) if points else 0
                
                # Divide the part's duration into sub-segments for the chain
                num_segments = max(1, len(points) - 1)
                sub_duration = part_duration / num_segments
                
                sub_idx = int(local_phase // sub_duration)
                sub_idx = min(sub_idx, num_segments - 1)
                sub_local_phase = local_phase % sub_duration
                
                v_start = points[sub_idx]
                v_end = points[sub_idx + 1]
                
                # Interpolate within the sub-segment
                # Removed the "-1.0" to ensure continuous motion across segments
                t = sub_local_phase / sub_duration if sub_duration > 0 else 0.0
                t = max(0.0, min(1.0, t))
                
                return v_start + t * (v_end - v_start)
            except:
                return 0.0
        
        try:
            return float(part_str)
        except:
            return 0.0

    def _evaluate_preset_behavior(self, ov_ch, audio, logic_matrix, instance_key):
        """Standardized math for preset behavior overrides."""
        # Force a rule-like object to reuse the math core
        rule = {
            'behavior': ov_ch.get('behavior', 'static'),
            'source': ov_ch.get('source', 'volume'),
            'modifiers': ov_ch.get('modifiers', {}),
            'cal': ov_ch.get('cal', {})
        }
        st = logic_matrix.states[instance_key]
        return self._apply_rule_math(rule, st, audio, logic_matrix)

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
        if dev_id == "all":
            self.overrides = {}
            return

        inst = next((i for i in self.stage_instances if i['id'] == dev_id or i.get('profileName') == dev_id), None)
        if not inst: return
        profile = self.profiles.get(inst.get('profileId'))
        channels = []
        if profile:
            channels = profile.get('channels', [])
            if not channels:
                fixture = self.fixtures.get(inst.get('fixtureId'))
                if fixture: channels = fixture.get('channels', [])
        
        if not channels: return
        
        base = int(inst.get('address', 1)) + int(inst.get('offset', 0))
        for idx, ch in enumerate(channels):
            addr = base + idx
            if addr in self.overrides: del self.overrides[addr]

    def clear_address_overrides(self, addresses):
        for addr in addresses:
            if int(addr) in self.overrides: del self.overrides[int(addr)]
    def toggle_manual_preset(self, preset_id: str, state: bool = None):
        """Force a preset to be active or inactive regardless of audio triggers."""
        if state is None:
            if preset_id in self.manual_active_presets:
                self.manual_active_presets.remove(preset_id)
            else:
                self.manual_active_presets.add(preset_id)
        elif state:
            self.manual_active_presets.add(preset_id)
        else:
            if preset_id in self.manual_active_presets:
                self.manual_active_presets.remove(preset_id)
        print(f"🎛️ Manual Preset '{preset_id}' is now {'ON' if preset_id in self.manual_active_presets else 'OFF'}")

    def clear_manual_presets(self):
        self.manual_active_presets.clear()
        print("🎛️ Cleared all manual presets")
