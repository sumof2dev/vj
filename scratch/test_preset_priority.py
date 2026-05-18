import sys
import os
import time

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.dmx_engine import DMXEngine

def run_test():
    engine = DMXEngine()
    
    # Mock some data
    engine.stage_instances = [
        {"id": "fix1", "address": 1, "profileId": "p1"}
    ]
    engine.profiles = {
        "p1": {
            "id": "p1",
            "channels": [{"role": "dimmer"}]
        }
    }
    
    engine.presets = [
        {
            "id": "sustained_manual",
            "name": "Wash",
            "decay": 9999, # Sustained
            "overrides": [{"type": "instance", "id": "fix1", "role": "dimmer", "channels": [{"role": "dimmer", "value": 128}]}]
        },
        {
            "id": "one_shot_auto",
            "name": "Strobe",
            "decay": 0, # One-shot
            "trigger": {"category": "volume", "value": "loud", "range": 5},
            "overrides": [{"type": "instance", "id": "fix1", "role": "dimmer", "channels": [{"role": "dimmer", "value": 255}]}]
        }
    ]
    
    # Set manual preset active
    engine.manual_active_presets = {"sustained_manual"}
    
    # Simulate an update without loud volume
    audio_quiet = {"vol": 0.5, "vibe": "mid", "transient": "steady"}
    engine.update(0.016, audio_quiet)
    
    print(f"Quiet - Channel 1 Value: {engine.universe[1]} (Expected 128 from sustained_manual)")
    
    # Simulate an update WITH loud volume to trigger the one-shot
    audio_loud = {"vol": 1.0, "vibe": "mid", "transient": "steady"}
    engine.update(0.016, audio_loud)
    
    print(f"Loud - Channel 1 Value: {engine.universe[1]} (Expected 255 from one_shot_auto overriding sustained_manual)")
    
    # If the fix works, it will output 128 then 255.
    
if __name__ == "__main__":
    run_test()
