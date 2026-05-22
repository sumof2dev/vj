
import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from dmx_engine import LogicMatrix, DMXEngine

def test_gain():
    engine = DMXEngine()
    
    # Mock audio state
    audio = {
        'vol': 1.0, # Max volume
        'vibe': 'mid',
        'transient': 'steady'
    }
    engine.logic.update(0.016, audio, 'steady')
    engine.eff_intensity = 1.0
    
    # Rule with gain = 1.0 (Full range)
    # y = (E * 1.0 * 2.0) - 1.0 = (1.0 * 2.0) - 1.0 = 1.0
    # final_dmx = 127.5 + (1.0 * 127.5) = 255
    rule_full = {
        'behavior': 'direct',
        'source': 'volume',
        'modifiers': {'react': 1.0, 'gain': 1.0},
        'cal': {'min': 0, 'center': 127, 'max': 255}
    }
    
    # Rule with gain = 0.5 (Half range)
    # y = (1.0 * 1.0 * 2.0) - 1.0 = 1.0
    # y_with_gain = 1.0 * 0.5 = 0.5
    # final_dmx = 127.5 + (0.5 * 127.5) = 191.25 -> 191
    rule_half = {
        'behavior': 'direct',
        'source': 'volume',
        'modifiers': {'react': 1.0, 'gain': 0.5},
        'cal': {'min': 0, 'center': 127, 'max': 255}
    }

    # Rule with small range (120-130) and gain = 0.1
    # y = 1.0
    # y_with_gain = 0.1
    # eff_center = 125, eff_max = 130
    # final_dmx = 125 + (0.1 * 5) = 125.5 -> 125
    rule_small = {
        'behavior': 'direct',
        'source': 'volume',
        'modifiers': {'react': 1.0, 'gain': 0.1},
        'cal': {'min': 120, 'center': 125, 'max': 130}
    }

    st = {}
    val_full = engine._apply_rule_math(rule_full, st, engine.logic, 0.016, audio=audio)
    st = {}
    val_half = engine._apply_rule_math(rule_half, st, engine.logic, 0.016, audio=audio)
    st = {}
    val_small = engine._apply_rule_math(rule_small, st, engine.logic, 0.016, audio=audio)

    print(f"Full Gain (1.0): {val_full} (Expected: 255)")
    print(f"Half Gain (0.5): {val_half} (Expected: 191)")
    print(f"Small Range (0.1): {val_small} (Expected: 125/126)")

    assert val_full == 255
    assert val_half == 191
    assert val_small in [125, 126]
    print("✅ GAIN LOGIC VERIFIED")

if __name__ == "__main__":
    test_gain()
