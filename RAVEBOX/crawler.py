import os
import sys
import time
import json
import spotipy
from spotipy.oauth2 import SpotifyOAuth, CacheFileHandler

# Add backend directory to path to locate recorder_service
sys.path.append(os.path.abspath("backend"))

from recorder_service import Recorder
from offline_audit_engine import OfflineAuditEngine

# --- CONSTANTS ---
DATABASE_DIR = "song_database"
SCRATCH_DIR = "crawler_scratch"
SPOTIFY_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".spotify_cache")
SPOT_CREDS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spotify_creds.json")

# Load credentials from spotify_creds.json
SPOT_CLIENT_ID = ''
SPOT_CLIENT_SECRET = ''
SPOTIFY_REDIRECT_URI = 'https://ravebox.love/callback'

if os.path.exists(SPOT_CREDS_FILE):
    try:
        with open(SPOT_CREDS_FILE, 'r') as f:
            creds = json.load(f)
            if creds.get("SPOT_CLIENT_ID"): SPOT_CLIENT_ID = creds["SPOT_CLIENT_ID"]
            if creds.get("SPOT_CLIENT_SECRET"): SPOT_CLIENT_SECRET = creds["SPOT_CLIENT_SECRET"]
            if creds.get("SPOTIFY_REDIRECT_URI"): SPOTIFY_REDIRECT_URI = creds["SPOTIFY_REDIRECT_URI"]
            print(f"🎵 Spotify: Loaded custom credentials from {SPOT_CREDS_FILE}")
    except Exception as e:
        print(f"⚠️ Spotify: Failed to load {SPOT_CREDS_FILE}: {e}")

# Ensure directories exist
os.makedirs(DATABASE_DIR, exist_ok=True)
os.makedirs(SCRATCH_DIR, exist_ok=True)

