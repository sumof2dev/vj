import sys
import os
import time

# Add backend to path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

from dmx_engine import DMXEngine

def test_system_actor():
    engine = DMXEngine()
    
    # Define a System Preset: speed pulses to 200% on high volume
    engine.presets = [
        {
            "id": "warp_test",
            "name": "Warp Speed",
            "trigger": {"category": "vibe", "value": "high"},
            "overrides": [
                {
                    "target": "system",
                    "channels": [
                        {"name": "speed", "value": "200"}
                    ]
                }
            ]
        }
    ]
    
    # 1. Test Chill (Standard Speed)
    audio_chill = {"vibe": "chill", "vol": 0.5, "bins": [0.5]*6}
    engine.update(0.016, audio_chill)
    print(f"Chill State: eff_speed={engine.eff_speed:.2f} (Expected: 0.60)")
    
    # 2. Test High (Warp Speed)
    audio_high = {"vibe": "high", "vol": 0.5, "bins": [0.5]*6}
    engine.update(0.016, audio_high)
    print(f"High State: eff_speed={engine.eff_speed:.2f} (Expected: 1.20)")
    
    # 3. Test Intensity
    engine.presets[0]["overrides"][0]["channels"].append({"name": "intensity", "value": "50"})
    engine.update(0.016, audio_high)
    print(f"Warp + Dim: eff_intensity={engine.eff_intensity:.2f} (Expected: 0.50)")

if __name__ == "__main__":
    test_system_actor()
