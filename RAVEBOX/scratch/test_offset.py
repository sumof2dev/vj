import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()
engine._preset_sweep_phases = {}
engine._processed_phases_this_frame = set()

ov_key_x = "circle_x"
ov_key_y = "circle_y"
dt = 0.016 * 0.6

print("--- Circle Trace X: 20-100-20 ---")
for i in range(5):
    engine._processed_phases_this_frame.clear()
    val_x = engine._resolve_preset_value(ov_key_x, "20-100-20", dt)
    print(f"Frame {i}: phase={engine._preset_sweep_phases[ov_key_x]:.3f}, val={val_x:.3f}")

print("\n--- Circle Trace Y: 10-90-10 + 16 ---")
for i in range(5):
    engine._processed_phases_this_frame.clear()
    val_y = engine._resolve_preset_value(ov_key_y, "10-90-10 + 16", dt)
    print(f"Frame {i}: phase={engine._preset_sweep_phases[ov_key_y]:.3f}, val={val_y:.3f}")
