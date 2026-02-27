# movement_scenes.py
# Pure Mathematical Paths supporting Time Scrubbing & Inversion
# All scenes return (x, y, rot_z) where values are -1.0 to 1.0

import math

class SceneManager:
    def __init__(self):
        self.scene_classes = {
            'hold': Hold,
            'scroll': Scroll,
            'chase': Chase,
            'lissajous': Lissajous
        }
        # Instantiate stateless scenes once
        self.scenes = {name: cls() for name, cls in self.scene_classes.items()}
        
        # Vibe -> scene pool + timing (Strictly Stateless & Reversible)
        self.vibe_config = {
            'chill': {'speed_mult': 0.5},
            'mid': {'speed_mult': 1.0},
            'high': {'speed_mult': 1.5}
        }

    def get_position(self, zone_idx, movement_time, dt, audio, shape_name, vibe, side='left', move_trigger=0.5, target_scene='hold'):
        """Stateless router for pure mathematical paths. Returns (x, y, rot_z)."""
        cfg = self.vibe_config.get(vibe, self.vibe_config['mid'])
        # Decoupled speed: lower baseline (0.2) + trigger boost
        speed = cfg['speed_mult'] * (0.2 + move_trigger * 0.8)
        scene = self.scenes.get(target_scene, self.scenes['hold'])
        return scene.update(movement_time * speed, dt, audio, zone_idx, side)
    
    def force_scene(self, scene_name):
        """Deprecated: Handoff and force logic is now handled strictly in dmx_engine."""
        pass


class Hold:
    """Routing: Returns Lissajous axes for rotation/effects mapping."""
    def update(self, t, dt, audio, zone_idx, side='left'):
        # Just return Lissajous source for the DMX engine to route to rotation
        return Lissajous().update(t, dt, audio, zone_idx, side)


class Scroll:
    """Routing: Returns Lissajous axes for Vertical (Y) mapping."""
    def update(self, t, dt, audio, zone_idx, side='left'):
        return Lissajous().update(t, dt, audio, zone_idx, side)


class Chase:
    """Routing: Returns Lissajous axes for Horizontal (X) mapping."""
    def update(self, t, dt, audio, zone_idx, side='left'):
        return Lissajous().update(t, dt, audio, zone_idx, side)


class Lissajous:
    """Frequency-shifted lissajous figures providing 3 axes: (x, y, z)."""
    def update(self, t, dt, audio, zone_idx, side='left'):
        # Phase offset based on zone
        phase = zone_idx * math.pi / 2
        
        flux = min(0.6, audio.get('flux', 0.0))
        bass = min(1.0, audio.get('bass', 0.0))
        mid = audio.get('mid', 0.0)
        high = audio.get('high', 0.0)
        bins = audio.get('bins', [0.0] * 11)
        
        # DYNAMIC Frequency Shift: Lower baseline, higher reactive "kick"
        speed_mult = 0.8 + (flux * 0.7) 
        
        freq_x = 1.5 * speed_mult
        freq_y = 1.0 * speed_mult
        
        # Radius driven by Bass (Restored dynamic range: small when quiet, large when loud)
        radius_x = 0.4 + bass * 0.6
        radius_y = 0.3 + bass * 0.7
        
        x = math.sin(t * freq_x + phase) * radius_x
        y = math.sin(t * freq_y) * radius_y
        
        # Z Axis: driven by mid-frequency bins
        mid_energy = (bins[3] + bins[4] + bins[5] + bins[6]) * 0.25
        rot_speed = 1.0 + min(2.0, mid_energy * 2.0) + high * 1.5
        z = math.sin(t * rot_speed * 0.5 + phase * 0.5)
        
        return x, y, z
