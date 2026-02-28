import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()
engine.load_fixture_profiles()
engine.load_stage_config()

audio = {'vol': 0.1, 'bass': 0.1, 'mid': 0.1, 'high': 0.1, 'vibe': 'mid', 'confidence': 1.0, 'flux': 0.1}
engine.update(1.0, audio)
val = engine.universe[161]
print(f"Universe[161] = {val}")
