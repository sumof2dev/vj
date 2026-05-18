import sys
import os

# Mock the environment or import the necessary parts
# Since I can't easily import from backend, I'll mock a minimal class with the problematic logic

class MockDMXEngine:
    def __init__(self):
        self._preset_sweep_phases = {}
        self._processed_phases_this_frame = set()
        self.universe = [0] * 512

    def _resolve_preset_value_BUGGY(self, ov_key, val_str, dt):
        """Current problematic implementation"""
        if ov_key not in self._preset_sweep_phases:
            self._preset_sweep_phases[ov_key] = 0.0
        
        rate = 60.0 
        # BUG: This increments EVERY time it's called
        self._preset_sweep_phases[ov_key] += dt * rate
        
        # Simple sweep logic for testing (0-255)
        phase = self._preset_sweep_phases[ov_key] % 255.0
        return phase

    def _resolve_preset_value_FIXED(self, ov_key, val_str, dt):
        """Proposed fix"""
        if ov_key not in self._preset_sweep_phases:
            self._preset_sweep_phases[ov_key] = 0.0
        
        # Only increment ONCE per frame per key
        if ov_key not in self._processed_phases_this_frame:
            rate = 60.0
            self._preset_sweep_phases[ov_key] += dt * rate
            self._processed_phases_this_frame.add(ov_key)
        
        phase = self._preset_sweep_phases[ov_key] % 255.0
        return phase

def run_test():
    engine = MockDMXEngine()
    dt = 0.016 # 60fps approx
    ov_key = "test_preset_pos_x_fixture1"
    
    print("--- TESTING BUGGY LOGIC (2 channels same role) ---")
    engine._preset_sweep_phases = {ov_key: 0.0}
    for frame in range(10):
        # Channel 1
        p1 = engine._resolve_preset_value_BUGGY(ov_key, "0-255", dt)
        # Channel 2
        p2 = engine._resolve_preset_value_BUGGY(ov_key, "0-255", dt)
        print(f"Frame {frame}: Phase = {p1:.2f} (Next: {p2:.2f}) - Delta: {p2-p1:.2f}")

    print("\n--- TESTING FIXED LOGIC (2 channels same role) ---")
    engine._preset_sweep_phases = {ov_key: 0.0}
    for frame in range(10):
        engine._processed_phases_this_frame.clear()
        # Channel 1
        p1 = engine._resolve_preset_value_FIXED(ov_key, "0-255", dt)
        # Channel 2
        p2 = engine._resolve_preset_value_FIXED(ov_key, "0-255", dt)
        print(f"Frame {frame}: Phase1 = {p1:.2f}, Phase2 = {p2:.2f} - Delta: {p2-p1:.2f}")

if __name__ == "__main__":
    run_test()
