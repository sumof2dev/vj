import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()
audio = {'vibe': 'high', 'vol': 0.5, 'bins': [0.5]*6}
engine.update(0.016, audio)
auto_sustained = [p['name'] for p in engine.presets if int(p.get('decay', 0)) > 0]
print(f"All Decay > 0 Presets: {auto_sustained}")

# Let's see what triggers eval to
for p in engine.presets:
    if p['name'] == 'Lissajous Movement':
        print(f"Lissajous Active flag in JSON: {p.get('active')}")
        for trig in p.get('triggers', []):
            t_cat = trig.get('category') or trig.get('type')
            t_val = trig.get('vibe', trig.get('value'))
            print(f"Trigger: {trig}, cat={t_cat}, val={t_val}")
