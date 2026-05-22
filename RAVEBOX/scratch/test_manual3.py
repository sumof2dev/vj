import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()
engine.toggle_manual_preset("pre_1776634477766", True)

# We will test with a CHILL vibe so NO automated presets trigger and mask it!
audio = {'vibe': 'chill', 'vol': 0.1, 'bins': [0.1]*6}

print("\n--- Testing Manual Activation ---")

# Let's just find ANY valid address for LeftMel pos_x
addr_x, addr_y = None, None
for i, inst in enumerate(engine.stage_instances):
    if inst['id'] == 'LeftMel':
        profile = engine.profiles.get(inst.get('profileId'))
        base = int(inst.get('address', 1)) + int(inst.get('offset', 0))
        for idx, ch in enumerate(profile.get('channels', [])):
            if ch.get('role', '') == 'pos_x': addr_x = base + idx
            if ch.get('role', '') == 'pos_y': addr_y = base + idx

print(f"Addresses: pos_x={addr_x}, pos_y={addr_y}")

if addr_x:
    for i in range(10):
        engine.update(0.016, audio)
        u = engine.get_universe()
        print(f"Frame {i}: DMX[pos_x]={u[addr_x]}, DMX[pos_y]={u[addr_y]}")

