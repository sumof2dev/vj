import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()
# Find LeftMel pos_x addr
addr = -1
for inst in engine.stage_instances:
    if inst['id'] == 'LeftMel':
        profile = engine.profiles.get(inst.get('profileId'))
        base_addr = int(inst.get('address', 1)) + int(inst.get('offset', 0))
        for ch_idx, ch in enumerate(profile['channels']):
            if ch.get('role', '') == 'pos_x':
                addr = base_addr + ch_idx
                break

print(f"LeftMel pos_x address: {addr}")

audio = {'vibe': 'high', 'vol': 0.5, 'bins': [0.5]*6}
for i in range(5):
    engine.update(0.016, audio)
    active_names = engine.get_active_preset_names()
    print(f"Frame {i}: Active Presets: {active_names}, DMX[{addr}]={engine.universe[addr]}")
