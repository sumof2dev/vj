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
        self.beat_intervals = collections.deque(maxlen=8)

        # PLL Tracking Constants
        self.lockout_ratio    = 0.55   # Dynamic lockout as fraction of beat period
        self.lockout_floor    = 0.135  # Hard floor (~220 BPM ceiling support)
        self.pll_correction   = 0.35   # Phase error proportional correction factor
        self.pll_period       = 0.50   # Initial period estimate (120 BPM)
        
        # Parallel shadow tracker state (old strategy)
        self.history_flux_old = collections.deque(maxlen=300)
        self.prev_beat_timestamp_old = time.time()
        self.bpm_list_old = []
        self.bpm_old = 120.0
        self.beat_count_old = 0
        
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
        self.cumulative_max = 3.0 # LOW Initial Baseline (allows quick adaptation to quiet starts)
        
        # FIXED GOLD STANDARDS (Smoothing)
        # Low bins (0-2): 0.70, Mid bins (3-4): 0.85, High bin (5): 0.90
        self.smoothing_configs = [0.70, 0.70, 0.70, 0.85, 0.85, 0.90]
        
        # Real-time HPSS sliding window components
        self.hpss_window = 7  # Frame count window size inferred from real-time phase delay tolerance thresholds
        self.fft_history = collections.deque(maxlen=self.hpss_window)
        self.history_bass_p = collections.deque(maxlen=self.rolling_window_size)
        self.history_mid_p  = collections.deque(maxlen=self.rolling_window_size)
        self.history_high_p = collections.deque(maxlen=self.rolling_window_size)
        self.prev_bands_p = [0.0, 0.0, 0.0]
        self.history_bass_h = collections.deque(maxlen=self.rolling_window_size)
        self.history_mid_h  = collections.deque(maxlen=self.rolling_window_size)
        self.history_high_h = collections.deque(maxlen=self.rolling_window_size)
        
        # Real-time drum classification states
        self.prev_raw_bins_p = [0.0] * 6
        self.history_bins_p_max = [collections.deque(maxlen=300) for _ in range(6)]
        self.cumulative_bins_p_max = [2.0] * 6
        self.current_hit_type = "NONE"
        self.hit_lockouts = {"KICK": 0, "SNARE": 0, "CYMBAL": 0}
        self.smooth_crest_factor = 3.5
        self.smooth_centroid = 1000.0

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
        new_gain = max(0.01, min(5.0, float(val)))
        if new_gain != self.gain:
            self.gain = new_gain
            # Reset peak tracking and clear histories to immediately adapt to the new gain/volume levels
            self.history_flux.clear()
            self.history_raw_max.clear()
            self.cumulative_max = 3.0  # Reset to low baseline for quick auto-warmup
            for bi in range(6):
                self.history_bins_p_max[bi].clear()
                self.cumulative_bins_p_max[bi] = 2.0

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

    def _extract_bands(self, fft_raw, percussive_fft, harmonic_fft, len_mono):
        if not hasattr(self, '_bin_ranges') or self._bin_ranges_len != len_mono:
            self._bin_ranges = []
            self._bin_ranges_len = len_mono
            freqs = np.fft.rfftfreq(len_mono, 1/44100)
            current_fft_idx = 1
            for cutoff in self.wled_freqs:
                start = current_fft_idx
                while current_fft_idx < len(freqs) and freqs[current_fft_idx] < cutoff:
                    current_fft_idx += 1
                if current_fft_idx == start: current_fft_idx += 1
                self._bin_ranges.append((start, current_fft_idx))
        
        wled_bins = [0.0] * 16
        wled_bins_p = [0.0] * 16
        wled_bins_h = [0.0] * 16
        
        for i, (start, end) in enumerate(self._bin_ranges):
            chunk = fft_raw[start:end]
            chunk_p = percussive_fft[start:end]
            chunk_h = harmonic_fft[start:end]
            
            if chunk.size > 0: wled_bins[i] = float(np.mean(chunk))
            if chunk_p.size > 0: wled_bins_p[i] = float(np.mean(chunk_p))
            if chunk_h.size > 0: wled_bins_h[i] = float(np.mean(chunk_h))
            
        raw_bass = float(np.mean(wled_bins[0:4]))
        raw_mid  = float(np.mean(wled_bins[4:11]))
        raw_high = float(np.mean(wled_bins[11:16]))
        
        raw_bass_p = float(np.mean(wled_bins_p[0:4]))
        raw_mid_p  = float(np.mean(wled_bins_p[4:11]))
        raw_high_p = float(np.mean(wled_bins_p[11:16]))
        
        raw_bass_h = float(np.mean(wled_bins_h[0:4]))
        raw_mid_h  = float(np.mean(wled_bins_h[4:11]))
        raw_high_h = float(np.mean(wled_bins_h[11:16]))
        
        return {
            'bass': raw_bass, 'mid': raw_mid, 'high': raw_high,
            'bass_p': raw_bass_p, 'mid_p': raw_mid_p, 'high_p': raw_high_p,
            'bass_h': raw_bass_h, 'mid_h': raw_mid_h, 'high_h': raw_high_h,
            'max': max(raw_bass, raw_mid, raw_high)
        }

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
        
        # 1.1 Calculate Crest Factor (Peak-to-RMS ratio of raw PCM block)
        raw_peak = np.max(np.abs(mono))
        raw_rms = np.sqrt(np.mean(mono ** 2)) + 1e-6
        crest_factor = float(raw_peak / raw_rms)
        self.smooth_crest_factor = self.smooth_crest_factor * 0.95 + crest_factor * 0.05

        # 1.2 Calculate Spectral Centroid (Center of mass of frequency spectrum)
        fft_sum = np.sum(fft_raw)
        if fft_sum > 1e-5:
            spectral_centroid = float(np.sum(freqs * fft_raw) / fft_sum)
        else:
            spectral_centroid = 0.0
        self.smooth_centroid = self.smooth_centroid * 0.90 + spectral_centroid * 0.10 
        
        # 1.5 Real-time HPSS Median Filtering Block
        self.fft_history.append(fft_raw)
        if len(self.fft_history) < self.hpss_window:
            percussive_fft = fft_raw
            harmonic_fft = fft_raw
            mask_p = np.ones_like(fft_raw) * 0.5
            mask_h = np.ones_like(fft_raw) * 0.5
        else:
            # Horizontal (time-axis) median filter tracking to extract steady harmonic components
            harmonic_fft = np.median(self.fft_history, axis=0)
            
            # Vertical (frequency-axis) median filter tracking to isolate sharp percussive lines
            pad_size = 2  # Local padding size mathematically required to center a 5-bin evaluation window
            padded = np.pad(fft_raw, pad_size, mode='edge')
            L = len(fft_raw)
            stacked = np.stack([
                padded[0:L], padded[1:L+1], padded[2:L+2], padded[3:L+3], padded[4:L+4]
            ], axis=0)
            percussive_fft = np.median(stacked, axis=0)
            
            # Soft masking calculation to resolve structural energy assignment profiles
            h_sq = harmonic_fft ** 2
            p_sq = percussive_fft ** 2
            eps = 1e-6  # Variance constraint constant inferred for floating-point calculation stability
            mask_p = p_sq / (h_sq + p_sq + eps)
            mask_h = h_sq / (h_sq + p_sq + eps)
            percussive_fft = fft_raw * mask_p
            harmonic_fft = fft_raw * mask_h

        # 2. Map to 16 WLED Bins (Decoupled Stream Generation)
        wled_bins = [0.0] * 16
        wled_bins_p = [0.0] * 16
        wled_bins_h = [0.0] * 16
        current_fft_idx = 1
        for i, cutoff in enumerate(self.wled_freqs):
            start = current_fft_idx
            while current_fft_idx < len(freqs) and freqs[current_fft_idx] < cutoff:
                current_fft_idx += 1
            if current_fft_idx == start: current_fft_idx += 1 
            
            chunk = fft_raw[start:current_fft_idx]
            chunk_p = percussive_fft[start:current_fft_idx]
            chunk_h = harmonic_fft[start:current_fft_idx]
            
            if chunk.size > 0: wled_bins[i] = np.mean(chunk)
            if chunk_p.size > 0: wled_bins_p[i] = np.mean(chunk_p)
            if chunk_h.size > 0: wled_bins_h[i] = np.mean(chunk_h)

        # 3. Calculate Raw Bands (Isolated processing routing vectors)
        raw_bass = np.mean(wled_bins[0:4])
        raw_mid  = np.mean(wled_bins[4:11])
        raw_high = np.mean(wled_bins[11:16])
        
        # Purely percussive tracking parameters reserved exclusively for the tracking loop grid
        raw_bass_p = np.mean(wled_bins_p[0:4])
        raw_mid_p  = np.mean(wled_bins_p[4:11])
        raw_high_p = np.mean(wled_bins_p[11:16])
        
        # Harmonic isolation bands for tonal/melodic tracking
        raw_bass_h = np.mean(wled_bins_h[0:4])
        raw_mid_h  = np.mean(wled_bins_h[4:11])
        raw_high_h = np.mean(wled_bins_h[11:16])
        
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
        
        # Harmonic-only spectral complexity for vibe determination
        # Excludes percussive transients so kick-heavy sections don't inflate the vibe state
        spectral_raw_h = (raw_mid_h + raw_high_h) / (raw_bass_h + raw_mid_h + raw_high_h + 1e-6)
        if not hasattr(self, 'smooth_spectral_h'): self.smooth_spectral_h = 0.5
        self.smooth_spectral_h = self.smooth_spectral_h * 0.92 + spectral_raw_h * 0.08
        spectral_complexity_h = float(self.smooth_spectral_h)
        
        current_raw_max = max(raw_bass, raw_mid, raw_high)
        
        # STABLE PEAK TRACKING (Intro-Aware):
        # We maintain a cumulative max that NEVER drops fast.
        # Sane Minimum 100.0 assumes a club-level signal is coming.
        self.cumulative_max = max(25.0, self.cumulative_max * 0.9995, current_raw_max) 
        
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

        # 4.2 Percussive-Only Bin Array Mapping
        raw_bins_p = [
            np.mean(wled_bins_p[0:3]),   # 0: Sub + Bass (Kick focus)
            np.mean(wled_bins_p[3:5]),   # 1: Low-Mid (Snare body / Toms)
            np.mean(wled_bins_p[5:7]),   # 2: Mid (Snare snap focus)
            np.mean(wled_bins_p[7:10]),  # 3: High-Mid (Ride ring / Upper mids)
            np.mean(wled_bins_p[10:14]), # 4: Presence (Hi-hat pedal attack)
            np.mean(wled_bins_p[14:16])  # 5: Air / High (Cymbal sizzle)
        ]

        # Calculate pure percussive transients with spectral gating
        diffs_p = [float(max(0, raw_bins_p[i] - self.prev_raw_bins_p[i])) for i in range(6)]
        self.prev_raw_bins_p = list(raw_bins_p)

        total_diff_p = sum(diffs_p) + 1e-6
        fractions_p = [diff / total_diff_p for diff in diffs_p]

        attacks_p = []
        for i in range(6):
            self.cumulative_bins_p_max[i] = max(1.0, self.cumulative_bins_p_max[i] * 0.999995, raw_bins_p[i])
            self.history_bins_p_max[i].append(raw_bins_p[i])
            bin_peak = max(self.cumulative_bins_p_max[i], max(self.history_bins_p_max[i]) if self.history_bins_p_max[i] else self.cumulative_bins_p_max[i])
            
            # Scale attacks by their relative contribution and per-bin peak
            val = (diffs_p[i] / (bin_peak + 1e-6)) * fractions_p[i] * 6.0 * self.gain
            attacks_p.append(min(1.0, val))

        # 5. ROLLING NORMALIZATION
        out_bass = self._normalize(raw_bass, self.history_bass)
        out_mid  = self._normalize(raw_mid, self.history_mid)
        out_high = self._normalize(raw_high, self.history_high)
        
        out_vol = min(1.0, (current_raw_max / global_peak) * self.gain)
        # Smooth out_vol slightly to prevent UI flickering on borderline signals
        if not hasattr(self, '_smooth_out_vol'): self._smooth_out_vol = out_vol
        self._smooth_out_vol = self._smooth_out_vol * 0.5 + out_vol * 0.5
        out_vol = self._smooth_out_vol

        # Harmonic-only volume for vibe determination
        # Uses same global_peak reference so harmonic vol is proportional to overall signal
        current_raw_max_h = max(raw_bass_h, raw_mid_h, raw_high_h)
        out_vol_h = min(1.0, (current_raw_max_h / global_peak) * self.gain)
        if not hasattr(self, '_smooth_out_vol_h'): self._smooth_out_vol_h = out_vol_h
        self._smooth_out_vol_h = self._smooth_out_vol_h * 0.5 + out_vol_h * 0.5
        out_vol_h = self._smooth_out_vol_h

        out_bass = min(1.0, out_bass * self.gain)
        out_mid  = min(1.0, out_mid * self.gain)
        out_high = min(1.0, out_high * self.gain)
        
        # 6. FLUX CALCULATION (Weighted for Beat Detection)
        # Append values to history first to maintain the window
        self.history_bass_p.append(raw_bass_p)
        self.history_mid_p.append(raw_mid_p)
        self.history_high_p.append(raw_high_p)
        
        # Find rolling max of the bass percussive band to use as a baseline reference
        max_bass_ref = max(self.history_bass_p) if len(self.history_bass_p) >= 10 else 1.0
        max_bass_ref = max(5.0, max_bass_ref) # Sane floor for quiet starts
        
        # Normalize bass_p
        min_bass = min(self.history_bass_p)
        max_bass = max(self.history_bass_p)
        sane_peak_bass = max(5.0, max_bass)
        out_bass_p = (raw_bass_p - min_bass) / (sane_peak_bass - min_bass + 1e-6)
        
        # Normalize mid_p, enforcing that its peak reference is at least 25% of the bass peak reference
        min_mid = min(self.history_mid_p)
        max_mid = max(self.history_mid_p)
        sane_peak_mid = max(max_bass_ref * 0.25, max_mid)
        out_mid_p = (raw_mid_p - min_mid) / (sane_peak_mid - min_mid + 1e-6)
        
        # Normalize high_p, enforcing that its peak reference is at least 12% of the bass peak reference
        min_high = min(self.history_high_p)
        max_high = max(self.history_high_p)
        sane_peak_high = max(max_bass_ref * 0.12, max_high)
        out_high_p = (raw_high_p - min_high) / (sane_peak_high - min_high + 1e-6)

        # Scale outputs by gain
        out_bass_p = min(1.0, max(0.0, out_bass_p) * self.gain * 2.0)
        out_mid_p  = min(1.0, max(0.0, out_mid_p) * self.gain * 2.0)
        out_high_p = min(1.0, max(0.0, out_high_p) * self.gain * 2.0)

        out_bass_h = self._normalize(raw_bass_h, self.history_bass_h)
        out_mid_h  = self._normalize(raw_mid_h, self.history_mid_h)
        out_high_h = self._normalize(raw_high_h, self.history_high_h)

        # Delta vectors track exclusively the isolated transient energy spikes
        bass_delta = max(0, out_bass_p - self.prev_bands_p[0])
        mid_delta  = max(0, out_mid_p - self.prev_bands_p[1])
        high_delta = max(0, out_high_p - self.prev_bands_p[2])
        
        # Broadband flux for visualizers (all frequencies)
        flux_broadband = bass_delta + mid_delta + high_delta
        
        # Bass-dominant flux for beat triggering (BPM focus)
        flux = (bass_delta * 1.0) + (mid_delta * 0.4) + (high_delta * 0.1)
        
        bass_onset = bass_delta > 0.15  # Gating threshold constraint inferred from original transient responsiveness profiles
        high_onset = high_delta > 0.12  # Gating threshold constraint inferred from original transient responsiveness profiles

        # Compute old-style flux for the shadow tracker (unseparated bands)
        bass_delta_old = max(0, out_bass - self.prev_bands[0])
        mid_delta_old  = max(0, out_mid - self.prev_bands[1])
        high_delta_old = max(0, out_high - self.prev_bands[2])
        flux_old = (bass_delta_old * 1.0) + (mid_delta_old * 0.4) + (high_delta_old * 0.1)

        self.prev_bands_p = [out_bass_p, out_mid_p, out_high_p]
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

        # Run shadow beat tracker (old strategy with fixed 350ms lockout)
        is_beat_old = False
        if len(self.history_flux_old) > 0:
            avg_flux_old = sum(self.history_flux_old) / len(self.history_flux_old)
            if flux_old > avg_flux_old * self.flux_threshold_mult and flux_old > self.flux_threshold_abs:
                if now - self.prev_beat_timestamp_old > 0.35:
                    is_beat_old = True
                    self.beat_count_old += 1
                    delta_old = now - self.prev_beat_timestamp_old
                    self.prev_beat_timestamp_old = now
                    self.bpm_list_old.append(60.0 / delta_old)
                    if len(self.bpm_list_old) > 12:
                        self.bpm_list_old.pop(0)
                    self.bpm_old = sum(self.bpm_list_old) / len(self.bpm_list_old)

        self.history_flux_old.append(flux_old)

        # 7. ADAPTIVE BEAT DETECTION (PLL)
        is_beat = False
        if len(self.history_flux) > 0:
            avg_flux = sum(self.history_flux) / len(self.history_flux)
            if flux > avg_flux * self.flux_threshold_mult and flux > self.flux_threshold_abs:
                # Dynamic lockout: 55% of tracked beat period
                if len(self.beat_intervals) >= 2:
                    sorted_ibi = sorted(self.beat_intervals)
                    self.pll_period = float(sorted_ibi[len(sorted_ibi) // 2])
                    # Clamp pll_period to sane tempos [45 BPM, 185 BPM] -> [1.333s, 0.324s]
                    self.pll_period = max(0.324, min(1.333, self.pll_period))
                    lockout = max(self.lockout_floor, self.pll_period * self.lockout_ratio)
                else:
                    lockout = 0.35  # Cold-start fallback

                if now - self.prev_beat_timestamp > lockout:
                    is_beat = True
                    self.beat_count += 1
                    delta = now - self.prev_beat_timestamp

                    # Integer multiplier matching for syncopation resilience
                    time_elapsed = now - self.prev_beat_timestamp
                    elapsed_cycles = max(1, round(time_elapsed / self.pll_period))

                    # Phase-locked grid correction relative to closest rhythmic step
                    expected_beat = self.prev_beat_timestamp + (elapsed_cycles * self.pll_period)
                    phase_error = now - expected_beat
                    tolerance = self.pll_period * 0.25

                    if abs(phase_error) < tolerance and len(self.beat_intervals) >= 2:
                        # Soft PLL pull: absorb 35% of timing deviation
                        self.prev_beat_timestamp = expected_beat + phase_error * self.pll_correction
                    else:
                        # Hard reset: tempo transition or cold start
                        self.prev_beat_timestamp = now

                    self.bpm_list.append(60.0 / delta)
                    if len(self.bpm_list) > 12:
                        self.bpm_list.pop(0)
                    self.bpm = sum(self.bpm_list) / len(self.bpm_list)
                    
                    # Clamp the stored interval delta to maintain safe boundaries
                    clamped_delta = max(0.324, min(1.333, delta))
                    self.beat_intervals.append(clamped_delta)

                    # Rhythmic Validation Guard / Safety Check (Corrective)
                    outside_expected = (self.bpm > 185 or self.bpm < 45)
                    if outside_expected:
                        ratio = self.bpm / (self.bpm_old + 1e-6)
                        is_harmonic = (abs(ratio - 2.0) < 0.15) or (abs(ratio - 0.5) < 0.15) or (abs(ratio - 1.0) < 0.15)
                        if not is_harmonic:
                            # Reset PLL state to the shadow tracker's stable tempo
                            self.beat_intervals.clear()
                            sane_delta = 60.0 / self.bpm_old
                            self.beat_intervals.append(sane_delta)
                            self.beat_intervals.append(sane_delta)
                            self.pll_period = sane_delta
                            self.prev_beat_timestamp = now
                            self.bpm = self.bpm_old
                            self.bpm_list = [self.bpm_old]
        
        # Store weighted flux for adaptive thresholding
        # (CRITICAL: History must match current flux for the multiplier to be valid)
        self.history_flux.append(flux)

        # 7.1 Drum Classification Decision Matrix
        self.current_hit_type = "NONE"
        for key in self.hit_lockouts:
            if self.hit_lockouts[key] > 0:
                self.hit_lockouts[key] -= 1

        # Calculate BPM-adaptive lockout durations (in frames)
        frame_duration = 2048.0 / 44100.0  # ~46.4ms
        kick_lockout_val = max(2, round(0.25 * self.pll_period / frame_duration))
        cym_lockout_val = max(2, round(0.18 * self.pll_period / frame_duration))

        # Aggregate localized transient scores
        kick_score = attacks_p[0] + (attacks_p[1] * 0.3)
        snare_score = attacks_p[2] + attacks_p[3] + (attacks_p[1] * 0.7)
        cymbal_score = attacks_p[4] + attacks_p[5]

        # Threshold boundaries; inferred from empirical transient classification testing
        t_thresh = 0.18  
        cym_thresh = 0.12

        # Check thresholds + lockouts + dynamic peak ratio gates
        is_kick = (kick_score > t_thresh and 
                   raw_bins_p[0] > self.cumulative_bins_p_max[0] * 0.35 and 
                   self.hit_lockouts["KICK"] == 0)
        
        # If there is a kick, check snare ratio to suppress low-end bleed
        if is_kick:
            is_snare = (snare_score > 0.38 and 
                        snare_score > kick_score * 0.40 and 
                        max(raw_bins_p[2], raw_bins_p[3]) > max(self.cumulative_bins_p_max[2], self.cumulative_bins_p_max[3]) * 0.15 and 
                        self.hit_lockouts["SNARE"] == 0)
        else:
            is_snare = (snare_score > 0.22 and 
                        max(raw_bins_p[2], raw_bins_p[3]) > max(self.cumulative_bins_p_max[2], self.cumulative_bins_p_max[3]) * 0.15 and 
                        self.hit_lockouts["SNARE"] == 0)
            
        is_cymbal = (cymbal_score > cym_thresh and 
                     self.hit_lockouts["CYMBAL"] == 0)

        # Prioritize hi-hat over snare if high frequency energy dominates
        if is_cymbal and not is_kick:
            if cymbal_score > snare_score * 0.8:
                is_snare = False
            else:
                is_cymbal = False

        # Resolve simultaneous or individual hit designations
        if is_kick and is_snare:
            self.current_hit_type = "KICK+SNARE"
            self.hit_lockouts["KICK"] = kick_lockout_val
            self.hit_lockouts["SNARE"] = kick_lockout_val
            self.hit_lockouts["CYMBAL"] = cym_lockout_val
        elif is_kick:
            self.current_hit_type = "KICK"
            self.hit_lockouts["KICK"] = kick_lockout_val
            self.hit_lockouts["SNARE"] = max(1, kick_lockout_val - 1) # Suppress click bleed into snare
        elif is_snare:
            self.current_hit_type = "SNARE"
            self.hit_lockouts["SNARE"] = kick_lockout_val
            self.hit_lockouts["CYMBAL"] = cym_lockout_val # Suppress decay bleed into hi-hat
        elif is_cymbal:
            self.current_hit_type = "CYMBAL"
            self.hit_lockouts["CYMBAL"] = cym_lockout_val
            self.hit_lockouts["SNARE"] = cym_lockout_val # Suppress decay bleed into snare

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

        mono_state = {
            "bass": float(out_bass),
            "mid": float(out_mid),
            "high": float(out_high),
            "bass_p": float(out_bass_p),  # Pure transient kick track exposed to engine loops
            "mid_p": float(out_mid_p),    # Pure snappy snare/clap track exposed to engine loops
            "high_p": float(out_high_p),  # Pure crisp hi-hat track exposed to engine loops
            "bass_h": float(out_bass_h),  # Tonal bass content (synth pads, bass lines)
            "mid_h": float(out_mid_h),    # Harmonic mid content (vocals, melodic leads)
            "high_h": float(out_high_h),  # Harmonic high content (string sustain, pad shimmer)
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
            "spectral_complexity": spectral_complexity,
            "vol_h": float(out_vol_h),
            "spectral_complexity_h": spectral_complexity_h,
            "hit_type": self.current_hit_type,  # Structural hit category exported directly to main state courier
            "kick_score": float(kick_score),
            "snare_score": float(snare_score),
            "cymbal_score": float(cymbal_score),
            "kick": float(1.0 if is_kick else 0.0),
            "snare": float(1.0 if is_snare else 0.0),
            "cymbal": float(1.0 if is_cymbal else 0.0),
            "kick_behavior": float(min(1.0, raw_bins_p[0] / max(self.cumulative_bins_p_max[0], 1e-6))),
            "snare_behavior": float(min(1.0, max(raw_bins_p[2], raw_bins_p[3]) / max(self.cumulative_bins_p_max[2], 1e-6))),
            "cymbal_behavior": float(min(1.0, raw_bins_p[5] / max(self.cumulative_bins_p_max[5], 1e-6))),
            "crest_factor": float(self.smooth_crest_factor),
            "spectral_centroid": float(self.smooth_centroid)
        }

        # Process stereo channels if available
        is_stereo = (indata.ndim == 2 and indata.shape[1] >= 2)
        if is_stereo:
            # 1. Extract Left/Right PCM and run real FFTs
            left_pcm = indata[:, 0]
            left_pcm = left_pcm - np.mean(left_pcm)
            fft_l = np.abs(np.fft.rfft(left_pcm))

            right_pcm = indata[:, 1]
            right_pcm = right_pcm - np.mean(right_pcm)
            fft_r = np.abs(np.fft.rfft(right_pcm))

            # 2. Apply mono-derived HPSS masks
            percussive_fft_l = fft_l * mask_p
            harmonic_fft_l = fft_l * mask_h

            percussive_fft_r = fft_r * mask_p
            harmonic_fft_r = fft_r * mask_h

            # 3. Extract bands
            bands_l = self._extract_bands(fft_l, percussive_fft_l, harmonic_fft_l, len(mono))
            bands_r = self._extract_bands(fft_r, percussive_fft_r, harmonic_fft_r, len(mono))

            # 4. Normalize using mono history boundaries
            def normalize_value(val, history):
                if len(history) < 10: return 0.5
                min_val = min(history)
                max_val = max(history)
                sane_peak = max(0.1, max_val)
                if sane_peak - min_val < 0.0001: return 0.0
                norm = (val - min_val) / (sane_peak - min_val)
                return min(1.0, max(0.0, norm))

            # Left normalization
            out_bass_l = min(1.0, normalize_value(bands_l['bass'], self.history_bass) * self.gain)
            out_mid_l  = min(1.0, normalize_value(bands_l['mid'], self.history_mid) * self.gain)
            out_high_l = min(1.0, normalize_value(bands_l['high'], self.history_high) * self.gain)

            min_bass_p = min(self.history_bass_p) if self.history_bass_p else 0.0
            max_bass_p = max(self.history_bass_p) if self.history_bass_p else 5.0
            sane_peak_bass_p = max(5.0, max_bass_p)
            out_bass_p_l = min(1.0, max(0.0, (bands_l['bass_p'] - min_bass_p) / (sane_peak_bass_p - min_bass_p + 1e-6)) * self.gain * 2.0)

            min_mid_p = min(self.history_mid_p) if self.history_mid_p else 0.0
            max_mid_p = max(self.history_mid_p) if self.history_mid_p else 1.25
            sane_peak_mid_p = max(max_bass_ref * 0.25, max_mid_p)
            out_mid_p_l = min(1.0, max(0.0, (bands_l['mid_p'] - min_mid_p) / (sane_peak_mid_p - min_mid_p + 1e-6)) * self.gain * 2.0)

            min_high_p = min(self.history_high_p) if self.history_high_p else 0.0
            max_high_p = max(self.history_high_p) if self.history_high_p else 0.6
            sane_peak_high_p = max(max_bass_ref * 0.12, max_high_p)
            out_high_p_l = min(1.0, max(0.0, (bands_l['high_p'] - min_high_p) / (sane_peak_high_p - min_high_p + 1e-6)) * self.gain * 2.0)

            out_bass_h_l = min(1.0, normalize_value(bands_l['bass_h'], self.history_bass_h) * self.gain)
            out_mid_h_l  = min(1.0, normalize_value(bands_l['mid_h'], self.history_mid_h) * self.gain)
            out_high_h_l = min(1.0, normalize_value(bands_l['high_h'], self.history_high_h) * self.gain)

            out_vol_l = min(1.0, (bands_l['max'] / global_peak) * self.gain)
            if not hasattr(self, '_smooth_out_vol_l'): self._smooth_out_vol_l = out_vol_l
            self._smooth_out_vol_l = self._smooth_out_vol_l * 0.5 + out_vol_l * 0.5
            out_vol_l = self._smooth_out_vol_l

            # Right normalization
            out_bass_r = min(1.0, normalize_value(bands_r['bass'], self.history_bass) * self.gain)
            out_mid_r  = min(1.0, normalize_value(bands_r['mid'], self.history_mid) * self.gain)
            out_high_r = min(1.0, normalize_value(bands_r['high'], self.history_high) * self.gain)

            out_bass_p_r = min(1.0, max(0.0, (bands_r['bass_p'] - min_bass_p) / (sane_peak_bass_p - min_bass_p + 1e-6)) * self.gain * 2.0)
            out_mid_p_r = min(1.0, max(0.0, (bands_r['mid_p'] - min_mid_p) / (sane_peak_mid_p - min_mid_p + 1e-6)) * self.gain * 2.0)
            out_high_p_r = min(1.0, max(0.0, (bands_r['high_p'] - min_high_p) / (sane_peak_high_p - min_high_p + 1e-6)) * self.gain * 2.0)

            out_bass_h_r = min(1.0, normalize_value(bands_r['bass_h'], self.history_bass_h) * self.gain)
            out_mid_h_r  = min(1.0, normalize_value(bands_r['mid_h'], self.history_mid_h) * self.gain)
            out_high_h_r = min(1.0, normalize_value(bands_r['high_h'], self.history_high_h) * self.gain)

            out_vol_r = min(1.0, (bands_r['max'] / global_peak) * self.gain)
            if not hasattr(self, '_smooth_out_vol_r'): self._smooth_out_vol_r = out_vol_r
            self._smooth_out_vol_r = self._smooth_out_vol_r * 0.5 + out_vol_r * 0.5
            out_vol_r = self._smooth_out_vol_r

            # Metadata keys to copy to left and right channels
            metadata_keys = [
                'vibe', 'transient', 'beat', 'bar', 'beat_phase', 'beat_count', 
                'bpm', 'suggested_animation', 'hit_type', 'kick_score', 
                'snare_score', 'cymbal_score', 'flux', 'bass_onset', 'high_onset',
                'kick', 'snare', 'cymbal', 'kick_behavior', 'snare_behavior', 'cymbal_behavior',
                'crest_factor', 'spectral_centroid'
            ]

            left_dict = {
                "bass": float(out_bass_l),
                "mid": float(out_mid_l),
                "high": float(out_high_l),
                "bass_p": float(out_bass_p_l),
                "mid_p": float(out_mid_p_l),
                "high_p": float(out_high_p_l),
                "bass_h": float(out_bass_h_l),
                "mid_h": float(out_mid_h_l),
                "high_h": float(out_high_h_l),
                "vol": float(out_vol_l)
            }
            right_dict = {
                "bass": float(out_bass_r),
                "mid": float(out_mid_r),
                "high": float(out_high_r),
                "bass_p": float(out_bass_p_r),
                "mid_p": float(out_mid_p_r),
                "high_p": float(out_high_p_r),
                "bass_h": float(out_bass_h_r),
                "mid_h": float(out_mid_h_r),
                "high_h": float(out_high_h_r),
                "vol": float(out_vol_r)
            }
            for k in metadata_keys:
                if k in mono_state:
                    left_dict[k] = mono_state[k]
                    right_dict[k] = mono_state[k]

            mono_state['left'] = left_dict
            mono_state['right'] = right_dict
        else:
            left_dict = mono_state.copy()
            right_dict = mono_state.copy()
            mono_state['left'] = left_dict
            mono_state['right'] = right_dict

        return mono_state

    def get_empty_state(self):
         state = { 
             "bass": 0.0, "mid": 0.0, "high": 0.0,
             "bass_p": 0.0, "mid_p": 0.0, "high_p": 0.0,
             "bass_h": 0.0, "mid_h": 0.0, "high_h": 0.0,
             "vol": 0.0, "flux": 0.0, 
             "beat": False, "bar": False, "bpm": 120.0,
             "bass_onset": False, "high_onset": False, "beat_phase": 0.0,
             "beat_count": 0, "impact": 0.0,
             "suggested_animation": None,
             "bins": [0.0] * 6,
             "attacks": [0.0] * 6,
             "ratios": [0.0] * 6,
             "spectral_complexity": 0.5,
             "vol_h": 0.0,
             "spectral_complexity_h": 0.5,
             "hit_type": "NONE",
             "kick_score": 0.0, "snare_score": 0.0, "cymbal_score": 0.0,
             "kick": 0.0, "snare": 0.0, "cymbal": 0.0,
             "kick_behavior": 0.0, "snare_behavior": 0.0, "cymbal_behavior": 0.0,
             "crest_factor": 3.5,
             "spectral_centroid": 1000.0
         }
         state["left"] = state.copy()
         state["right"] = state.copy()
         return state
