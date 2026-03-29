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
        self.smooth_vol = 0.0

        # Energy Trend Tracking (Build/Drop Detection)
        self.energy_history = collections.deque(maxlen=120)  # ~4s at 30fps
        self.transient = "steady"  # "building", "dropping", "tension", "steady"
        self._transient_hold_until = 0  # Hold timer to prevent single-frame flickers
        self._steady_since = 0 # Prevent re-triggering building too fast

    def update(self, audio_state, now=None):
        """
        Input: Raw Audio Dictionary from main.py
        Output: The "3x3" Command Structure
        """
        if now is None: now = time.time()
        
        # Initialize timestamps on first frame to support virtual time / reset
        if not hasattr(self, '_time_initialized') or now < self.last_vibe_change - 10.0:
            self.last_vibe_change = now
            self._transient_hold_until = now
            self._steady_since = now
            self._time_initialized = True
        
        # 1. CALCULATE DENSITY (For Vibe Selection)
        # Force incoming audio values to standard Python floats to prevent float32 accumulation/serialization issues
        bass = float(audio_state.get('bass', 0.0))
        vol = float(audio_state.get('vol', 0.0))
        high = float(audio_state.get('high', 0.0))
        flux = float(audio_state.get('flux', 0.0))

        if audio_state.get('beat', False):
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
            
            if density < chill_density and vol < chill_vol:
                target = "chill"
            elif density > high_density and vol > high_vol:
                target = "high"
            else:
                target = "mid"
                
            if target != self.current_vibe:
                self.current_vibe = target
                self.last_vibe_change = now

        # Liquid Smoothing: Slower coefficients for modulators to prevent sub-pixel jitter in raymarchers
        # Explicitly cast to float to prevent numpy type leakage
        self.smooth_bass = float(self.smooth_bass + (bass - self.smooth_bass) * 0.15)
        self.smooth_high = float(self.smooth_high + (high - self.smooth_high) * 0.1)
        self.smooth_flux = float(self.smooth_flux + (flux - self.smooth_flux) * 0.05)
        self.smooth_vol  = float(self.smooth_vol  + (vol  - self.smooth_vol)  * 0.15)

        # 3.5 ENERGY TREND TRACKING (Build/Drop Detection)
        # Calculate an instantaneous "impact" score (Bass is weighted heavily)
        impact = float(bass * 0.6 + vol * 0.4)
        
        # Keep a short history for instant snap detection (approx 0.5 seconds at 30fps)
        if not hasattr(self, 'impact_history'):
            self.impact_history = collections.deque(maxlen=15)
        self.impact_history.append(impact)

        # Legacy energy for density (slower moving trend)
        energy = float(density * 0.4 + vol * 0.6)
        self.energy_history.append(energy)
        
        if len(self.energy_history) >= 60 and len(self.impact_history) >= 15:
            old_energy = self.energy_history[-60]
            trend_long = energy - old_energy
            
            old_impact = self.impact_history[0]
            impact_spike = impact - old_impact

            # Minimum hold durations per state (seconds)
            # Increased for more intentional, cinematic phase shifts
            HOLD_TIMES = {"building": 1.5, "tension": 2.0, "dropping": 4.0}
            
            # Use a slightly wider window (8 frames) for smoother transient decisions
            # This ignores percussive gaps that might look like silence (tension)
            recent_avg = sum(self.impact_history[i] for i in range(-8, 0)) / 8.0 
            old_avg = sum(self.impact_history[i] for i in range(0, 8)) / 8.0
            sustained_spike = recent_avg - old_avg
            
            # If we're still in a hold period, don't enter state transition logic
            if now < self._transient_hold_until:
                pass
            else:
                # STATE MACHINE: steady → building → tension → dropping → steady
                
                if self.transient == "steady":
                    # DEBOUNCE: Stay steady for at least 3.0s after a drop before re-building
                    # Building: Energy is rising, and we're actually loud enough (prevents triggering on noise)
                    if trend_long > 1.2 and recent_avg > 0.45 and now - self._steady_since > 3.0:
                        self.transient = "building"
                        self._transient_hold_until = now + HOLD_TIMES["building"]
                
                elif self.transient == "building":
                    # Advance to TENSION: Sustained drop in energy during a building phase (the breakdown)
                    if recent_avg < 0.2 and old_energy > 1.8:
                        self.transient = "tension"
                        self._transient_hold_until = now + HOLD_TIMES["tension"]
                    elif trend_long > 0.4:
                        pass # Energy still rising, hold building
                    else:
                        self.transient = "steady" # Energy flattened out without tension, return to normal
                
                elif self.transient == "tension":
                    # Advance to DROPPING: Massive recovery (The Drop!)
                    if bass > 0.6 or (sustained_spike > 0.3 and recent_avg > 0.6):
                        self.transient = "dropping"
                        self._transient_hold_until = now + HOLD_TIMES["dropping"]
                    elif recent_avg < 0.35:
                        pass # Still in the break
                    else:
                        self.transient = "steady" # Tension resolved without a heavy drop
                
                elif self.transient == "dropping":
                    # Drop hold finished, return to steady and start the post-drop lockout
                    self.transient = "steady"
                    self._steady_since = now

        # Drop is over, return to steady
        
        return {
            "vibe": self.current_vibe,      # "chill", "mid", "high"
            "transient": self.transient,    # "building", "dropping", "steady"
            "mods": {
                "bass": self.smooth_bass,
                "high": self.smooth_high,
                "flux": self.smooth_flux,
                "vol":  self.smooth_vol,
                "beat_phase": audio_state.get('beat_phase', 0.0)  # 0-1 position in beat
            }
        }