import sys
sys.path.append('backend')
from dmx_engine import DMXEngine

eng = DMXEngine()
inst = eng.stage_instances[4] # Left1
print("Instance:", inst)
profile = eng.profiles.get(inst['profileId'])
cache = eng._fast_cache[inst['profileId']][0] # Channel 1
rule = cache.get_active_rule('mid', 'steady')
print("Rule:", rule)
val = eng._calculate_channel(0, {'vibe':'mid', 'vol':0.5, 'bins':[0.5]*6}, eng.logic, 0, cache, profile['id'])
print("Val:", val)
