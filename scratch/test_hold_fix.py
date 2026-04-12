import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from dmx_engine import DMXEngine, LogicMatrix, ChannelConfig

def test_holds():
    engine = DMXEngine()
    
    # Mock a ChannelConfig with a 'beat' hold rule
    rule_beat = {
        'behavior': 'random',
        'source': 'vol',
        'cal': {'min': 0, 'center': 127, 'max': 255},
        'modifiers': {'speed': 1.0, 'react': 0.5, 'hold_type': 'beat'}
    }
    
    # We'll use a rule that changes its 'value' to simulate different capture frames
    class MockRule(dict):
        def get(self, key, default=None):
            return super().get(key, default)

    cache = ChannelConfig(rules=[rule_beat], states={}, default_val=0)
    
    logic = LogicMatrix()
    audio = {
        'beat': False,
        'bar': False,
        'vol': 0.5,
        'beat_count': 0
    }
    logic.update(0.016, audio, 'steady')
    
    # --- TEST 1: BEAT HOLD ---
    print("Test 1: Beat Hold")
    
    # Frame 1: No beat, should be initial random value or baseline
    val1 = engine._calculate_channel(0, audio, logic, 0, cache, 'prof1')
    print(f"F1 (No Beat): {val1}")
    
    # Frame 2: Beat occurs, should pick a new value
    audio['beat'] = True
    logic.update(0.016, audio, 'steady')
    val2 = engine._calculate_channel(0, audio, logic, 0, cache, 'prof1')
    print(f"F2 (Beat ON): {val2}")
    
    # Frame 3: Beat OFF, should stay HELD at val2
    audio['beat'] = False
    logic.update(0.016, audio, 'steady')
    val3 = engine._calculate_channel(0, audio, logic, 0, cache, 'prof1')
    print(f"F3 (Beat OFF): {val3}")
    assert val2 == val3, f"Value should be held! {val2} != {val3}"
    
    # Frame 4: Next Beat occurs, should re-capture a new value
    audio['beat'] = True
    logic.update(0.016, audio, 'steady')
    val4 = engine._calculate_channel(0, audio, logic, 0, cache, 'prof1')
    print(f"F4 (Next Beat): {val4}")
    assert val4 != val3, f"Value should have changed on next beat! {val4} == {val3}"

    # --- TEST 2: GATED HOLD (FLOORFREEZE) ---
    print("\nTest 2: Gated Hold (Floorfreeze)")
    rule_gate = {
        'behavior': 'push',
        'source': 'vol',
        'cal': {'min': 0, 'center': 127, 'max': 255},
        'modifiers': {'speed': 1.0, 'react': 1.0, 'hold_type': 'floorfreeze'}
    }
    cache_gate = ChannelConfig(rules=[rule_gate], states={}, default_val=0)
    
    # Frame 1: Normal volume, should be moving
    audio['beat'] = False
    audio['vol'] = 0.5
    logic.update(0.016, audio, 'steady')
    v1 = engine._calculate_channel(0, audio, logic, 0, cache_gate, 'prof2')
    print(f"F1 (Vol 0.5): {v1}")
    
    # Frame 2: Floorfreeze (vol < 0.15)
    audio['vol'] = 0.05
    logic.update(0.016, audio, 'steady')
    v2 = engine._calculate_channel(0, audio, logic, 0, cache_gate, 'prof2')
    print(f"F2 (Vol 0.05 - FREEZE): {v2}")
    
    # Frame 3: Still Floorfreeze
    v3 = engine._calculate_channel(0, audio, logic, 0, cache_gate, 'prof2')
    print(f"F3 (Vol 0.05 - STILL FREEZE): {v3}")
    assert v2 == v3, "Value should be frozen"
    
    # Frame 4: Back to normal, should release
    audio['vol'] = 0.8
    logic.update(0.016, audio, 'steady')
    v4 = engine._calculate_channel(0, audio, logic, 0, cache_gate, 'prof2')
    print(f"F4 (Vol 0.8 - RELEASED): {v4}")
    assert v4 != v3, "Value should have changed after release"

if __name__ == "__main__":
    test_holds()
