
import sys
import os
import time
from collections import deque

# Add the backend to path
sys.path.append('/home/sumof2/vj/backend')
from vibe_engine import VibeEngine

def test_vibe_bpm():
    engine = VibeEngine()
    engine.mid_vibe_bias = 0.4
    
    # Target density for 160 BPM: 5.6 + (6.0 * 0.4) = 8.0
    # Density is count of beats in last 3 seconds.
    
    now = 1000.0 # Arbitrary start time
    
    # 1. Test 140 BPM (Below threshold)
    # 140 BPM = 2.33 bps = 7 beats in 3 seconds.
    print("Testing 140 BPM (should be 'mid')...")
    beats = []
    # Fill 3 seconds with 7 beats evenly spaced
    for i in range(7):
        beats.append(now + (i * (3.0 / 7.0)))
    
    # Update engine with these beats
    for b in beats:
        audio_state = {'beat': True, 'vol': 0.4, 'spectral_complexity': 0.3}
        engine.update(audio_state, now=b)
        # Clear 'beat' flag for subsequent silent updates if any
    
    # Final check at the end of the window
    res = engine.update({'vol': 0.4, 'spectral_complexity': 0.3}, now=now + 3.0)
    print(f"Result: {res['vibe']}")
    if res['vibe'] == 'high':
        print("FAIL: Triggers HIGH too early")
    else:
        print("PASS: Stayed MID")

    print("-" * 20)

    # 2. Test 160 BPM (At threshold)
    # 160 BPM = 2.66 bps = 8 beats in 3 seconds.
    print("Testing 160 BPM (should be 'high')...")
    engine = VibeEngine() # Fresh engine
    engine.mid_vibe_bias = 0.4
    beats = []
    for i in range(8):
        beats.append(now + (i * (3.0 / 8.0)))
    
    for b in beats:
        audio_state = {'beat': True, 'vol': 0.4, 'spectral_complexity': 0.3}
        engine.update(audio_state, now=b)
    
    res = engine.update({'vol': 0.4, 'spectral_complexity': 0.3}, now=now + 3.001)
    print(f"Result: {res['vibe']}")
    if res['vibe'] == 'high':
        print("PASS: Triggers HIGH correctly")
    else:
        print("FAIL: Did not trigger HIGH at 160 BPM")

if __name__ == "__main__":
    test_vibe_bpm()
