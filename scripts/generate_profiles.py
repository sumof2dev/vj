#!/usr/bin/env python3
"""
Generate two new Ehaho behavior profiles based on calibration scan data.
Injects them into ravebox_config.json alongside updated stage assignments.
"""
import json, os, copy, time

CONFIG_PATH = "/home/sumof2/vj/fixtures/ravebox_config.json"
BACKUP_PATH = f"/home/sumof2/vj/fixtures/ravebox_config.backup_{int(time.time())}.json"

with open(CONFIG_PATH) as f:
    config = json.load(f)

# Back up
with open(BACKUP_PATH, 'w') as f:
    json.dump(config, f, indent=2)
print(f"✅ Config backed up to {BACKUP_PATH}")

from profile_factory import ProfileFactory
factory = ProfileFactory()

FIXTURE_ID = "fix_1774209417123"

# ─── Helper: Build a rule ───────────────────────────────────────────────
def static(val):
    return {"vibe": "any", "behavior": "static", "value": val}

def direct(source, cal_min, cal_center, cal_max, bin_idx=0, smoothing=0.0, threshold=0.0, react=1.0):
    r = {
        "vibe": "any", "behavior": "direct", "source": source, "bin_idx": bin_idx,
        "cal": {"min": cal_min, "center": cal_center, "max": cal_max},
        "audio": {"smoothing": smoothing, "threshold": threshold, "react": react}
    }
    return r

def lfo(source, cal_min, cal_center, cal_max, shape="sine", speed=0.1, react=0.5, bin_idx=0, invert=False, hold=0, smoothing=0.0):
    r = {
        "vibe": "any", "behavior": "lfo", "source": source, "bin_idx": bin_idx,
        "cal": {"min": cal_min, "center": cal_center, "max": cal_max},
        "lfo": {"shape": shape, "speed": speed, "react": react, "invert": invert, "hold": hold, "smoothing": smoothing}
    }
    return r

def cycle(source, cal_min, cal_center, cal_max):
    return {
        "vibe": "any", "behavior": "cycle", "source": source,
        "cal": {"min": cal_min, "center": cal_center, "max": cal_max}
    }

def vibe_rule(vibe, behavior, source=None, val=None, cal=None, bin_idx=0, lfo_cfg=None, audio_cfg=None):
    r = {"vibe": vibe, "behavior": behavior}
    if source: r["source"] = source
    if val is not None: r["value"] = val
    if bin_idx: r["bin_idx"] = bin_idx
    if cal: r["cal"] = {"min": cal[0], "center": cal[1], "max": cal[2]}
    if lfo_cfg: r["lfo"] = lfo_cfg
    if audio_cfg: r["audio"] = audio_cfg
    return r


