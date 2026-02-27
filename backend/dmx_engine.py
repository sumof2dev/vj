import time
import math
import random
import collections
import importlib
import sys
import os
from typing import Dict, Any, List, Optional
import json
from movement_scenes import SceneManager

class ScanningLFO:
    """Treats a DMX channel as a high-speed texture-scanning engine."""
    def __init__(self):
        self.phase = 0.0

    def update(self, dt, intensity):
        # Intensity 0-1.0 drives the speed of the scan
        speed = 0.1 + (intensity * 25.0)
        self.phase = (self.phase + dt * speed) % 1.0
        return int(self.phase * 10)

class DMXEngine:
    
    def __init__(self):
        self.vibe_config = {}
        self.universe = bytearray(513)
        self.universe[0] = 0x00
        
        # Engines
        self.scene_manager = SceneManager()
        self.overrides = {}
        self.drones = {}  # Stateful drone matrix tracking local time and anchors per zone
        self._dt = 0.016  # Default dt, updated each frame by update()
        
        # State
        self.beat_pulse = 0.0
        self.intensity = 1.0
        self.speed = 1.0 # Requested Laser Speed (Defaulted to 1.0 for visibility)
        self._last_print_time = 0.0
        self._last_scene_switch_beat = 0
        self._last_drop_time = 0.0
        self._one_shot_active = False

        # Internal Logic
        self._pattern_rotate_counter = 0
        self._last_pattern_switch_time = 0.0
        self.rhythm_state = {} # Tracks fast-decay brightness and latched shapes for rhythm zones
        
        # Reactive Parameters (Moved from ReactiveMovement)
        self.audio_sensitivity = 0.5
        
        # --- RE-ADDED MISSING STATE INITIALIZATION ---
        self.smoothed_vol = 0.0
        self.smoothed_bass = 0.0
        self.smoothed_mid = 0.0
        self.smoothed_high = 0.0
        self.smoothed_flux = 0.0
        self.vibe_progress = 0.0 
        self.transient = "steady" 
        
        self.active_effects = {} # Key: (zone_idx, role), Value: effect_name
        
        # Rotation Phase Tracking
        self.rot_phase = {'x': 0.0, 'y': 0.0, 'z': 0.0} 
        self.z_rev = 1.0 
        
        # ROTATION LOGIC STATE
        self.rot_state = 'IDLE' 
        self.rot_state_timer = 0 
        
        self.current_base_layer = 0 
        self.current_fx_layer = 6  
        self.base_layer_timer = 0
        self.rot_cycle = 0 
        
        # Universal visual pools (Vibe-agnostic)
        all_bases = [0, 1, 2, 3, 3, 3, 4, 5, 6, 7, 8, 9, 10] 
        all_fx = [0, 1, 2, 3, 5, 6]
        
        self.visual_pools = {
            'chill': {'base': all_bases, 'fx': all_fx},
            'mid':   {'base': all_bases, 'fx': all_fx},
            'high':  {'base': all_bases, 'fx': all_fx}
        }
        
        # Remote Control State
        # Triggers removed per user request for unified baseline
        
        self.scene_freq = 1 # 0=Slow, 1=Normal, 2=Fast, 3=Frantic
        self.pattern_mode = 'auto'  
        self.color_mode = 'auto'  
        self.color_multi = 0.0
        self.color_solid = 0.0
        
        # Scanning Tools & Accumulators
        self.grating_lfo = ScanningLFO()
        
        self.acc_bass = 0.0
        self.acc_flux = 0.0
        self.acc_vol = 0.0
        
        # Sustained bass tracking
        self.sustained_bass = 0.0
        self.sustained_bass_timer = 0.0  
        self.current_zoom_factor = 0.5   
        
        # Bass Style Detection
        self._bass_bins_history = collections.deque(maxlen=30)  # ~0.5s at 60fps
        self._bass_delta_history = collections.deque(maxlen=30)
        self._mid_history = collections.deque(maxlen=30)
        
        # Held Drawing & Dots Logic
        self.held_drawing_values = {}
        self.held_dots_values = {}
        self.last_pattern_rotate_counter = 0
        self._current_bass_style = None
        self._bass_style_holdoff = 0.0  # Cooldown timer
        
        # Fixture & Stage Config
        self.fixtures = {}
        self.stage_config = {}
        self.presets = {}
        self.roles = {
            "lead": {
                "pos_x": [32, 96],
                "pos_y": [32, 96],
                "zoom": [0, 127],
                "rot_z": [0, 127]
            },
            "rythm": {
                "boots": { "shapes": [], "colors": [] },
                "cats": { "shapes": [], "colors": [] },
                "cha": { "shapes": [], "colors": [] }
            }
        }
        
        # Hot Reload Tracking
        self._vibe_config_path = os.path.join('fixtures', 'vibe_config.json')
        self._stage_config_path = os.path.join('fixtures', 'stage_config.json')
        self._presets_config_path = os.path.join('fixtures', 'presets.json')
        self._roles_config_path = 'roles.json'
        
        self._load_profiles()
        self._load_roles() # Explicitly load roles after path is defined
        
        # Zone Mapping
        self.zone_map = list(self.stage_config.get('devices', {}).keys())
        
        # Movement Scene Pools (Strictly Stateless & Reversible)
        self.scene_pools = {
            'chill': ['hold', 'scroll', 'lissajous'],
            'mid': ['lissajous', 'scroll', 'chase'],
            'high': ['chase', 'lissajous']
        }
        self.current_scene_name = 'hold'

        self._last_vibe_mtime = os.path.getmtime(self._vibe_config_path) if os.path.exists(self._vibe_config_path) else 0
        self._last_stage_mtime = os.path.getmtime(self._stage_config_path) if os.path.exists(self._stage_config_path) else 0
        self._last_presets_mtime = os.path.getmtime(self._presets_config_path) if os.path.exists(self._presets_config_path) else 0
        self._last_roles_mtime = os.path.getmtime(self._roles_config_path) if os.path.exists(self._roles_config_path) else 0
        

    def _load_profiles(self):
        """Load JSON fixture definitions and stage configuration"""
        fixtures_dir = 'fixtures'
        if not os.path.exists(fixtures_dir):
            print(f"⚠️ Fixtures directory not found: {fixtures_dir}")
            return

        # Load Stage Config
        stage_path = os.path.join(fixtures_dir, 'stage_config.json')
        if os.path.exists(stage_path):
            try:
                with open(stage_path, 'r') as f:
                    self.stage_config = json.load(f)
                    if 'lasers' in self.stage_config:
                        if 'devices' not in self.stage_config:
                            self.stage_config['devices'] = {}
                        self.stage_config['devices'].update(self.stage_config['lasers'])
                print(f"✅ Loaded stage config from {stage_path}")
            except Exception as e:
                print(f"❌ Error loading stage config: {e}")

        # Load Vibe Config
        vibe_path = os.path.join(fixtures_dir, 'vibe_config.json')
        if os.path.exists(vibe_path):
            try:
                with open(vibe_path, 'r') as f:
                    self.vibe_config = json.load(f)
                print(f"✅ Loaded vibe config from {vibe_path}")
            except Exception as e:
                print(f"❌ Error loading vibe config: {e}")
                self.vibe_config = {}

        # Load Presets
        prest_path = os.path.join(fixtures_dir, 'presets.json')
        if os.path.exists(prest_path):
            try:
                with open(prest_path, 'r') as f:
                    self.presets = json.load(f)
                print(f"✅ Loaded presets from {prest_path}")
            except Exception as e:
                print(f"❌ Error loading presets: {e}")
                self.presets = {}

        # Load all fixture definitions
        for filename in os.listdir(fixtures_dir):
            if filename.endswith('.json') and filename not in ['stage_config.json', 'vibe_config.json', 'presets.json']:
                path = os.path.join(fixtures_dir, filename)
                try:
                    with open(path, 'r') as f:
                        fix_data = json.load(f)
                        fix_name = filename.replace('.json', '')
                        self.fixtures[fix_name] = fix_data
                        print(f"✅ Loaded fixture definition: {fix_name}")
                except Exception as e:
                    print(f"❌ Error loading fixture {filename}: {e}")

    def _update_analysis(self, dt: float, audio: Dict[str, float]):
        """
        Update internal smoothed values and accumulators based on audio input.
        """
        # Smooth Audio Levels (Sensitivity Tuning: 5.0 = fast, 1.0 = slow)
        # Use the UI-linked audio_sensitivity to decouple laser dynamics from visuals
        # REMOVED: Scaling target_vol by gain again (Double Gain Fix)
        target_vol = audio.get('vol', 0.0) 
        target_bass = audio.get('bass', 0.0)
        target_mid = audio.get('mid', 0.0)
        target_high = audio.get('high', 0.0)
        target_flux = audio.get('flux', 0.0)
        
        # Modulate smoothing with confidence: High Confidence = Snappier (fast), Low = Sluggish (drift)
        conf = audio.get('confidence', 1.0)
        # Smooth factor range: 1.0 (low conf) to 6.0 (high conf) - increased for more reactivity
        smooth_factor = (1.0 + 5.0 * conf) * dt
        
        self.smoothed_vol += (target_vol - self.smoothed_vol) * smooth_factor
        self.smoothed_bass += (target_bass - self.smoothed_bass) * smooth_factor
        self.smoothed_mid += (target_mid - self.smoothed_mid) * smooth_factor
        self.smoothed_high += (target_high - self.smoothed_high) * smooth_factor
        self.smoothed_flux += (target_flux - self.smoothed_flux) * smooth_factor
        
        # --- LFO & COLOR CLOCKS ---
        # 1. Simple LFO (-1.0 to 1.0) using accumulated time for smooth waves
        if not hasattr(self, '_lfo_time'):
            self._lfo_time = 0.0
        self._lfo_time += dt * self.speed
        self.lfo_val = math.sin(self._lfo_time * 1.5)
        
        # 2. Color sequencer driven by volume and flux
        if not hasattr(self, 'color_timer'):
            self.color_timer = 0.0
            self.color_idx = 0
        
        # Color changes faster when it's loud or there are lots of transients
        color_speed = 1.0 + (self.smoothed_vol * 3.0) + (self.smoothed_flux * 8.0)
        self.color_timer += dt * color_speed
        if self.color_timer > 2.0:  # Trigger threshold
            self.color_idx += 1
            self.color_timer = 0.0

        # Accumulators (for continuous movement)
        self.acc_bass += target_bass * dt
        self.acc_flux += target_flux * dt
        self.acc_vol += target_vol * dt
        
        # Beat Pulse (Logic: Use main.py's beat detection)
        is_beat = audio.get('beat', False)
        
        if is_beat and self.beat_pulse < 0.2:
            self.beat_pulse = 1.0 # Trigger
            
            # --- RHYTHMIC SCENE SWITCHING ---
            self.rot_state_timer += 1
            vibe = self._get_vibe_name(audio)
            
            # Determine Scene Duration based on Vibe
            # High: 8 beats, Mid: 16 beats, Chill: 32 beats
            duration_map = {'high': 8, 'mid': 16, 'chill': 32}
            base_duration = duration_map.get(vibe, 16)
            
            # Apply Master Scene Frequency Multiplier
            # 0=Slow (x2), 1=Normal (x1), 2=Fast (/2), 3=Frantic (/4)
            mults = [2.0, 1.0, 0.5, 0.25]
            mult = mults[self.scene_freq] if 0 <= self.scene_freq < 4 else 1.0
            
            target_duration = int(base_duration * mult)
            target_duration = max(4, target_duration) # Don't switch faster than every 4 beats
            
            # Check if it's time for a normal rhythmic switch
            beats_since_switch = self.rot_state_timer - self._last_scene_switch_beat
            
            if beats_since_switch >= target_duration:
                self._last_scene_switch_beat = self.rot_state_timer
                
                # Randomize Visual Layers (vibe-aware)
                self._randomize_visual_layers(vibe)
                
                # Cycle Rotation State
                self.rot_cycle = (self.rot_cycle + 1) % 4
                
                # Update Rotation State
                if self.rot_cycle == 0: self.rot_state = 'ROTX'
                elif self.rot_cycle == 2: self.rot_state = 'ROTY'
                else: self.rot_state = 'IDLE'

                # Pick New Movement Scene from pool, mixing in user Presets for current vibe
                candidates = list(self.scene_pools.get(vibe, self.scene_pools['mid']))
                for p_name, p_data in self.presets.items():
                    if p_data.get('vibe') == vibe:
                        candidates.append(f"PRESET:{p_name}")
                        
                self.current_scene_name = random.choice(candidates)
                print(f"[DMX] Rhythmic switch to {self.current_scene_name} ({vibe})")

            # --- EDM DROP SCENE TRIGGER ---
            # Trust the Vibe Engine's immediate transient impact detector.
            if self.transient == 'dropping' and not self._one_shot_active:
                # Debounce: Ensure we don't spam drops (wait at least 8 seconds between them)
                if time.time() - self._last_drop_time > 8.0:
                    # 1. Snap Lasers (Handled by drone blend logic in update())
                    self._one_shot_active = True
                    self._last_drop_time = time.time()
                    
                    # 2. Snap Visuals
                    vibe = self._get_vibe_name(audio)
                    self._randomize_visual_layers(vibe)
                    self.base_layer_timer = 0 # Reset rhythmic timer
                    
                    print(f"[DMX] EDM DROP DETECTED! Lasers & Visuals synced.")


            # --- PATTERN LOGIC ---
            # Rule 3: Hold pattern 2x as long when X or Y is active
            should_rotate_pattern = True
            if self.rot_state != 'IDLE':
                # Only rotate on even beats (50% speed)
                if self.rot_state_timer % 2 != 0:
                    should_rotate_pattern = False
            
            if should_rotate_pattern:
                self._pattern_rotate_counter = (self._pattern_rotate_counter + 1) % 100
                
            # Clear held values on pattern change
            if self._pattern_rotate_counter != self.last_pattern_rotate_counter:
                self.held_drawing_values = {}
                self.held_dots_values = {}
                self.last_pattern_rotate_counter = self._pattern_rotate_counter
                
            # Toggle Z-Direction every 8 beats
            if self.rot_state_timer % 8 == 0:
                self.z_rev *= -1.0
                
        else:
            self.beat_pulse = max(0.0, self.beat_pulse - 4.0 * dt) # Decay
            
        # Rotation Phase Update
        vibe = self._get_vibe_name(audio)
        v_cfg = self.vibe_config.get(vibe, self.vibe_config.get('mid', {}))
        # Rotation Speed Calculation
        base_speed = v_cfg.get('rot_speed', 10.0)
        
        # Dynamic Speed: Base + Flux * Sensitivity (Dampened)
        # This replaces the manual 'rotation' trigger. We use additive sensitivity
        # to ensure it doesn't grow exponentially.
        # Dynamic Speed: Lower baseline (0.05) + higher flux authority (3.0)
        mod_speed = base_speed * (0.05 + (self.smoothed_flux * self.audio_sensitivity * 3.0)) * self.speed
        mod_speed = min(base_speed * 4.0, mod_speed) # Hard ceiling on "wildness"
        
        # Confidence boost
        conf = audio.get('confidence', 1.0)
        mod_speed *= (0.5 + 0.5 * conf)
        
        self.rot_phase['x'] += dt * mod_speed
        self.rot_phase['y'] += dt * mod_speed


    def _randomize_visual_layers(self, vibe):
        """Pick random visual layers from vibe-appropriate pools."""
        pools = self.visual_pools.get(vibe, self.visual_pools['mid'])
        
        # Base Layer (avoid repeating)
        base_opts = pools['base']
        new_base = random.choice(base_opts)
        if new_base == self.current_base_layer and len(base_opts) > 1:
            new_base = random.choice([b for b in base_opts if b != self.current_base_layer])
        self.current_base_layer = new_base
        
        # Simple random choice for FX (Backend dictates, frontend renders blindly)
        self.current_fx_layer = random.choice(pools['fx'])

    def _process_led_strip(self, dev_name, dev_cfg, audio):
        """
        Special logic for WS2811 LED Strips (SP201E)
        Pattern: Grp1:Blue, Grp2:Off, Grp3:Red, ...
        Reactivity: Brightness scales with FLUX
        """
        start_addr = dev_cfg['address']
        # Assume a reasonable number of groups for now (e.g. 10 groups = 30 channels)
        # User said "if you get a few, I can add the rest"
        num_groups = 10 
        
        flux = self.smoothed_flux
        # Scale brightness: Base 20 + Flux * 200 (Max 255)
        bright = min(255, 20 + flux * 500) 
        
        for g in range(num_groups):
            # Group Start Address (0-based relative to start_addr)
            # Offset = g * 3
            base = start_addr + (g * 3)
            
            # Pattern Cycle: 0=Blue, 1=Off, 2=Red, 3=Off ... (Mod 4)
            cycle = g % 4
            
            r, g_val, b = 0, 0, 0
            
            if cycle == 0:
                # Blue
                b = int(bright)
            elif cycle == 2:
                # Red
                r = int(bright)
            # else: Off
            
            # Write to Universe (Safeguard bounds)
            if base + 2 < len(self.universe):
                # Tension Blackout Override: Force LED strip to 0
                if self.transient == 'tension':
                    self.universe[base] = 0
                    self.universe[base+1] = 0
                    self.universe[base+2] = 0
                else:
                    self.universe[base] = r
                    self.universe[base+1] = g_val
                    self.universe[base+2] = b

    def update(self, dt: float, audio: Dict[str, float], visual_states: Dict[str, int] = None):
        """
        Main DMX Calculation Loop
        """
        try:
            # Validate audio dict keys and provide defaults
            required_keys = {
                'vol': 0.0,
                'bass': 0.0,
                'mid': 0.0,
                'high': 0.0,
                'flux': 0.0,
                'confidence': 1.0,
                'transient': 'steady'
            }
            for key, default in required_keys.items():
                if key not in audio:
                    audio[key] = default
                    print(f"[DMX] Warning: audio missing key '{key}', defaulting to {default}")

            # Store dt for use in _calculate_channel
            self._dt = dt

            # 0. Hot Reload Check
            self._check_for_reload()

            # 1. Analysis Update
            self._update_analysis(dt, audio)
            self.transient = audio.get('transient', 'steady')

            # Bass Style Detection
            self._detect_bass_style(audio, dt)

            # (Drop-triggered layer randomization has been moved into _update_analysis for perfect sync)

            # 2.2 Update Rhythm Envelopes & Latched Shapes
            bass_hit = audio.get('bass_onset', False)
            high_hit = audio.get('high_onset', False)

            for z in range(len(self.zone_map)):
                if z not in self.rhythm_state:
                    # Default latch state
                    self.rhythm_state[z] = {'env': 0.0, 'shape': 'circle', 'color': 12}

                dev_name = self.zone_map[z]
                dev_cfg = self.stage_config.get('devices', {}).get(dev_name, {})
                behavior = dev_cfg.get('behavior', 'lead')

                # Rise/Fall Envelope Processing
                st = self.rhythm_state[z]
                if behavior == 'rhythm':
                    if st.get('trigger', False):
                        st['env'] = min(1.0, st['env'] + 8.0 * self._dt)
                        if st['env'] >= 1.0: st['trigger'] = False
                    else:
                        st['env'] = max(0.0, st['env'] - 12.0 * self._dt)
                else:
                    st['env'] = max(0.0, st['env'] - 3.0 * self._dt)

                if behavior == 'rhythm':
                    rythm_cfg = self.roles.get('rythm', {})
                    hit_detected = False
                    # Priority 1: CHA (Kick + Snare)
                    if bass_hit and high_hit:
                        cha = rythm_cfg.get('cha', {})
                        st['trigger'] = True
                        hit_detected = True
                        if cha.get('shapes'):
                            st['shape'] = random.choice(cha['shapes'])
                        if cha.get('colors'):
                            st['color_name'] = random.choice(cha['colors'])
                    # Priority 2: BOOTS (Kick)
                    elif bass_hit:
                        boots = rythm_cfg.get('boots', {})
                        st['trigger'] = True
                        hit_detected = True
                        if boots.get('shapes'):
                            st['shape'] = random.choice(boots['shapes'])
                        if boots.get('colors'):
                            st['color_name'] = random.choice(boots['colors'])
                    # Priority 3: CATS (Snare)
                    elif high_hit:
                        cats = rythm_cfg.get('cats', {})
                        st['trigger'] = True
                        hit_detected = True
                        if cats.get('shapes'):
                            st['shape'] = random.choice(cats['shapes'])
                        if cats.get('colors'):
                            st['color_name'] = random.choice(cats['colors'])
                    
                    if hit_detected:
                        # Capture energy to scale the width of this specific pulse
                        # Lower floor (0.1) and steeper ramp (2.2x) for more dynamic range
                        energy = max(0.1, min(1.0, self.smoothed_vol * 2.2))
                        st['hit_energy'] = energy

            # 3. Process Devices (Zones)
            vibe = self._get_vibe_name(audio)

            # 2.5 Drop/One-Shot Timeout
            if self._one_shot_active:
                if time.time() - self._last_drop_time > 2.0:
                    self._one_shot_active = False
                    print(f"[DMX] One-shot DROP cleared")

            # Ensure Scene is Valid for Vibe (Smart Switching with Hysteresis)
            active_pool = self.scene_pools.get(vibe, [])
            if active_pool and self.current_scene_name not in active_pool:
                beats_in_scene = self.rot_state_timer - self._last_scene_switch_beat
                if beats_in_scene >= 8:
                    print(f"[DMX] Vibe change ({vibe}) forced scene switch from {self.current_scene_name}")
                    self.current_scene_name = random.choice(active_pool)
                    self._last_scene_switch_beat = self.rot_state_timer

            # 1.5 Handle Intentional Effect Triggers (Effect Stack)
            self._handle_effect_triggers(audio, vibe)

            # --- THE TIME SCRUBBER (Step 1 & 3) ---
            for z_idx in range(len(self.zone_map)):
                if z_idx not in self.drones:
                    self.drones[z_idx] = {
                        't': random.random() * 100.0,
                        'anchor_x': 0.0, 'anchor_y': 0.0, 'anchor_rot_z': 0.0,
                        'last_x': 0.0, 'last_y': 0.0, 'last_rot_z': 0.0,
                        'blend': 1.0,
                        'scene': self.current_scene_name
                    }
                drone = self.drones[z_idx]

                # Dynamic Playhead (Exponential authority for more dramatic slider impact)
                # At 1.0 = normal. At 0.5 = 0.35x. At 2.0 = 2.8x.
                playhead_speed = self.speed ** 0.5
                if self.transient == 'dropping':
                    playhead_speed = -self.speed * 1.0
                elif self.transient == 'tension':
                    playhead_speed = self.speed * 0.1

                drone['t'] += dt * playhead_speed

                # Scene Handoff & Anchor Capture
                if drone['scene'] != self.current_scene_name:
                    drone['scene'] = self.current_scene_name
                    # SCENE RESET: Hard zero rotation memory on change
                    drone['last_rot_z'] = 0.0
                    drone['curr_rot_x'] = 0.0
                    drone['curr_rot_y'] = 0.0
                    
                    # 1. Capture Lock Positions for current scene
                    drone['lock_x'] = drone['last_x']
                    drone['lock_y'] = drone['last_y']
                    
                    if self.transient == 'dropping' or self._one_shot_active:
                        drone['blend'] = 1.0
                    else:
                        drone['anchor_x'] = drone['last_x']
                        drone['anchor_y'] = drone['last_y']
                        drone['anchor_rot_z'] = 0.0 # Reset rotation anchor
                        drone['blend'] = 0.0

                # Progress the interpolation timer
                if drone['blend'] < 1.0:
                    drone['blend'] = min(1.0, drone['blend'] + dt * 2.0)

            for i, (dev_name, dev_cfg) in enumerate(self.stage_config['devices'].items()):
                side = dev_cfg.get('location', 'left')
                if side == 'n/a':
                    continue
                if side == 'led_strip':
                    self._process_led_strip(dev_name, dev_cfg, audio)
                    continue
                self._process_device(dev_name, dev_cfg, i, vibe, audio)

            # 4. Debug Output (Every 1s)
            now = time.time()
            if now - self._last_print_time > 1.0:
                self._print_debug(vibe)
                self._last_print_time = now
        except Exception as e:
            import traceback
            print(f"[DMX] ERROR in update: {e}")
            traceback.print_exc()
            self._dt = dt
            return

    def _print_debug(self, vibe):
        """
        Print active channels to terminal
        """
        # Collect active channels roughly
        actives = []
        for i, val in enumerate(self.universe):
            if val > 0:
                actives.append(f"{i}:{val}")
        
        # Limit output length
        out_str = " | ".join(actives[:10])
        if len(actives) > 10: out_str += f" ... (+{len(actives)-10})"
        
        if not actives: out_str = "No Output"
        
        # DEBUG: Show Rotation State and Scene
        rot_status = f"ROT:{self.rot_state}({self.rot_state_timer})"
        scene_status = f"SCENE:{self.current_scene_name}"
        
        print(f"\r[DMX] Vibe:{vibe.upper()} | {rot_status} | {scene_status} | {out_str}", end="\033[K")


    def _load_roles(self):
        """Load roles configuration from root roles.json"""
        if os.path.exists(self._roles_config_path):
            try:
                with open(self._roles_config_path, 'r') as f:
                    self.roles = json.load(f)
                print(f"✅ Loaded roles config from {self._roles_config_path}")
            except Exception as e:
                print(f"❌ Error loading roles config: {e}")

    def _check_for_reload(self):
        """
        Watch fixture JSON files for changes and reload if needed.
        """
        try:
            # Watch vibe_config.json
            if hasattr(self, '_vibe_config_path') and os.path.exists(self._vibe_config_path):
                mtime = os.path.getmtime(self._vibe_config_path)
                if mtime > self._last_vibe_mtime:
                    print(f"\n[DMX] Vibe config change detected! Reloading {self._vibe_config_path}...")
                    with open(self._vibe_config_path, 'r') as f:
                        self.vibe_config = json.load(f)
                    self._last_vibe_mtime = mtime
                    
            # Watch stage_config.json
            if hasattr(self, '_stage_config_path') and os.path.exists(self._stage_config_path):
                m_stage = os.path.getmtime(self._stage_config_path)
                if m_stage > self._last_stage_mtime:
                    print(f"\n[DMX] ♻️ Stage config change detected! Reloading {self._stage_config_path}...")
                    with open(self._stage_config_path, 'r') as f:
                        new_stage = json.load(f)
                        if 'lasers' in new_stage:
                            if 'devices' not in new_stage:
                                new_stage['devices'] = {}
                            new_stage['devices'].update(new_stage['lasers'])
                        if 'devices' in new_stage:
                            self.stage_config = new_stage
                            self.zone_map = list(self.stage_config.get('devices', {}).keys())
                            print(f"✅ Reloaded {len(self.zone_map)} devices.")
                        else:
                            print("⚠️ Stage config reload failed: 'devices'/'lasers' key missing.")
                    self._last_stage_mtime = m_stage
            # Watch presets.json
            if hasattr(self, '_presets_config_path') and os.path.exists(self._presets_config_path):
                m_presets = os.path.getmtime(self._presets_config_path)
                if m_presets > self._last_presets_mtime:
                    print(f"\n[DMX] 💾 Presets change detected! Reloading {self._presets_config_path}...")
                    with open(self._presets_config_path, 'r') as f:
                        self.presets = json.load(f)
                        print(f"✅ Reloaded {len(self.presets)} presets.")
                    self._last_presets_mtime = m_presets
            
            # Watch roles.json
            if hasattr(self, '_roles_config_path') and os.path.exists(self._roles_config_path):
                m_roles = os.path.getmtime(self._roles_config_path)
                if m_roles > self._last_roles_mtime:
                    print(f"\n[DMX] 🎭 Roles change detected! Reloading {self._roles_config_path}...")
                    self._load_roles()
                    self._last_roles_mtime = m_roles
                    
        except Exception as e:
            print(f"\n[DMX] Error reloading config: {e}")


    def _process_device(self, dev_name, dev_cfg, zone_idx, vibe, audio):
        """
        Calculate and set DMX values for a specific device (zone) using JSON profile
        """
        fix_type = dev_cfg.get('type')
        fixture = self.fixtures.get(fix_type)
        if not fixture:
            print(f"⚠️ Fixture type '{fix_type}' not found for device {dev_name}")
            return

        behavior = str(dev_cfg.get('behavior', 'lead')).strip().lower()

        start_addr = dev_cfg['address']
        offset_val = dev_cfg['offset']
        
        # Iterate defined channels in JSON fixture
        for role, ch_offset in fixture['channels'].items():
            # Calculate Base Value
            val = self._calculate_channel(role, vibe, audio, zone_idx, dev_name, fixture)
            
            # Apply Default if calculated value is -1 (Static/Safety)
            if val == -1:
                val = fixture.get('defaults', {}).get(role, 0)
            
            # Apply Master Intensity to relevant roles (Exclude colors to prevent bin shift)
            if role in ['dimmer', 'beam_fx']:
                val = val * self.intensity

            # Apply Override if exists
            final_addr = start_addr + offset_val + ch_offset
            if final_addr in self.overrides:
                val = self.overrides[final_addr]
            
            # --- BASS STYLE OVERLAY ---
            # When a bass style is detected, overlay matching presets onto all devices
            if self._current_bass_style:
                for p_name, p_data in self.presets.items():
                    if p_data.get('vibe') == self._current_bass_style:
                        if role in p_data.get('channels', {}):
                            val = p_data['channels'][role]

            # Write to Universe
            if 0 < final_addr < len(self.universe):
                # TENSION BLACKOUT: Force intensity-related channels to 0
                # Exclude position and zoom to keep lasers ready for the drop
                blackout_roles = ['dimmer', 'beam_fx', 'strobe', 'shutter']
                if self.transient == 'tension' and role in blackout_roles:
                    self.universe[final_addr] = 0
                else:
                    self.universe[final_addr] = int(max(0, min(255, val)))

    def _calculate_channel(self, role, vibe, audio, zone_idx, dev_name='L1', fixture=None):
        """Determine DMX value based on role and current vibe using JSON fixture metadata"""
        
        dev_cfg = self.stage_config.get('devices', {}).get(dev_name, {})
        category = dev_cfg.get('category', 'laser')
        behavior = str(dev_cfg.get('behavior', 'lead')).strip().lower()
        
        fixture = self.fixtures.get(dev_cfg.get('type'))
        if not fixture: return -1

        # --- RHYTHM OVERRIDE (PRIORITY) ---
        if behavior == 'rhythm':
            st = getattr(self, 'rhythm_state', {}).get(zone_idx, {'env': 0.0, 'shape': 'circle', 'color_name': 'Red', 'trigger': False})
            
            if role == 'mode': return 254
            if role == 'boundary': return 50
            if role == 'group': return 250
            
            if role in ['pos_x', 'pos_y']:
                return fixture.get('calibration', {}).get(role, {}).get('center', 64)
            if role in ['rot_z', 'rot_x', 'rot_y']:
                return 0 # CRITICAL: Rotation fixed at 0 for rhythm
            
            if role == 'zoom':
                # Pulsing with Dynamic Energy scaling
                # Lower DMX = Wider. env 1.0 -> 0 (Wide), env 0 -> 127 (Tight)
                # peak_energy scales how far it opens (e.g. 0.4 = small open, 1.0 = full open)
                peak_energy = st.get('hit_energy', 0.4)
                val = 127 - (st.get('env', 0.0) * peak_energy * 127)
                return int(max(0, min(127, val)))
            if role == 'pattern':
                return fixture.get('shapes', {}).get(st.get('shape', 'circle'), 0)
            if role in ['color_multi', 'color_solid']:
                if role == 'color_solid':
                    color_name = st.get('color_name', 'Red')
                    colors = fixture.get('modes', {}).get('color_solid', {}).get('individual', {}).get('colors', [])
                    for c in colors:
                        if c['name'] == color_name: return (c['min'] + c['max']) // 2
                    return 12
                return 0
            
            # Silence all other effects
            if role in ['grating', 'drawing', 'drawing_delay', 'dots', 'beam_fx', 'strobe', 'twist']:
                return 0
            
            return -1 # Use defaults for anything else

        # RESTRICT LASER LOGIC TO 'laser' CATEGORY
        laser_exclusive_roles = [
            'pattern', 'zoom', 'pos_x', 'pos_y', 
            'beam_fx', 'grating', 'drawing', 'drawing_delay', 'dots'
        ]
        
        if category != 'laser' and role in laser_exclusive_roles:
            return -1

        # --- PRESET / GOBO BYPASS ---
        if self.current_scene_name.startswith('PRESET:'):
            preset_name = self.current_scene_name.split('PRESET:')[1]
            p_data = self.presets.get(preset_name, {})
            # Only apply if it's the correct category and profile for this preset
            target_profile = p_data.get('profile')
            category_match = p_data.get('target_category', 'laser') == category
            profile_match = target_profile is None or target_profile == dev_cfg.get('type')
            
            if category_match and profile_match:
                if role in p_data.get('channels', {}):
                    return int(p_data['channels'][role])
                    
        cal = fixture.get('calibration', {})
        v_cfg = self.vibe_config.get(vibe, self.vibe_config.get('mid', {}))

        modes = fixture.get('modes', {}).get(role, {})
        active_effect = self.active_effects.get((zone_idx, role))
        
        if active_effect and active_effect in modes:
            mode_cfg = modes[active_effect]
            rng = mode_cfg.get('range', [128, 255])
            macros = mode_cfg.get('macros', [])
            
            if macros:
                # Speed up macro cycling on high vibe or drops
                div = 4
                if vibe == 'high' or self.transient == 'dropping':
                    div = 2
                m_idx = (self._pattern_rotate_counter // div) % len(macros)
                base = fixture.get('macros', {}).get(macros[m_idx], rng[0])
            else:
                base = rng[0]
                
            # Hardware macros usually respond to slight modulation in their range
            # User request: climb higher faster, bottom of range does nothing.
            # Use a non-linear curve (sqrt) to ramp up quickly from 0
            # and add a base offset to skip the "dead zone"
            # Original: mod = int(self.smoothed_flux * 31)
            mod = int(math.sqrt(max(0.0, self.smoothed_flux)) * 23 + 8)
            return min(rng[1], base + mod)
        
        # Manual Mode Limit
        manual_mx = modes.get('manual', {}).get('range', [0, 127])[1]

        # 1. SHAPE / PATTERN
        if role == 'pattern':
            shapes = v_cfg.get('shapes', [])
            if not shapes: return 0
            shape_key = shapes[(self._pattern_rotate_counter + zone_idx) % len(shapes)]
            return fixture.get('shapes', {}).get(shape_key, 0)

        # 1.5 ZOOM / MOVEMENT SIZE
        # Calculate pure logical size (No baseline - silence is a Dot, audio grows it)
        size_pct = (self.smoothed_vol * 0.6 + self.smoothed_bass * 0.8 - self.smoothed_flux * 0.6)
        size_pct = max(0.0, min(1.0, size_pct))

        if role == 'zoom':
            # Fetch calibration bounds
            entry = cal.get('zoom', {})
            min_dmx = entry.get('min_dmx', 0)
            max_dmx = entry.get('max_dmx', 127)
            center  = entry.get('center', 64)
            
                # SCENE OVERRIDES
            if self.current_scene_name == 'hold':
                hold_mod = getattr(self.drones.get(zone_idx, {}), 'get', lambda x, y: 0.0)('hold_effect', 0.0)
                # Add the oscillating lissajous axis to the size calculation
                size_pct += hold_mod * 0.3 # Subtle 30% modulation
            elif self.current_scene_name == 'lissajous':
                # User request: lissajous requires a smaller, tighter zoom size
                size_pct *= 0.6
            
            # Save globally so Pos X/Y can read it to constrain travel distance
            self.current_size_pct = size_pct 
            
            # TENSION STATE: Force absolute tightest zoom (Center Dot)
            if self.transient == 'tension':
                size_pct = 0.0
            
            # Map sizes based on calibration limits
            # Normal (center) size maps to ~0.5 size_pct
            if size_pct >= 0.5:
                # Expand from center towards min_dmx (widest)
                # Map 0.5->1.0 to center->min_dmx
                expand_ratio = (size_pct - 0.5) * 2.0
                val = center + (min_dmx - center) * expand_ratio
            else:
                # Shrink from center towards max_dmx (tightest)
                # Map 0.0->0.5 to max_dmx->center
                shrink_ratio = size_pct * 2.0
                val = max_dmx + (center - max_dmx) * shrink_ratio
            
            safe_min = min(min_dmx, max_dmx)
            safe_max = max(min_dmx, max_dmx)
            return int(max(safe_min, min(safe_max, val)))

        # 2. HARDWARE COLOR LOGIC (Bass vs Treble Dominance)
        if role in ['color_multi', 'color_solid']:
            seed = getattr(self, 'color_idx', 0) + zone_idx
            
            # Treble Dominates -> Multi-Color Mode
            if self.smoothed_high > self.smoothed_bass:
                if role == 'color_multi': return (seed * 13) % 256
                return 0
            # Bass Dominates -> Solid Color Mode
            else:
                if role == 'color_solid': return 64 + ((seed * 17) % (255 - 64)) # Use cycle range
                return 0

        # 3. MOVEMENT (Pan/Tilt)
        if role == 'pos_x' or role == 'pos_y':
            # Retrieve side for logic
            dev_stage_cfg = self.stage_config.get('devices', {}).get(dev_name, {})
            side = dev_stage_cfg.get('location', 'left')

            # Use global center preference if available
            default_center = self.stage_config.get('global', {}).get('local_center', 64)
            entry = cal.get(role, {})
            
            # Base Center Logic
            center = entry.get('center', default_center)

            # Determine Physical Limits (New calibration system)
            if role == 'pos_x':
                # Map to config.json keys (far_left, far_right)
                c_min = entry.get('far_left', entry.get('left', 0))
                c_max = entry.get('far_right', entry.get('right', 255))
                # Role Override
                if 'pos_x' in self.roles.get('lead', {}):
                    c_min, c_max = self.roles['lead']['pos_x']
                # Legacy compatibility
                elif 'range' in entry and 'far_left' not in entry and 'left' not in entry:
                    r = entry['range']
                    c_min = max(0, center - r)
                    c_max = min(255, center + r)
            else:
                # Map to config.json keys (top, bottom)
                c_min = entry.get('top', 0)
                c_max = entry.get('bottom', 255)
                # Role Override
                if 'pos_y' in self.roles.get('lead', {}):
                    c_min, c_max = self.roles['lead']['pos_y']
                # Legacy compatibility
                elif 'range' in entry and 'top' not in entry:
                    r = entry['range']
                    c_min = max(0, center - r)
                    c_max = min(255, center + r)

            # --- ZOOM CONSTRAINT logic ---
            zoom_dmx_val = self._calculate_channel('zoom', vibe, audio, zone_idx, dev_name, fixture)
            
            # Check for Manual Overrides
            zoom_ch_offset = fixture.get('channels', {}).get('zoom', -1)
            d_cfg = self.stage_config['devices'].get(dev_name, {})
            start_addr = d_cfg.get('address', 0)
            offset_val = d_cfg.get('offset', 0)
            final_zoom_addr = start_addr + offset_val + zoom_ch_offset
            
            if final_zoom_addr in self.overrides:
                zoom_dmx_val = int(self.overrides[final_zoom_addr])
                
            # Movement Constraints
            # User Request: Restrict standard range to 32-96 (+/- 32 from center 64)
            max_phys_deviation = 32.0
            min_phys_deviation = 8.0
            
            shapes = v_cfg.get('shapes', ['circle'])
            shape_key = shapes[(self._pattern_rotate_counter + zone_idx) % len(shapes)] if shapes else 'circle'
            
            drone = self.drones[zone_idx]
            
            # 1. Stateless Scene Execution (returns x, y, rot_z)
            # All scenes now return the raw 3-axis Lissajous path
            scene_x, scene_y, scene_z = self.scene_manager.get_position(
                zone_idx, drone['t'], self._dt, 
                audio, shape_key, vibe, 
                side=side, move_trigger=0.1, 
                target_scene=self.current_scene_name
            )
            
            # --- UNIVERSAL ROUTER ---
            # Route Lissajous Axes (x, y, z) based on scene
            output_pos_x = 0.0
            output_pos_y = 0.0
            output_rot_x = 0.0
            output_rot_y = 0.0
            output_rot_z = 0.0
            
            if self.current_scene_name == 'lissajous':
                output_pos_x = scene_x
                output_pos_y = scene_y
                output_rot_z = scene_z
                # rot_x, rot_y locked at 0
            
            elif self.current_scene_name == 'chase':
                output_pos_x = scene_x
                output_pos_y = drone.get('lock_y', 0.0) # Vertical Lock
                
                if self.rot_state == 'ROTX':
                    output_rot_x = scene_y # Drive Rot X with Y-Lissajous
                    output_rot_z = scene_z
                elif self.rot_state == 'IDLE':
                    output_rot_z = scene_y # Swap to Z
                # else: All rot at 0
            
            elif self.current_scene_name == 'scroll':
                output_pos_x = drone.get('lock_x', 0.0) # Horizontal Lock
                output_pos_y = scene_y
                
                if self.rot_state == 'ROTY':
                    output_rot_y = scene_x # Drive Rot Y with X-Lissajous
                    output_rot_z = scene_z
                elif self.rot_state == 'IDLE':
                    output_rot_z = scene_x # Swap to Z
                # else: All rot at 0
                
            elif self.current_scene_name == 'hold':
                output_pos_x = drone.get('lock_x', 0.0)
                output_pos_y = drone.get('lock_y', 0.0)
                output_rot_z = scene_z
                
                if self.rot_state == 'ROTX':
                    output_rot_x = scene_x
                    # Effects driven by remaining axis (Y) handled in zoom/effects
                    self.drones[zone_idx]['hold_effect'] = scene_y
                elif self.rot_state == 'ROTY':
                    output_rot_y = scene_y
                    # Effects driven by remaining axis (X)
                    self.drones[zone_idx]['hold_effect'] = scene_x
                else:
                    self.drones[zone_idx]['hold_effect'] = 0.0 # Hide third axis
            
            # 3. Handoff Interpolation
            if drone['blend'] < 1.0:
                eased = drone['blend'] * (2 - drone['blend'])
                output_pos_x = drone['anchor_x'] + (output_pos_x - drone['anchor_x']) * eased
                output_pos_y = drone['anchor_y'] + (output_pos_y - drone['anchor_y']) * eased
                output_rot_z = drone['anchor_rot_z'] + (output_rot_z - drone['anchor_rot_z']) * eased
                # Rotation X/Y snap to center on change per requirement, no blend needed
                
            # Store values for next frame / other channels
            self.drones[zone_idx]['last_x'] = output_pos_x
            self.drones[zone_idx]['last_y'] = output_pos_y
            self.drones[zone_idx]['last_rot_z'] = output_rot_z
            self.drones[zone_idx]['curr_rot_x'] = output_rot_x
            self.drones[zone_idx]['curr_rot_y'] = output_rot_y

            # --- PURE PATH CALCULATIONS ---
            # The smaller the size_pct (tighter dot), the higher the mobility allowance.
            # Wide lasers move 50% less to prevent clipping, Dots move 100%.
            mobility_factor = 0.5 + (1.0 - size_pct) * 0.5
            
            # Check for optional zoom-based position limitation range
            zoom_cal = cal.get('zoom', {})
            limit_range = zoom_cal.get('pos_limit_range', [0, 255])
            if zoom_dmx_val < limit_range[0] or zoom_dmx_val > limit_range[1]:
                mobility_factor = 1.0
            
            # Ensure we use bounds safely inside the hardware's manual mapping (usually 0-127)
            # This mathematically guarantees we NEVER accidentally trigger a hardware macro
            manual_range = fixture.get('modes', {}).get(role, {}).get('manual', {}).get('range', [0, 127])
            man_min, man_max = manual_range[0], manual_range[1]
            
            # Use roles.json limits, but hard-clamp them to the manual range
            safe_min = max(man_min, min(c_min, c_max))
            safe_max = min(man_max, max(c_min, c_max))
            
            # Dynamically calculate how far we can travel from the center without clipping
            max_travel_pos = safe_max - center
            max_travel_neg = center - safe_min
            
            # Find the largest symmetric swing we can do safely
            max_phys_deviation = max(0.0, min(max_travel_pos, max_travel_neg))
            min_phys_deviation = max_phys_deviation * 0.25 # Don't go completely still when large
            
            # Base amplitude constrained by size
            allowed_deviation = min_phys_deviation + (max_phys_deviation - min_phys_deviation) * mobility_factor
            
            # Scale sweeping scenes to use the full safe physical deviation, ignoring mobility clamp
            if self.current_scene_name in ['scroll', 'chase', 'lissajous']:
                allowed_deviation = max_phys_deviation 
            
            offset_factor = allowed_deviation

            # Use Universal Router output for proper axis locking
            if self.transient == 'tension':
                raw_val = center
            elif role == 'pos_x':
                raw_val = center + (output_pos_x * offset_factor)
            else:
                raw_val = center + (output_pos_y * offset_factor)
                
            # Final clamp to safe envelope
            val = max(safe_min, min(safe_max, raw_val))
            
            # Final Inversion
            if (role == 'pos_x' and dev_stage_cfg.get('invert_x')):
                val = (man_max + man_min) - val
            if (role == 'pos_y' and dev_stage_cfg.get('invert_y')):
                val = (man_max + man_min) - val
                
            return int(val)



        # 4. ROTATION & TUMBLE (Z, X, Y)
        if role in ['rot_z', 'rot_x', 'rot_y']:
            # Use calibration bounds if available, fallback to manual range
            entry = cal.get(role, {})
            mn = entry.get('min_dmx', 0)
            mx = entry.get('max_dmx', 127)
            
            # Center is 0 per Hardware Spec (Lissajous Profile view avoidance)
            center_rot = 0 
            
            drone = self.drones.get(zone_idx, {})
            
            # Z-Rotation: Scene-routed from drone state
            if role == 'rot_z':
                val_norm = drone.get('last_rot_z', 0.0)
                val = int(center_rot + val_norm * (mx - center_rot))
                val = max(mn, min(mx, val))
                
                dev_cfg = self.stage_config['devices'].get(dev_name, {})
                if dev_cfg.get('invert_rot'): val = mx - (val - mn)
                return val
                
            # X/Y-Rotation: Scene-routed from drone state
            max_tilt = mx // 2
            
            if role == 'rot_x':
                val_norm = drone.get('curr_rot_x', 0.0)
                return int(max(mn, min(mx, center_rot + val_norm * max_tilt)))
                
            if role == 'rot_y':
                val_norm = drone.get('curr_rot_y', 0.0)
                return int(max(mn, min(mx, center_rot + val_norm * max_tilt)))

        # 5. HARDWARE COLOR LOGIC
        if role in ['color_multi', 'color_solid']:
            # Global Manual Override (Highest Priority)
            if role == 'color_multi' and self.color_multi > 0:
                return int(self.color_multi * 255)
            if role == 'color_solid' and self.color_solid > 0:
                return int(self.color_solid * 255)

            # Mode-specific behavior if no manual override
            seed_val = (self._pattern_rotate_counter + zone_idx + 1)
            
            # 5a. SOLID MODE: Use discrete hardware color bins
            if self.color_mode == 'solid':
                if role == 'color_solid':
                    solid_cfg = fixture.get('modes', {}).get('color_solid', {}).get('individual', {})
                    colors = solid_cfg.get('colors', [])
                    if colors:
                        # Cycle through discrete pure colors
                        c = colors[seed_val % len(colors)]
                        return (c['min'] + c['max']) // 2 # Center of bin
                    return (seed_val * 7) % 64 # Fallback to low range
                return 0
            
            # 5b. MULTI MODE: Use the 'cycle' range from color_solid if available
            if self.color_mode == 'multi':
                if role == 'color_solid':
                    # Use the 'cycle' range (e.g. 64-255)
                    cycle_cfg = fixture.get('modes', {}).get('color_solid', {}).get('cycle', {})
                    rng = cycle_cfg.get('range', [64, 255])
                    # Just return the start of cycle range + modest speed
                    return min(255, rng[0] + 32) 
                
                # Randomized multi-color segments if no override
                if role == 'color_multi':
                    return (seed_val * 13) % 256
                return 0
            
            # 5c. AUTO MODE: Vibe-based selection (Existing Logic)
            if vibe == "chill":
                if role == 'color_solid': return (seed_val * 7) % 64 
                return 0
            
            if vibe == "high":
                # High Vibe: identical to 'multi' logic
                if role == 'color_solid': 
                    cycle_cfg = fixture.get('modes', {}).get('color_solid', {}).get('cycle', {})
                    rng = cycle_cfg.get('range', [64, 255])
                    return min(255, rng[0] + 50) # Faster cycle
                if role == 'color_multi': return (seed_val * 13) % 256
                return 0
            
            if vibe == "mid":
                if role == 'color_solid': return (seed_val * 17) % 256
                else:
                    if role == 'color_multi': return 20 + (seed_val * 77) % 200
                    return 0

        # 6. BEAM FX
        if role == 'beam_fx':
            if vibe == 'chill': return 0
            # Priority: Calibration bounds (base/max)
            b_cfg = cal.get('beam_fx', {})
            high_thresh = self.vibe_config.get(vibe, {}).get('dynamics', {}).get('beam_fx', {}).get('high_threshold', 0.4)
            
            if self.smoothed_high > high_thresh:
                self.push_effect(zone_idx, 'beam_fx', 'active')
                base = b_cfg.get('base', 64)
                mx = b_cfg.get('max', 255)
                val = base + (self.smoothed_high * (mx - base))
                return int(min(255, val))
            self.pop_effect(zone_idx, 'beam_fx')
            return 0
        # 7. GRATING (High-Speed Texture Scanning)
        if role == 'grating':
            # Base intensity driven by bass
            scan_intensity = self.smoothed_bass
            
            # If we are dropping or the effect is forced active, rev the engine to max
            is_forced = (zone_idx, 'grating') in self.active_effects
            if self.transient == 'dropping' or is_forced:
                scan_intensity = 1.0
            
            # Only scan if there is actually some audio energy or it's forced
            if scan_intensity > 0.1 or is_forced:
                # Use calibration range for LFO if available
                g_cfg = cal.get('grating', {})
                mn = g_cfg.get('base', 0)
                mx = g_cfg.get('max', 255)
                raw_lfo = self.grating_lfo.update(self._dt, scan_intensity) / 255.0 # normalized 0-1
                return int(mn + raw_lfo * (mx - mn))
            
            return 0

        # 8. DRAWING EFFECTS (Stepped Logic - Held until Pattern Change)
        if role == 'drawing_delay' or role == 'drawing':
            # Check if we already have a held value for this zone
            if zone_idx in self.held_drawing_values:
                val, delay_val = self.held_drawing_values[zone_idx]
                if role == 'drawing_delay': return delay_val
                return val

            # Rare Trigger Logic: Only on intense transients or massive energy
            energy = (self.smoothed_bass + self.smoothed_flux) * 0.5
            
            # Trigger conditions: EDM Drop or extreme bass spike
            if (self.transient == 'dropping' or energy > 0.85):
                # Selection logic (Rare activation)
                steps_str = cal.get(role, {}).get('steps', "63, 127, 255")
                try:
                    steps = [int(s.strip()) for s in str(steps_str).split(',') if s.strip()]
                except:
                    steps = [63, 127, 255]
                
                if not steps: steps = [255]
                
                s_idx = int(energy * len(steps))
                s_idx = max(0, min(len(steps)-1, s_idx))
                
                # Activate and hold
                final_val = steps[s_idx]
                final_delay = 63 # Standard drawing delay
                
                self.held_drawing_values[zone_idx] = (final_val, final_delay)
                self.push_effect(zone_idx, 'drawing', 'active')
                self.push_effect(zone_idx, 'drawing_delay', 'active')
                
                if role == 'drawing_delay': return final_delay
                return final_val
            else:
                # If not triggered and not held, ensure it's off
                self.pop_effect(zone_idx, 'drawing')
                self.pop_effect(zone_idx, 'drawing_delay')
                return 0
        
        # 8.5 DOTS (Point Grating - Rare and Held until Pattern Change)
        if role == 'dots':
            # Check for held value
            if zone_idx in self.held_dots_values:
                return self.held_dots_values[zone_idx]

            # Rare Trigger Logic: On intense transients or massive treble energy
            energy = self.smoothed_high
            
            if (self.transient == 'dropping' or energy > 0.85):
                steps_str = cal.get(role, {}).get('steps', "255")
                try:
                    steps = [int(s.strip()) for s in str(steps_str).split(',') if s.strip()]
                except:
                    steps = [255]
                
                if not steps: steps = [255]
                
                s_idx = int(energy * len(steps))
                s_idx = max(0, min(len(steps)-1, s_idx))
                val = steps[s_idx]
                
                self.held_dots_values[zone_idx] = val
                self.push_effect(zone_idx, 'dots', 'active')
                return val
            else:
                self.pop_effect(zone_idx, 'dots')
                return 0
        
        # 9. STROBE
        if role == 'strobe':
            strb = fixture.get('strobe', {}).get(role, {})
            # Criteria: High Intensity (smoothed_high) + High Energy (flux)
            # OR simple high treble
            if self.smoothed_high > 0.7 and self.smoothed_flux > 0.5:
                # Oscillate or Max? User asked for activation during high intensity.
                # Let's return Max.
                return strb.get('max', 255)
            # Default to Min
            return strb.get('min', 0)

        # 10. GENERIC
        if role == 'generic' or role.startswith('generic'):
            gen = fixture.get('generic', {}).get(role, {})
            mod_name = gen.get('modifier', 'intensity')
            
            # Get Modifier Value (0.0 - 1.0)
            val_norm = 0.0
            if mod_name == 'intensity':
                val_norm = self.intensity
            elif mod_name == 'flux':
                val_norm = self.smoothed_flux
            elif mod_name == 'bass':
                val_norm = self.smoothed_bass
            elif mod_name == 'treble':
                val_norm = self.smoothed_high
            elif mod_name == 'crosstalk':
                # Inverse of intensity/flux/activity?
                # Interpreting as "active when quiet"
                val_norm = 1.0 - max(self.smoothed_bass, self.smoothed_high, self.smoothed_flux)
            elif mod_name == 'none':
                val_norm = 0.0 # Just uses default/min?
            
            # Map 0.0-1.0 to Min-Max
            mn = gen.get('min', 0)
            mx = gen.get('max', 255)
            default = gen.get('default', 0)
            
            # If modifier is effectively zero (e.g. no signal), should we use Default?
            # Linear interpolation:
            out = mn + (mx - mn) * val_norm
            return int(out)
            
        # 11. DIMMER (Master Intensity / Shutter)
        if role == 'dimmer' or role.startswith('dimmer'):
            dim_cfgs = fixture.get('dimmers', {})
            cfg = dim_cfgs.get(role)
            if not cfg: return -1 # Use defaults if no config
            
            # Logic: binary vs range
            if cfg.get('mode') == 'binary':
                logic = cfg.get('logic', 'normally_off')
                if logic == 'normally_on':
                    # Always on unless master blackout (handled in _process_device)
                    is_on = True
                else: 
                    # On only if there is audio or intensity > 0
                    is_on = audio.get('vol', 0) > 0.02 or self.intensity > 0
                
                return cfg.get('on_val', 255) if is_on else cfg.get('off_val', 0)
            else:
                # Range Mode: Scale between min and max
                # Note: _process_device will still multiply this by self.intensity
                mn = cfg.get('min', 0)
                mx = cfg.get('max', 255)
                # If we assume range mode is for master-dimming, we can return mx
                # and let the global intensity scaling handle it.
                return mx

        if role in ['mode', 'boundary', 'group', 'twist', 'clip']: 
            return -1

        return -1
    
    def _get_vibe_name(self, audio: Dict) -> str:
        return audio.get('vibe', 'mid')

    def get_universe(self): 
        """Return full 512 channel universe (513 bytes with start code)"""
        return self.universe[:]
    
    def set_intensity(self, val): self.intensity = float(val)
    def set_speed(self, val): self.speed = float(val)
    def set_color_multi(self, val): self.color_multi = float(val)
    def set_color_solid(self, val): self.color_solid = float(val)
    
    def set_audio_sensitivity(self, val): self.audio_sensitivity = float(val)
    
    # Deprecated set_pattern_freq removed in favor of global scene_freq
    
    def set_pattern_mode(self, mode):
        """Set pattern selection mode."""
        self.pattern_mode = mode
    
    def set_color_mode(self, mode):
        """Set color mode."""
        self.color_mode = mode
    
    # _get_trigger_value removed


    def get_channel_state(self):
        # Return currently active DMX values and effects for HUD
        res = {
            "values": {},
            "effects": []
        }
        
        # Collect values
        for name, cfg in self.stage_config.get('devices', {}).items():
            fix_type = cfg.get('type')
            fixture = self.fixtures.get(fix_type)
            if not fixture: continue

            base = cfg['address'] + cfg['offset']
            for role, off in fixture['channels'].items():
                addr = base + off
                if 0 < addr < len(self.universe):
                    res["values"][f"{name}_{role}"] = self.universe[addr]
        
        # Collect currently active hardware effects (macros)
        for (zone_idx, role), effect_name in self.active_effects.items():
            if zone_idx < len(self.zone_map):
                dev_name = self.zone_map[zone_idx]
                res["effects"].append(f"{dev_name} {role.upper()}: {effect_name.upper()}")
                
        return res

    def push_effect(self, zone_idx, role, effect_name):
        """Explicitly activate a hardware effect mode for a specific channel."""
        self.active_effects[(zone_idx, role)] = effect_name

    def pop_effect(self, zone_idx, role):
        """Return a channel to standard manual control."""
        if (zone_idx, role) in self.active_effects:
            del self.active_effects[(zone_idx, role)]

    def _handle_effect_triggers(self, audio, vibe):
        """Intentional trigger logic: pushes effects to the stack based on audio energy and frequency."""
        conf = audio.get('confidence', 1.0)
        
        # Audio Frequency Analysis
        bass_energy = self.smoothed_bass * (0.5 + 0.5 * conf)
        mid_energy = self.smoothed_mid * (0.5 + 0.5 * conf)
        treble_energy = self.smoothed_high * (0.5 + 0.5 * conf)
        flux_energy = self.smoothed_flux * (0.5 + 0.5 * conf)
        
        force_macros = self.transient == 'dropping'
        
        # --- GLOBAL CHAOS LAYER (Drop/Transient Overrides) ---
        # Sits above standard scene logic for intense scattered impact
        if force_macros:
            for i, (dev_name, dev_cfg) in enumerate(self.stage_config.get('devices', {}).items()):
                # Skip rhythm zones for global macro chaos
                if dev_cfg.get('behavior') == 'rhythm':
                    continue
                # Dynamic Zoom oscillation
                # Zoom oscillation moved to rare status below
                # Dots (Point Grating) 
                self.push_effect(i, 'dots', 'active')
                # Grating (Strobe) — full 0-255 sweep
                self.push_effect(i, 'grating', 'active')
            # Don't return — still apply scene-specific logic below
        
        # --- THE HOLD STATE & TARGETED EQ CHAOS ---
        if self.current_scene_name == 'hold':
            for i, (dev_name, dev_cfg) in enumerate(self.stage_config.get('devices', {}).items()):
                # Skip rhythm zones for hold chaos
                if dev_cfg.get('behavior') == 'rhythm':
                    continue
                # Determine dominant frequency band
                dominant = max(bass_energy, mid_energy, treble_energy)
                
                if dominant < 0.3:
                    continue  # Not enough energy to trigger
                
                # Bass Dominant -> Rotation Velocity (Drawing removed for Rare & Held consistency)
                if bass_energy == dominant and bass_energy > 0.3:
                    self.push_effect(i, 'rot_z', 'oscillation')
                
                # Mid Dominant -> 3D Rotation Unlock (Rot X/Y/Z get aggressive velocity)
                elif mid_energy == dominant and mid_energy > 0.3:
                    self.push_effect(i, 'rot_z', 'distortion')
                    # Rot X and Y are handled via tumble in _calculate_channel
                    # but we push zoom oscillation to add visual intensity
                    # Zoom oscillation moved to rare status below
                
                # Treble Dominant -> Grating only (Dots moved to Rare & Held consistency)
                elif treble_energy == dominant and treble_energy > 0.3:
                    self.push_effect(i, 'grating', 'active')
                    
            return # Skip the rest of the audio-reactive macro logic
        
        for i, (dev_name, dev_cfg) in enumerate(self.stage_config.get('devices', {}).items()):
            fix_type = dev_cfg.get('type')
            fixture = self.fixtures.get(fix_type)
            if not fixture: continue
            
            # Skip rhythm zones for standard macro oscillation
            if dev_cfg.get('behavior') == 'rhythm':
                continue
                
            # 1. WAVE -> Only on Drop or Extreme Energy (Hardware Macros)
            energy = (self.smoothed_bass + self.smoothed_flux) * 0.1
            if energy > 0.85 or force_macros:
                self.push_effect(i, 'pos_x', 'wave')
                self.push_effect(i, 'pos_y', 'wave')
            else:
                self.pop_effect(i, 'pos_x')
                self.pop_effect(i, 'pos_y')
                
            # 2. DRAWING deactivated here - now handled exclusively in _calculate_channel 
            # for "Rare and Held" logic consistency.
                
                
            # 3. GRATING -> TREBLE (High-end energy)
            if treble_energy > 0.5 or force_macros:
                self.push_effect(i, 'grating', 'active')
                self.push_effect(i, 'rot_z', 'distortion')
            else:
                self.pop_effect(i, 'grating')
                self.pop_effect(i, 'rot_z')

            # 4. ZOOM OSCILLATION -> Only on REAL Drop or Major Energy
            # Increased threshold to 0.95 and using a more stable energy metric
            zoom_trigger_energy = (self.smoothed_bass * 0.7 + self.smoothed_flux * 0.3)
            if zoom_trigger_energy > 0.95 or force_macros:
                self.push_effect(i, 'zoom', 'oscillation')
            else:
                self.pop_effect(i, 'zoom')

    def _detect_bass_style(self, audio, dt):
        """
        Classify the current audio into a bass style based on frequency bin signatures.
        Sets self._current_bass_style to one of: 'sub', 'tearout', 'machine_gun', 'wonky', or None.
        """
        bins = audio.get('bins', [0.0] * 11)
        isolation = audio.get('isolation', 0.0)
        bass = audio.get('bass', 0.0)
        mid = audio.get('mid', 0.0)
        bpm = audio.get('bpm', 120.0)

        # Track history for temporal patterns
        self._bass_bins_history.append(bass)
        prev_bass = self._bass_bins_history[-2] if len(self._bass_bins_history) >= 2 else 0.0
        bass_delta = abs(bass - prev_bass)
        self._bass_delta_history.append(bass_delta)
        self._mid_history.append(mid)

        # Holdoff timer: don't re-classify too rapidly
        if self._bass_style_holdoff > 0:
            self._bass_style_holdoff -= dt
            return

        detected = None

        # 1. SUB: Pure sine wave — extreme low bin energy, clean isolation, no high content
        if bins[0] > 0.8 and sum(bins[4:]) < 0.2 and isolation > 0.7:
            detected = 'sub'

        # 2. TEAROUT: Grinding distortion — heavy bass + dense high-frequency presence, no isolation
        elif bass > 0.7 and sum(bins[5:]) > 2.0 and isolation < 0.2:
            detected = 'tearout'

        # 3. MACHINE GUN: Rapid staccato hits — high bass delta variance (on/off/on/off pattern)
        elif len(self._bass_delta_history) >= 15:
            deltas = list(self._bass_delta_history)
            avg_delta = sum(deltas) / len(deltas)
            # Count zero-crossings (transitions between hit and silence)
            crossings = 0
            for i in range(1, len(deltas)):
                if (deltas[i] > avg_delta * 1.5) != (deltas[i-1] > avg_delta * 1.5):
                    crossings += 1
            # Frequent transitions with meaningful energy = machine gun pattern
            if crossings > 8 and bass > 0.4 and avg_delta > 0.15:
                detected = 'machine_gun'

        # 4. WONKY: Sustained bass with oscillating mids (wobble)
        if detected is None and len(self._mid_history) >= 15 and bass > 0.5:
            mids = list(self._mid_history)
            # Calculate derivative sign changes (oscillation detection)
            sign_changes = 0
            for i in range(2, len(mids)):
                d1 = mids[i] - mids[i-1]
                d2 = mids[i-1] - mids[i-2]
                if (d1 > 0.02 and d2 < -0.02) or (d1 < -0.02 and d2 > 0.02):
                    sign_changes += 1
            # Sustained bass + rhythmic mid oscillation = wobble
            bass_sustained = min(self._bass_bins_history) > 0.3 if len(self._bass_bins_history) >= 10 else False
            if sign_changes > 5 and bass_sustained:
                detected = 'wonky'

        # Apply detection with holdoff
        if detected != self._current_bass_style:
            if detected is not None:
                # Check if any presets exist for this style before committing
                has_presets = any(p.get('vibe') == detected for p in self.presets.values())
                if has_presets:
                    self._current_bass_style = detected
                    self._bass_style_holdoff = 0.5  # 0.5s holdoff
                    print(f"[DMX] Bass style detected: {detected}")
                else:
                    self._current_bass_style = None
            else:
                self._current_bass_style = None

    def apply_overrides(self, ol, sl=[]):
        """
        Handle 'laser_override' messages from frontend.
        Supports:
        1. Explicit Address: { 'address': 50, 'value': 255 }
        2. Zone/Channel: { 'zone': 1, 'channel': 1, 'value': 255 }
        
        This is now ADDITIVE. To clear, use clear_device_overrides.
        """
        for o in ol:
            # Mode 1: Absolute Address
            if 'address' in o:
                addr = int(o['address'])
                val = int(o.get('value', 0))
                self.overrides[addr] = val
                continue

            # Mode 2: Zone Mapping (Legacy/Relative)
            z_idx = int(o.get('zone', 1))
            ch_idx = int(o.get('channel', 1)) 
            
            # Map Zone Index to Device Key (1 -> L1, 2 -> L2, etc.)
            if z_idx <= len(self.zone_map):
                dev_key = self.zone_map[z_idx - 1]
                dev_cfg = self.stage_config['devices'][dev_key]
                base = dev_cfg['address'] + dev_cfg['offset']
                
                final_addr = base + ch_idx - 1
                self.overrides[final_addr] = int(o.get('value', 0))

    def clear_device_overrides(self, dev_name):
        """Clear all manual overrides for a specific device based on its channel mapping"""
        dev_cfg = self.stage_config.get('devices', {}).get(dev_name)
        if not dev_cfg: return
        
        fix_type = dev_cfg.get('type')
        fixture = self.fixtures.get(fix_type)
        if not fixture: return
        
        base = dev_cfg['address'] + dev_cfg['offset']
        for role, ch_offset in fixture.get('channels', {}).items():
            abs_addr = base + ch_offset
            if abs_addr in self.overrides:
                del self.overrides[abs_addr]
        print(f"🧹 Cleared overrides for device: {dev_name}")

    def load_config(self):
        """
        No-op for now as we use static python profile.
        Could implement module reload here if needed.
        """
        pass
