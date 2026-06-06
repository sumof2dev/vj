import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

def test_inverse_actual():
    engine = DMXEngine()
    
    # Mock audio state
    audio = {
        'vol': 1.0,
        'vibe': 'mid',
        'transient': 'steady'
    }
    
    # Inverse range rule (100 to 0)
    rule = {
        'behavior': 'direct',
        'source': 'volume',
        'modifiers': {'react': 1.0, 'gain': 1.0},
        'cal': {'min': 100, 'center': 50, 'max': 0}
    }
    
    # Test loud (E = 1.0)
    st_loud = {}
    val_loud = engine._apply_rule_math(rule, st_loud, engine.logic, 0.016, audio={'vol': 1.0, 'vibe': 'mid'})
    
    # Test quiet (E = 0.0)
    st_quiet = {}
    val_quiet = engine._apply_rule_math(rule, st_quiet, engine.logic, 0.016, audio={'vol': 0.0, 'vibe': 'mid'})
    
    print(f"Actual Engine Inverse Range (100 to 0) direct mapping:")
    print(f"  Quietest (E=0.0): DMX = {val_quiet} (Expected: 100)")
    print(f"  Loudest (E=1.0): DMX = {val_loud} (Expected: 0)")

if __name__ == '__main__':
    test_inverse_actual()