# ═══════════════════════════════════════════════════════════════════════
#  PROFILE 1: MELODY — HARMONIC / TONAL (GOLD STANDARD)
# ═══════════════════════════════════════════════════════════════════════
melody_mappings = [
    [vibe_rule("any", "static", val=215)],   # CH 1: Dimmer
    [vibe_rule("any", "static", val=0)],     # CH 2: Boundary (Safe 0)
    [vibe_rule("any", "static", val=250)],   # CH 3: Group
    [                                        # CH 4: Pattern
        vibe_rule("chill", "cycle", source="bar", cal=(2, 11, 20)),
        vibe_rule("mid", "cycle", source="bar", cal=(2, 15, 28)),
        vibe_rule("high", "static", val=50),
        vibe_rule("drop", "static", val=21),
        vibe_rule("any", "cycle", source="bar", cal=(0, 15, 30))
    ],
    [                                        # CH 5: Zoom
        vibe_rule("chill", "lfo", source="ratio", bin_idx=2, cal=(40, 65, 90), lfo_cfg={"shape": "sine", "speed": 0.06, "react": 0.4, "smoothing": 0.95}),
        vibe_rule("mid", "lfo", source="ratio", bin_idx=2, cal=(40, 90, 140), lfo_cfg={"shape": "sine", "speed": 0.08, "react": 0.6, "smoothing": 0.9}),
        vibe_rule("high", "lfo", source="ratio", bin_idx=2, cal=(80, 140, 200), lfo_cfg={"shape": "sine", "speed": 0.1, "react": 0.8, "smoothing": 0.85}),
        vibe_rule("drop", "direct", source="flux", cal=(100, 170, 240), audio_cfg={"smoothing": 0.7, "threshold": 0.1, "react": 1.0}),
        vibe_rule("any", "lfo", source="ratio", bin_idx=2, cal=(40, 90, 140), lfo_cfg={"shape": "sine", "speed": 0.08, "react": 0.6, "smoothing": 0.9})
    ],
    [                                        # CH 6: Z Rotation
        vibe_rule("chill", "lfo", source="raw", bin_idx=3, cal=(0, 64, 127), lfo_cfg={"shape": "sine", "speed": 0.02, "react": 0.2, "smoothing": 0.98}),
        vibe_rule("mid", "static", val=195),
        vibe_rule("high", "direct", source="flux", cal=(192, 208, 223), audio_cfg={"smoothing": 0.5, "react": 1.0}),
        vibe_rule("drop", "static", val=250),
        vibe_rule("any", "static", val=64)
    ],
    [                                        # CH 7: X Position (32-96 Safe)
        vibe_rule("any", "lfo", source="raw", cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.02, "react": 0.15, "smoothing": 0.98}),
        vibe_rule("drop", "lfo", source="raw", cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.02, "react": 0.1, "smoothing": 0.99}),
        vibe_rule("high", "lfo", source="flux", cal=(128, 159, 191), lfo_cfg={"shape": "sine", "speed": 0.05, "react": 0.8, "smoothing": 0.9})
    ],
    [                                        # CH 8: Y Position (32-96 Safe)
        vibe_rule("any", "lfo", source="raw", cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.02, "react": 0.15, "invert": True, "smoothing": 0.98}),
        vibe_rule("drop", "lfo", source="raw", cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.02, "react": 0.1, "invert": True, "smoothing": 0.99}),
        vibe_rule("high", "lfo", source="flux", cal=(128, 159, 191), lfo_cfg={"shape": "sine", "speed": 0.05, "react": 0.8, "invert": True, "smoothing": 0.9})
    ],
    [                                        # CH 9: X Rotation (Tilt)
        vibe_rule("any", "static", val=0),
        vibe_rule("high", "lfo", source="flux", cal=(0, 48, 127), lfo_cfg={"shape": "sine", "speed": 0.1, "react": 0.9})
    ],
    [                                        # CH 10: Y Rotation (Tilt)
        vibe_rule("any", "static", val=0),
        vibe_rule("high", "lfo", source="flux", cal=(0, 48, 127), lfo_cfg={"shape": "sine", "speed": 0.08, "react": 0.6, "invert": True})
    ],
    [                                        # CH 11: Colors Multi
        vibe_rule("any", "direct", source="ratio", bin_idx=4, cal=(0, 127, 255), audio_cfg={"smoothing": 0.7, "threshold": 0.1, "react": 0.8})
    ],
    [                                        # CH 12: Colors Solid
        vibe_rule("chill", "static", val=90),
        vibe_rule("mid", "static", val=127),
        vibe_rule("high", "static", val=200),
        vibe_rule("drop", "static", val=255),
        vibe_rule("any", "static", val=127)
    ],
    [                                        # CH 13: Dots
        vibe_rule("chill", "static", val=0),
        vibe_rule("any", "direct", source="attack", bin_idx=3, cal=(0, 0, 60), audio_cfg={"smoothing": 0.5, "threshold": 0.4, "react": 0.6})
    ],
    [                                        # CH 14: Latency
        vibe_rule("any", "lfo", source="ratio", bin_idx=2, cal=(192, 210, 228), lfo_cfg={"shape": "sine", "speed": 0.08, "react": 0.3, "smoothing": 0.9})
    ],
    [                                        # CH 15: Drawing
        vibe_rule("any", "direct", source="flux", bin_idx=0, cal=(0, 80, 200), audio_cfg={"smoothing": 0.6, "threshold": 0.2, "react": 0.7})
    ],
    [                                        # CH 16: Twist
        vibe_rule("any", "static", val=0),
        vibe_rule("high", "direct", source="flux", bin_idx=5, cal=(0, 40, 100), audio_cfg={"smoothing": 0.5, "threshold": 0.3, "react": 0.8}),
        vibe_rule("drop", "direct", source="flux", bin_idx=5, cal=(0, 80, 180), audio_cfg={"smoothing": 0.3, "react": 1.0})
    ],
    [                                        # CH 17: Grating
        vibe_rule("any", "static", val=0),
        vibe_rule("drop", "direct", source="attack", cal=(0, 50, 120), audio_cfg={"smoothing": 0.3, "react": 1.0})
    ]
]


