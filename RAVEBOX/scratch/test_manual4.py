import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()
engine.toggle_manual_preset("pre_1776634477766", True)
audio = {'vibe': 'chill', 'vol': 0.1, 'bins': [0.1]*6}

print("\n--- Testing Manual Activation ---")
prev_u = list(engine.get_universe())

for i in range(15):
    engine.update(0.016, audio)
    u = list(engine.get_universe())
    diffs = []
    for addr in range(len(u)):
        if u[addr] != prev_u[addr] and u[addr] != 0:
            diffs.append(f"DMX[{addr}]: {u[addr]}")
    
    if diffs:
        print(f"Frame {i}: " + ", ".join(diffs))
    else:
        print(f"Frame {i}: No change")
    prev_u = u

