import json
import os

# Paths
SCAN_REPORT = "/home/sumof2/vj/tmp/scan_results/report.json"
CONCERT_REPORT = "/home/sumof2/vj/tmp/concert_results/concert_report.json"
MANIFEST_FILE = "/home/sumof2/vj/backend/static/sim_manifest.json"

def generate():
    manifest = {
        "patterns": {},
        "concert": [],
        "rot_deformations": [],
        "draw_deformations": []
    }

    # 1. LOAD PATTERNS (CH 4)
    if os.path.exists(SCAN_REPORT):
        with open(SCAN_REPORT, 'r') as f:
            data = json.load(f)
            for item in data:
                dmx = item['dmx']
                # Check if image actually exists in static/sim_frames
                filename = f"pattern_{dmx:03d}.jpg"
                if os.path.exists(f"/home/sumof2/vj/backend/static/sim_frames/{filename}"):
                    manifest["patterns"][str(dmx)] = {
                        "file": filename,
                        "complexity": item['complexity'],
                        "brightness": item['brightness']
                    }
        print(f"[*] Indexed {len(manifest['patterns'])} patterns")

    # 2. LOAD CONCERT (CH 14/15 Interaction)
    if os.path.exists(CONCERT_REPORT):
        with open(CONCERT_REPORT, 'r') as f:
            data = json.load(f)
            for item in data:
                d14 = item['ch14_delay']
                d15 = item['ch15_draw']
                filename = f"concert_{d14:03d}_{d15:03d}.jpg"
                if os.path.exists(f"/home/sumof2/vj/backend/static/sim_frames/{filename}"):
                    manifest["concert"].append({
                        "ch14": d14,
                        "ch15": d15,
                        "file": filename,
                        "complexity": item['complexity'],
                        "brightness": item['brightness']
                    })
        print(f"[*] Indexed {len(manifest['concert'])} concert (drawing interaction) frames")

    # 3. LOAD MULTI-AXIS (Rotation & Drawing Deformation)
    MULTI_AXIS_REPORT = "/home/sumof2/vj/tmp/multi_axis_results/multi_axis_report.json"
    if os.path.exists(MULTI_AXIS_REPORT):
        with open(MULTI_AXIS_REPORT, 'r') as f:
            data = json.load(f)
            for item in data:
                filename = item['file']
                if os.path.exists(f"/home/sumof2/vj/backend/static/sim_frames/{filename}"):
                    if item['type'] == 'rotation':
                        manifest["rot_deformations"].append({
                            "x": item['x_rot'],
                            "y": item['y_rot'],
                            "file": filename,
                            "complexity": item['complexity'],
                            "brightness": item['brightness']
                        })
                    elif item['type'] == 'drawing':
                        manifest["draw_deformations"].append({
                            "draw": item['draw'],
                            "drawing": item['drawing'],
                            "file": filename,
                            "complexity": item['complexity'],
                            "brightness": item['brightness']
                        })
        print(f"[*] Indexed {len(manifest['rot_deformations'])} rotation deformation frames")
        print(f"[*] Indexed {len(manifest['draw_deformations'])} drawing deformation frames")

    # SAVE MANIFEST
    with open(MANIFEST_FILE, 'w') as f:
        json.dump(manifest, f, indent=4)
    print(f"[*] Manifest saved to {MANIFEST_FILE}")

if __name__ == "__main__":
    generate()