# ═══════════════════════════════════════════════════════════════════════
#  PROFILE 2: RHYTHM — PERCUSSIVE / BEAT (GOLD STANDARD)
# ═══════════════════════════════════════════════════════════════════════
rhythm_mappings = [
    [vibe_rule("any", "static", val=215)],   # CH 1: Dimmer
    [vibe_rule("any", "static", val=127)],   # CH 2: Boundary (Static 127)
    [vibe_rule("any", "static", val=250)],   # CH 3: Group
    [                                        # CH 4: Pattern
        vibe_rule("chill", "cycle", source="bar", cal=(32, 40, 48)),
        vibe_rule("mid", "cycle", source="bar", cal=(8, 22, 35)),
        vibe_rule("high", "cycle", source="beat", cal=(43, 46, 49)),
        vibe_rule("drop", "static", val=15),
        vibe_rule("any", "cycle", source="bar", cal=(8, 22, 35))
    ],
    [                                        # CH 5: Zoom
        vibe_rule("chill", "lfo", source="raw", cal=(25, 50, 80), lfo_cfg={"shape": "sine", "speed": 0.05, "react": 0.3, "smoothing": 0.95}),
        vibe_rule("mid", "direct", source="bass", cal=(30, 70, 160), audio_cfg={"smoothing": 0.3, "threshold": 0.15, "react": 1.0}),
        vibe_rule("high", "direct", source="bass", cal=(40, 100, 210), audio_cfg={"smoothing": 0.2, "threshold": 0.1, "react": 1.0}),
        vibe_rule("drop", "direct", source="bass", cal=(60, 130, 250), audio_cfg={"smoothing": 0.15, "threshold": 0.05, "react": 1.0}),
        vibe_rule("any", "direct", source="bass", cal=(30, 70, 160), audio_cfg={"smoothing": 0.3, "threshold": 0.15, "react": 1.0})
    ],
    [                                        # CH 6: Z Rotation
        vibe_rule("any", "direct", source="beat", cal=(0, 64, 127), audio_cfg={"smoothing": 0.3, "react": 0.5}),
        vibe_rule("mid", "static", val=220),
        vibe_rule("high", "static", val=250),
        vibe_rule("drop", "direct", source="beat", cal=(192, 224, 255), audio_cfg={"smoothing": 0.1, "react": 1.0})
    ],
    [                                        # CH 7: X Position
        vibe_rule("any", "static", val=64),
        vibe_rule("drop", "static", val=64),
        vibe_rule("mid", "lfo", source="bass", cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.1, "react": 0.4, "smoothing": 0.9}),
        vibe_rule("high", "direct", source="beat", cal=(192, 224, 255), audio_cfg={"smoothing": 0.1, "threshold": 0.0, "react": 1.0})
    ],
    [                                        # CH 8: Y Position
        vibe_rule("any", "static", val=64),
        vibe_rule("drop", "static", val=64),
        vibe_rule("mid", "lfo", source="bass", cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.1, "react": 0.4, "invert": True, "smoothing": 0.9}),
        vibe_rule("high", "direct", source="beat", cal=(192, 224, 255), audio_cfg={"smoothing": 0.1, "threshold": 0.0, "react": 1.0})
    ],
    [                                        # CH 9: X Rotation (Tilt)
        vibe_rule("any", "static", val=0),
        vibe_rule("high", "direct", source="beat", cal=(0, 64, 127), audio_cfg={"smoothing": 0.2, "react": 0.9})
    ],
    [                                        # CH 10: Y Rotation (Tilt)
        vibe_rule("any", "static", val=0),
        vibe_rule("high", "direct", source="beat", cal=(0, 64, 127), audio_cfg={"smoothing": 0.4, "react": 0.6, "invert": True})
    ],
    [                                        # CH 11: Color Multi
        vibe_rule("any", "direct", source="attack", bin_idx=1, cal=(64, 127, 255), audio_cfg={"smoothing": 0.4, "react": 0.9})
    ],
    [                                        # CH 12: Color Solid
        vibe_rule("any", "direct", source="beat", bin_idx=0, cal=(63, 63, 145), audio_cfg={"smoothing": 0.1, "react": 1.0})
    ],
    [vibe_rule("any", "static", val=127)], # CH 13: Dots
    [                                        # CH 14: Latency
        vibe_rule("any", "lfo", source="attack", bin_idx=2, cal=(192, 210, 230), lfo_cfg={"speed": 0.15, "react": 0.7})
    ],
    [                                        # CH 15: Drawing
        vibe_rule("any", "lfo", source="attack", bin_idx=1, cal=(170, 200, 230), lfo_cfg={"speed": 0.15, "react": 0.6})
    ],
    [                                        # CH 16: Twist
        vibe_rule("chill", "static", val=0),
        vibe_rule("any", "direct", source="flux", cal=(0, 0, 80), audio_cfg={"smoothing": 0.3, "threshold": 0.4, "react": 1.0})
    ],
    [                                        # CH 17: Grating
        vibe_rule("any", "static", val=0),
        vibe_rule("high", "direct", source="attack", cal=(0, 30, 90), audio_cfg={"smoothing": 0.2, "react": 1.0}),
        vibe_rule("drop", "direct", source="attack", cal=(0, 60, 130), audio_cfg={"smoothing": 0.15, "react": 1.0})
    ]
]


