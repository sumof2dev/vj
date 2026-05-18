import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))
from dmx_engine import DMXEngine

engine = DMXEngine()
audio = {'vibe': 'high', 'vol': 0.5, 'bins': [0.5]*6}

# We'll just run the exact trigger loop from update()
possible_auto_presets = []
for p_data in engine.presets:
    if not p_data.get('active', True): continue
    triggers = p_data.get('triggers', [])
    is_active = len(triggers) > 0
    
    for trig in triggers:
        trig_matched = False
        t_cat = trig.get('category') or trig.get('type')
        if t_cat == 'vibe':
            t_val = trig.get('vibe', trig.get('value'))
            if t_val == 'high':
                trig_matched = True
        
        if not trig_matched:
            is_active = False
            break
            
    if is_active:
        possible_auto_presets.append(p_data['name'])

print(f"Possible: {possible_auto_presets}")
