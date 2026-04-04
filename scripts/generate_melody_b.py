#!/usr/bin/env python3
"""
Create a melody variant profile for Top2 and update stage assignment.
Top1 + Top2 should both be melodic but with positional differentiation.
Uses the ProfileFactory for automated desynchronization.
"""
import json, copy
from profile_factory import ProfileFactory

CONFIG_PATH = "/home/sumof2/vj/fixtures/ravebox_config.json"
FIXTURE_ID = "fix_1774209417123"

with open(CONFIG_PATH) as f:
    config = json.load(f)

# ═══════════════════════════════════════════════════════════════════════
#  PROFILE 3: MELODY B — TOP2 HARMONIC (GOLD STANDARD)
# ═══════════════════════════════════════════════════════════════════════

def vibe_rule(vibe, behavior, source=None, val=None, cal=None, bin_idx=0, lfo_cfg=None, audio_cfg=None):
    r = {"vibe": vibe, "behavior": behavior}
    if source: r["source"] = source
    if val is not None: r["value"] = val
    if bin_idx: r["bin_idx"] = bin_idx
    if cal: r["cal"] = {"min": cal[0], "center": cal[1], "max": cal[2]}
    if lfo_cfg: r["lfo"] = lfo_cfg
    if audio_cfg: r["audio"] = audio_cfg
    return r

melody_b_mappings = [
    [vibe_rule("any", "static", val=215)],   # CH 1: Dimmer
    [vibe_rule("any", "static", val=0)],     # CH 2: Boundary
    [vibe_rule("any", "static", val=250)],   # CH 3: Group
    [                                        # CH 4: Pattern (Variant)
        vibe_rule("chill", "cycle", source="bar", cal=(21, 24, 28)),
        vibe_rule("mid", "cycle", source="bar", cal=(1, 27, 54)),
        vibe_rule("high", "static", val=51),
        vibe_rule("drop", "static", val=28),
        vibe_rule("any", "cycle", source="bar", cal=(1, 27, 54))
    ],
    [                                        # CH 5: Zoom (Harmonic Offset)
        vibe_rule("chill", "lfo", source="ratio", bin_idx=3, cal=(50, 80, 110), lfo_cfg={"shape": "sine", "speed": 0.05, "react": 0.5, "smoothing": 0.95}),
        vibe_rule("mid", "lfo", source="ratio", bin_idx=3, cal=(50, 100, 155), lfo_cfg={"shape": "sine", "speed": 0.07, "react": 0.6, "smoothing": 0.9}),
        vibe_rule("high", "lfo", source="ratio", bin_idx=3, cal=(70, 130, 190), lfo_cfg={"shape": "sine", "speed": 0.09, "react": 0.7, "smoothing": 0.85}),
        vibe_rule("drop", "direct", source="flux", cal=(90, 160, 230), audio_cfg={"smoothing": 0.65, "threshold": 0.1, "react": 1.0}),
        vibe_rule("any", "lfo", source="ratio", bin_idx=3, cal=(50, 100, 155), lfo_cfg={"shape": "sine", "speed": 0.07, "react": 0.6, "smoothing": 0.9})
    ],
    [                                        # CH 6: Z Rotation
        vibe_rule("chill", "lfo", source="raw", bin_idx=4, cal=(0, 64, 127), lfo_cfg={"shape": "sine", "speed": 0.025, "react": 0.2, "smoothing": 0.98, "invert": True}),
        vibe_rule("mid", "static", val=224),
        vibe_rule("high", "direct", source="flux", cal=(224, 240, 255), audio_cfg={"smoothing": 0.5, "react": 1.0}),
        vibe_rule("drop", "static", val=200)
    ],
    [                                        # CH 7: X Position (Harmonic Offset)
        vibe_rule("any", "lfo", source="raw", bin_idx=1, cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.02, "react": 0.15, "invert": True, "smoothing": 0.98}),
        vibe_rule("drop", "lfo", source="raw", bin_idx=1, cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.02, "react": 0.1, "invert": True, "smoothing": 0.99}),
        vibe_rule("high", "lfo", source="flux", cal=(128, 159, 191), lfo_cfg={"shape": "sine", "speed": 0.05, "react": 0.8, "invert": True, "smoothing": 0.9})
    ],
    [                                        # CH 8: Y Position (Harmonic Offset)
        vibe_rule("any", "lfo", source="raw", bin_idx=1, cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.02, "react": 0.15, "smoothing": 0.98}),
        vibe_rule("drop", "lfo", source="raw", bin_idx=1, cal=(32, 64, 96), lfo_cfg={"shape": "sine", "speed": 0.02, "react": 0.1, "smoothing": 0.99}),
        vibe_rule("high", "lfo", source="flux", cal=(128, 159, 191), lfo_cfg={"shape": "sine", "speed": 0.05, "react": 0.8, "smoothing": 0.9})
    ],
    [                                        # CH 9: X Rotation (Tilt)
        vibe_rule("any", "static", val=0),
        vibe_rule("high", "lfo", source="flux", cal=(0, 64, 127), lfo_cfg={"shape": "sine", "speed": 0.12, "react": 0.85})
    ],
    [                                        # CH 10: Y Rotation (Tilt)
        vibe_rule("any", "static", val=0),
        vibe_rule("high", "lfo", source="flux", cal=(0, 64, 127), lfo_cfg={"shape": "sine", "speed": 0.09, "react": 0.7, "invert": True})
    ],
    [                                        # CH 11: Color Multi
        vibe_rule("any", "direct", source="ratio", bin_idx=3, cal=(0, 127, 255), audio_cfg={"smoothing": 0.7, "threshold": 0.1, "react": 0.8})
    ],
    [                                        # CH 12: Color Solid
        vibe_rule("chill", "static", val=160),
        vibe_rule("mid", "static", val=180),
        vibe_rule("high", "static", val=220),
        vibe_rule("drop", "static", val=240),
        vibe_rule("any", "static", val=180)
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

# ─── Injection ─────────────────────────────────────────────────────

variant = {
    "id": "prof_ehaho_melody_b",
    "name": "Ehaho Melody B",
    "fixtureId": FIXTURE_ID,
    "mappings": melody_b_mappings
}

# Add variant profile
config["profiles"] = [p for p in config["profiles"] if p["id"] != variant["id"]]
config["profiles"].append(variant)

# Assign to stage
top2 = next((f for f in config["stage"] if f["id"] == "Top2"), None)
if top2:
    top2["profileId"] = variant["id"]
    top2["profileName"] = variant["name"]

with open(CONFIG_PATH, 'w') as f:
    json.dump(config, f, indent=2)

print(f"✅ MELODY B RESTORED (Gold Standard Offset)")
for inst in config["stage"]:
    if inst["fixtureId"] == FIXTURE_ID:
        print(f"   {inst['id']}: {inst['profileName']}")

print("\n🎵 Top2 variant injected. Engine will hot-reload.")