# ═══════════════════════════════════════════════════════════════════════
#  INJECT INTO CONFIG
# ═══════════════════════════════════════════════════════════════════════

def build_profile(id, name, mappings):
    return {
        "id": id,
        "name": name,
        "fixtureId": FIXTURE_ID,
        "mappings": mappings
    }

# Replace or add profiles
p_melody = build_profile("prof_ehaho_melody", "Ehaho Melody", melody_mappings)
p_rhythm = build_profile("prof_ehaho_rhythm", "Ehaho Rhythm", rhythm_mappings)

config["profiles"] = [p for p in config["profiles"] if p["id"] not in ["prof_ehaho_melody", "prof_ehaho_rhythm"]]
config["profiles"].extend([p_melody, p_rhythm])

# Assign to stage
stage_map = {
    "Left1": "prof_ehaho_melody",
    "Right1": "prof_ehaho_melody",
    "Top1": "prof_ehaho_melody",
    "Left2": "prof_ehaho_rhythm",
    "Right2": "prof_ehaho_rhythm",
    "Top2": "prof_ehaho_melody_b"
}

for fix in config["stage"]:
    if fix["id"] in stage_map:
        fix["profileId"] = stage_map[fix["id"]]
        if fix["profileId"] == "prof_ehaho_melody_b":
             fix["profileName"] = "Ehaho Melody B"
        else:
             fix["profileName"] = next(p["name"] for p in config["profiles"] if p["id"] == fix["profileId"])

with open(CONFIG_PATH, 'w') as f:
    json.dump(config, f, indent=2)

print(f"✅ MELODY RESTORED (Gold Standard)")
print(f"✅ RHYTHM RESTORED (Gold Standard)")
for s_id, p_id in stage_map.items():
    print(f"   {s_id}: {p_id}")

print("\n🎵 Hot-reloading DMX engine...")
