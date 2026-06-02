# vibe_engine.py
import time
import collections

class VibeEngine:
    def __init__(self):
        # Configuration
        self.beat_history = collections.deque(maxlen=20)
        self.current_vibe = "mid" # Default
        self.last_vibe_change = 0
        self.vibe_splits = {"chillMid": 33, "midHigh": 66} # Requested Default
        
        # Smoothers
        self.smooth_bass = 0.0
        self.smooth_high = 0.0
        self.smooth_flux = 0.0
        self.smooth_vol = 0.0

        # Harmonic-isolated smoothers for vibe + transient detection
        self.smooth_vol_h = 0.0
        self.smooth_bass_h = 0.0

        # Energy Trend Tracking (Build/Drop Detection)
        # History window (30s @ 60Hz = 1800 frames)
        self.energy_history = collections.deque(maxlen=1800)
        self.impact_history = collections.deque(maxlen=1800)
        self.transient = "steady"  # "building", "dropping", "tension", "steady"
        self._transient_hold_until = 0  # Hold timer to prevent single-frame flickers
        self._steady_since = 0 # Prevent re-triggering building too fast
        self.vibe_hysteresis = 5.0 # "Sticky Vibe" (prevent flickering)
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
        # Full-signal inputs for smoothed DMX mods
        bass = float(audio_state.get('bass', 0.0))
        vol = float(audio_state.get('vol', 0.0))
        high = float(audio_state.get('high', 0.0))
        flux = float(audio_state.get('flux', 0.0))
        # Harmonic-isolated inputs for vibe bucket + transient detection
        vol_h = float(audio_state.get('vol_h', 0.0))
        bass_h = float(audio_state.get('bass_h', 0.0))
        spectral = float(audio_state.get('spectral_complexity_h', 0.5))

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
        
        chill_threshold = self.vibe_splits.get("chillMid", 33) / 100.0
        high_threshold = self.vibe_splits.get("midHigh", 66) / 100.0
        
        # Map boundaries directly to audio signal ranges so the UI sliders
        # have full authority over the vibe buckets.
        
        # HIGH:
        # Vol ranges from ~0.2 (easy) to 1.0+ (impossible)
        high_vol = 0.2 + (high_threshold * 0.8)
        high_density = high_threshold * 12.0
        high_spectral = high_threshold * 0.8 
        
        # CHILL:
        # Vol ranges from 0.0 (impossible) to 1.2+ (always chill)
        chill_vol = chill_threshold * 1.2
        chill_density = chill_threshold * 10.0
        
        # Vibe Logic (harmonic-only: percussive transients excluded)
        is_high = (density >= high_density) or (vol_h > high_vol and spectral > high_spectral)
        is_chill = (vol_h < chill_vol and density < chill_density)
        
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
            # Add debounce for all transitions to prevent 60Hz oscillation
            is_upgrade = (self.current_vibe == "chill" and target in ["mid", "high"]) or (self.current_vibe == "mid" and target == "high")
            if is_upgrade:
                # Upgrades can be fast, but add a tiny 0.25s debounce to avoid threshold flickering
                if target == "high" or (now - self.last_vibe_change > 0.25):
                    self.current_vibe = target
                    self.last_vibe_change = now
            else:
                # Downgrades
                required_hold = self.vibe_hysteresis if self.current_vibe == "high" else 2.0
                if now - self.last_vibe_change > required_hold:
                    self.current_vibe = target
                    self.last_vibe_change = now

        # Restored "Snappier" Smoothing (Reverted from Liquid Smoothing)
        # Explicitly cast to float to prevent numpy type leakage
        self.smooth_bass = float(self.smooth_bass + (bass - self.smooth_bass) * 0.35)
        self.smooth_high = float(self.smooth_high + (high - self.smooth_high) * 0.25)
        self.smooth_flux = float(self.smooth_flux + (flux - self.smooth_flux) * 0.30)
        self.smooth_vol  = float(self.smooth_vol  + (vol  - self.smooth_vol)  * 0.35)

        # Harmonic-isolated smoothers for transient detection
        self.smooth_vol_h  = float(self.smooth_vol_h  + (vol_h  - self.smooth_vol_h)  * 0.35)
        self.smooth_bass_h = float(self.smooth_bass_h + (bass_h - self.smooth_bass_h) * 0.35)

        # 3.5 ENERGY TREND TRACKING (Build/Drop Detection)
        # Calculate an instantaneous "impact" score using harmonic-only inputs
        # so percussive transients don't trigger false builds/drops
        impact = float(self.smooth_bass_h * 0.6 + vol_h * 0.4)

        self.impact_history.append(impact)
        self._history_frame += 1

        # Slow-moving energy trend for build/drop detection (harmonic volume)
        # We store the smoothed harmonic volume to prevent single-beat spikes from triggering trends.
        energy = float(self.smooth_vol_h)
        self.energy_history.append(energy)
        
        # Suppress transient detection until history is warm (~3s).
        if self._history_frame >= 180 and len(self.energy_history) >= 180 and len(self.impact_history) >= 180:
            # Windowed Trend: Compare recent 60-frame average to a 60-frame block from ~3s ago
            # This is MUCH more stable than single-frame comparisons and avoids beat-aliasing.
            recent_energy = float(sum(list(self.energy_history)[-60:]) / 60.0)
            past_energy = float(sum(list(self.energy_history)[-180:-120]) / 60.0)
            trend_long = recent_energy - past_energy
            
            # Minimum hold durations per state (seconds) - Re-aligned with Cinematic rules
            HOLD_TIMES = {"building": 0.5, "tension": 1.5, "dropping": 6.0}
            
            # Use a wide window (60 frames / ~1.0s) for rhythmic stability
            recent_avg = float(sum(list(self.impact_history)[-60:]) / 60.0)
            old_avg = float(sum(list(self.impact_history)[-180:-120]) / 60.0)
            
            # Deep History Check (Compare to 25s ago if available)
            if len(self.energy_history) >= 1500:
                very_old_energy = float(sum(list(self.energy_history)[-1500:-1470]) / 30.0)
                deep_trend = recent_energy - very_old_energy
                # If we see a massive 25s rise, we lower the threshold for "Building"
                if deep_trend > 0.4: trend_long += 0.1 
            
            sustained_spike = recent_avg - old_avg

            
            # If we're still in a hold period, don't enter state transition logic
            if now < self._transient_hold_until:
                pass
            else:
                # STATE MACHINE: steady → building → tension → dropping → steady
                
                if self.transient == "steady":
                    # BUILDING: Sustained rise over ~2s
                    if trend_long > 0.25 and recent_avg > 0.35 and now - self._steady_since > 5.0 and self.current_vibe != "high":
                        self.transient = "building"
                        self._transient_hold_until = now + HOLD_TIMES["building"]
                
                elif self.transient == "building":
                    # Advance to TENSION: Energy drops significantly relative to the build
                    if recent_avg < old_avg * 0.70 and past_energy > 0.05:
                        self.transient = "tension"
                        self._transient_hold_until = now + HOLD_TIMES["tension"]
                    elif trend_long > 0.0 or recent_avg > 0.25:
                        # Energy still rising or high, DO NOT revert to steady
                        self._transient_hold_until = now + 1.0 # Extend
                    else:
                        # Energy definitely flattened out without tension, return to normal and START LOCKOUT
                        self.transient = "steady" 
                        self._steady_since = now
                
                elif self.transient == "tension":
                    # Advance to DROPPING: Massive recovery (The Drop!)
                    # More aggressive sustained_spike detection to catch the "Big Drop"
                    if impact > 0.5 or sustained_spike > 0.30:
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
            },
            "snippet": None
        }