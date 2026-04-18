import sys
import os

# Updated MockEngine to match real dmx_engine.py logic
class MockEngine:
    def __init__(self):
        self._preset_sweep_phases = {}

    def _resolve_preset_value(self, ov_key, val, dt):
        if isinstance(val, (int, float)): return int(val)
        if not isinstance(val, str): return 0
        offset = 0.0
        main_val = val
        if '+' in val:
            parts = val.rsplit('+', 1)
            main_val = parts[0].strip()
            try: offset = float(parts[1].strip())
            except: pass
        seq_parts = [p.strip() for p in main_val.split(',')]
        num_parts = len(seq_parts)
        if num_parts == 0: return 0
        if ov_key not in self._preset_sweep_phases:
            self._preset_sweep_phases[ov_key] = 0.0
        rate = 60.0 
        self._preset_sweep_phases[ov_key] += dt * rate
        part_duration = 64.0
        total_cycle = num_parts * part_duration
        eff_phase = (self._preset_sweep_phases[ov_key] + offset) % total_cycle
        part_idx = int(eff_phase // part_duration)
        local_phase = eff_phase % part_duration
        part_str = seq_parts[part_idx]
        if '-' in part_str:
            try:
                points = [float(p.strip()) for p in part_str.split('-') if p.strip()]
                num_points = len(points)
                if num_points < 2: return int(points[0]) if points else 0
                num_segments = num_points - 1
                sub_duration = part_duration / num_segments
                sub_idx = int(local_phase // sub_duration)
                sub_idx = min(sub_idx, num_segments - 1)
                sub_local_phase = local_phase % sub_duration
                v_start = points[sub_idx]
                v_end = points[sub_idx + 1]
                t = sub_local_phase / sub_duration if sub_duration > 0 else 0.0
                t = max(0.0, min(1.0, t))
                return int(v_start + t * (v_end - v_start))
            except: return 0
        try: return int(float(part_str))
        except: return 0

def test():
    engine = MockEngine()
    
    print("--- Test 1: Basic Sweep 32-96 ---")
    val = engine._resolve_preset_value("x", "32-96", 0) # t=0
    print(f"t=0: {val}")
    engine._preset_sweep_phases["x"] = 32.0
    print(f"phase=32 (mid): {engine._resolve_preset_value('x', '32-96', 0)}")
    engine._preset_sweep_phases["x"] = 63.9
    print(f"phase=63.9 (end): {engine._resolve_preset_value('x', '32-96', 0)}")

    print("\n--- Test 6: Multi-Dash Ping-Pong 32-96-32 ---")
    engine = MockEngine()
    p = "32-96-32"
    engine._preset_sweep_phases["p"] = 0
    print(f"Start (0): {engine._resolve_preset_value('p', p, 0)}")
    engine._preset_sweep_phases["p"] = 16
    print(f"Mid-Up (16): {engine._resolve_preset_value('p', p, 0)}") 
    engine._preset_sweep_phases["p"] = 32
    print(f"Peak (32): {engine._resolve_preset_value('p', p, 0)}")
    engine._preset_sweep_phases["p"] = 48
    print(f"Mid-Down (48): {engine._resolve_preset_value('p', p, 0)}")
    engine._preset_sweep_phases["p"] = 63.9
    print(f"End (63.9): {engine._resolve_preset_value('p', p, 0)}")

if __name__ == "__main__":
    test()
