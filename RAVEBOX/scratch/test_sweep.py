import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()

# Test 1: Standard sweep
engine._preset_sweep_phases = {}
engine._processed_phases_this_frame = set()
print("--- Standard Sweep: 32-96-32 + 32 ---")
ov_key = "std_key"
dt = 0.016 * 0.6
for i in range(5):
    engine._processed_phases_this_frame.clear()
    val = engine._resolve_preset_value(ov_key, "32-96-32 + 32", dt)
    print(f"Frame {i}: phase={engine._preset_sweep_phases[ov_key]:.3f}, val={val:.3f}")

# Test 2: Double speed sweep
engine._preset_sweep_phases = {}
engine._processed_phases_this_frame = set()
print("\n--- Double Speed Sweep: 32-96-32x2 + 32 ---")
ov_key = "x2_key"
for i in range(5):
    engine._processed_phases_this_frame.clear()
    val = engine._resolve_preset_value(ov_key, "32-96-32x2 + 32", dt)
    print(f"Frame {i}: phase={engine._preset_sweep_phases[ov_key]:.3f}, val={val:.3f}")

# Test 3: Half speed sweep
engine._preset_sweep_phases = {}
engine._processed_phases_this_frame = set()
print("\n--- Half Speed Sweep: 32-96-32x0.5 + 32 ---")
ov_key = "x0.5_key"
for i in range(5):
    engine._processed_phases_this_frame.clear()
    val = engine._resolve_preset_value(ov_key, "32-96-32x0.5 + 32", dt)
    print(f"Frame {i}: phase={engine._preset_sweep_phases[ov_key]:.3f}, val={val:.3f}")
