import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from dmx_engine import DMXEngine

def test_preset_logic():
    engine = DMXEngine()
    
    # Define a test preset with two triggers: Vibe 'chill' and Volume < 10%
    test_preset = {
        "id": "test_1",
        "name": "Test AND Logic",
        "active": True,
        "triggers": [
            {"type": "vibe", "value": "chill"},
            {"type": "volume", "less_than": 10, "greater_than": 0}
        ],
        "overrides": []
    }
    
    engine.presets = [test_preset]
    
    # Test Case 1: Both Match (Vibe: chill, Vol: 0.05)
    audio_both = {"vibe": "chill", "vol": 0.05, "transient": "steady"}
    engine.update(0.016, audio_both)
    print(f"Test 1 (Both Match): {'PASS' if 'test_1' in [p['id'] for p in engine.active_presets] else 'FAIL'}")
    
    # Test Case 2: Only Vibe matches (Vibe: chill, Vol: 0.5)
    audio_vibe_only = {"vibe": "chill", "vol": 0.5, "transient": "steady"}
    engine.update(0.016, audio_vibe_only)
    print(f"Test 2 (Vibe Only): {'PASS' if 'test_1' not in [p['id'] for p in engine.active_presets] else 'FAIL'}")
    
    # Test Case 3: Only Volume matches (Vibe: mid, Vol: 0.05)
    audio_vol_only = {"vibe": "mid", "vol": 0.05, "transient": "steady"}
    engine.update(0.016, audio_vol_only)
    print(f"Test 3 (Volume Only): {'PASS' if 'test_1' not in [p['id'] for p in engine.active_presets] else 'FAIL'}")
    
    # Test Case 4: Neither matches (Vibe: high, Vol: 0.8)
    audio_neither = {"vibe": "high", "vol": 0.8, "transient": "steady"}
    engine.update(0.016, audio_neither)
    print(f"Test 4 (Neither): {'PASS' if 'test_1' not in [p['id'] for p in engine.active_presets] else 'FAIL'}")

    # Test Case 5: Empty triggers (Should be FALSE)
    test_preset_empty = {
        "id": "test_empty",
        "name": "Test Empty",
        "active": True,
        "triggers": [],
        "overrides": []
    }
    engine.presets = [test_preset_empty]
    engine.update(0.016, audio_both)
    print(f"Test 5 (Empty Triggers): {'PASS' if 'test_empty' not in [p['id'] for p in engine.active_presets] else 'FAIL'}")

if __name__ == "__main__":
    test_preset_logic()
