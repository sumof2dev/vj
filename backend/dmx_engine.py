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
            
        final_idx = matching_indices[state['indices'].get(search_vibe, 0)]
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
        if audio.get('beat', False):
            self.beat_count += 1
            if audio.get('bar', False):
                self.bar_count += 1

        # Canonical Source Mapping
        # 'beat' and 'bar' are now AMPLITUDE drivers (0-1 phase ramp)
        # 'vol', 'bass', 'mid', 'high' are the primary keys
        beat_phase = float(audio.get('beat_phase', 0.0))
        bar_phase = ((float(audio.get('beat_count', 0)) % 4.0) + beat_phase) / 4.0

        self.state = {
            'bass': float(audio.get('bass', audio.get('low', 0.0))),
            'mid': float(audio.get('mid', 0.0)),
            'high': float(audio.get('high', 0.0)),
            'vol': float(audio.get('vol', audio.get('volume', 0.0))),
            'volume': float(audio.get('vol', audio.get('volume', 0.0))), # Legacy support
            'low': float(audio.get('bass', audio.get('low', 0.0))),       # Legacy support
            'flux': float(audio.get('flux', 0.0)),
            'impact': float(audio.get('impact', 0.0)),
            'beat': beat_phase,
            'bar': bar_phase,
            'static': 1.0,
            'zero': 0.0
        }

        # Add specific frequency bins (0-5) for targeted reactivity
        for i, val in enumerate(audio.get('bins', [0.0]*6)):
            if i < 6:
                self.state[f'bin_{i}'] = float(val)

        # Pillar States are updated in _calculate_channel for per-rule state maintenance.
        # However, global grids (Figure-8) still live here.
        eff_beat = float(self.beat_count % 16) + (1.0 - audio.get('beat_phase', 0.0))
        t = (eff_beat / 16.0) * 2.0 * math.pi
        
        p = active_pattern.lower() if active_pattern else "figure-8"
        if "circle" in p:
            self.grid_x = math.cos(t)
            self.grid_y = math.sin(t)
        elif "lissajous a" in p:
            self.grid_x = math.sin(3 * t + math.pi/2)
            self.grid_y = math.sin(2 * t)
        elif "lissajous b" in p:
            self.grid_x = math.sin(5 * t)
            self.grid_y = math.sin(4 * t)
        else:
            self.grid_x = math.cos(t)
            self.grid_y = math.sin(2 * t)

        self.state.update({
            'grid_x': float(self.grid_x),
            'grid_y': float(self.grid_y),
            'intensity': master_intensity
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
        self.active_presets = []
        self.calibrated_preset_active = False
        self.active_lissajous_pattern = "Figure-8"
        
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
        
        self.behavior_defaults = {}
        self._descriptors_path = os.path.join('backend', 'descriptors.json')
        self._descriptors_mtime = 0
        
        self.sync_indices = {
            'chill': 0, 'mid': 0, 'high': 0, 'any': 0, 'build': 0, 'drop': 0
        }
        
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
        
        self._load_profiles()
        self._load_descriptors()
        
        self._reload_thread = threading.Thread(target=self._hot_reload_loop, daemon=True)
        self._reload_thread.start()

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
        self.prev_gamepad = self.gamepad
        self.gamepad = gamepad or {}
        self.transient = audio.get('transient', 'steady')
        current_vibe = audio.get('vibe', 'mid')

        self.logic.update(dt, audio, self.transient, self.speed, self.intensity)
        
        # Pre-calculate active presets (Global check once per frame)
        self.active_presets = []
        self.calibrated_preset_active = False
        
        active_triggers = [f"vibe:{current_vibe}"]
        if self.transient: active_triggers.append(f"state:{self.transient}") # Support state triggers correctly

        for p_data in self.presets:
            if not p_data.get('active', True): continue
            triggers = p_data.get('triggers', [])
            if p_data.get('trigger'): triggers = [p_data.get('trigger')] # Legacy support
            
            is_active = False
            for trig in triggers:
                t_cat = trig.get('category') or trig.get('type')
                
                # Numeric range helper
                def check_range(val, t):
                    lt = t.get('less_than')
                    gt = t.get('greater_than')
                    if lt is not None and val > float(lt): return False
                    if gt is not None and val < float(gt): return False
                    return True

                if t_cat == 'vibe' and trig.get('vibe', trig.get('value')) == current_vibe:
                    is_active = True
                elif t_cat == 'state' and (trig.get('state') == self.transient or trig.get('value') == self.transient):
                    is_active = True
                elif t_cat == 'volume':
                    v_pct = audio.get('vol', 0.0) * 100.0
                    if 'less_than' in trig or 'greater_than' in trig:
                        if check_range(v_pct, trig): is_active = True
                    else:
                        # Legacy keyword support
                        target_v = trig.get('value', 'mid')
                        v = audio.get('vol', 0.0)
                        r = float(trig.get('range', 5)) / 100.0 
                        if target_v == 'silence' and v <= r: is_active = True
                        elif target_v == 'loud' and v >= (1.0 - r): is_active = True
                        elif target_v == 'mid' and abs(v - 0.5) <= (r / 2.0): is_active = True

                elif t_cat == 'bin':
                    bins = audio.get('bins', [0.0]*6)
                    target = trig.get('target', 'BASS')
                    bin_map = {'SUB':0, 'BASS':1, 'KICK':2, 'LOW_MID':3, 'MID':4, 'HIGH_MID':5, 'PRESENCE':4, 'BRILLIANCE':5}
                    b_idx = bin_map.get(target, int(trig.get('bin', 1)))
                    
                    if b_idx < len(bins):
                        val = bins[b_idx] * 100.0
                        if check_range(val, trig): is_active = True

                elif t_cat == 'channel':
                    addr = int(trig.get('target', 0))
                    if 0 < addr < len(self.universe):
                        val = self.universe[addr]
                        if check_range(val, trig): is_active = True

                elif t_cat == 'function':
                    # Search logic matrix state for matching keys
                    target = trig.get('target', '').lower()
                    val = None
                    for k, v in self.logic.state.items():
                        if k.lower() == target:
                            val = v * 100.0 if isinstance(v, (int, float)) else None
                            break
                    
                    if val is not None:
                        if check_range(val, trig): is_active = True
                
                if is_active: break
                
            if is_active:
                self.active_presets.append(p_data)
                
        # --- MERGE MANUAL PRESETS ---
        for p_data in self.presets:
            if not p_data.get('active', True): continue
            p_id = p_data.get('id', p_data.get('name'))
            if p_id in self.manual_active_presets:
                if p_data not in self.active_presets:
                    self.active_presets.append(p_data)

        # Check for "Calibrated" virtual fixture in overrides across all active presets
        for p_data in self.active_presets:
            for ov in p_data.get('overrides', []):
                if ov.get('type') == 'calibrated' or ov.get('id') == 'calibrated':
                    self.calibrated_preset_active = True
                    # The "Target Function" (ch.name) becomes the pattern
                    for ch in ov.get('channels', []):
                        self.active_lissajous_pattern = ch.get('name', 'Figure-8')

        if 'left' in audio and 'right' in audio:
            self.logic_l.update(dt, audio['left'], self.transient, self.speed, self.intensity)
            self.logic_r.update(dt, audio['right'], self.transient, self.speed, self.intensity)
        else:
            self.logic_l = self.logic
            self.logic_r = self.logic
            self.logic.update(dt, audio, self.transient, self.speed, self.intensity)
        
        # Removed legacy rhythm triggers
        
        should_switch = False
        current_beat = audio.get('beat_count', 0)
        beats_passed = current_beat - self._last_scene_switch_beat
        
        # PHRASING LOGIC
        if self.scene_freq == -1: should_switch = False # MANUAL MODE
        elif self.scene_freq == 0 and beats_passed >= 1: should_switch = True
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
                # Pick a global index for the base layer (UserGen uses this to index library)
                self.current_base_layer = random.randint(0, 999)
            if not visual_states or visual_states.get("fx", -1) == -1:
                # Pick a global index for the fx layer
                self.current_fx_layer = random.randint(0, 999)
            self._last_scene_switch_beat = current_beat
            
        self.logic.state['scene_trigger'] = 1.0 if should_switch else -1.0
            
        # Rotate Sync Indices on Vibe/Transient Change
        if current_vibe != self._last_vibe:
            old_idx = self.sync_indices.get(current_vibe, 0)
            new_idx = (old_idx + 1) % 3
            self.sync_indices[current_vibe] = new_idx
            self.sync_indices['any'] = (self.sync_indices.get('any', 0) + 1) % 3
            print(f"🔄 Sync Group Rotation: {current_vibe} {old_idx+1} -> {new_idx+1} (Any rotation: {self.sync_indices['any']+1})")
        
        # Also treat core transients as vibes for syncing
        eff_transient_vibe = None
        if self.transient == 'building': eff_transient_vibe = 'build'
        elif self.transient == 'dropping': eff_transient_vibe = 'drop'
        
        if eff_transient_vibe and self.transient != self._last_transient:
            old_t_idx = self.sync_indices.get(eff_transient_vibe, 0)
            new_t_idx = (old_t_idx + 1) % 3
            self.sync_indices[eff_transient_vibe] = new_t_idx
            print(f"⚡ Transient Sync Rotation: {eff_transient_vibe} {old_t_idx+1} -> {new_t_idx+1}")

        self._last_vibe = current_vibe
        self._last_transient = self.transient

        # Process All Instances
        for i, inst in enumerate(self.stage_instances):
            self._process_instance(inst, i, audio, self.sync_indices)

        for addr, val in self.overrides.items():
            if 0 < addr < len(self.universe):
                self.universe[addr] = max(0, min(255, int(val)))

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
        
        # X/Y LINKING PRE-PASS: If either X or Y is calibrated, both follow grid
        force_calibrated = False
        if self.calibrated_preset_active:
             force_calibrated = True
             active_logic.state['lissajous_active'] = 1.0

        for ch_idx, ch_def in enumerate(channels):
            role = ch_def.get('role', '').lower()
            if role in ['pos_x', 'pos_y']:
                cache = self._fast_cache.get(profile['id'], {}).get(ch_idx)
                if cache:
                    rule = cache.get_active_rule(current_vibe, self.transient, f"{profile['id']}_{ch_idx}_{zone_idx}")
                    if rule and rule.get('behavior') == 'calibrated':
                        force_calibrated = True
                        active_logic.state['lissajous_active'] = 1.0
                        break

        for ch_idx, ch_def in enumerate(channels):

            # Use addrOffset if provided explicitly, otherwise fallback to index relative to base_addr
            offset = ch_def.get('addrOffset')
            if offset is None: offset = ch_idx
            
            final_addr = base_addr + int(offset)
            if not (0 < final_addr < len(self.universe)): continue
            
            
            cache = self._fast_cache.get(profile['id'], {}).get(ch_idx)
            if not cache: continue
            
            val = self._calculate_channel(ch_idx, active_audio, active_logic, zone_idx, cache, profile['id'], force_calibrated, ch_def, sync_indices)

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
                                preset_override_val = int(ov.get('value', 0))
                    
                    if matched_ov_ch is not None:
                        if matched_ov_ch.get('mode') == 'behavior':
                            # Dynamic behavior override — evaluate like a profile rule
                            bkey = f"preset_{p_id}_{ov.get('id','g')}_{target_role}_{zone_idx}"
                            preset_override_val = self._evaluate_preset_behavior(
                                matched_ov_ch, active_audio, active_logic, bkey
                            )
                        else:
                            preset_override_val = int(matched_ov_ch.get('value', 0))
            
            if preset_override_val is not None:
                val = preset_override_val
                
            self.universe[final_addr] = max(0, min(255, int(val)))

    def _calculate_channel(self, ch_idx, audio, logic_matrix, zone_idx, cache, profile_id, force_calibrated=False, ch_def=None, sync_indices=None):
        current_vibe = audio.get('vibe', 'mid')
        current_transient = audio.get('transient', 'steady')
        instance_key = f"{profile_id}_{ch_idx}_{zone_idx}"
        rule = cache.get_active_rule(current_vibe, current_transient, instance_key, sync_indices)
        if not rule: return cache.default_val

        # Mad Libs Schema extraction
        behavior = rule.get('behavior', 'static')
        source = rule.get('source', 'volume')
        mods = rule.get('modifiers', {'speed': 0.5, 'react': 0.5, 'hold_type': 'none'})
        
        easy_id = rule.get('easy_id')
        if easy_id and easy_id in self.behavior_defaults:
            # BRIDGE OVERRIDE: Prioritize global defaults for premade links
            # We only override if it's NOT marked as 'custom' (which it isn't if easy_id exists)
            default = self.behavior_defaults[easy_id]
            behavior = default.get('behavior', behavior)
            source = default.get('source', source)
            mods['speed'] = default.get('speed', mods['speed'])
            mods['react'] = default.get('react', mods['react'])
            mods['hold_type'] = default.get('hold_type', mods['hold_type'])

        speed = float(mods.get('speed', 0.5))
        react = float(mods.get('react', 0.5))
        hold_type = mods.get('hold_type', 'none')
        
        # 3-point calibration
        cal = rule.get('cal') or {}
        fixture_cal = ch_def.get('calibration') or {} if ch_def else {}
        c_min = int(cal.get('min', fixture_cal.get('min', 0)))
        c_max = int(cal.get('max', fixture_cal.get('max', 255)))
        c_center = int(cal.get('center', fixture_cal.get('center', (c_min + c_max) // 2)))

        # 3.5 Global Relative Center Override
        # If the behavior has a fixed relative midpoint (from tuning), prioritize it
        r_center = rule.get('rel_center')
        if r_center is None and easy_id and easy_id in self.behavior_defaults:
            r_center = self.behavior_defaults[easy_id].get('rel_center')
        
        if r_center is not None:
             c_center = c_min + (float(r_center) * (c_max - c_min))

        # 1. Resolve Driver Magnitude (E) from LogicMatrix state
        E = logic_matrix.state.get(source, 0.0)

        # 2. State Maintenance for this specific rule instance
        st = logic_matrix.states[instance_key]
        if 'pos' not in st: 
            st.update({
                'pos': 0.0, 'vel': 0.0, 'phase': 0.0, 't': 0.0, 
                'bucket': 0, 'step': 0, 'hold_active': False, 
                'last_beat': False
            })

        # 3. Hold Logic (CAPTURING trigger)
        is_beat = audio.get('beat', False)
        is_bar = audio.get('bar', False)
        is_pulse_type = hold_type in ['beat', 'sync_beat', 'bar', 'sync_bar']
        trigger_hold = False
        
        # Canonical Hold Types
        if hold_type in ['beat', 'sync_beat'] and is_beat: trigger_hold = True
        elif hold_type in ['bar', 'sync_bar'] and is_bar: trigger_hold = True
        elif hold_type == 'peakpause' and E > 0.85: trigger_hold = True
        elif hold_type == 'floorfreeze' and E < 0.15: trigger_hold = True
        # Legacy support
        elif hold_type == 'quickly' and E > 0.8: trigger_hold = True
        elif hold_type == 'slowly' and E < 0.2: trigger_hold = True

        # Special Kinematics Hold (Holds Input F, not Output Y)
        is_kinematics = behavior in ['push', 'pull', 'kinematic_push', 'kinematic_pull']
        
        if trigger_hold:
            if is_kinematics: 
                st['held_force'] = E
            else: 
                # For pulse triggers (beat/bar), we clear the old held value 
                # so that a fresh one is captured on this specific frame.
                if is_pulse_type:
                    st.pop('held_dmx', None)
                st['hold_active'] = True 
        else:
            # Release Logic
            if not is_pulse_type:
                # Gated holds (peakpause, etc) or "None" release immediately when condition isn't met
                st['hold_active'] = False
                st.pop('held_force', None)
                st.pop('held_dmx', None)
            # Pulse types (beat/bar) RETAIN hold_active=True and their held_dmx here 
            # so they remain frozen between beats.

        E_eff = st.get('held_force', E)

        # 4. Behavior Logic
        y = 0.0 # Normalized output: usually [-1, 1], mapped to min..center..max
        dt = self._dt

        if behavior == 'static':
            # Pure fixed-value hold, no audio reactivity or calibration mapping
            return max(0, min(255, int(rule.get('value', 0))))
        
        elif behavior in ['sine', 'saw', 'square', 'triangle', 'lfo_sine', 'lfo_saw', 'lfo_square', 'lfo_triangle']:
            # NEW STANDARD: Volume modulates Frequency, Driver modulates Amplitude
            # RHYTHMIC SYNC: If source is 'beat' or 'bar', lock phase to the driver
            vol_driver = float(audio.get('vol', 0.1)) 
            
            if source in ['beat', 'bar']:
                p = E_eff # Rhythmic phase lock
            else:
                f_base = speed * 1.0
                freq = (f_base * 0.1) + (vol_driver * 5.0) 
                st['phase'] = (st['phase'] + dt * freq) % 1.0
                p = st['phase']
            
            # Amplitude determined by driver (E_eff) multiplied by reactivity
            amp = E_eff * react
            
            if behavior in ['sine', 'lfo_sine']: y = amp * math.sin(p * 2.0 * math.pi)
            elif behavior in ['saw', 'lfo_saw']: y = amp * ((p * 2.0) - 1.0)
            elif behavior in ['square', 'lfo_square']: y = amp if p < 0.5 else -amp
            elif behavior in ['triangle', 'lfo_triangle']: y = amp * (abs((p * 4.0) - 2.0) - 1.0)

        elif behavior in ['push', 'pull', 'kinematic_push', 'kinematic_pull']:
            # Kinematics Pillar (Spring-Mass-Damper Simulation)
            # speed -> stiffness (k), react -> damping (c)
            # Scaling adjusted to keep output naturally within [-1, 1] for typical audio input
            k = speed * 25.0 + 1.0 # Min stiffness to prevent runaway
            c = (1.0 - react) * 8.0 + 2.0 # Min damping for stability
            force_mult = 15.0 # Reduced force
            force = E_eff * force_mult if behavior in ['push', 'kinematic_push'] else -E_eff * force_mult
            
            accel = force - (k * st['pos']) - (c * st['vel'])
            st['vel'] += accel * dt
            st['pos'] += st['vel'] * dt
            y = st['pos']

        elif behavior in ['noise', 'simplex', 'perlin', 'noise_simplex', 'noise_perlin']:
            # Noise Pillar: speed -> base scroll speed, react -> audio jitter
            noise_rate = speed * 0.5 + (E_eff * react * 2.0)
            st['t'] += dt * noise_rate
            y = (logic_matrix._noise1d(st['t']) * 2.0) - 1.0

        elif behavior in ['step', 'forward', 'pingpong', 'step_forward', 'step_pingpong']:
            # Step Pillar: Standard 4-step sequence (0, 85, 170, 255) for all roles
            seq = [0, 85, 170, 255]
            
            rate = speed * 4.0
            
            if source in ['beat', 'bar']:
                st['phase'] = E_eff # Step on each beat cycle
            else:
                st['phase'] += dt * rate * (1.0 + E_eff * 2.0)

            if st['phase'] >= 1.0:
                st['phase'] = 0.0
                if behavior in ['forward', 'step_forward']:
                    st['step'] = (st['step'] + 1) % len(seq)
                else: # pingpong, step_pingpong
                    if 'dir' not in st: st['dir'] = 1
                    st['step'] += st['dir']
                    if st['step'] >= len(seq)-1 or st['step'] <= 0: st['dir'] *= -1
            
            y = (seq[st['step']] / 127.5) - 1.0

        elif behavior in ['random', 'adjacent', 'erratic', 'markov_adjacent', 'markov_erratic']:
            # Markov Pillar: 5-level probability sampling
            is_beat_trig = audio.get('beat', False)
            if is_beat_trig and not st.get('last_beat'):
                r = random.random()
                curr = st['bucket']
                if behavior in ['adjacent', 'markov_adjacent']:
                    if r < 0.20: pass # 20% Stay
                    elif r < 0.55: st['bucket'] = min(4, curr + 1) # 35% Up
                    elif r < 0.90: st['bucket'] = max(0, curr - 1) # 35% Down
                    elif r < 0.95: st['bucket'] = min(4, curr + 2) # 5% Jump Up
                    else: st['bucket'] = max(0, curr - 2) # 5% Jump Down
                else: # random, erratic, markov_erratic
                    if r < 0.10: 
                        st['bucket'] = min(4, max(0, curr + random.choice([-1, 0, 1])))
                    else:
                        others = [i for i in range(5) if abs(i - curr) > 1]
                        if others: st['bucket'] = random.choice(others)
            
            st['last_beat'] = is_beat_trig
            y = (st['bucket'] * 64.0 / 127.5) - 1.0

        # final DMX mapping
        # y is normalized where 0.0 is center.
        y = max(-1.0, min(1.0, y))
        if y >= 0: final_dmx = c_center + (y * (c_max - c_center))
        else: final_dmx = c_center + (y * (c_center - c_min))
        
        # 5. Hold Persistence Logic (NON-KINEMATICS)
        if not is_kinematics:
            if st.get('hold_active'):
                if 'held_dmx' not in st: st['held_dmx'] = final_dmx
                final_dmx = st['held_dmx']
            else:
                st.pop('held_dmx', None)

        return max(c_min, min(c_max, int(final_dmx)))

    def _evaluate_preset_behavior(self, ov_ch, audio, logic_matrix, instance_key):
        """
        Evaluate a behavior-mode preset override channel using the same math
        as _calculate_channel, but driven by the override's own definition
        instead of a profile rule.
        
        ov_ch schema:
        {
            "name": "dimmer",
            "mode": "behavior",
            "behavior": "sine|saw|square|triangle|push|pull|noise|step|...",
            "source": "volume|bass|flux|beat|...",
            "modifiers": {"speed": 0.5, "react": 0.5, "hold_type": "none"},
            "cal": {"min": 0, "center": 127, "max": 255}
        }
        """
        behavior = ov_ch.get('behavior', 'static')
        source = ov_ch.get('source', 'volume')
        mods = ov_ch.get('modifiers', {})
        speed = float(mods.get('speed', 0.5))
        react = float(mods.get('react', 0.5))
        hold_type = mods.get('hold_type', 'none')

        cal = ov_ch.get('cal', {})
        c_min = int(cal.get('min', 0))
        c_max = int(cal.get('max', 255))
        c_center = int(cal.get('center', (c_min + c_max) // 2))

        if behavior == 'static':
            return max(0, min(255, int(ov_ch.get('value', c_center))))

        # Resolve driver energy from LogicMatrix
        E = logic_matrix.state.get(source, 0.0)

        # Per-instance state persistence
        st = logic_matrix.states[instance_key]
        if 'pos' not in st:
            st.update({
                'pos': 0.0, 'vel': 0.0, 'phase': 0.0, 't': 0.0,
                'bucket': 0, 'step': 0, 'hold_active': False,
                'last_beat': False
            })

        # Hold logic
        is_beat = audio.get('beat', False)
        is_bar = audio.get('bar', False)
        trigger_hold = False
        is_pulse_type = hold_type in ['beat', 'sync_beat', 'bar', 'sync_bar']

        if hold_type in ['beat', 'sync_beat'] and is_beat: trigger_hold = True
        elif hold_type in ['bar', 'sync_bar'] and is_bar: trigger_hold = True
        elif hold_type == 'peakpause' and E > 0.85: trigger_hold = True
        elif hold_type == 'floorfreeze' and E < 0.15: trigger_hold = True

        is_kinematics = behavior in ['push', 'pull', 'kinematic_push', 'kinematic_pull']

        if trigger_hold:
            if is_kinematics:
                st['held_force'] = E
            else:
                if is_pulse_type:
                    st.pop('held_dmx', None)
                st['hold_active'] = True
        else:
            if not is_pulse_type:
                st['hold_active'] = False
                st.pop('held_force', None)
                st.pop('held_dmx', None)

        E_eff = st.get('held_force', E)
        dt = self._dt
        y = 0.0

        # --- Behavior evaluation (same math as _calculate_channel) ---
        if behavior in ['sine', 'saw', 'square', 'triangle',
                        'lfo_sine', 'lfo_saw', 'lfo_square', 'lfo_triangle']:
            vol_driver = float(audio.get('vol', 0.1))
            if source in ['beat', 'bar']:
                p = E_eff
            else:
                f_base = speed * 1.0
                freq = (f_base * 0.1) + (vol_driver * 5.0)
                st['phase'] = (st['phase'] + dt * freq) % 1.0
                p = st['phase']

            amp = E_eff * react
            if behavior in ['sine', 'lfo_sine']: y = amp * math.sin(p * 2.0 * math.pi)
            elif behavior in ['saw', 'lfo_saw']: y = amp * ((p * 2.0) - 1.0)
            elif behavior in ['square', 'lfo_square']: y = amp if p < 0.5 else -amp
            elif behavior in ['triangle', 'lfo_triangle']: y = amp * (abs((p * 4.0) - 2.0) - 1.0)

        elif behavior in ['push', 'pull', 'kinematic_push', 'kinematic_pull']:
            k = speed * 25.0 + 1.0
            c = (1.0 - react) * 8.0 + 2.0
            force_mult = 15.0
            force = E_eff * force_mult if behavior in ['push', 'kinematic_push'] else -E_eff * force_mult
            accel = force - (k * st['pos']) - (c * st['vel'])
            st['vel'] += accel * dt
            st['pos'] += st['vel'] * dt
            y = st['pos']

        elif behavior in ['noise', 'simplex', 'perlin', 'noise_simplex', 'noise_perlin']:
            noise_rate = speed * 0.5 + (E_eff * react * 2.0)
            st['t'] += dt * noise_rate
            y = (logic_matrix._noise1d(st['t']) * 2.0) - 1.0

        elif behavior in ['step', 'forward', 'pingpong', 'step_forward', 'step_pingpong']:
            seq = [0, 85, 170, 255]
            rate = speed * 4.0
            if source in ['beat', 'bar']:
                st['phase'] = E_eff
            else:
                st['phase'] += dt * rate * (1.0 + E_eff * 2.0)
            if st['phase'] >= 1.0:
                st['phase'] = 0.0
                if behavior in ['forward', 'step_forward']:
                    st['step'] = (st['step'] + 1) % len(seq)
                else:
                    if 'dir' not in st: st['dir'] = 1
                    st['step'] += st['dir']
                    if st['step'] >= len(seq)-1 or st['step'] <= 0: st['dir'] *= -1
            y = (seq[st['step']] / 127.5) - 1.0

        elif behavior in ['random', 'adjacent', 'erratic', 'markov_adjacent', 'markov_erratic']:
            is_beat_trig = audio.get('beat', False)
            if is_beat_trig and not st.get('last_beat'):
                r = random.random()
                curr = st['bucket']
                if behavior in ['adjacent', 'markov_adjacent']:
                    if r < 0.20: pass
                    elif r < 0.55: st['bucket'] = min(4, curr + 1)
                    elif r < 0.90: st['bucket'] = max(0, curr - 1)
                    elif r < 0.95: st['bucket'] = min(4, curr + 2)
                    else: st['bucket'] = max(0, curr - 2)
                else:
                    if r < 0.10:
                        st['bucket'] = min(4, max(0, curr + random.choice([-1, 0, 1])))
                    else:
                        others = [i for i in range(5) if abs(i - curr) > 1]
                        if others: st['bucket'] = random.choice(others)
            st['last_beat'] = is_beat_trig
            y = (st['bucket'] * 64.0 / 127.5) - 1.0

        elif behavior == 'direct':
            y = (E_eff * react * 2.0) - 1.0

        # Map normalized y to DMX via 3-point calibration
        y = max(-1.0, min(1.0, y))
        if y >= 0: final_dmx = c_center + (y * (c_max - c_center))
        else: final_dmx = c_center + (y * (c_center - c_min))

        # Hold persistence
        if not is_kinematics:
            if st.get('hold_active'):
                if 'held_dmx' not in st: st['held_dmx'] = final_dmx
                final_dmx = st['held_dmx']
            else:
                st.pop('held_dmx', None)

        return max(c_min, min(c_max, int(final_dmx)))

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
