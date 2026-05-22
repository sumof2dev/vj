import os
import time
import json
import threading
import queue
import cv2
import numpy as np
import sounddevice as sd
import wave
import requests
import subprocess
import shutil
from datetime import datetime

class Recorder:
    def __init__(self, root_dir="recordings"):
        self.root_dir = root_dir
        if not os.path.exists(self.root_dir):
            os.makedirs(self.root_dir)
        
        self.is_recording = False
        self.session_dir = None
        self.start_time = 0
        
        # Video state
        self.video_writer = None
        self.fps = 10
        self.video_thread = None
        
        # Audio state
        self.audio_stream = None
        self.audio_file = None
        self.audio_q = queue.Queue()
        
        # DMX state
        self.dmx_log = []
        self.monitored_addresses = []
        self.last_dmx_log_time = 0 # Throttling for 1Hz logging
        
    def start(self, name=None, addresses=None, roles=None, samplerate=44100, video_enabled=True):
        if self.is_recording:
            return False
            
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        folder_name = f"REC_{timestamp}" + (f"_{name}" if name else "")
        self.session_dir = os.path.join(self.root_dir, folder_name)
        os.makedirs(self.session_dir)
        
        self.monitored_addresses = addresses or []
        self.address_roles = roles or {}
        self.dmx_log = []
        self.start_time = time.time()
        self.is_recording = True
        
        # --- Audio Setup ---
        try:
            audio_path = os.path.join(self.session_dir, "audio.wav")
            self.audio_file = wave.open(audio_path, 'wb')
            self.audio_file.setnchannels(1)
            self.audio_file.setsampwidth(2) # 16-bit
            self.audio_file.setframerate(samplerate)
            
            def audio_callback(indata, frames, time_info, status):
                if self.is_recording:
                    self.audio_q.put(indata.copy())
            
            self.audio_stream = sd.InputStream(samplerate=samplerate, channels=1, callback=audio_callback)
            self.audio_stream.start()
            
            def audio_writer():
                while self.is_recording or not self.audio_q.empty():
                    try:
                        data = self.audio_q.get(timeout=0.5)
                        # Convert float32 to int16
                        int_data = (data * 32767).astype(np.int16)
                        self.audio_file.writeframes(int_data.tobytes())
                    except queue.Empty:
                        continue
            threading.Thread(target=audio_writer, daemon=True).start()
        except Exception as e:
            print(f"🔴 Recorder Audio Error: {e}")

        # --- Video Setup ---
        if video_enabled:
            try:
                video_path = os.path.join(self.session_dir, "video_raw.mp4")
                # We'll initialize VideoWriter on the first frame to get the correct resolution
                self.video_writer = None
                
                def video_worker():
                    frame_interval = 1.0 / self.fps
                    while self.is_recording:
                        loop_start = time.time()
                        try:
                            resp = requests.get("http://127.0.0.1:8004/capture", timeout=1)
                            if resp.status_code == 200:
                                nparr = np.frombuffer(resp.content, np.uint8)
                                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                                if frame is not None:
                                    if self.video_writer is None:
                                        h, w = frame.shape[:2]
                                        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                                        self.video_writer = cv2.VideoWriter(video_path, fourcc, self.fps, (w, h))
                                    
                                    self.video_writer.write(frame)
                        except Exception as e:
                            print(f"🔴 Recorder Video Fetch Error: {e}")
                        
                        # Precision sleep
                        elapsed = time.time() - loop_start
                        to_sleep = max(0, frame_interval - elapsed)
                        time.sleep(to_sleep)
                    
                    if self.video_writer:
                        self.video_writer.release()
                        self.video_writer = None
                        
                self.video_thread = threading.Thread(target=video_worker, daemon=True)
                self.video_thread.start()
            except Exception as e:
                print(f"🔴 Recorder Video Error: {e}")
        else:
            print("📷 Live Feed is off, skipping video recording.")

        print(f"🎬 Started Recording: {self.session_dir}")
        return True

    def log_dmx(self, universe, audio_state=None, active_presets=None):
        if not self.is_recording:
            return
            
        now = time.time()
        # Throttling: Bumped to 20Hz (0.05s) for smooth timeline syncing
        if now - self.last_dmx_log_time < 0.05:
            return
            
        self.last_dmx_log_time = now
        entry = {
            "t": round(now - self.start_time, 3),
            "v": {addr: universe[addr] for addr in self.monitored_addresses if addr < len(universe)}
        }
        
        # Capture audio signature if provided by the main engine
        if audio_state:
            entry["a"] = {
                "b": round(audio_state.get("bass", 0.0), 3),
                "m": round(audio_state.get("mid", 0.0), 3),
                "h": round(audio_state.get("high", 0.0), 3),
                "f": round(audio_state.get("flux", 0.0), 3),
                "vl": round(audio_state.get("vol", 0.0), 3),
                "vb": audio_state.get("vibe", "mid"),
                "tr": audio_state.get("transient", "steady"),
                "bt": bool(audio_state.get("beat", False))
            }
        
        # Capture active presets for timeline visualization
        if active_presets:
            entry["p"] = active_presets
            
        self.dmx_log.append(entry)

    def stop(self, new_name=None):
        if not self.is_recording:
            return None
            
        self.is_recording = False
        
        # Close audio
        if self.audio_stream:
            self.audio_stream.stop()
            self.audio_stream.close()
            self.audio_stream = None
            
        if self.audio_file:
            # Wait a bit for the writer thread to finish the queue
            time.sleep(1.0)
            self.audio_file.close()
            self.audio_file = None
            
        # Video is closed by its own thread
        if self.video_thread:
            self.video_thread.join(timeout=2.0)
            
        # Save DMX Log
        if self.dmx_log:
            dmx_path = os.path.join(self.session_dir, "dmx.json")
            with open(dmx_path, 'w') as f:
                json.dump(self.dmx_log, f)
        
        # Save Metadata
        meta_path = os.path.join(self.session_dir, "meta.json")
        meta = {
            "timestamp": datetime.now().isoformat(),
            "duration": round(time.time() - self.start_time, 2),
            "addresses": self.monitored_addresses,
            "roles": self.address_roles
        }
        with open(meta_path, 'w') as f:
            json.dump(meta, f, indent=4)
            
        # --- Folder Renaming (Must happen BEFORE Muxing Thread) ---
        final_dir = self.session_dir
        if new_name:
            try:
                # Sanitize name
                clean_name = "".join([c for c in new_name if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
                if clean_name:
                    parent = os.path.dirname(self.session_dir)
                    new_path = os.path.join(parent, clean_name)
                    # Simple conflict resolution
                    if os.path.exists(new_path):
                        timestamp = datetime.now().strftime("%H%M%S")
                        new_path += f"_{timestamp}"
                    
                    os.rename(self.session_dir, new_path)
                    final_dir = new_path
                    self.session_dir = new_path 
            except Exception as e:
                print(f"🔴 Recorder Rename Error: {e}")

        # --- Background Transcoding (Browser Playability) ---
        # Hand off the FINAL path so the thread uses the renamed folder if applicable
        threading.Thread(target=self._finalize_video, args=(final_dir,), daemon=True).start()

        print(f"🏁 Stopped Recording: {final_dir} (Finalizing video in background...)")
        return final_dir

    def _finalize_video(self, target_dir):
        """Transcodes the raw OpenCV video into a browser-ready H.264 video."""
        if not target_dir:
            return
        
        # Give files a moment to flush and release
        time.sleep(1.0)
        
        raw_path = os.path.join(target_dir, "video_raw.mp4")
        final_path = os.path.join(target_dir, "video.mp4")
        log_path = os.path.join(target_dir, "transcode.log")
        
        if not os.path.exists(raw_path):
            return

        print(f"🔄 Transcoding Video to H.264 for browser compatibility: {target_dir}...")
        # Use libx264 with ultrafast to minimize CPU impact after the session
        cmd = [
            "/usr/bin/ffmpeg", "-y",
            "-i", raw_path,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            final_path
        ]
        
        try:
            with open(log_path, "w") as log_file:
                result = subprocess.run(cmd, stdout=log_file, stderr=subprocess.STDOUT, text=True, timeout=60)
                if result.returncode == 0:
                    print(f"✅ Transcoding Successful: {final_path}")
                    if os.path.exists(raw_path):
                        os.remove(raw_path)
                else:
                    print(f"🔴 Transcoding Failed: Check {log_path} for details.")
        except Exception as e:
            with open(log_path, "a") as f:
                f.write(f"🔴 Transcoding Error: {e}\n")
            print(f"🔴 Transcoding Error: {e}")


    def save_training_sample(self, session_id, start_t, end_t, correct_label):
        """Copies an entire session folder to 'training_data' and adds a label.json."""
        if not session_id:
            return False
            
        source_dir = os.path.join(self.root_dir, session_id)
        if not os.path.exists(source_dir):
            # Try to find it if session_id is just the name
            source_dir = os.path.join(self.root_dir, session_id)
            if not os.path.exists(source_dir):
                print(f"⚠️ Training Sample Error: Source session {session_id} not found.")
                return False
        
        training_root = "training_data"
        if not os.path.exists(training_root):
            os.makedirs(training_root)
            
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        target_dir = os.path.join(training_root, f"TRAIN_{timestamp}_{correct_label}")
        
        try:
            # Copy entire session for full context
            shutil.copytree(source_dir, target_dir)
            
            # Add label metadata
            label_data = {
                "source_session": session_id,
                "start_t": start_t,
                "end_t": end_t,
                "correct_label": correct_label,
                "timestamp": datetime.now().isoformat()
            }
            
            with open(os.path.join(target_dir, "label.json"), 'w') as f:
                json.dump(label_data, f, indent=4)
                
            print(f"📂 Saved Training Sample to: {target_dir}")
            return True
        except Exception as e:
            print(f"❌ Error saving training sample: {e}")
            return False

