import os
import json
import cv2
import numpy as np

SAVE_DIR = "/home/sumof2/vj/tmp/multi_axis_results"
REPORT_FILE = f"{SAVE_DIR}/multi_axis_report.json"

def analyze_frame(filepath):
    frame = cv2.imread(filepath)
    if frame is None: return 0, 0
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
    brightness = np.sum(gray) // 1000
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    complexity = sum(len(c) for c in contours)
    return complexity, int(brightness)

def reconstruct():
    report = []
    files = [f for f in os.listdir(SAVE_DIR) if f.endswith(".jpg")]
    print(f"[*] Reconstructing report from {len(files)} files...")
    
    for f in files:
        path = os.path.join(SAVE_DIR, f)
        comp, bright = analyze_frame(path)
        
        if f.startswith("rot_"):
            parts = f.replace(".jpg", "").split("_")
            report.append({
                "type": "rotation",
                "x_rot": int(parts[1]),
                "y_rot": int(parts[2]),
                "complexity": comp,
                "brightness": bright,
                "file": f
            })
        elif f.startswith("draw_"):
            parts = f.replace(".jpg", "").split("_")
            report.append({
                "type": "drawing",
                "draw": int(parts[1]),
                "drawing": int(parts[2]),
                "complexity": comp,
                "brightness": bright,
                "file": f
            })
            
    with open(REPORT_FILE, "w") as out:
        json.dump(report, out, indent=4)
    print(f"[*] Report reconstructed and saved to {REPORT_FILE}")

if __name__ == "__main__":
    reconstruct()
