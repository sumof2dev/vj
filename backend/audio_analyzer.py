import numpy as np
import collections
import time

class AudioAnalyzer:
    def __init__(self):
        # WLED Frequency Ranges (Hz)
        self.wled_freqs = [
            86, 129, 216, 301, 430, 560, 818, 1120, 
            1421, 1895, 2412, 3015, 3704, 4479, 7106, 9259
        ]
        
        # Audio History for Rolling Normalization
        self.rolling_window_size = 300 # Approx 5-10 seconds @ 30-60 updates/sec
        self.history_bass = collections.deque(maxlen=self.rolling_window_size)
        self.history_mid  = collections.deque(maxlen=self.rolling_window_size)
        self.history_high = collections.deque(maxlen=self.rolling_window_size)
        self.history_flux = collections.deque(maxlen=self.rolling_window_size)
        self.history_raw_max = collections.deque(maxlen=self.rolling_window_size)

        # Beat Detection State
        self.last_beat_time = 0.0
        self.bpm_list = []
        self.bpm = 120.0
        self.prev_beat_timestamp = time.time()
        self.beat_intervals = collections.deque(maxlen=4)
        
        # Silence Detection State
        self.last_sound_time = time.time()
        self.smooth_raw_vol = 0.0

        # Gain (Sensitivity)
        self.gain = 0.5 # Default gain (1.0 = Normal)
        
        # Flux Threshold Tuning
        self.flux_threshold_mult = 2.05 # Flux Sens 0.5
        self.flux_threshold_abs = 0.35  # Flux Sens 0.5
        
        # Simple Timer for pattern switching
        self.frames_since_switch = 0
        self.auto_switch_threshold = 400 
        self.prev_bands = [0.0, 0.0, 0.0]
        self.prev_bins = [0.0] * 6
        self.prev_raw_bins = [0.0] * 6
        self.beat_count = 0
        self.flux_sensitivity_percentage = 0.5 # Track raw slider percentage (0-1)
        self.cumulative_max = 3.0 # LOW Initial Baseline (allows quick adaptation to quiet starts)
        
        # FIXED GOLD STANDARDS (Smoothing)
        # Low bins (0-2): 0.70, Mid bins (3-4): 0.85, High bin (5): 0.90
        self.smoothing_configs = [0.70, 0.70, 0.70, 0.85, 0.85, 0.90]

    def get_signal_health(self):
        """Analyze raw peak history to detect environment-level issues (Spotify vol, ALSA)."""
        if not self.history_raw_max or len(self.history_raw_max) < 20:
            return {"status": "WARM_UP", "peak": 0.0, "message": "Gathering signal data..."}

        # Find the peak in the rolling window (last ~5-10s)
        peak = max(self.history_raw_max)

        if peak < 4.0:
            # Signal is basically silence
            return {"status": "CRITICAL_LOW", "peak": float(round(peak, 3)), "message": "Signal nearly silent. Check Spotify/Main Volume."}
        if peak < 15.0:
            # Signal is workable but weak
            return {"status": "WEAK", "peak": float(round(peak, 3)), "message": "Signal is weak. Results may be inconsistent."}
        if peak > 250.0:
            # Overloaded signal
            return {"status": "OVERLOAD", "peak": float(round(peak, 3)), "message": "Signal is clipping or has high DC offset."}
        
        return {"status": "HEALTHY", "peak": float(round(peak, 3)), "message": "Audio signal levels are optimal."}

    def set_gain(self, val: float):
        """Set normalization gain (Sensitivity)"""
        self.gain = max(0.01, min(5.0, float(val)))

    def set_flux_sensitivity(self, val: float):
        """Set flux threshold multiplier (Higher = more sensitive to beats)"""
        self.flux_sensitivity_percentage = float(val)
        # Optimized formula: 
        # val=0.0 -> mult=4.0 (Very conservative)
        # val=0.5 -> mult=2.0 (Balanced)
        # val=1.0 -> mult=1.2 (Sensitive)
        # val=1.5 -> mult=0.8 (Aggressive but not insane)
        self.flux_threshold_mult = max(0.6, 4.0 - (float(val) * 2.1))
        self.flux_threshold_abs = max(0.1, 0.6 - (float(val) * 0.45))

    def _normalize(self, val, history):
        """Perform rolling normalization (val - history_min) / (history_max - history_min)"""
        history.append(val)
        if len(history) < 10: return 0.5 # Not enough data
        
        min_val = min(history)
        max_val = max(history)
        
        # SANE PEAK: Instead of normalizing against absolute max in history (which might be noise),
        # use a minimum baseline for the 'max' so tiny sounds aren't boosted to 100%.
        sane_peak = max(0.1, max_val)
        
        if sane_peak - min_val < 0.0001: return 0.0
        
        norm = (val - min_val) / (sane_peak - min_val)
        return min(1.0, max(0.0, norm))

    def process(self, indata, now=None):
        if indata.size == 0: return self.get_empty_state()
        if now is None: now = time.time()
        
        # Initialize timestamps on first frame to support virtual time / reset
        if not hasattr(self, '_time_initialized') or now < self.last_sound_time - 10.0:
            self.last_sound_time = now
            self.prev_beat_timestamp = now - 1.0
            self._time_initialized = True

        # 1. Clean & FFT
        mono = np.mean(indata, axis=1)
        mono = mono - np.mean(mono)
        fft_raw = np.abs(np.fft.rfft(mono))
        freqs = np.fft.rfftfreq(len(mono), 1/44100) 
        
        # 2. Map to 16 WLED Bins
        wled_bins = [0.0] * 16
        current_fft_idx = 1
        for i, cutoff in enumerate(self.wled_freqs):
            start = current_fft_idx
            while current_fft_idx < len(freqs) and freqs[current_fft_idx] < cutoff:
                current_fft_idx += 1
            if current_fft_idx == start: current_fft_idx += 1 
            chunk = fft_raw[start:current_fft_idx]
            if chunk.size > 0: wled_bins[i] = np.mean(chunk)

        # 3. Calculate Raw Bands
        raw_bass = np.mean(wled_bins[0:4])
        raw_mid  = np.mean(wled_bins[4:11])
        raw_high = np.mean(wled_bins[11:16])
        
        # 3.5 Calculate 6 Frequency Bins
        raw_bins = [
            np.mean(wled_bins[0:3]),   # 0: Sub + Bass
            np.mean(wled_bins[3:5]),   # 1: Low-Mid
            np.mean(wled_bins[5:7]),   # 2: Mid
            np.mean(wled_bins[7:10]),  # 3: High-Mid
            np.mean(wled_bins[10:14]), # 4: Presence
            np.mean(wled_bins[14:16])  # 5: Air / High
        ]
        
        # 4. Silence Reset & Peak Tracking
        current_raw_vol = (raw_bass + raw_mid + raw_high) / 3.0
        if not hasattr(self, 'smooth_raw_vol'): self.smooth_raw_vol = 0.0
        self.smooth_raw_vol = self.smooth_raw_vol * 0.7 + current_raw_vol * 0.3
        raw_vol = self.smooth_raw_vol
        
        # 3.8 SPECTRAL complexity (Shimmer)
        # Ratio of Mid+High energy to Bass energy.
        # High complexity = Busy Peak (High Vibe)
        # Low complexity = Bass Groove (Mid Vibe)
        spectral_raw = (raw_mid + raw_high) / (raw_bass + raw_mid + raw_high + 1e-6)
        if not hasattr(self, 'smooth_spectral'): self.smooth_spectral = 0.5
        self.smooth_spectral = self.smooth_spectral * 0.92 + spectral_raw * 0.08
        spectral_complexity = float(self.smooth_spectral)
        
        current_raw_max = max(raw_bass, raw_mid, raw_high)
        
        # STABLE PEAK TRACKING (Intro-Aware):
        # We maintain a cumulative max that NEVER drops fast.
        # Sane Minimum 100.0 assumes a club-level signal is coming.
        self.cumulative_max = max(25.0, self.cumulative_max * 0.999995, current_raw_max) 
        
        # Reference peak is the maximum of recent history or the cumulative ceiling
        global_peak = max(self.cumulative_max, max(self.history_raw_max) if self.history_raw_max else self.cumulative_max)
        self.history_raw_max.append(current_raw_max)

        if raw_vol > 0.00001:  # Lowered from 0.0002 for sensitvity
            self.last_sound_time = now
        elif now - self.last_sound_time > 5.0:
            self.bpm = 120.0
            self.bpm_list = []
            return self.get_empty_state()
        
        if raw_vol < 0.00001:  # Lowered from 0.0002 for sensitivity
            return self.get_empty_state()

        # --- Timbre (Spectral Ratios) ---
        total_energy = sum(raw_bins) + 1e-6
        ratios = [float(b / total_energy) for b in raw_bins]
        
        # --- Impact (Rate of Rise / Attacks) ---
        attacks = [min(1.0, float(max(0, raw_bins[i] - self.prev_raw_bins[i])) / (global_peak + 1e-6) * self.gain) for i in range(6)]
        self.prev_raw_bins = list(raw_bins)

        # 5. ROLLING NORMALIZATION
        out_bass = self._normalize(raw_bass, self.history_bass)
        out_mid  = self._normalize(raw_mid, self.history_mid)
        out_high = self._normalize(raw_high, self.history_high)
        
        out_vol = min(1.0, (current_raw_max / global_peak) * self.gain)
        # Smooth out_vol slightly to prevent UI flickering on borderline signals
        if not hasattr(self, '_smooth_out_vol'): self._smooth_out_vol = out_vol
        self._smooth_out_vol = self._smooth_out_vol * 0.5 + out_vol * 0.5
        out_vol = self._smooth_out_vol

        out_bass = min(1.0, out_bass * self.gain)
        out_mid  = min(1.0, out_mid * self.gain)
        out_high = min(1.0, out_high * self.gain)
        
        # 6. FLUX CALCULATION (Weighted for Beat Detection)
        # We prioritize Bass for BPM estimation to avoid double-triggering on snares or high-hats.
        bass_delta = max(0, out_bass - self.prev_bands[0])
        mid_delta  = max(0, out_mid - self.prev_bands[1])
        high_delta = max(0, out_high - self.prev_bands[2])
        
        # Broadband flux for visualizers (all frequencies)
        flux_broadband = bass_delta + mid_delta + high_delta
        
        # Bass-dominant flux for beat triggering (BPM focus)
        # We prioritize the "Kick" frequency range so the BPM locks to the rhythm, not high noise.
        # Magnitude is preserved (1.0 for bass) so current sensitivity sliders still work.
        flux = (bass_delta * 1.0) + (mid_delta * 0.4) + (high_delta * 0.1)
        
        bass_onset = bass_delta > 0.15
        high_onset = high_delta > 0.12

        self.prev_bands = [out_bass, out_mid, out_high]
        
        out_bins = [0.0] * 6
        for bi in range(6):
            val = float(raw_bins[bi])
            # Bass Optimization: gate sub-bass noise floor and downscale to prevent
            # low-end energy from dominating the bin array and inflating impact scores.
            if bi == 0: val = max(0.0, val - 0.08) * 0.5
            if bi == 1: val = max(0.0, val - 0.03) * 0.7
            normalized = min(1.0, (val / global_peak) * self.gain)
            
            # --- SNAPPY FREQUENCY-AWARE SMOOTHING ---
            # Using Gold Standard Coefficients from self.smoothing_configs
            s_factor = self.smoothing_configs[bi]
            
            out_bins[bi] = min(1.0, max(0.0, self.prev_bins[bi] * s_factor + normalized * (1.0 - s_factor)))
        self.prev_bins = out_bins
        
        self.history_flux.append(flux)
        
        # 7. ADAPTIVE BEAT DETECTION
        is_beat = False
        if len(self.history_flux) > 0:
            avg_flux = sum(self.history_flux) / len(self.history_flux)
            # Use the bass-dominant flux for is_beat trigger
            if flux > avg_flux * self.flux_threshold_mult and flux > self.flux_threshold_abs:
                # Lockout: Prevent double-beats within 350ms (Max ~170BPM support)
                # This prevents "ghost" doubles on slow songs but allows standard EDM.
                if now - self.prev_beat_timestamp > 0.35:
                    is_beat = True
                    self.beat_count += 1
                    delta = now - self.prev_beat_timestamp
                    new_bpm = 60.0 / delta
                    self.prev_beat_timestamp = now
                    self.bpm_list.append(new_bpm)
                    if len(self.bpm_list) > 12:
                        self.bpm_list.pop(0)
                    self.bpm = sum(self.bpm_list) / len(self.bpm_list)
                    self.beat_intervals.append(delta)
        
        # Store weighted flux for adaptive thresholding
        # (CRITICAL: History must match current flux for the multiplier to be valid)
        self.history_flux.append(flux)

        # 7.2 BEAT PHASE TRACKING
        if self.bpm > 0:
            beat_phase = ((now - self.prev_beat_timestamp) * self.bpm / 60.0) % 1.0
        else:
            beat_phase = 0.0
        
        suggested_shape = None
        self.frames_since_switch += 1
        if is_beat and self.frames_since_switch > self.auto_switch_threshold:
            suggested_shape = "random"
            self.frames_since_switch = 0

        return {
            "bass": float(out_bass),
            "mid": float(out_mid),
            "high": float(out_high),
            "vol": float(out_vol),
            "flux": float(flux),
            "beat": bool(is_beat),
            "bar": bool(is_beat and (self.beat_count % 4 == 0)),
            "bass_onset": bool(bass_onset),
            "high_onset": bool(high_onset),
            "beat_phase": float(beat_phase),
            "beat_count": int(self.beat_count),
            "bpm": float(self.bpm),
            "impact": float(max(attacks) if attacks else 0.0),
            "attacks": attacks,
            "ratios": ratios,
            "suggested_animation": suggested_shape,
            "bins": [float(b) for b in out_bins],
            "spectral_complexity": spectral_complexity
        }

    def get_empty_state(self):
         return { 
             "bass": 0.0, "mid": 0.0, "high": 0.0, "vol": 0.0, "flux": 0.0, 
             "beat": False, "bar": False, "bpm": 120.0,
             "bass_onset": False, "high_onset": False, "beat_phase": 0.0,
             "suggested_animation": None, "vibe": "chill", "transient": "steady",
             "bins": [0.0] * 6,
             "attacks": [0.0] * 6,
             "ratios": [0.0] * 6,
             "spectral_complexity": 0.5
         }
