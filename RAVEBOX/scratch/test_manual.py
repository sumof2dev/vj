import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()

# Trigger Lissajous Movement manually
engine.toggle_manual_preset("pre_1776634477766", True)

# We will test with a CHILL vibe so NO automated presets trigger and mask it!
audio = {'vibe': 'chill', 'vol': 0.1, 'bins': [0.1]*6}

print("\n--- Testing Manual Activation of Lissajous Movement ---")
for inst in engine.stage_instances:
    if inst['id'] == 'LeftMel':
        base_addr = int(inst.get('address', 1)) + int(inst.get('offset', 0))
        for ch_idx, ch in enumerate(engine.profiles[inst['profileId']]['channels']):
            if ch.get('role', '') in ('pos_x', 'pos_y'):
                addr = base_addr + ch_idx
                print(f"Tracking {inst['id']} {ch.get('role')} at addr {addr}")

for i in range(5):
    engine.update(0.016, audio)
    u = engine.get_universe()
    print(f"Frame {i}: DMX[pos_x]={u[3]}, DMX[pos_y]={u[5]}")  # Assuming addrs

