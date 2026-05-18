import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()
engine._preset_sweep_phases = {}
engine._processed_phases_this_frame = set()

ov_key = "test_key"
dt = 0.016 * 0.6  # typical _eff_dt
for i in range(10):
    engine._processed_phases_this_frame.clear()
    val = engine._resolve_preset_value(ov_key, "32-96-32 + 32", dt)
    print(f"Frame {i}: phase={engine._preset_sweep_phases[ov_key]:.3f}, val={val}")
