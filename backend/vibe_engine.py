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
        self.transient = "steady"  # "building", "dropping", "tension", "steady"
        self._transient_hold_until = 0  # Hold timer to prevent single-frame flickers

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
        # Hysteresis: Don't switch faster than every 2 seconds
        if now - self.last_vibe_change > 2.0:
            target = self.current_vibe
            
            # Hybrid Logic: Discrete checks (Density AND Volume) but parameterized by Bias
            # Bias 0.0 -> Easy to leave Mid (Small Mid Zone)
            # Bias 1.0 -> Hard to leave Mid (Extreme Mid Zone)
            
            # Chill Thresholds: Lower bias makes it easier to hit chill (higher thresholds)
            chill_density = 2.0 * (1.0 - self.mid_vibe_bias)
            chill_vol = 0.3 * (1.0 - self.mid_vibe_bias)
            
            # High Thresholds: Lower bias makes it easier to hit high (lower thresholds)
            high_density = 4.0 + (4.0 * self.mid_vibe_bias)
            high_vol = 0.5 + (0.4 * self.mid_vibe_bias)
            
            if density < chill_density and audio_state['vol'] < chill_vol:
                target = "chill"
            elif density > high_density and audio_state['vol'] > high_vol and audio_state.get('confidence', 1.0) > 0.5:
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
            e_list = list(self.energy_history)
            old_energy = e_list[-60]
            trend_long = energy - old_energy
            
            i_list = list(self.impact_history)
            old_impact = i_list[0]
            impact_spike = impact - old_impact

            # Minimum hold durations per state (seconds)
            HOLD_TIMES = {"building": 1.0, "tension": 1.5, "dropping": 2.0}
            
            # Sustained spike check: average of last 5 impact samples vs 5 oldest
            recent_avg = sum(i_list[-5:]) / 5.0
            old_avg = sum(i_list[:5]) / 5.0
            sustained_spike = recent_avg - old_avg
            
            # If we're still in a hold period, don't override
            if now < self._transient_hold_until:
                pass
            else:
                # STATE MACHINE: steady → building → tension → dropping → steady
                
                if self.transient == "steady":
                    # Entry to BUILDING: Energy is rising over ~2 seconds
                    if trend_long > 1.0:
                        self.transient = "building"
                        self._transient_hold_until = now + HOLD_TIMES["building"]
                
                elif self.transient == "building":
                    # Advance to TENSION: Energy drops off (the breakdown/silence before a drop)
                    if impact < 0.25 and old_energy > 1.5:
                        self.transient = "tension"
                        self._transient_hold_until = now + HOLD_TIMES["tension"]
                    # Still building? Stay here if energy is still trending up
                    elif trend_long > 0.5:
                        pass  # Hold building
                    else:
                        self.transient = "steady"  # Build fizzled out
                
                elif self.transient == "tension":
                    # Advance to DROPPING: Bass comes back hard (the drop!)
                    if audio_state['bass'] > 0.5 or (sustained_spike > 0.35 and impact > 0.6):
                        self.transient = "dropping"
                        self._transient_hold_until = now + HOLD_TIMES["dropping"]
                    # Still tense? Stay here if impact is still low
                    elif impact < 0.4:
                        pass  # Hold tension
                    else:
                        self.transient = "steady"  # Tension resolved without drop
                
                elif self.transient == "dropping":
                    # Drop is over, return to steady
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