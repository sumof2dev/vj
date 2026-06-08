import time
import math
import random
import os
import json
import re

SPEED_MULT_PATTERN = re.compile(r'x\s*([0-9]+(?:\.[0-9]+)?)')
SPEED_MULT_END_PATTERN = re.compile(r'x\s*([0-9]+(?:\.[0-9]+)?)$')
import collections
from typing import Dict
import threading

class ChannelConfig:
    """Pre-resolved channel mapping rules for hot-loop performance."""
    __slots__ = ['mod_name', 'rules', 'states', 'default_val', 'is_controller', 'threshold', 'vibe_splits']
    def __init__(self, rules, states, default_val, threshold=0.0, mod_name='static', vibe_splits=None):
        self.rules = rules # List of dicts: layer, mod, vibe, cal: [min, center, max], lfo, state_map, etc.
        self.states = states
        self.default_val = default_val
        self.is_controller = False
        self.threshold = threshold
        self.mod_name = mod_name
        self.vibe_splits = vibe_splits or {"chillMid": 33, "midHigh": 66}

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
            variant_val = global_sync_indices.get(search_vibe, None)
            if variant_val is not None:
                variant = variant_val + 1 if isinstance(variant_val, int) else variant_val
                tagged_vibe = f"{search_vibe} {variant}"
                matching_indices = [
                    i for i, r in enumerate(self.rules)
                    if r.get('vibe') == tagged_vibe and not r.get('muted') and not r.get('modifiers', {}).get('muted', False)
                ]
            
        if not matching_indices:
            # Fallback to standard vibe matching
            matching_indices = [
                i for i, r in enumerate(self.rules)
                if r.get('vibe') == search_vibe and not r.get('muted') and not r.get('modifiers', {}).get('muted', False)
            ]
        
        # Handle fallback to 'any' for non-transient vibes
        if not matching_indices and not is_transient:
            is_fallback = True
            search_vibe = f'any:{current_vibe}' # Re-rolls on base vibe change, stable during variant changes
            
            # Check for synchronized fallback (e.g. "any 1")
            if global_sync_indices:
                variant_val = global_sync_indices.get('any', None)
                if variant_val is not None:
                    variant = variant_val + 1 if isinstance(variant_val, int) else variant_val
                    tagged_any = f"any {variant}"
                    matching_indices = [
                        i for i, r in enumerate(self.rules)
                        if r.get('vibe') == tagged_any and not r.get('muted') and not r.get('modifiers', {}).get('muted', False)
                    ]

            if not matching_indices:
                matching_indices = [
                    i for i, r in enumerate(self.rules)
                    if r.get('vibe') in ['any', 'any/fallback'] and not r.get('muted') and not r.get('modifiers', {}).get('muted', False)
                ]

        # 4. Absolute Fallback: If still nothing, use the first non-disabled, non-muted rule
        if not matching_indices:
            for r in self.rules:
                if r.get('vibe') != 'never' and not r.get('muted') and not r.get('modifiers', {}).get('muted', False):
                    return r
            return None # Revert to default channel value

        # 5. Random Logic: Pick one random rule from the matching set
        # We use a stable seed (vibe change or sync variant change) to maintain the choice
        # until the vibe category or variant index rotates.
        if state['last_vibe'] != search_vibe:
            state['last_vibe'] = search_vibe
            if len(matching_indices) > 1:
                state['indices'][search_vibe] = random.randrange(len(matching_indices))
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
        four_bar_phase = ((self.beat_count % 16) + beat_phase) / 16.0

        self.state = {
            'bass': float(audio.get('bass', 0.0)),
            'mids': float(audio.get('mid', 0.0)),
            'highs': float(audio.get('high', 0.0)),
            'bass_p': float(audio.get('bass_p', 0.0)),  # Maps pure kick transients to DMX core lookups
            'mids_p': float(audio.get('mid_p', 0.0)),   # Maps pure snare transients to DMX core lookups
            'highs_p': float(audio.get('high_p', 0.0)), # Maps pure hat transients to DMX core lookups
            'bass_h': float(audio.get('bass_h', 0.0)),
            'mids_h': float(audio.get('mid_h', 0.0)),
            'highs_h': float(audio.get('high_h', 0.0)),
            'volume': float(audio.get('vol', 0.0)),
            'impact': float(audio.get('flux', 0.0)),
            'spectral flux': float(audio.get('flux', 0.0)),
            'beat phase': beat_phase,
            'bar phase': bar_phase,
            '4 bar phase': four_bar_phase,
            'static': 1.0,
            'zero': 0.0,
            'kick': float(audio.get('kick_behavior', 0.0)),   # Scaled 0-1: max on kick hit, 0 otherwise
            'snare': float(audio.get('snare_behavior', 0.0)), # Scaled 0-1: max on snare hit, 0 otherwise
            'cymbal': float(audio.get('cymbal_behavior', 0.0)), # Scaled 0-1: max on cymbal hit, 0 otherwise
            'beat': 1.0 if audio.get('beat', False) else 0.0
        }

        # Add specific frequency bins (0 and 4 only)
        bins = audio.get('bins', [0.0]*6)
        if len(bins) > 0: self.state['bin 0'] = min(1.0, float(bins[0]) * 2.0)
        if len(bins) > 4: self.state['bin 4'] = min(1.0, float(bins[4]) * 2.0)

