import json
import os
import sys
import numpy as np
from collections import deque

def match_beats(live_beats, truth_beats, tolerance=0.070):
    if len(live_beats) == 0 or len(truth_beats) == 0:
        return 0, 0.0, 0.0, 0.0

    truth_arr = np.array(truth_beats)
    matched = 0

    for l_beat in live_beats:
        idx = np.searchsorted(truth_arr, l_beat)
        closest = None
        if idx > 0:
            closest = truth_arr[idx - 1]
        if idx < len(truth_arr):
            candidate = truth_arr[idx]
            if closest is None or abs(candidate - l_beat) < abs(closest - l_beat):
                closest = candidate
        if closest is not None and abs(closest - l_beat) <= tolerance:
            matched += 1

    precision = matched / len(live_beats)
    recall = matched / len(truth_arr)
    f_measure = (2 * precision * recall) / (precision + recall + 1e-6)
    return matched, precision, recall, f_measure

def run_simulation(recording_dir):
    dmx_path = os.path.join(recording_dir, "dmx.json")
    audit_path = os.path.join(recording_dir, "audit_results.json")
    
    if not os.path.exists(dmx_path) or not os.path.exists(audit_path):
        print(f"Skipping {recording_dir}: missing dmx.json or audit_results.json")
        return None
        
    with open(dmx_path) as f:
        frames = json.load(f)
    with open(audit_path) as f:
        audit_data = json.load(f)
        
    truth_beats = audit_data["truth"]["beat_times"]
    truth_bpm = audit_data["summary"]["measured_global_bpm_truth"]
    
    # State Configuration
    history_flux = deque(maxlen=300)
    history_flux_old = deque(maxlen=300)
    
    bpm_list = []
    bpm = 120.0
    prev_beat_timestamp = 0.0
    prev_beat_timestamp_actual = 0.0
    beat_intervals = deque(maxlen=8)
    pll_period = 0.50
    lockout_ratio = 0.55
    lockout_floor = 0.135
    pll_correction = 0.35
    smooth_build_up = 0.0
    
    prev_beat_timestamp_old = 0.0
    bpm_list_old = []
    bpm_old = 120.0
    
    flux_threshold_mult = 2.05
    flux_threshold_abs = 0.35
    
    detected_beats = []
    beat_count = 0
    beat_count_old = 0
    
    # In dmx.json, raw percussive high/bass are scaled, let's look at the keys:
    # 'hp' is high percussive, 'bp' is bass percussive.
    # In the engine:
    # hp = wled_bins_p[11:16], bp = wled_bins_p[0:4].
    # In server.py, these are packaged into dmx.json frame['a']['hp'] and frame['a']['bp'].
    # Let's map raw_high_p = frame['a']['hp'] * 12.5 and raw_bass_p = frame['a']['bp'] * 12.5
    # or just use hp and bp directly. Let's see: in server.py, the scaling might be normalized.
    # Let's inspect a frame to check the typical values of 'hp' and 'bp'.
    
    # Let's run the frames
    first_frame = True
    for frame in frames:
        now = frame['t']
        flux = frame['a'].get('f', 0.0)
        flux_old = flux
        
        # Approximate raw bands
        hp = frame['a'].get('hp', 0.0)
        bp = frame['a'].get('bp', 0.0)
        # Scale back to typical FFT magnitudes for threshold check (roughly * 12.5)
        raw_high_p = hp * 12.5
        raw_bass_p = bp * 12.5
        
        if first_frame:
            prev_beat_timestamp = now - 1.0
            prev_beat_timestamp_actual = now - 1.0
            prev_beat_timestamp_old = now - 1.0
            first_frame = False
            
        # Shadow tracker
        if len(history_flux_old) > 0:
            avg_flux_old = sum(history_flux_old) / len(history_flux_old)
            if flux_old > avg_flux_old * flux_threshold_mult and flux_old > flux_threshold_abs:
                if now - prev_beat_timestamp_old > 0.35:
                    if beat_count_old == 0:
                        beat_count_old = 1
                        prev_beat_timestamp_old = now
                    else:
                        beat_count_old += 1
                        delta_old = now - prev_beat_timestamp_old
                        prev_beat_timestamp_old = now
                        bpm_list_old.append(60.0 / delta_old)
                        if len(bpm_list_old) > 12:
                            bpm_list_old.pop(0)
                        sorted_list = sorted(bpm_list_old)
                        bpm_old = sorted_list[len(sorted_list) // 2]
        
        history_flux_old.append(flux_old)
        
        # PLL tracker
        if len(history_flux) > 0:
            avg_flux = sum(history_flux) / len(history_flux)
            if flux > avg_flux * flux_threshold_mult and flux > flux_threshold_abs:
                if beat_count == 0:
                    beat_count = 1
                    prev_beat_timestamp = now
                    prev_beat_timestamp_actual = now
                    detected_beats.append(now)
                    continue

                # Build-up scaling logic
                transient_ratio = raw_high_p / (raw_bass_p + 1e-6)
                raw_build = min(1.0, max(0.0, (transient_ratio - 0.2) / 0.8)) if raw_high_p > 1.0 else 0.0
                alpha = 0.3 if raw_build > smooth_build_up else 0.95
                smooth_build_up = smooth_build_up * alpha + raw_build * (1.0 - alpha)
                build_up_intensity = smooth_build_up
                
                if len(beat_intervals) >= 2:
                    sorted_ibi = sorted(beat_intervals)
                    pll_period = float(sorted_ibi[len(sorted_ibi) // 2])
                    pll_period = max(0.324, min(1.333, pll_period))
                    
                    dynamic_ratio = lockout_ratio * (1.0 - build_up_intensity * 0.65)
                    dynamic_floor = max(0.060, lockout_floor * (1.0 - build_up_intensity * 0.55))
                    lockout = max(dynamic_floor, pll_period * dynamic_ratio)
                else:
                    lockout = 0.35 * (1.0 - build_up_intensity * 0.65)
                
                if now - prev_beat_timestamp_actual > lockout:
                    if beat_count == 0:
                        beat_count = 1
                        prev_beat_timestamp = now
                        prev_beat_timestamp_actual = now
                        detected_beats.append(now)
                    else:
                        delta = now - prev_beat_timestamp_actual
                        
                        grid_ratio = delta / pll_period if len(beat_intervals) >= 2 else 1.0
                        if grid_ratio < 0.6:
                            pass
                        elif grid_ratio > 4.5:
                            prev_beat_timestamp_actual = now
                            prev_beat_timestamp = now
                        else:
                            store_delta = delta
                            if grid_ratio > 1.5:
                                fold_div = max(1, round(delta / pll_period))
                                store_delta = delta / fold_div
                                
                            elapsed_cycles = max(1, round(delta / pll_period))
                            expected_beat = prev_beat_timestamp + (elapsed_cycles * pll_period)
                            phase_error = now - expected_beat
                            tolerance = pll_period * 0.25
                            
                            if abs(phase_error) < tolerance and len(beat_intervals) >= 2:
                                prev_beat_timestamp = expected_beat + phase_error * pll_correction
                            else:
                                prev_beat_timestamp = now
                                
                            prev_beat_timestamp_actual = now
                            
                            bpm_list.append(60.0 / store_delta)
                            if len(bpm_list) > 12:
                                bpm_list.pop(0)
                            bpm = sum(bpm_list) / len(bpm_list)
                            
                            clamped_delta = max(0.324, min(1.333, store_delta))
                            beat_intervals.append(clamped_delta)
                            
                            outside_expected = (bpm > 185 or bpm < 45)
                            if outside_expected:
                                guard_ratio = bpm / (bpm_old + 1e-6)
                                is_harmonic = (abs(guard_ratio - 2.0) < 0.15) or (abs(guard_ratio - 0.5) < 0.15) or (abs(guard_ratio - 1.0) < 0.15)
                                print(f"[{os.path.basename(recording_dir)}] GUARD at {now:.3f}s: bpm={bpm:.1f} bpm_old={bpm_old:.1f} ratio={guard_ratio:.2f} harmonic={is_harmonic}")
                                if not is_harmonic:
                                    print(f"  --> PLL RESET to {bpm_old:.1f} BPM")
                                    beat_intervals.clear()
                                    sane_delta = 60.0 / bpm_old
                                    beat_intervals.append(sane_delta)
                                    beat_intervals.append(sane_delta)
                                    pll_period = sane_delta
                                    prev_beat_timestamp = now
                                    prev_beat_timestamp_actual = now
                                    bpm = bpm_old
                                    bpm_list = [bpm_old]
                                    
                            detected_beats.append(now)
                        
        history_flux.append(flux)
        
    matched, precision, recall, f_measure = match_beats(detected_beats, truth_beats)
    return {
        "truth_bpm": truth_bpm,
        "final_bpm": bpm,
        "truth_beat_count": len(truth_beats),
        "detected_beat_count": len(detected_beats),
        "matched": matched,
        "precision": precision,
        "recall": recall,
        "f_measure": f_measure
    }

if __name__ == "__main__":
    recordings_dir = "recordings"
    tracks = [
        "Imanbek - Belly Dancer",
        "RIMEDAG - Sic Parvis Magna - BitterRude Remix",
        "Technical Hitch - Lets Go Faster",
        "AHEE - Fiyah"
    ]
    
    print(f"{'Track Name':<45} | Truth | Final | Match % (F-measure)  | Beats (Det/Truth)")
    print("=" * 85)
    for track in tracks:
        res = run_simulation(os.path.join(recordings_dir, track))
        if res:
            print(f"{track:<45} | {res['truth_bpm']:>5.1f} | {res['final_bpm']:>5.1f} | {res['f_measure']*100:>5.1f}%  (P:{res['precision']*100:.1f} R:{res['recall']*100:.1f}) | {res['detected_beat_count']}/{res['truth_beat_count']}")
    print("=" * 85)
