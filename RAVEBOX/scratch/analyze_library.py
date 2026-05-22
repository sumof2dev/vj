import os
import json
import cv2
import numpy as np

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_ROOT = os.path.join(BASE_DIR, 'library')

def analyze_image(path):
    img = cv2.imread(path)
    if img is None: return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return {
        "luminance": round(float(np.mean(gray) / 255.0), 3),
        "contrast": round(float(np.std(gray) / 255.0), 3)
    }

print("🔍 Starting Library Brightness Analysis...")

for root, dirs, files in os.walk(LIB_ROOT):
    for f in files:
        if f.endswith('.jpg') and not f.endswith('.frag.jpg'):
            # This is likely a thumbnail or texture
            # But we specifically want the .frag.jpg ones or texture images
            pass
        
        # Shaders have .frag and .frag.jpg
        if f.endswith('.frag'):
            thumb_path = os.path.join(root, f + ".jpg")
            meta_path = os.path.join(root, f + ".json")
            
            if os.path.exists(thumb_path):
                stats = analyze_image(thumb_path)
                if stats:
                    meta = {}
                    if os.path.exists(meta_path):
                        with open(meta_path, 'r') as m:
                            meta = json.load(m)
                    
                    meta.update(stats)
                    with open(meta_path, 'w') as m:
                        json.dump(meta, m, indent=4)
                    print(f"✅ Analyzed {f}: Lum={stats['luminance']}, Con={stats['contrast']}")

print("✨ Analysis Complete.")
