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
        self.vibe_hysteresis = 5.0 # "Sticky Vibe" (prevent flickering)
        self.impact_history = collections.deque(maxlen=15)
        self._history_frame = 0  # Frame counter; transient logic is suppressed until history is warm

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
        spectral = float(audio_state.get('spectral_complexity', 0.5))

        if audio_state.get('beat', False):
            self.beat_history.append(now)
        # Clean old beats (>3s)
        while len(self.beat_history) > 0 and now - self.beat_history[0] > 3.0:
            self.beat_history.popleft()
        density = len(self.beat_history)

        # 2. SELECT VIBE (The "Bucket")
        # Hysteresis: We allow instant upgrades to HIGH, but downgrades are blocked
        # for vibe_hysteresis (5s) to prevent lighting "indecision" in complex tracks.
        target = self.current_vibe
        
        # HIGH Thresholds: Enhanced to distinguish "Groove" from "Peak"
        # 1. Extreme Beat Density (BPM > 180 or very active rhythm)
        # 2. Combination of Volume AND Spectral Complexity (The Shimmer)
        high_vol = 0.55 + (0.35 * self.mid_vibe_bias)
        high_density = 6.5 + (6.0 * self.mid_vibe_bias)
        # Spectral threshold is biased to protect the Mid core
        high_spectral = 0.38 + (0.15 * (1.0 - self.mid_vibe_bias)) 
        
        chill_vol = 0.20 * (1.0 - self.mid_vibe_bias)
        chill_density = 2.0 * (1.0 - self.mid_vibe_bias)
        
        # Vibe Logic
        is_high = (density >= high_density) or (vol > high_vol and spectral > high_spectral)
        is_chill = (vol < chill_vol and density < chill_density)
        
        if is_high:
            target = "high"
        elif is_chill:
            # Downgrade protection check
            if self.current_vibe != "high" or (now - self.last_vibe_change > self.vibe_hysteresis):
                target = "chill"
        else:
            # Mid Drive (The Default Groove)
            if self.current_vibe != "high" or (now - self.last_vibe_change > self.vibe_hysteresis):
                target = "mid"
            
        if target != self.current_vibe:
            self.current_vibe = target
            self.last_vibe_change = now

        # Restored "Snappier" Smoothing (Reverted from Liquid Smoothing)
        # Explicitly cast to float to prevent numpy type leakage
        self.smooth_bass = float(self.smooth_bass + (bass - self.smooth_bass) * 0.35)
        self.smooth_high = float(self.smooth_high + (high - self.smooth_high) * 0.25)
        self.smooth_flux = float(self.smooth_flux + (flux - self.smooth_flux) * 0.30)
        self.smooth_vol  = float(self.smooth_vol  + (vol  - self.smooth_vol)  * 0.35)

        # 3.5 ENERGY TREND TRACKING (Build/Drop Detection)
        # Calculate an instantaneous "impact" score (Bass is weighted heavily)
        impact = float(bass * 0.6 + vol * 0.4)

        self.impact_history.append(impact)
        self._history_frame += 1

        # Slow-moving energy trend for build/drop detection (volume-only)
        # We store the smoothed volume to prevent single-beat spikes from triggering trends.
        energy = float(self.smooth_vol)
        self.energy_history.append(energy)
        
        # Suppress transient detection until we have a half-window of real data (~2s).
        # 60 frames balances startup false-positives vs. calibration test responsiveness.
        # Transient logic requires at least 70 frames of history for its windowed comparison
        if self._history_frame >= 70 and len(self.energy_history) >= 70 and len(self.impact_history) >= 15:
            # Windowed Trend: Compare recent 10-frame average to a 10-frame block from 2s ago
            # This is MUCH more stable than single-frame comparisons.
            recent_energy = sum(list(self.energy_history)[-10:]) / 10.0
            past_energy = sum(list(self.energy_history)[-70:-60]) / 10.0
            trend_long = recent_energy - past_energy
            
            old_impact = self.impact_history[0]
            impact_spike = impact - old_impact

            # Minimum hold durations per state (seconds) - Re-aligned with Cinematic rules
            # Building hold is reduced to ensure we can catch the breakdown (tension) immediately.
            HOLD_TIMES = {"building": 0.5, "tension": 1.5, "dropping": 4.0}
            
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
                    # SUSTAINED IMPACT BYPASS (Immediate Drop):
                    # If music snaps from quiet to extreme energy instantly.
                    if (impact > 0.45 or sustained_spike > 0.3) and recent_avg > 0.4 and now - self._steady_since > 2.0:
                        self.transient = "dropping"
                        self._transient_hold_until = now + HOLD_TIMES["dropping"]
                    
                    # Standard sequence: Building (Slow Build)
                    elif trend_long > 0.3 and recent_avg > 0.35 and now - self._steady_since > 2.0:
                        self.transient = "building"
                        self._transient_hold_until = now + HOLD_TIMES["building"]
                
                elif self.transient == "building":
                    # Advance to TENSION: Relative drop in energy (The Breakdown)
                    # We compare current avg to the energy from ~1.5s ago
                    if recent_avg < old_avg * 0.8 and past_energy > 0.05:
                        self.transient = "tension"
                        self._transient_hold_until = now + HOLD_TIMES["tension"]
                    elif impact > 0.35: # EMERGENCY BYPASS: even faster
                        self.transient = "dropping"
                        self._transient_hold_until = now + HOLD_TIMES["dropping"]
                    elif trend_long > -0.02 or recent_avg > 0.2:
                        # Energy still rising or high, DO NOT revert to steady
                        self._transient_hold_until = now + 1.0 # Extend
                    else:
                        # Energy definitely flattened out without tension, return to normal and START LOCKOUT
                        self.transient = "steady" 
                        self._steady_since = now
                
                elif self.transient == "tension":
                    # Advance to DROPPING: Massive recovery (The Drop!)
                    # More aggressive sustained_spike detection to catch the "Big Drop" at 1:23
                    if impact > 0.45 or sustained_spike > 0.20:
                        self.transient = "dropping"
                        self._transient_hold_until = now + HOLD_TIMES["dropping"]
                    elif recent_avg < 0.15:
                        pass # Still in the break
                    else:
                        # Logic: If energy recovers slightly WITHOUT a spike, it wasn't a drop, it's just steady again
                        self.transient = "steady"
                        self._steady_since = now
                
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