class SpotifyPlaylistCrawler:
    def __init__(self):
        self.recorder = Recorder(root_dir=SCRATCH_DIR)
        self.auditor = OfflineAuditEngine()
        self.sp = self._init_spotify()
        self.current_track_id = None
        self.current_track_name = "Unknown"
        self.current_artist_name = "Unknown"
        self.current_duration_ms = 0
        self.recording_start_time = 0
        self.is_recording = False

    def _init_spotify(self):
        # Make sure your credentials have 'user-modify-playback-state' along with 'user-read-currently-playing'
        handler = CacheFileHandler(cache_path=SPOTIFY_CACHE_PATH)
        auth_manager = SpotifyOAuth(
            client_id=SPOT_CLIENT_ID,
            client_secret=SPOT_CLIENT_SECRET,
            redirect_uri=SPOTIFY_REDIRECT_URI,
            scope="user-read-currently-playing user-modify-playback-state",
            cache_handler=handler,
            open_browser=False
        )
        return spotipy.Spotify(auth_manager=auth_manager, retries=3, requests_timeout=10)

    def run_crawler_loop(self):
        print(" Ravebox Playlist Crawler Active. Monitoring playback...")
        
        while True:
            try:
                state = self.sp.current_user_playing_track()
                
                # Safety guard: Spotify client inactive/paused
                if not state or not state.get('is_playing') or not state.get('item'):
                    print("💤 Spotify is idle or paused. Waiting 10 seconds...")
                    time.sleep(10)
                    continue

                track = state['item']
                track_id = track['id']
                duration_ms = track['duration_ms']
                progress_ms = state['progress_ms']
                
                # File path targets
                json_path = os.path.join(DATABASE_DIR, f"{track_id}.json")
                temp_audio_path = os.path.join(SCRATCH_DIR, f"REC_{track_id}", "audio.wav") # Managed by recorder folder structure

                # --- TRACK RECOGNITION & CRAWL LOGIC ---
                if track_id != self.current_track_id:
                    # If we were recording an older track that ended/changed, check if it's complete
                    if self.is_recording:
                        session_dir = self.recorder.stop()
                        self.is_recording = False
                        
                        elapsed = time.time() - self.recording_start_time
                        threshold = max(30.0, (self.current_duration_ms / 1000.0) * 0.70)
                        
                        if elapsed >= threshold:
                            print(f"🎵 Captured substantial recording ({elapsed:.1f}s). Committing track {self.current_track_id}...")
                            prev_json_path = os.path.join(DATABASE_DIR, f"{self.current_track_id}.json")
                            self.process_and_commit(
                                self.current_track_id, 
                                session_dir, 
                                prev_json_path, 
                                self.current_track_name, 
                                self.current_artist_name
                            )
                        else:
                            print(f"Track changed unexpectedly. Purging short rogue recording of {elapsed:.1f}s.")
                            if session_dir and os.path.exists(session_dir):
                                import shutil
                                shutil.rmtree(session_dir, ignore_errors=True)

                    self.current_track_id = track_id
                    self.current_track_name = track.get('name', 'Unknown')
                    self.current_artist_name = track['artists'][0]['name'] if track.get('artists') else "Unknown"
                    self.current_duration_ms = duration_ms
                    self.recording_start_time = time.time()
                    print(f"\n Current Track: {self.current_track_name} - {self.current_artist_name} [{track_id}]")

                    # 1. Skip if already cached!
                    if os.path.exists(json_path):
                        print(f"Track already cached in database. Issuing Skip Command...")
                        self.sp.next_track()
                        time.sleep(3) # Give Spotify time to transition state
                        continue

                    # 2. If not cached, initiate background recording pass
                    print(f"Track not found in database. Starting background recording capture...")
                    # We start recording from the current position. 
                    # Tip: For clean database maps, let the crawler run the playlist from the beginning!
                    self.recorder.start(name=track_id, video_enabled=False)
                    self.is_recording = True

                # --- TRACK COMPLETION CHECK ---
                # Check if song is near completion (e.g., within 2 seconds of the end)
                time_remaining_ms = duration_ms - progress_ms
                if self.is_recording and time_remaining_ms <= 2000:
                    print(f"Song wrapping up. Stopping capture stream...")
                    
                    # Stop recording and capture the final directory name
                    session_dir = self.recorder.stop()
                    self.is_recording = False
                    
                    # Execute Librosa processing thread
                    self.process_and_commit(
                        track_id, 
                        session_dir, 
                        json_path, 
                        self.current_track_name, 
                        self.current_artist_name
                    )
                    
                    # Force transition to the next track automatically
                    print("Processing handoff complete. Force advancing playlist...")
                    self.sp.next_track()
                    time.sleep(4)

            except Exception as e:
                print(f"Crawler Error Core: {e}")
                time.sleep(5)

            time.sleep(2) # Poll tracking rate

    def process_and_commit(self, track_id, session_dir, json_path, track_name, artist_name):
        """Runs heavy Librosa processing and copies raw wav assets before purging scratch folder."""
        if not session_dir or not os.path.exists(session_dir):
            return

        wav_target = os.path.join(session_dir, "audio.wav")
        dmx_dummy_json = os.path.join(session_dir, "dmx.json")

        # Fallback helper: OfflineAuditEngine expects a dmx.json file to map timeline shapes
        # Since we are creating an acoustic-only ground truth database, generate a minimal layout
        if os.path.exists(wav_target):
            try:
                with open(dmx_dummy_json, 'w') as f:
                    json.dump([{"t": 0.0, "a": {}}], f)

                print(f"Launching Librosa Audio Analysis Engine...")
                # Run the non-causal analysis tool you wrote
                analysis_result = self.auditor.run_comparison_audit(dmx_dummy_json, wav_target)
                
                # Strip out the 'summary' and keep the deep 'truth' vector arrays for playback
                database_payload = analysis_result.get("truth", {})
                database_payload["global_bpm"] = analysis_result["summary"]["measured_global_bpm_truth"]

                # Commit data map to disk permanently
                with open(json_path, 'w') as f:
                    json.dump(database_payload, f, indent=2)
                print(f"Database updated successfully: {json_path}")

                # Copy WAV file to permanent location
                audio_out_dir = "crawled_audio"
                os.makedirs(audio_out_dir, exist_ok=True)
                
                # Sanitize filename
                def sanitize_filename(name):
                    return "".join(c if c.isalnum() or c in (' ', '_', '-') else "" for c in name).strip().replace(' ', '_')
                
                clean_artist = sanitize_filename(artist_name)
                clean_track = sanitize_filename(track_name)
                dest_name = f"{clean_artist}_{clean_track}.wav"
                dest_path = os.path.join(audio_out_dir, dest_name)
                
                import shutil
                print(f"Saving permanent WAV file: {dest_path}")
                shutil.copy2(wav_target, dest_path)

            except Exception as audit_err:
                print(f"Processing Failure for track {track_id}: {audit_err}")
            finally:
                # Completely wipe raw wav directory blocks to optimize storage spaces
                import shutil
                print(f"Purging volatile PCM scratch folder: {session_dir}")
                shutil.rmtree(session_dir, ignore_errors=True)


if __name__ == "__main__":
    crawler = SpotifyPlaylistCrawler()
    crawler.run_crawler_loop()