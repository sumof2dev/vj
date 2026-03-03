import sys
import os
import time

sys.path.insert(0, os.path.join(os.getcwd(), 'backend'))

from main import audio_state
from dmx_engine import DMXEngine

engine = DMXEngine()

print("Engine starting...")
try:
    for _ in range(10):
        engine.update(0.033, audio_state)
        # Check specific channels
        print("DMX State:", engine.get_channel_state())
        time.sleep(0.1)
except Exception as e:
    import traceback
    traceback.print_exc()
