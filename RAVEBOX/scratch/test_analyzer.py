import sys
import os
import wave
import numpy as np
import collections
import time

sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
from audio_analyzer import AudioAnalyzer

class DiagnosticAudioAnalyzer(AudioAnalyzer):
    def process_and_diagnose(self, indata, now=None):
        if indata.size == 0: return self.get_empty_state()
        if now is None: now = time.time()
        
        # We run the standard initialization checks
        if not hasattr(self, '_time_initialized') or now < self.last_sound_time - 10.0:
            self.last_sound_time = now
            self.prev_beat_timestamp = now - 1.0
            self._time_initialized = True

        # 1. Clean & FFT
        mono = np.mean(indata, axis=1)
        mono = mono - np.mean(mono)
        fft_raw = np.abs(np.fft.rfft(mono))
        freqs = np.fft.rfftfreq(len(mono), 1/44100) 
        
        # 1.5 Real-time HPSS Median Filtering Block
        self.fft_history.append(fft_raw)
        if len(self.fft_history) < self.hpss_window:
            percussive_fft = fft_raw
            harmonic_fft = fft_raw
        else:
            # Horizontal (time-axis) median filter tracking to extract steady harmonic components
            harmonic_fft = np.median(self.fft_history, axis=0)
            
            # Vertical (frequency-axis) median filter tracking to isolate sharp percussive lines
            pad_size = 2  # Local padding size mathematically required to center a 5-bin evaluation window
            padded = np.pad(fft_raw, pad_size, mode='edge')
            stacked = np.stack([
                padded[0:-4], padded[1:-3], padded[2:-2], padded[3:-1], padded[4:]
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
        spectral_raw = (raw_mid + raw_high) / (raw_bass + raw_mid + raw_high + 1e-6)
        if not hasattr(self, 'smooth_spectral'): self.smooth_spectral = 0.5
        self.smooth_spectral = self.smooth_spectral * 0.92 + spectral_raw * 0.08
        spectral_complexity = float(self.smooth_spectral)
        
        current_raw_max = max(raw_bass, raw_mid, raw_high)
        self.cumulative_max = max(25.0, self.cumulative_max * 0.999995, current_raw_max) 
        global_peak = max(self.cumulative_max, max(self.history_raw_max) if self.history_raw_max else self.cumulative_max)
        self.history_raw_max.append(current_raw_max)

        if raw_vol < 0.00001:
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

        # Maintain rolling peak for each of the 6 percussive bins
        if not hasattr(self, 'history_bins_p_max'):
            self.history_bins_p_max = [collections.deque(maxlen=300) for _ in range(6)]
            self.cumulative_bins_p_max = [2.0] * 6
            
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

        out_bass = min(1.0, out_bass * self.gain)
        out_mid  = min(1.0, out_mid * self.gain)
        out_high = min(1.0, out_high * self.gain)
        
        # 5.1 Percussive Rolling Normalization with Cross-Band Peak Floors
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
        norm_bass_p = (raw_bass_p - min_bass) / (sane_peak_bass - min_bass + 1e-6)
        
        # Normalize mid_p, enforcing that its peak reference is at least 25% of the bass peak reference
        min_mid = min(self.history_mid_p)
        max_mid = max(self.history_mid_p)
        sane_peak_mid = max(max_bass_ref * 0.25, max_mid)
        norm_mid_p = (raw_mid_p - min_mid) / (sane_peak_mid - min_mid + 1e-6)
        
        # Normalize high_p, enforcing that its peak reference is at least 12% of the bass peak reference
        min_high = min(self.history_high_p)
        max_high = max(self.history_high_p)
        sane_peak_high = max(max_bass_ref * 0.12, max_high)
        norm_high_p = (raw_high_p - min_high) / (sane_peak_high - min_high + 1e-6)

        # Scale outputs by gain
        out_bass_p = min(1.0, max(0.0, norm_bass_p) * self.gain * 2.0)
        out_mid_p  = min(1.0, max(0.0, norm_mid_p) * self.gain * 2.0)
        out_high_p = min(1.0, max(0.0, norm_high_p) * self.gain * 2.0)

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
        
        # Gating thresholds
        bass_onset = bass_delta > 0.15
        high_onset = high_delta > 0.12

        self.prev_bands_p = [out_bass_p, out_mid_p, out_high_p]
        self.prev_bands = [out_bass, out_mid, out_high]
        
        out_bins = [0.0] * 6
        for bi in range(6):
            val = float(raw_bins[bi])
            if bi == 0: val = max(0.0, val - 0.08) * 0.5
            if bi == 1: val = max(0.0, val - 0.03) * 0.7
            normalized = min(1.0, (val / global_peak) * self.gain)
            s_factor = self.smoothing_configs[bi]
            out_bins[bi] = min(1.0, max(0.0, self.prev_bins[bi] * s_factor + normalized * (1.0 - s_factor)))
        self.prev_bins = out_bins

        # Beat detection
        is_beat = False
        if len(self.history_flux) > 0:
            avg_flux = sum(self.history_flux) / len(self.history_flux)
            if flux > avg_flux * self.flux_threshold_mult and flux > self.flux_threshold_abs:
                if len(self.beat_intervals) >= 2:
                    sorted_ibi = sorted(self.beat_intervals)
                    self.pll_period = float(sorted_ibi[len(sorted_ibi) // 2])
                    lockout = max(self.lockout_floor, self.pll_period * self.lockout_ratio)
                else:
                    lockout = 0.35

                if now - self.prev_beat_timestamp > lockout:
                    is_beat = True
                    self.beat_count += 1
                    delta = now - self.prev_beat_timestamp
                    self.prev_beat_timestamp = now
                    self.bpm_list.append(60.0 / delta)
                    if len(self.bpm_list) > 12:
                        self.bpm_list.pop(0)
                    self.bpm = sum(self.bpm_list) / len(self.bpm_list)
                    self.beat_intervals.append(delta)
        
        self.history_flux.append(flux)

        # Hit type classification
        self.current_hit_type = "NONE"
        for key in self.hit_lockouts:
            if self.hit_lockouts[key] > 0:
                self.hit_lockouts[key] -= 1

        # Calculate BPM-adaptive lockout durations (in frames)
        frame_duration = 2048.0 / 44100.0  # ~46.4ms
        kick_lockout_val = max(2, round(0.25 * self.pll_period / frame_duration))
        cym_lockout_val = max(2, round(0.18 * self.pll_period / frame_duration))

        kick_score = attacks_p[0] + (attacks_p[1] * 0.3)
        snare_score = attacks_p[2] + attacks_p[3] + (attacks_p[1] * 0.7)
        cymbal_score = attacks_p[4] + attacks_p[5]

        t_thresh = 0.18  
        cym_thresh = 0.12

        # Check thresholds + lockouts + dynamic peak ratio gates
        is_kick = (kick_score > t_thresh and 
                   raw_bins_p[0] > self.cumulative_bins_p_max[0] * 0.35 and 
                   self.hit_lockouts["KICK"] == 0)
        
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

        if is_cymbal and not is_kick:
            if cymbal_score > snare_score * 0.8:
                is_snare = False
            else:
                is_cymbal = False

        if is_kick and is_snare:
            self.current_hit_type = "KICK+SNARE"
            self.hit_lockouts["KICK"] = kick_lockout_val
            self.hit_lockouts["SNARE"] = kick_lockout_val
            self.hit_lockouts["CYMBAL"] = cym_lockout_val
        elif is_kick:
            self.current_hit_type = "KICK"
            self.hit_lockouts["KICK"] = kick_lockout_val
            self.hit_lockouts["SNARE"] = max(1, kick_lockout_val - 1)
        elif is_snare:
            self.current_hit_type = "SNARE"
            self.hit_lockouts["SNARE"] = kick_lockout_val
            self.hit_lockouts["CYMBAL"] = cym_lockout_val
        elif is_cymbal:
            self.current_hit_type = "CYMBAL"
            self.hit_lockouts["CYMBAL"] = cym_lockout_val
            self.hit_lockouts["SNARE"] = cym_lockout_val

        if self.current_hit_type != "NONE":
            # Diagnose details
            print(f"[Diag Hit at {now:.2f}s: {self.current_hit_type}] GlobalPeak: {global_peak:.2f}")
            print(f"  Raw Perc Bins: {[round(float(b), 4) for b in raw_bins_p]}")
            print(f"  Bands_p:       Bass={out_bass_p:.3f}, Mid={out_mid_p:.3f}, High={out_high_p:.3f}")
            print(f"  Attacks_p:     {[round(float(a), 4) for a in attacks_p]}")
            print(f"  Scores: Kick={kick_score:.3f}, Snare={snare_score:.3f}, Cymbal={cymbal_score:.3f}")

        return {
            "beat": is_beat, 
            "hit_type": self.current_hit_type, 
            "bass_p": out_bass_p, 
            "mid_p": out_mid_p, 
            "high_p": out_high_p,
            "kick_score": kick_score,
            "snare_score": snare_score,
            "cymbal_score": cymbal_score
        }

def analyze_wav(wav_path):
    # 1. Run Diagnostic pass
    wf = wave.open(wav_path, 'rb')
    n_channels = wf.getnchannels()
    sampwidth = wf.getsampwidth()
    framerate = wf.getframerate()
    n_frames = wf.getnframes()
    
    diag_analyzer = DiagnosticAudioAnalyzer()
    block_size = 2048
    frame_count = 0
    
    max_kick = (0.0, 0.0)
    max_snare = (0.0, 0.0)
    max_cymbal = (0.0, 0.0)
    beat_count = 0
    hits_detected = {"NONE": 0, "KICK": 0, "SNARE": 0, "CYMBAL": 0, "KICK+SNARE": 0}
    
    while True:
        data = wf.readframes(block_size)
        if not data:
            break
        
        if sampwidth == 2:
            dtype = np.int16
            scale = 32768.0
        elif sampwidth == 4:
            dtype = np.int32
            scale = 2147483648.0
        else:
            return
            
        audio_data = np.frombuffer(data, dtype=dtype).astype(np.float32) / scale
        if n_channels == 2:
            if len(audio_data) % 2 != 0:
                audio_data = audio_data[:-(len(audio_data) % 2)]
            audio_data = audio_data.reshape(-1, 2)
        else:
            audio_data = audio_data.reshape(-1, 1)
            
        if len(audio_data) < block_size:
            pad_len = block_size - len(audio_data)
            audio_data = np.pad(audio_data, ((0, pad_len), (0, 0)) if n_channels == 2 else ((0, pad_len),), 'constant')
            
        t = frame_count * block_size / float(framerate)
        state = diag_analyzer.process_and_diagnose(audio_data, now=t)
        
        if t > 1.5:
            if state['kick_score'] > max_kick[0]:
                max_kick = (state['kick_score'], t)
            if state['snare_score'] > max_snare[0]:
                max_snare = (state['snare_score'], t)
            if state['cymbal_score'] > max_cymbal[0]:
                max_cymbal = (state['cymbal_score'], t)
            
        if state['beat']:
            beat_count += 1
            hits_detected[state['hit_type']] = hits_detected.get(state['hit_type'], 0) + 1
            
        frame_count += 1
    wf.close()
    
    # 2. Run Production class pass to verify it behaves exactly the same
    wf = wave.open(wav_path, 'rb')
    prod_analyzer = AudioAnalyzer()
    prod_analyzer.gain = 0.5 # Match simulation gain
    prod_beat_count = 0
    prod_hits_detected = {"NONE": 0, "KICK": 0, "SNARE": 0, "CYMBAL": 0, "KICK+SNARE": 0}
    prod_frame_count = 0
    
    while True:
        data = wf.readframes(block_size)
        if not data:
            break
        
        audio_data = np.frombuffer(data, dtype=dtype).astype(np.float32) / scale
        if n_channels == 2:
            if len(audio_data) % 2 != 0:
                audio_data = audio_data[:-(len(audio_data) % 2)]
            audio_data = audio_data.reshape(-1, 2)
        else:
            audio_data = audio_data.reshape(-1, 1)
            
        if len(audio_data) < block_size:
            pad_len = block_size - len(audio_data)
            audio_data = np.pad(audio_data, ((0, pad_len), (0, 0)) if n_channels == 2 else ((0, pad_len),), 'constant')
            
        t = prod_frame_count * block_size / float(framerate)
        state = prod_analyzer.process(audio_data, now=t)
        
        if state['beat']:
            prod_beat_count += 1
            prod_hits_detected[state['hit_type']] = prod_hits_detected.get(state['hit_type'], 0) + 1
            
        prod_frame_count += 1
    wf.close()
    
    print("\n=== DIAGNOSTIC SIMULATION SUMMARY ===")
    print(f"Total frames processed: {frame_count}")
    print(f"Total beats detected: {beat_count}")
    print(f"Hits detected: {hits_detected}")
    print(f"Max Kick Score: {max_kick[0]:.4f} at {max_kick[1]:.2f}s")
    print(f"Max Snare Score: {max_snare[0]:.4f} at {max_snare[1]:.2f}s")
    print(f"Max Cymbal Score: {max_cymbal[0]:.4f} at {max_cymbal[1]:.2f}s")
    
    print("\n=== PRODUCTION CLASS VALIDATION SUMMARY ===")
    print(f"Total frames processed: {prod_frame_count}")
    print(f"Total beats detected: {prod_beat_count}")
    print(f"Hits detected: {prod_hits_detected}")

if __name__ == "__main__":
    wav_path = "/home/sumof2/projects/RAVEBOX/recordings/REC_20260525_111958/audio.wav"
    analyze_wav(wav_path)
