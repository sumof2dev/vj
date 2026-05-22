import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()
engine.toggle_manual_preset("pre_1776634477766", True)
audio = {'vibe': 'chill', 'vol': 0.1, 'bins': [0.1]*6}

print("\n--- Testing Manual Activation ---")
px_addr, py_addr = -1, -1
for inst in engine.stage_instances:
    if inst['id'] == 'LeftMel':
        base_addr = int(inst.get('address', 1)) + int(inst.get('offset', 0))
        for ch_idx, ch in enumerate(engine.profiles[inst['profileId']]['channels']):
            if ch.get('role', '') == 'pos_x': px_addr = base_addr + ch_idx
            if ch.get('role', '') == 'pos_y': py_addr = base_addr + ch_idx

print(f"Addresses: pos_x={px_addr}, pos_y={py_addr}")

for i in range(5):
    engine.update(0.016, audio)
    u = engine.get_universe()
    print(f"Frame {i}: DMX[pos_x]={u[px_addr]}, DMX[pos_y]={u[py_addr]}")