class DMXEngine:
    def __init__(self):
        self.universe = bytearray(513)
        self.prev_universe = bytearray(513)
        self.universe[0] = 0x00
        self.overrides = {}
        self._dt = 0.016
        
        self.logic = LogicMatrix()
        self.logic_l = LogicMatrix()
        self.logic_r = LogicMatrix()
        
        self.base_speed = 0.6 
        # previously intensity 1.0
        self.base_intensity = 1.0
        # previously eff_speed 0.6
        self.eff_speed = 0.6
        self.eff_intensity = 1.0
        self.vibe_reactivity = {"chill": 1.0, "mid": 1.5, "high": 2.0}
        self._eff_dt = 0.016
        self.scene_freq = 1
        self.audio_sensitivity = 1.0
        self.active_presets = [] # Combined list for UI/Broadcast (Held + Auto + Manual)
        self.auto_active_presets = [] # Sustained presets triggered by audio (picked randomly)
        self.auto_one_shots = [] # Zero-hold presets triggered by audio (all simultaneous)
        self.manual_active_presets = set() # Set of preset IDs manually forced ON
        
        # Pause System
        self.is_paused = False
        
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
        self._processed_phases_this_frame = set()
        self._silence_start = None
        self.blackout = False
        self._was_silent = False
        self._last_variant_change_time = 0.0
        self._last_frame_one_shot_ids = set()
        
        self.behavior_defaults = {}
        self._descriptors_path = os.path.join('backend', 'descriptors.json')
        self._descriptors_mtime = 0
        
        self.sync_indices = {
            'chill': 1, 'mid': 1, 'high': 1, 'any': 1, 'build': 1, 'drop': 1
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
        self.active_visual_commands = []
        
        self._load_profiles()
        self._load_descriptors()
        
        self._reload_thread = threading.Thread(target=self._hot_reload_loop, daemon=True)
        self._reload_thread.start()

    def _resolve_spectral_variant(self, audio):
        """Returns variant string ('bass', 'treble', or '') based on frequency dominance."""
        raw_bins = audio.get('bins', [0.0] * 6)
        bins = [float(b) for b in raw_bins] if raw_bins else [0.0] * 6
        
        bass_energy = bins[0] + bins[1]
        mid_energy = bins[2] + bins[3]
        treble_energy = bins[4] + bins[5]
        
        total = bass_energy + mid_energy + treble_energy + 1e-6
        bass_ratio = bass_energy / total
        treble_ratio = treble_energy / total
        
        variant = ""
        dominant = 0
        
        if bass_ratio > 0.40 and treble_ratio < 0.20:
            variant = "bass"
            dominant = 0 if bins[0] > bins[1] else 1
        elif treble_ratio > 0.40 and bass_ratio < 0.20:
            variant = "treble"
            dominant = 4 if bins[4] > bins[5] else 5
        else:
            dominant = bins.index(max(bins)) if max(bins) > 0 else 0
            
        return variant, dominant

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

    def _find_fixture_role_address(self, fixture_id, role_name):
        # Find stage instance with resilient matching (ID, ProfileName, or Zone)
        inst = next((i for i in self.stage_instances if 
                    i['id'] == fixture_id or 
                    i.get('profileName') == fixture_id or 
                    str(i.get('zone', '')).lower() == fixture_id.lower()), None)
        
        if not inst: return -1
        
        base_addr = inst.get('address', 1)
        prof_id = inst.get('profileId')
        if not prof_id: return -1
        
        prof = self.profiles.get(prof_id)
        if not prof: return -1
        
        # Find channel with this role
        channels = prof.get('channels', [])
        for ch_idx, ch in enumerate(channels):
            if ch.get('role') == role_name or ch.get('name') == role_name:
                return base_addr + ch_idx
        
        return -1

    def _build_fast_cache(self):
        new_cache = {}
        for p_id, profile in self.profiles.items():
            new_cache[p_id] = {}
            channels = profile.get('channels', [])
            if not channels: continue
            
            mappings = profile.get('mappings', [])
            vibe_splits_map = profile.get('vibeSplits', {})
            
            for ch_idx, ch in enumerate(channels):
                rules = mappings[ch_idx] if ch_idx < len(mappings) else []
                default_val = ch.get('default', 127)
                vibe_splits = vibe_splits_map.get(str(ch_idx), {"chillMid": 33, "midHigh": 66})
                
                new_cache[p_id][ch_idx] = ChannelConfig(
                    rules=rules,
                    states={}, 
                    default_val=default_val,
                    threshold=0.0,
                    vibe_splits=vibe_splits
                )
        self._fast_cache = new_cache

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

    def _get_zone_context(self, zone_str, audio):
        zone_str = str(zone_str or '').lower()
        
        # 1. Spatial routing
        if 'left' in zone_str:
            active_logic = self.logic_l
            spatial_audio = audio.get('left', audio)
        elif 'right' in zone_str:
            active_logic = self.logic_r
            spatial_audio = audio.get('right', audio)
        else:
            active_logic = self.logic
            spatial_audio = audio
            
        # 2. HPSS filtering
        if 'harmony' in zone_str or 'harmonic' in zone_str:
            active_audio = {
                **spatial_audio,
                'bass': spatial_audio.get('bass_h', 0.0),
                'mid': spatial_audio.get('mid_h', 0.0),
                'high': spatial_audio.get('high_h', 0.0),
            }
        elif 'percussive' in zone_str:
            active_audio = {
                **spatial_audio,
                'bass': spatial_audio.get('bass_p', 0.0),
                'mid': spatial_audio.get('mid_p', 0.0),
                'high': spatial_audio.get('high_p', 0.0),
            }
        else:
            active_audio = spatial_audio
            
        return active_logic, active_audio

    def update(self, dt: float, audio: Dict, visual_states: Dict = None, gamepad: Dict = None):
        self._dt = dt
        self.prev_universe[:] = self.universe[:]
        self._processed_phases_this_frame.clear()
        
        # PAUSE LOGIC
        if self.is_paused:
            # Shift all holds forward by dt so they don't expire while paused
            for p_id in self._preset_holds:
                self._preset_holds[p_id] += dt
            # Reapply hardware overrides even when paused
            for addr, val in self.overrides.items():
                if 0 < addr < len(self.universe):
                    self.universe[addr] = max(0, min(255, int(val)))
            return
        
        self.eff_speed = self.base_speed
        self.eff_intensity = self.base_intensity
        self._eff_dt = dt * self.eff_speed

        self.prev_gamepad = self.gamepad
        self.gamepad = gamepad or {}
        self.transient = audio.get('transient', 'steady')
        current_vibe = audio.get('vibe', 'mid')
        variant = self.sync_indices.get(current_vibe, 1) + 1
        tagged_vibe = f"{current_vibe} {variant}"
        
        # --- AUTOMATIC PRESETS (Triggers) ---
        possible_auto_presets = []
        
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
                    # Warn the user about the broken preset
                    if not hasattr(self, '_warned_presets'): self._warned_presets = set()
                    p_name = p_data.get('name', 'Unknown')
                    if p_name not in self._warned_presets:
                        print(f"⚠️  Preset '{p_name}' contains an empty/invalid trigger.")
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

                if t_cat == 'vibe':
                    t_val = trig.get('vibe', trig.get('value'))
                    if t_val == current_vibe or t_val == tagged_vibe:
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
                    if len(bins) >= 6:
                        # Extract energies
                        bass_energy = float(bins[0]) + float(bins[1])
                        mid_energy = float(bins[2]) + float(bins[3])
                        treble_energy = float(bins[4]) + float(bins[5])
                        
                        max_energy = max(bass_energy, mid_energy, treble_energy)
                        if max_energy > 0.01:
                            target = str(trig.get('target', 'bass')).lower()
                            if target == 'bass' and bass_energy == max_energy:
                                trig_matched = True
                            elif target == 'mid' and mid_energy == max_energy:
                                trig_matched = True
                            elif target == 'treble' and treble_energy == max_energy:
                                trig_matched = True

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
                possible_auto_presets.append(p_data)
                
        # Separate matching presets into sustained (one randomly chosen) and one-shots (exclusion logic)
        auto_sustained = [p for p in possible_auto_presets if int(p.get('decay', 0)) > 0]
        potential_one_shots = [p for p in possible_auto_presets if int(p.get('decay', 0)) == 0]

        # --- SUSTAINED EXCLUSION LOGIC ---
        # "if preset1 is active, prrset 2 may not override if hold time > 0"
        # Check if any held presets are still active (Decay logic)
        now = time.time()
        
        if self.is_paused:
            # Shift all holds forward by dt so they don't expire while paused
            for p_id in self._preset_holds:
                self._preset_holds[p_id] += dt
        
        held_presets = []
        for p_id, hold_until in list(self._preset_holds.items()):
            if now < hold_until:
                p_data = next((p for p in self.presets if str(p.get('id', '')) == p_id), None)
                if p_data: held_presets.append(p_data)
            else:
                self._preset_holds.pop(p_id, None)

        self.auto_active_presets = []
        if held_presets:
            # A sustained preset is already active/decaying. Block all new ones.
            pass
        elif auto_sustained:
            # If multiple sustained presets match, pick one at random
            seed = self.logic.beat_count
            rng = random.Random(seed)
            self.auto_active_presets = [rng.choice(auto_sustained)]
            
            # Start decay timer for the chosen one
            for p in self.auto_active_presets:
                p_id = str(p.get('id', ''))
                decay = int(p.get('decay', 0))
                self._preset_holds[p_id] = now + decay if decay != 999 else now + 999999
        
        # --- ONE-SHOT EXCLUSION LOGIC ---
        # "if preset2 was active first, preset 1 is not allowed if they target the same fixture+role"
        self.auto_one_shots = []
        existing_one_shots = []
        new_one_shots = []
        
        for p in potential_one_shots:
            p_id = str(p.get('id', ''))
            if p_id in self._last_frame_one_shot_ids:
                existing_one_shots.append(p)
            else:
                new_one_shots.append(p)
                
        self.auto_one_shots.extend(existing_one_shots)
        
        def get_preset_footprint(preset):
            fp = set()
            for ov in preset.get('overrides', []):
                t = str(ov.get('target', ov.get('id', ov.get('type', '')))).lower()
                r = str(ov.get('role', ov.get('name', ''))).lower()
                if t and r: fp.add(f"{t}:{r}")
                for ch in ov.get('channels', []):
                    cr = str(ch.get('role', ch.get('name', ''))).lower()
                    if t and cr: fp.add(f"{t}:{cr}")
            return fp

        active_footprint = set()
        for p in self.auto_one_shots:
            active_footprint.update(get_preset_footprint(p))
                    
        for p in new_one_shots:
            p_footprint = get_preset_footprint(p)
            # Allow if no overlap with already active/accepted one-shots
            if not active_footprint.intersection(p_footprint):
                self.auto_one_shots.append(p)
                active_footprint.update(p_footprint)
                
        self._last_frame_one_shot_ids = {str(p.get('id', '')) for p in self.auto_one_shots}
                
        # --- MERGE MANUAL PRESETS ---
        manual_presets_list = []
        for p_data in self.presets:
            if not p_data.get('active', True): continue
            p_id = str(p_data.get('id', ''))
            p_name = str(p_data.get('name', ''))
            if (p_id and p_id in self.manual_active_presets) or (p_name and p_name in self.manual_active_presets):
                manual_presets_list.append(p_data)
            elif (p_id.lower() in self.manual_active_presets) or (p_name.lower() in self.manual_active_presets):
                # Fallback to lowered only if exact match fails
                manual_presets_list.append(p_data)

        manual_sustained = [p for p in manual_presets_list if int(p.get('decay', 0)) > 0]
        manual_one_shots = [p for p in manual_presets_list if int(p.get('decay', 0)) == 0]

        # Update combined list for external observers and priority processing
        # Order: Held -> New Sustained -> Manual Sustained -> Auto One-Shots -> Manual One-Shots
        self.active_presets = held_presets + self.auto_active_presets + manual_sustained + self.auto_one_shots + manual_one_shots

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
                        # Standardize on effective dt (self._eff_dt) to ensure visualizers stay in sync with fixture speeds
                        resolved_val = self._resolve_preset_value(ov_key, ch.get('value', 0), self._eff_dt)
                        self.active_visual_commands.append({
                            "function": fn,
                            "value": resolved_val
                        })
                        if fn == 'next_visual': force_next_visual = True
                        if fn == 'next_fx': force_next_fx = True

        if not self.is_paused:
            self.logic.update(dt, audio, self.transient, self.eff_speed, self.eff_intensity)
            if 'left' in audio and 'right' in audio:
                self.logic_l.update(dt, audio['left'], self.transient, self.eff_speed, self.eff_intensity)
                self.logic_r.update(dt, audio['right'], self.transient, self.eff_speed, self.eff_intensity)
            else:
                self.logic_l = self.logic
                self.logic_r = self.logic
        else:
            # Ensure references are valid when paused
            if 'left' not in audio or 'right' not in audio:
                self.logic_l = self.logic
                self.logic_r = self.logic
        
        # Removed legacy rhythm triggers
        
        # --- Vibe/Variant/Transient Change Detection ---
        # Stability: 0.03 to enter silence, 0.06 to recover (prevent jitter at noise floor)
        vol = audio.get('vol', 0.0)
        is_silent = vol < (0.06 if self._was_silent else 0.03)
        vibe_changed = current_vibe != self._last_vibe
        silence_recovered = self._was_silent and not is_silent
        transient_changed = self.transient != self._last_transient
        variant_changed = False
        
        # Spectral Resolution (Determines synchronized 1, 2, or 3 variant)
        # Stability: Only rotate variant if energy is significant (>0.1) or vibe changed
        if vibe_changed or silence_recovered or transient_changed:
            old_variant = self.sync_indices.get(current_vibe, 1) # Default to 1 (neutral/mid index)
            variant_str, dominant = self._resolve_spectral_variant(audio)
            
            # Map string variant to integer index (0: bass, 1: neutral, 2: treble)
            mapping = {"bass": 0, "": 1, "treble": 2}
            variant = mapping.get(variant_str, 1)
            
            # Dampen variant changes: Only rotate if volume is above 0.1 or it's a major vibe change
            # This prevents ghost cycling during quiet passages or noise floor jitter
            if variant != old_variant:
                now = time.time()
                if vibe_changed or (vol > 0.1 and now - self._last_variant_change_time > 2.0):
                    variant_changed = True
                    self._last_variant_change_time = now
            
            if not variant_changed and not vibe_changed:
                variant = old_variant

            self.sync_indices[current_vibe] = variant
            self.sync_indices['any'] = variant
            
            # Also update transient-specific indices
            eff_transient_vibe = None
            if self.transient == 'building': eff_transient_vibe = 'build'
            elif self.transient == 'dropping': eff_transient_vibe = 'drop'
            if eff_transient_vibe and transient_changed:
                self.sync_indices[eff_transient_vibe] = variant

            if variant_changed or vibe_changed:
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
            self.lab_dmx_val = self._apply_rule_math(self.lab_probe_rule, self.lab_probe_state, self.logic, dt * self.eff_speed, audio=audio, use_intensity=False)
        else:
            self.lab_dmx_val = 0

        # 1. Base Layer Processing (Profiles + Auto Sustained + Held Presets)
        for i, inst in enumerate(self.stage_instances):
            self._process_instance(inst, i, audio, held_presets + self.auto_active_presets, self.sync_indices, use_raw_dt=False)

        # 2. Automated One-Shot Layer (Hold = 0)
        if self.auto_one_shots:
            for i, inst in enumerate(self.stage_instances):
                self._apply_presets_to_instance(inst, i, audio, self.auto_one_shots, use_raw_dt=False)

        # 3. Manual Sustained Layer (Hold > 0)
        # Higher priority than automated one-shots, allows manual clicks to override auto patterns
        if manual_sustained:
            for i, inst in enumerate(self.stage_instances):
                self._apply_presets_to_instance(inst, i, audio, manual_sustained, use_raw_dt=False)

        # 4. Manual One-Shot Layer
        if manual_one_shots:
            for i, inst in enumerate(self.stage_instances):
                self._apply_presets_to_instance(inst, i, audio, manual_one_shots, use_raw_dt=False)

        # 5. GLOBAL BLACKOUT OVERRIDE
        # Blackout everything underneath
        if self.blackout:
            for i in range(1, len(self.universe)):
                self.universe[i] = 0

        # 6. Hardware Overrides (Sliders/Console)
        # The absolute final word for any DMX channel, overrides even blackout
        for addr, val in self.overrides.items():
            if 0 < addr < len(self.universe):
                self.universe[addr] = max(0, min(255, int(val)))

    def get_active_preset_names(self):
        """Returns a list of names for currently active presets."""
        names = []
        for p in self.active_presets:
            names.append(p.get('name', 'unnamed'))
        return list(set(names)) # De-duplicate names

    def set_blackout(self, state):
        self.blackout = bool(state)
        print(f"🔦 Global Blackout: {'ON' if self.blackout else 'OFF'}")

    def _process_instance(self, inst, zone_idx, audio, active_presets, sync_indices=None, use_raw_dt=False):
        profile = self.profiles.get(inst.get('profileId'))
        if not profile: return

        channels = profile.get('channels', [])
        if not channels:
            fixture = self.fixtures.get(inst.get('fixtureId'))
            if fixture:
                channels = fixture.get('channels', [])
        
        if not channels: return

        try:
            base_addr = int(inst.get('address', 1))
        except: return
        
        # Resolve spatial and HPSS routing for the assigned zone
        active_logic, active_audio = self._get_zone_context(inst.get('zone'), audio)
        


        for ch_idx, ch_def in enumerate(channels):
            # Use addrOffset if provided explicitly, otherwise fallback to index relative to base_addr
            offset = ch_def.get('addrOffset')
            if offset is None: offset = ch_idx
            
            final_addr = base_addr + int(offset)
            if not (0 < final_addr < len(self.universe)): continue
            
            cache = self._fast_cache.get(profile['id'], {}).get(ch_idx)
            if not cache: continue
            
            val = self._calculate_channel(ch_idx, active_audio, active_logic, zone_idx, cache, profile['id'], ch_def, sync_indices, base_addr=base_addr, all_channels=channels)
            self.universe[final_addr] = max(0, min(255, int(val)))

        # Now apply presets
        self._apply_presets_to_instance(inst, zone_idx, audio, active_presets, use_raw_dt)

    def _apply_presets_to_instance(self, inst, zone_idx, audio, active_presets, use_raw_dt=False):
        profile = self.profiles.get(inst.get('profileId'))
        if not profile: return

        channels = profile.get('channels', [])
        if not channels:
            fixture = self.fixtures.get(inst.get('fixtureId'))
            if fixture:
                channels = fixture.get('channels', [])
        
        if not channels: return

        try:
            base_addr = int(inst.get('address', 1))
        except: return

        # Resolve spatial and HPSS routing for the assigned zone
        zone_str = str(inst.get('zone') or '').lower()
        active_logic, active_audio = self._get_zone_context(zone_str, audio)

        # Pre-resolve dt to use for this batch of presets
        dt_to_use = self._dt if use_raw_dt else self._eff_dt

        # 1. First Pass: Identify which roles are explicitly overridden by presets
        overridden_roles = set()
        for p_data in active_presets:
            for ov in p_data.get('overrides', []):
                if ov.get('type') == 'instance':
                    target_id = ov.get('target', ov.get('id'))
                    if (str(target_id).lower() == str(inst['id']).lower() or 
                        str(target_id).lower() == str(inst.get('profileName', '')).lower() or 
                        (inst.get('zone') and str(inst.get('zone')).lower() == str(target_id).lower())):
                        
                        # Use strictly the role field from the override
                        ov_top_role = str(ov.get('role', '')).lower()
                        if ov_top_role:
                            overridden_roles.add(ov_top_role)
                        for ov_ch in ov.get('channels', []):
                            ov_ch_role = str(ov_ch.get('role', ov_ch.get('name', ''))).lower()
                            if ov_ch_role:
                                overridden_roles.add(ov_ch_role)

        for ch_idx, ch_def in enumerate(channels):
            offset = ch_def.get('addrOffset')
            if offset is None: offset = ch_idx
            final_addr = base_addr + int(offset)
            if not (0 < final_addr < len(self.universe)): continue

            preset_override_val = None
            # Strictly use the role field as assigned in the UI dropdown
            target_role = str(ch_def.get('role', '')).lower()
            if not target_role: continue

            for p_data in active_presets:
                overrides = p_data.get('overrides', [])
                p_id = p_data.get('id', p_data.get('name', 'unknown'))
                for ov in overrides:
                    ov_type = ov.get('type')
                    target_id = ov.get('target', ov.get('id'))
                    matched_ov_ch = None
                    
                    if ov_type == 'instance':
                        is_match = (str(target_id).lower() == str(inst['id']).lower() or 
                                   str(target_id).lower() == str(inst.get('profileName', '')).lower() or 
                                   (inst.get('zone') and str(inst.get('zone')).lower() == str(target_id).lower()))
                        
                        if is_match:
                            # 1. Check if the top-level override role matches
                            ov_top_role = str(ov.get('role', '')).lower()
                            
                            for ov_ch in ov.get('channels', []):
                                # Match strictly by the role defined in the preset override
                                ov_ch_role = str(ov_ch.get('role', ov_ch.get('name', ''))).lower()
                                
                                # A match occurs if:
                                # - The specific channel role/name matches the profile role
                                # - OR the top-level override role matches the profile role
                                if ov_ch_role == target_role or ov_top_role == target_role:
                                    matched_ov_ch = ov_ch
                                    break
                    elif ov_type == 'global':
                        ov_role = str(ov.get('role', ov.get('name', ''))).lower()
                        if target_role == ov_role or f"global: {target_role}" == ov_role:
                            for ov_ch in ov.get('channels', []):
                                if str(ov_ch.get('role', '')).lower() == target_role:
                                    matched_ov_ch = ov_ch
                                    break
                            if matched_ov_ch is None and 'value' in ov:
                                ov_key = f"dimmer_{p_id}_{target_id}_{inst['id']}"
                                preset_override_val = self._resolve_preset_value(ov_key, ov.get('value', 0), dt_to_use)

                    if matched_ov_ch is not None:
                        if matched_ov_ch.get('mode') == 'behavior':
                            z_idx = 0
                            if 'left' in zone_str: z_idx = 1
                            elif 'right' in zone_str: z_idx = 2
                            
                            bkey = f"preset_{p_id}_{ov.get('id','g')}_{target_role}_{z_idx}"
                            preset_override_val = self._evaluate_preset_behavior(
                                matched_ov_ch, active_audio, active_logic, bkey, use_raw_dt
                            )
                        else:
                            ov_key = f"dmx_{p_id}_{target_role}_{inst['id']}"
                            preset_override_val = self._resolve_preset_value(ov_key, matched_ov_ch.get('value', 0), dt_to_use)
            
            if preset_override_val is not None:
                self.universe[final_addr] = max(0, min(255, int(preset_override_val)))



    def _calculate_channel(self, ch_idx, audio, logic_matrix, zone_idx, cache, profile_id, ch_def=None, sync_indices=None, base_addr=1, all_channels=None):
        current_vibe = audio.get('vibe', 'mid')
        current_transient = audio.get('transient', 'steady')
        instance_key = f"{profile_id}_{ch_idx}_{zone_idx}"
        rule = cache.get_active_rule(current_vibe, current_transient, instance_key, sync_indices)
        if not rule: return cache.default_val
        
        # State Maintenance for this specific rule instance
        st = logic_matrix.states[instance_key]
        return self._apply_rule_math(rule, st, logic_matrix, self._dt * logic_matrix.speed_mult, 
                                    audio=audio, ch_def=ch_def, vibe_splits=cache.vibe_splits,
                                    base_addr=base_addr, all_channels=all_channels)

    def _apply_rule_math(self, rule, st, logic_matrix, dt, audio=None, ch_def=None, use_intensity=True, vibe_splits=None, base_addr=1, all_channels=None):
        """Core mathematical mapping from audio/logic to DMX value"""
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

        # Calibration
        cal = rule.get('cal') or {}
        fixture_cal = ch_def.get('calibration') or {} if ch_def else {}
        c_min = int(cal.get('min', fixture_cal.get('min', 0)))
        c_max = int(cal.get('max', fixture_cal.get('max', 255)))

        threshold_hold_val = mods.get('threshold_hold_value')
        threshold_hold_value = None
        if threshold_hold_val is not None and threshold_hold_val != '':
            try:
                threshold_hold_value = int(threshold_hold_val)
            except ValueError:
                pass

        if threshold_hold_value is not None:
            c_center = threshold_hold_value
        else:
            c_center = int(cal.get('center', fixture_cal.get('center', (c_min + c_max) // 2)))

        # Scale speed and react by the range span relative to 255
        range_span = float(c_max - c_min)
        scale_factor = range_span / 255.0 if range_span > 0 else 1.0

        speed = float(mods.get('speed', 0.5)) * scale_factor
        react = float(mods.get('react', 0.5)) * scale_factor
        gain = float(mods.get('gain', 1.0))
        hold_type = str(mods.get('hold_type', 'none')).lower()

        # --- DYNAMIC VIBE PARTITIONING (Removed) ---
        # Vibe partitioning completely removed per user request
        eff_min = float(c_min)
        eff_max = float(c_max)
        eff_center = float(c_center)

        # 1. Resolve Driver Magnitude (E)
        audio_key = source
        if source == 'mids': audio_key = 'mid'
        elif source == 'highs': audio_key = 'high'
        elif source == 'volume': audio_key = 'vol'
        elif source == 'kick': audio_key = 'kick_behavior'
        elif source == 'snare': audio_key = 'snare_behavior'
        elif source == 'cymbal': audio_key = 'cymbal_behavior'
        elif source == 'beat':
            if 'beat_env' not in st:
                st['beat_env'] = 0.0
            
            curr_beat_count = audio.get('beat_count', 0) if audio else 0
            curr_beat_state = bool(audio.get('beat', False)) if audio else False
            
            if 'last_source_beat_count' not in st:
                st['last_source_beat_count'] = curr_beat_count
            if 'last_source_beat_state' not in st:
                st['last_source_beat_state'] = curr_beat_state
                
            has_beat = False
            if curr_beat_state and not st['last_source_beat_state']:
                has_beat = True
            elif curr_beat_count > st['last_source_beat_count']:
                has_beat = True
                
            st['last_source_beat_count'] = curr_beat_count
            st['last_source_beat_state'] = curr_beat_state
            
            # If beat occurred, reset envelope to 1.0 (Beat (Binary) is volume-independent)
            if has_beat:
                st['beat_env'] = 1.0
            
            # Decay envelope: speed of 1.0 means fast decay, 0.0 means slow/no decay
            speed = float(mods.get('speed', 0.5))
            decay_rate = 1.0 + (speed * 20.0) # decay rate between 1.0 and 21.0
            st['beat_env'] = max(0.0, st['beat_env'] - dt * decay_rate * st['beat_env'])
            
            E = st['beat_env']
            audio_key = None
        elif source in ['spectral flux', 'impact']: audio_key = 'flux'
        elif source.startswith('bin ') or source.startswith('bin_'):
            try:
                b_idx = int(source.replace('bin ', '').replace('bin_', ''))
                bins = audio.get('bins', [0.0]*6) if audio else [0.0]*6
                E = min(1.0, float(bins[b_idx]) * 2.0) if b_idx < len(bins) else 0.0
                audio_key = None
            except (ValueError, IndexError):
                E = 0.0
                audio_key = None
        
        if audio_key is not None:
            if audio and audio_key in audio:
                E = float(audio[audio_key])
            else:
                E = logic_matrix.state.get(source, 0.0)

        # --- VIBE-DEPENDENT DRIVER REACTIVITY TUNING ---
        current_vibe = audio.get('vibe', 'mid') if audio else 'mid'
        reactivity = getattr(self, 'vibe_reactivity', {}).get(current_vibe, 1.0)
        
        if current_vibe == 'chill':
            # Exponentially compress moderate signals, scaled by chill reactivity
            E = math.pow(E, 1.75) * reactivity
        elif current_vibe == 'high':
            # Boost the incoming signal gain, scaled by high reactivity
            E = min(1.0, E * reactivity)
        else:
            # Mid Vibe: scaled by mid reactivity
            E = min(1.0, E * reactivity)
        
        # Apply Threshold Gate
        threshold = float(mods.get('threshold', 0.0))
        is_gated = False
        if E < threshold:
            E = 0.0
            is_gated = True
        else:
            if threshold < 1.0:
                E = (E - threshold) / (1.0 - threshold)
            else:
                E = 0.0

        # 2. State Maintenance
        if 'phase' not in st: 
            st.update({'phase': 0.0, 't': 0.0, 'hold_active': False, 'held_dmx': eff_center, 'step': 0, 'bucket': 0, 'last_beat': False})

        # 3. Hold Logic (Pulse-aware transitions)
        curr_beat_count = audio.get('beat_count', 0) if audio else 0
        curr_beat_state = bool(audio.get('beat', False)) if audio else False
        
        if 'last_hold_beat_count' not in st: st['last_hold_beat_count'] = curr_beat_count
        if 'last_hold_beat_state' not in st: st['last_hold_beat_state'] = curr_beat_state
        
        # Detect if a NEW beat has occurred since the last engine frame
        has_new_beat = False
        if curr_beat_state and not st['last_hold_beat_state']:
            has_new_beat = True
        elif curr_beat_count > st['last_hold_beat_count']:
            has_new_beat = True
            
        # Also detect a "Bar" (every 4 beats or when the bar flag is active)
        has_new_bar = False
        if has_new_beat:
            if audio and audio.get('bar', False):
                has_new_bar = True
            elif curr_beat_count % 4 == 0:
                has_new_bar = True
        
        # Update state for next frame
        st['last_hold_beat_count'] = curr_beat_count
        st['last_hold_beat_state'] = curr_beat_state
        
        trigger_hold = False
        if hold_type == 'beat' and has_new_beat: trigger_hold = True
        elif hold_type == 'bar' and has_new_bar: trigger_hold = True
        
        if trigger_hold: 
            st['hold_active'] = True
            st.pop('held_dmx', None)
        elif hold_type == 'none':
            st['hold_active'] = False

        # 4. Behavior Logic
        y = 0.0 
        
        if behavior == 'static':
            # For static behavior, if we have a specific 'value', use it. 
            # Otherwise use the center of our partitioned range.
            if 'value' in rule:
                return max(0, min(255, int(rule['value'])))
            return max(0, min(255, int(eff_center)))
        
        elif behavior == 'direct':
            y = (E * react * 2.0) - 1.0
            
        elif behavior in ['sine', 'square', 'saw', 'triangle']:
            if source in ['beat phase', 'bar phase', '4 bar phase', 'bar']:
                p = E # Rhythmic phase lock
            else:
                # Frequency is now locked directly to a smooth, non-jittery rhythmic timeline
                track_bpm = audio.get('bpm', 120.0) if audio else 120.0
                freq = (track_bpm / 60.0) * speed
                st['phase'] = (st['phase'] + dt * freq) % 1.0
                p = st['phase']
            
            # The audio driver (E) now scales the wave amplitude instead of speed
            amp = E * react
            if behavior == 'sine': y = amp * math.sin(p * 2.0 * math.pi)
            elif behavior == 'saw': y = amp * ((p * 2.0) - 1.0)
            elif behavior == 'square': y = amp if p < 0.5 else -amp
        elif behavior == 'noise':
            st['t'] += dt * (speed * 0.5 + E * react * 2.0)
            y = (logic_matrix._noise1d(st['t']) * 2.0) - 1.0

        elif behavior == 'beat phase':
            p = logic_matrix.state.get('beat phase', 0.0)
            y = (p * 2.0 * E) - 1.0

        elif behavior == 'stochastic':
            y = (random.random() * 2.0) - 1.0

        elif behavior == 'spike':
            if 'spike_val' not in st: st['spike_val'] = 0.0
            threshold = (1.0 - react) * 0.35
            if E > st.get('last_E', 0.0) + threshold:
                st['spike_val'] = E
            st['spike_val'] *= max(0.0, 1.0 - dt * speed * 1.2)
            st['last_E'] = E
            y = (st['spike_val'] * 2.0) - 1.0

        elif behavior == 'fuzzy':
            st['t'] += dt * speed * 1.8
            noise = (self.logic._noise1d(st['t']) * 2.0 - 1.0) * react * 0.25
            y = ((E + noise) * 2.0) - 1.0

        elif behavior == 'fuzzy_pulsed':
            # Couples micro-flutter frequency directly to real-time transient energy (impact/flux)
            flux_val = audio.get('flux', 0.0) if audio else logic_matrix.state.get('impact', 0.0)
            st['t'] += dt * speed * (5.0 + flux_val * 15.0)
            
            # Deterministic high-frequency vibration modulated by current driver magnitude
            pulsed_deviation = math.sin(st['t'] * math.pi * 2.0) * react * 0.15 * E
            y = (E * 2.0) - 1.0 + pulsed_deviation

        elif behavior == 'bar phase':
            p = logic_matrix.state.get('bar phase', 0.0)
            y = (p * 2.0 * E) - 1.0

        elif behavior == 'direct_stepped':
            y = (math.floor(E * 8) / 8 * 2.0) - 1.0
            
        if (is_gated or E == 0.0) and threshold_hold_value is not None:
            final_dmx = threshold_hold_value
        else:
            if is_gated:
                y = -1.0
            
            # --- Y → DMX MAPPING ---
            # Mapping normalized y to DMX
            y = max(-1.0, min(1.0, y * gain))
            if use_intensity:
                y *= self.eff_intensity  # Scale amplitude within range, not absolute DMX
            
            if y >= 0: final_dmx = eff_center + (y * (eff_max - eff_center))
            else: final_dmx = eff_center + (y * (eff_center - eff_min))
        
        # Hold persistence
        if hold_type != 'none':
            if st['hold_active']:
                if 'held_dmx' not in st: st['held_dmx'] = final_dmx
                final_dmx = st['held_dmx']
            else:
                st.pop('held_dmx', None)
        
        return max(0, min(255, int(final_dmx)))

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


        # 1. Parse Global Speed Multiplier (wherever it is in the string, e.g. x50)
        global_speed_mult = 1.0
        speed_match = SPEED_MULT_PATTERN.search(val.lower())
        if speed_match:
            try:
                global_speed_mult = float(speed_match.group(1))
                # Strip it from val so it doesn't break offset or part parsing
                val = val[:speed_match.start()] + val[speed_match.end():]
            except:
                pass

        # 2. Parse Offset (at the very end of the string)
        offset = 0.0
        main_val = val
        if '+' in val:
            parts = val.rsplit('+', 1)
            main_val = parts[0].strip()
            try:
                offset = float(parts[1].strip())
            except:
                pass

        # 3. Parse Sequence (split by comma)
        seq_parts = [p.strip() for p in main_val.split(',')]
        num_parts = len(seq_parts)
        if num_parts == 0: return 0

        # Pre-parse each part for speed multipliers, falling back to global_speed_mult
        parsed_parts = []
        for p in seq_parts:
            p_clean = p.strip()
            speed_mult = global_speed_mult
            match = SPEED_MULT_END_PATTERN.search(p_clean.lower())
            if match:
                try:
                    speed_mult = float(match.group(1))
                    p_clean = p_clean.rsplit('x', 1)[0].strip()
                except ValueError:
                    pass
            parsed_parts.append((p_clean, speed_mult))

        # 3. Maintain/Update Phase Accumulator
        if ov_key not in self._preset_sweep_phases:
            self._preset_sweep_phases[ov_key] = 0.0
        
        # Each part occupies a consistent "64 bit" phase window
        part_duration = 64.0
        total_cycle = num_parts * part_duration
        
        # Determine current part based on current phase (before incrementing)
        current_phase = (self._preset_sweep_phases[ov_key] + offset) % total_cycle
        current_part_idx = min(int(current_phase // part_duration), num_parts - 1)
        _, speed_mult = parsed_parts[current_part_idx]

        # Rate: 60 bits per second (Legacy speed standard)
        # FIX: Only increment ONCE per frame per key to prevent multi-channel speedup
        if ov_key not in self._processed_phases_this_frame:
            rate = 60.0 
            self._preset_sweep_phases[ov_key] = (self._preset_sweep_phases[ov_key] + dt * rate * speed_mult) % total_cycle
            self._processed_phases_this_frame.add(ov_key)
        
        # Apply offset and wrap
        eff_phase = (self._preset_sweep_phases[ov_key] + offset) % total_cycle
        
        # Determine which part of the sequence we are in
        part_idx = min(int(eff_phase // part_duration), num_parts - 1)
        local_phase = eff_phase % part_duration # 0.0 to 64.0
        
        part_str, _ = parsed_parts[part_idx]

        # 4. Resolve the specific part (Value or Sweep)
        keywords = {
            'on': 255, 'high': 255, 'max': 255, 'full': 255,
            'off': 0, 'low': 0, 'min': 0, 'zero': 0,
            'slow': 64, 'med': 128, 'mid': 128, 'fast': 200, 'punch': 255
        }

        if '-' in part_str:
            try:
                # Handle multi-dash chains like "32-96-32" or "slow-fast"
                raw_points = [p.strip().lower() for p in part_str.split('-') if p.strip()]
                points = []
                for rp in raw_points:
                    if rp in keywords:
                        points.append(float(keywords[rp]))
                    else:
                        points.append(float(rp))

                num_points = len(points)
                if num_points < 2: return int(points[0]) if points else 0
                
                # ... (rest of the interpolation logic remains same)
                num_segments = max(1, len(points) - 1)
                sub_duration = part_duration / num_segments
                
                sub_idx = int(local_phase // sub_duration)
                sub_idx = min(sub_idx, num_segments - 1)
                sub_local_phase = local_phase % sub_duration
                
                v_start = points[sub_idx]
                v_end = points[sub_idx + 1]
                
                t = sub_local_phase / sub_duration if sub_duration > 0 else 0.0
                t = max(0.0, min(1.0, t))
                
                return v_start + t * (v_end - v_start)
            except:
                return 0.0
        
        try:
            low_part = part_str.strip().lower()
            if low_part in keywords:
                return float(keywords[low_part])
            return float(part_str)
        except:
            return 0.0

    def _evaluate_preset_behavior(self, ov_ch, audio, logic_matrix, instance_key, use_raw_dt=False):
        """Standardized math for preset behavior overrides."""
        try:
            # Fallback for "value" vs "behavior" field names to support legacy/UI presets
            behavior = ov_ch.get('behavior', ov_ch.get('value', 'static'))
            if isinstance(behavior, int) or (isinstance(behavior, str) and behavior.isdigit()):
                behavior = 'static' # It's a raw value, not a behavior name

            # Force a rule-like object to reuse the math core
            rule = {
                'behavior': behavior,
                'source': ov_ch.get('source', 'volume'),
                'modifiers': ov_ch.get('modifiers', {}),
                'cal': ov_ch.get('cal', {'min': 0, 'center': 128, 'max': 255})
            }
            st = logic_matrix.states[instance_key]
            # Use raw dt if requested (e.g. for manual punch-through during pause)
            dt_to_use = self._dt if use_raw_dt else self._eff_dt
            return self._apply_rule_math(rule, st, logic_matrix, dt_to_use, audio=audio)
        except Exception as e:
            # print(f"⚠️ Preset behavior evaluation failed: {e}")
            return 0

    def get_universe(self): return self.universe[:]
    def set_intensity(self, val): self.base_intensity = float(val)
    def set_speed(self, val): self.base_speed = float(val)
    def set_audio_sensitivity(self, val): self.audio_sensitivity = float(val)
    def set_pause(self, state): 
        self.is_paused = bool(state)
        if self.is_paused:
            print("🛑 ENGINE PAUSED")
        else:
            print("▶️ ENGINE RESUMED")
    # Removed legacy _detect_bass_style

    def apply_overrides(self, ol, sl=[]):
        for o in ol:
            if 'address' in o:
                self.overrides[int(o['address'])] = int(o.get('value', 0))

    def clear_device_overrides(self, dev_id):
        # We now match by instance id or profile name
        if dev_id == "all":
            self.overrides = {}
            self.manual_active_presets.clear()
            print("🎛️ Cleared ALL manual overrides and manual presets")
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
        
        base = int(inst.get('address', 1))
        for idx, ch in enumerate(channels):
            addr = base + idx
            if addr in self.overrides: del self.overrides[addr]

    def clear_address_overrides(self, addresses):
        for addr in addresses:
            if int(addr) in self.overrides: del self.overrides[int(addr)]
    def toggle_manual_preset(self, preset_id: str, state: bool = None, exclusive: bool = False):
        """Force a preset to be active or inactive regardless of audio triggers.
           If exclusive is True and we are turning a preset ON, clear all other manual presets.
        """
        preset_id = str(preset_id).lower()
        is_on = preset_id in self.manual_active_presets
        target_state = state if state is not None else not is_on

        if target_state:
            if exclusive:
                self.manual_active_presets.clear()
                print(f"🎛️ [EXCLUSIVE] Clearing other manual presets for '{preset_id}'")
            self.manual_active_presets.add(preset_id)
        else:
            if preset_id in self.manual_active_presets:
                self.manual_active_presets.remove(preset_id)
        
        print(f"🎛️ Manual Preset State: {list(self.manual_active_presets)}")
        print(f"🎛️ Manual Preset '{preset_id}' is now {'ON' if target_state else 'OFF'}")

    def clear_manual_presets(self):
        self.manual_active_presets.clear()
        print("🎛️ Cleared all manual presets")
