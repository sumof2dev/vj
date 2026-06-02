import json
import os
import sys

try:
    import numpy as np
    import librosa
    import scipy.signal
except ModuleNotFoundError:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    venv_python = None
    for venv in ['venv_local', 'venv', '.venv']:
        p = os.path.join(base_dir, venv, 'bin', 'python3')
        if os.path.isfile(p):
            venv_python = p
            break
    if venv_python and sys.executable != venv_python:
        os.execv(venv_python, [venv_python] + sys.argv)
    else:
        raise

class OfflineAuditEngine:
    def __init__(self, sample_rate=44100):
        # Sample rate technical configuration inferred from main.py streaming settings
        self.sr = sample_rate 
        # Window hop length constraint inferred from standard digital signal spectrogram profiles
        self.hop_length = 512 

    def load_telemetry(self, json_path):
        """Loads recorded performance logs."""
        with open(json_path, 'r') as f:
            return json.load(f)

    def analyze_ground_truth(self, audio_path):
        """Generates absolute non-causal audio profiles via Librosa."""
        # Load audio into memory natively
        y, sr = librosa.load(audio_path, sr=self.sr)
        
        # 1. Compute global definitive tempo and frame locations
        onset_env = librosa.onset.onset_strength(y=y, sr=self.sr, hop_length=self.hop_length)
        tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=self.sr, hop_length=self.hop_length)
        beat_times = librosa.frames_to_time(beats, sr=self.sr, hop_length=self.hop_length)

        # 2. Run non-causal Harmonic-Percussive Source Separation
        stft = librosa.stft(y, hop_length=self.hop_length)
        stft_harmonic, stft_percussive = librosa.decompose.hpss(stft)
        
        # 3. Extract frequency band envelopes from percussive STFT
        freqs = librosa.fft_frequencies(sr=self.sr, n_fft=2048)
        percussive_mag = np.abs(stft_percussive)
        harmonic_mag = np.abs(stft_harmonic)
        full_mag = np.abs(stft)

        # Band boundaries matching audio_analyzer.py 6-bin layout
        bass_mask = freqs < 250
        mid_mask = (freqs >= 250) & (freqs < 4000)
        high_mask = freqs >= 4000

        def band_envelope(mag, mask):
            """RMS energy per frame for a frequency band."""
            band = mag[mask, :]
            if band.size == 0:
                return np.zeros(mag.shape[1])
            env = np.sqrt(np.mean(band ** 2, axis=0))
            peak = np.max(env) + 1e-6
            return env / peak

        perc_bass = band_envelope(percussive_mag, bass_mask)
        perc_mid = band_envelope(percussive_mag, mid_mask)
        perc_high = band_envelope(percussive_mag, high_mask)
        harm_bass = band_envelope(harmonic_mag, bass_mask)
        harm_mid = band_envelope(harmonic_mag, mid_mask)
        harm_high = band_envelope(harmonic_mag, high_mask)
        
        # Standard EQ bands (unseparated STFT)
        full_bass = band_envelope(full_mag, bass_mask)
        full_mid = band_envelope(full_mag, mid_mask)
        full_high = band_envelope(full_mag, high_mask)

        # Volume envelope based on RMS of the full STFT
        total_rms = np.sqrt(np.mean(full_mag ** 2, axis=0))
        vol_truth = total_rms / (np.max(total_rms) + 1e-6)

        # Harmonic volume envelope
        harmonic_rms = np.sqrt(np.mean(harmonic_mag ** 2, axis=0))
        vol_h_truth = harmonic_rms / (np.max(harmonic_rms) + 1e-6)

        # Spectral complexity harmonic
        raw_harm_bass = np.sqrt(np.mean(harmonic_mag[bass_mask, :] ** 2, axis=0)) if harmonic_mag[bass_mask, :].size > 0 else np.zeros(harmonic_mag.shape[1])
        raw_harm_mid = np.sqrt(np.mean(harmonic_mag[mid_mask, :] ** 2, axis=0)) if harmonic_mag[mid_mask, :].size > 0 else np.zeros(harmonic_mag.shape[1])
        raw_harm_high = np.sqrt(np.mean(harmonic_mag[high_mask, :] ** 2, axis=0)) if harmonic_mag[high_mask, :].size > 0 else np.zeros(harmonic_mag.shape[1])
        spectral_complexity_h = (raw_harm_mid + raw_harm_high) / (raw_harm_bass + raw_harm_mid + raw_harm_high + 1e-6)

        # Percussive onset envelope (broadband)
        percussive_envelope = librosa.onset.onset_strength(
            S=librosa.amplitude_to_db(percussive_mag, ref=np.max), 
            sr=self.sr, 
            hop_length=self.hop_length
        )
        
        # Convert frames directly to an accessible timeline array
        times = librosa.frames_to_time(np.arange(len(onset_env)), sr=self.sr, hop_length=self.hop_length)
        # STFT frames may differ in length from onset frames, align to shorter
        stft_times = librosa.frames_to_time(np.arange(percussive_mag.shape[1]), sr=self.sr, hop_length=self.hop_length)

        return {
            "global_bpm": float(np.atleast_1d(tempo)[0]),
            "beat_times": beat_times.tolist(),
            "timeline": times,
            "flux_truth": onset_env / (np.max(onset_env) + 1e-6),
            "percussive_flux_truth": percussive_envelope / (np.max(percussive_envelope) + 1e-6),
            # Per-band HPSS envelopes
            "stft_timeline": stft_times,
            "perc_bass": perc_bass,
            "perc_mid": perc_mid,
            "perc_high": perc_high,
            "harm_bass": harm_bass,
            "harm_mid": harm_mid,
            "harm_high": harm_high,
            # Standard EQ envelopes
            "bass_truth": full_bass,
            "mid_truth": full_mid,
            "high_truth": full_high,
            "vol_truth": vol_truth,
            "vol_h_truth": vol_h_truth,
            "spectral_complexity_h": spectral_complexity_h
        }

    def _match_beats(self, live_beats, truth_beats, tolerance=0.070):
        """Evaluate beat alignment using sorted binary search (O(n log m))."""
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

    def _band_rmse(self, live_times, live_values, truth_times, truth_values):
        """RMSE between a live band and its interpolated truth counterpart."""
        interp_truth = np.interp(live_times, truth_times, truth_values)
        return float(np.sqrt(np.mean((live_values - interp_truth) ** 2)))

    def run_comparison_audit(self, json_path, audio_path):
        """Cross-references recorded live tracking parameters against Librosa ground truth."""
        telemetry = self.load_telemetry(json_path)
        truth = self.analyze_ground_truth(audio_path)
        
        # Extract time tracks from recorded frames
        live_times = np.array([frame['t'] for frame in telemetry])
        live_flux = np.array([frame['a'].get('f', 0.0) for frame in telemetry])
        live_beats = np.array([frame['t'] for frame in telemetry if frame['a'].get('bt', False)])

        # Interpolate truth timelines directly onto our variable live sample ticks
        interp_flux_truth = np.interp(live_times, truth['timeline'], truth['flux_truth'])
        
        # Calculate Root-Mean-Square Deviation for continuous envelope parameters
        flux_rmse = float(np.sqrt(np.mean((live_flux - interp_flux_truth) ** 2)))

        # Evaluate Beat Accuracy (Precision & Recall)
        _, precision, recall, f_measure = self._match_beats(live_beats, truth['beat_times'])

        sample_frame = telemetry[0]['a'] if telemetry else {}

        # Standard EQ band comparisons (b, m, h, vl)
        standard_audit = {}
        standard_fields = {
            'b': ('bass_truth', 'stft_timeline'),
            'm': ('mid_truth', 'stft_timeline'),
            'h': ('high_truth', 'stft_timeline'),
            'vl': ('vol_truth', 'stft_timeline')
        }
        for live_key, (truth_key, time_key) in standard_fields.items():
            if live_key in sample_frame:
                live_band = np.array([frame['a'].get(live_key, 0.0) for frame in telemetry])
                rmse = self._band_rmse(live_times, live_band, truth[time_key], truth[truth_key])
                standard_audit[f"{live_key}_rmse"] = rmse

        # HPSS per-band comparison (if live data contains HPSS fields)
        hpss_audit = {}
        hpss_fields = {
            'bp': ('perc_bass', 'stft_timeline'),
            'mp': ('perc_mid', 'stft_timeline'),
            'hp': ('perc_high', 'stft_timeline'),
            'bh': ('harm_bass', 'stft_timeline'),
            'mh': ('harm_mid', 'stft_timeline'),
            'hh': ('harm_high', 'stft_timeline'),
        }
        for live_key, (truth_key, time_key) in hpss_fields.items():
            if live_key in sample_frame:
                live_band = np.array([frame['a'].get(live_key, 0.0) for frame in telemetry])
                rmse = self._band_rmse(live_times, live_band, truth[time_key], truth[truth_key])
                hpss_audit[f"{live_key}_rmse"] = rmse

        # Percussive flux comparison
        interp_perc_truth = np.interp(live_times, truth['timeline'], truth['percussive_flux_truth'])
        perc_flux_rmse = float(np.sqrt(np.mean((live_flux - interp_perc_truth) ** 2)))

        # Vibe and transient distributions
        vibe_distribution = {}
        transient_distribution = {}
        for frame in telemetry:
            vb = frame['a'].get('vb')
            if vb:
                vibe_distribution[vb] = vibe_distribution.get(vb, 0) + 1
            tr = frame['a'].get('tr')
            if tr:
                transient_distribution[tr] = transient_distribution.get(tr, 0) + 1

        total_frames = len(telemetry)
        if total_frames > 0:
            vibe_distribution = {k: round(v / total_frames, 4) for k, v in vibe_distribution.items()}
            transient_distribution = {k: round(v / total_frames, 4) for k, v in transient_distribution.items()}

        return {
            "summary": {
                "measured_global_bpm_truth": truth['global_bpm'],
                "envelope_tracking_rmse": flux_rmse,  # Lower is better
                "percussive_flux_rmse": perc_flux_rmse,
                "beat_alignment_f_measure": f_measure, # Higher is better (1.0 = perfect)
                "precision": precision,
                "recall": recall,
                "standard": standard_audit,
                "hpss": hpss_audit,
                "vibe_distribution": vibe_distribution,
                "transient_distribution": transient_distribution
            },
            "truth": {
                "beat_times": truth['beat_times'],
                "timeline": truth['timeline'].tolist(),
                "flux_truth": truth['flux_truth'].tolist(),
                "percussive_flux_truth": truth['percussive_flux_truth'].tolist(),
                # Per-band HPSS truth curves for frontend overlay
                "stft_timeline": truth['stft_timeline'].tolist(),
                "perc_bass": truth['perc_bass'].tolist(),
                "perc_mid": truth['perc_mid'].tolist(),
                "perc_high": truth['perc_high'].tolist(),
                "harm_bass": truth['harm_bass'].tolist(),
                "harm_mid": truth['harm_mid'].tolist(),
                "harm_high": truth['harm_high'].tolist(),
                # Standard EQ truth curves
                "bass_truth": truth['bass_truth'].tolist(),
                "mid_truth": truth['mid_truth'].tolist(),
                "high_truth": truth['high_truth'].tolist(),
                "vol_truth": truth['vol_truth'].tolist(),
                "vol_h_truth": truth['vol_h_truth'].tolist(),
                "spectral_complexity_h": truth['spectral_complexity_h'].tolist()
            }
        }


