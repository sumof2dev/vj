# vibe_engine.py
import time
import collections

class VibeEngine:
    def __init__(self):
        # Configuration
        self.beat_history = collections.deque(maxlen=20)
        self.current_vibe = "mid" # Default
        self.last_vibe_change = 0
        self.mid_vibe_bias = 0.4 # Requested Default
        
        # Smoothers
        self.smooth_bass = 0.0
        self.smooth_high = 0.0
        self.smooth_flux = 0.0

        # Energy Trend Tracking (Build/Drop Detection)
        self.energy_history = collections.deque(maxlen=120)  # ~4s at 30fps
        self.transient = "steady"  # "building", "dropping", "steady"

    def update(self, audio_state):
        """
        Input: Raw Audio Dictionary from main.py
        Output: The "3x3" Command Structure
        """
        now = time.time()
        
        # 1. CALCULATE DENSITY (For Vibe Selection)
        if audio_state['beat']:
            self.beat_history.append(now)
        # Clean old beats (>3s)
        while len(self.beat_history) > 0 and now - self.beat_history[0] > 3.0:
            self.beat_history.popleft()
        density = len(self.beat_history)

        # 2. SELECT VIBE (The "Bucket")
        # Hysteresis: Don't switch faster than every 4 seconds
        if now - self.last_vibe_change > 2.0:
            target = self.current_vibe
            
            # Logic:
            # Low Density + Low Vol = CHILL
            # High Density AND High Vol = HIGH (harder to achieve - reserve for drops)
            # Everything else = MID
            # Inject Spotify Context if available
            spotify = audio_state.get('spotify', {})
            track_energy = spotify.get('energy', 0.5)
            
            # Logic mapped with Spotify authority
            # If Spotify says it's a chill song (< 0.4 energy), suppress wild modes
            if (density < 2 and audio_state['vol'] < 0.3) or (track_energy < 0.4 and audio_state['vol'] < 0.6):
                target = "chill"
            # If Spotify says it's a banger (> 0.7 energy), let it reach HIGH much easier
            elif density > 3 and audio_state['vol'] > 0.5 and (audio_state.get('confidence', 0.5) > 0.5 or track_energy > 0.7):
                target = "high"
            else:
                target = "mid"
                
            if target != self.current_vibe:
                self.current_vibe = target
                self.last_vibe_change = now

        # 3. CALCULATE MODIFIERS (The "Sliders")
        # Faster smoothing for more reactive modifiers
        self.smooth_bass += (audio_state['bass'] - self.smooth_bass) * 0.35
        self.smooth_high += (audio_state['high'] - self.smooth_high) * 0.25
        self.smooth_flux += (audio_state['flux'] - self.smooth_flux) * 0.3

        # 3.5 ENERGY TREND TRACKING (Build/Drop Detection)
        # Redefined to understand EDM structure: Bass is the key indicator of an explosive drop.
        
        # Calculate an instantaneous "impact" score (Bass is weighted heavily)
        impact = audio_state['bass'] * 0.6 + audio_state['vol'] * 0.4
        
        # Keep a short history for instant snap detection (approx 0.5 seconds at 30fps)
        if not hasattr(self, 'impact_history'):
            self.impact_history = collections.deque(maxlen=15)
        self.impact_history.append(impact)

        # Legacy energy for density (slower moving trend)
        energy = density * 0.4 + audio_state['vol'] * 0.6
        self.energy_history.append(energy)
        
        if len(self.energy_history) >= 60 and len(self.impact_history) >= 15:
            old_energy = self.energy_history[-60]
            trend_long = energy - old_energy
            
            old_impact = self.impact_history[0]
            impact_spike = impact - old_impact

            # 1. TENSION: Sudden volume/bass cut while overall energy was recently high
            if impact < 0.25 and old_energy > 1.5:
                self.transient = "tension"
                
            # 2. THE DROP: Massive sudden spike in impact (Bass snapping back hard)
            # OR we are coming directly out of tension with a heavy bass hit
            elif impact_spike > 0.45 or (self.transient == "tension" and audio_state['bass'] > 0.7):
                self.transient = "dropping"
                
            # 3. BUILD: Gradual increase in overall density/volume over 2 seconds
            elif trend_long > 1.0:
                self.transient = "building"
                
            # 4. STEADY
            else:
                self.transient = "steady"

        # 4. APPLY CONFIDENCE SCALING (The "Commit Zone")
        # Low confidence = reduced amplitude of effects
        conf = audio_state.get('confidence', 1.0)
        
        return {
            "vibe": self.current_vibe,      # "chill", "mid", "high"
            "transient": self.transient,    # "building", "dropping", "steady"
            "mods": {
                "bass": self.smooth_bass * max(0.4, conf),   # Floor confidence at 0.4
                "high": self.smooth_high * max(0.4, conf),
                "flux": self.smooth_flux * max(0.4, conf),
                "vol":  audio_state['vol'] * max(0.5, conf), # Ensure at least 50% volume passes through
                "conf": conf,                      # Pass through for DMX scaling
                "beat_phase": audio_state.get('beat_phase', 0.0)  # 0-1 position in beat
            }
        }