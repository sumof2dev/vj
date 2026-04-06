import sys
import os
import time

from backend.dmx_engine import DMXEngine

engine = DMXEngine()
# Give it a moment to load
time.sleep(1)

# Fake audio input with beats
audio_data = {
    'vibe': 'high',
    'transient': 'steady',
    'beat': False,
    'beat_count': 0,
    # Need other fields so we don't crash
    'bins': [0.5]*6,
    'ratios': [0.5]*6,
    'attacks': [0.5]*6
}

print("Simulating beats for vibe=high...")
for i in range(20): # Simulate 20 frames
    # Trigger beat every 4 frames
    is_beat = (i % 4 == 0)
    audio_data['beat'] = is_beat
    if is_beat:
        audio_data['beat_count'] += 1
        
    engine.update(0.016, audio_data)
    
    # Observe channel 3 (PATTERN SELECTIONS) which has source='beat', behavior='lfo', shape='square'
    # Find the address for stage instance
    for inst in engine.stage_instances:
        profile = engine.profiles.get(inst.get('profileId'))
        if profile and profile['name'] == 'eh l2600 ryth':
            base_addr = int(inst.get('address', 1)) + int(inst.get('offset', 0))
            channels = profile.get('channels', [])
            if len(channels) > 3:
                pattern_ch_addr = base_addr + channels[3].get('addrOffset', 3)
                print(f"Frame {i:02d} | Beat: {is_beat} | Pattern Channel ({pattern_ch_addr}): {engine.universe[pattern_ch_addr]}")
                break