# =============================================================================
# CLI Mode — Run on minisforum, fetch from Pi, push results back
# =============================================================================
if __name__ == "__main__":
    import argparse
    import urllib.request
    import sys
    import tempfile
    import shutil
    import ssl

    # Bypass SSL verification globally for self-signed certificates on RPi
    try:
        ssl._create_default_https_context = ssl._create_unverified_context
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="Offline Librosa Audit (runs on minisforum, fetches from Pi or analyzes local dir)")
    parser.add_argument("--host", help="Pi server address (e.g. 192.168.1.90:8000 or ravebox.local:8000)")
    parser.add_argument("--session", help="Recording session folder name (required if fetching from Pi)")
    parser.add_argument("--local-dir", help="Path to local recording session folder (runs audit on local files)")
    parser.add_argument("--tolerance", type=float, default=0.070, help="Beat alignment tolerance in seconds (default: 0.070)")
    args = parser.parse_args()

    DEFAULT_RECORDINGS_DIR = "/home/sumof2/projects/RAVEBOX/recordings"
    if args.session and not args.host and not args.local_dir:
        args.local_dir = os.path.join(DEFAULT_RECORDINGS_DIR, args.session)

    if not args.local_dir and (not args.host or not args.session):
        parser.error("Either --local-dir OR both --host and --session must be specified")

    work_dir = None
    if args.local_dir:
        local_path = os.path.abspath(args.local_dir)
        session_name = args.session or os.path.basename(local_path.rstrip('/\\'))
        audio_path = os.path.join(local_path, "audio.wav")
        dmx_path = os.path.join(local_path, "dmx.json")
        is_local = True
        print(f"📂 Auditing local directory: {local_path}")
    else:
        session_name = args.session
        host = args.host if "://" in args.host else f"https://{args.host}"
        base_url = f"{host}/recordings/{session_name}"
        work_dir = tempfile.mkdtemp(prefix="ravebox_audit_")
        audio_path = os.path.join(work_dir, "audio.wav")
        dmx_path = os.path.join(work_dir, "dmx.json")
        is_local = False

    try:
        if not is_local:
            # 1. Download recording files from Pi
            print(f"📥 Fetching audio.wav from {base_url}/audio.wav ...")
            urllib.request.urlretrieve(f"{base_url}/audio.wav", audio_path)
            audio_size = os.path.getsize(audio_path)
            print(f"   ✅ audio.wav ({audio_size:,} bytes)")

            print(f"📥 Fetching dmx.json from {base_url}/dmx.json ...")
            urllib.request.urlretrieve(f"{base_url}/dmx.json", dmx_path)
            dmx_size = os.path.getsize(dmx_path)
            print(f"   ✅ dmx.json ({dmx_size:,} bytes)")
        else:
            if not os.path.exists(audio_path):
                print(f"❌ Error: audio.wav not found in {local_path}")
                sys.exit(1)
            if not os.path.exists(dmx_path):
                print(f"❌ Error: dmx.json not found in {local_path}")
                sys.exit(1)

        # 2. Run analysis
        print(f"\n🔬 Running Librosa analysis (this may take 10-30 seconds)...")
        engine = OfflineAuditEngine()
        result = engine.run_comparison_audit(dmx_path, audio_path)

        # 3. Print results
        s = result["summary"]
        print(f"\n{'='*60}")
        print(f"  AUDIT RESULTS: {session_name}")
        print(f"{'='*60}")
        print(f"  Global BPM (Librosa):   {s['measured_global_bpm_truth']:.1f}")
        print(f"  Beat F-Measure:         {s['beat_alignment_f_measure']*100:.1f}%  (P: {s['precision']*100:.1f}%  R: {s['recall']*100:.1f}%)")
        print(f"  Flux Envelope RMSE:     {s['envelope_tracking_rmse']:.4f}")
        print(f"  Percussive Flux RMSE:   {s['percussive_flux_rmse']:.4f}")
        
        if s.get('standard'):
            print(f"  Standard Band RMSE:")
            for k, v in s['standard'].items():
                print(f"    {k}: {v:.4f}")
                
        if s.get('hpss'):
            print(f"  HPSS Band RMSE:")
            for k, v in s['hpss'].items():
                print(f"    {k}: {v:.4f}")
                
        if s.get('vibe_distribution'):
            print(f"  Vibe State Distribution:")
            for k, v in s['vibe_distribution'].items():
                print(f"    {k}: {v*100:.1f}%")
                
        if s.get('transient_distribution'):
            print(f"  Transient State Distribution:")
            for k, v in s['transient_distribution'].items():
                print(f"    {k}: {v*100:.1f}%")
        print(f"{'='*60}\n")

        # Save local audit_results.json inside the local directory if running locally
        if is_local:
            local_results_path = os.path.join(local_path, "audit_results.json")
            with open(local_results_path, 'w') as lf:
                json.dump(result, lf, indent=4)
            print(f"💾 Saved local results to: {local_results_path}")

        # 4. Push results back to Pi if host is provided
        if args.host:
            host_url = args.host if "://" in args.host else f"https://{args.host}"
            result_json = json.dumps(result).encode('utf-8')
            upload_url = f"{host_url}/api/audit/save?session={session_name}"
            print(f"📤 Uploading audit_results.json to Pi ({len(result_json):,} bytes)...")
            
            req = urllib.request.Request(
                upload_url,
                data=result_json,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_data = json.loads(resp.read())
                if resp_data.get("status") == "ok":
                    print(f"   ✅ Results saved to Pi: recordings/{session_name}/audit_results.json")
                else:
                    print(f"   ⚠️ Unexpected response: {resp_data}")

        print(f"\n🎯 Done. Open player.html and click Deep Audit to review overlays.")

    except urllib.error.HTTPError as e:
        print(f"❌ HTTP Error {e.code}: {e.reason}")
        if e.code == 404:
            print(f"   Check that session '{session_name}' exists on the Pi.")
    except urllib.error.URLError as e:
        print(f"❌ Connection Error: {e.reason}")
        if not is_local:
            print(f"   Check that the Pi server is running at {host}")
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if work_dir and os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)