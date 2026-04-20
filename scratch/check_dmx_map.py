import json
import os
import sys

# Load stage config
try:
    with open('fixtures/stage_config.json', 'r') as f:
        stage = json.load(f)
except:
    print("Stage config not found")
    sys.exit(1)

# Load profiles
profiles = {}
for p in os.listdir('fixtures/profiles'):
    if p.endswith('.json'):
        with open(os.path.join('fixtures/profiles', p), 'r') as f:
            data = json.load(f)
            profiles[data['id']] = data

# Map address to fixture and role
addr_map = {}
for inst in stage:
    p_id = inst.get('profileId')
    if p_id in profiles:
        prof = profiles[p_id]
        base = int(inst.get('address', 1)) + int(inst.get('offset', 0))
        for ch_idx, ch in enumerate(prof.get('channels', [])):
            addr = base + ch_idx
            addr_map[addr] = {
                'fixture': inst['id'],
                'profile': prof['name'],
                'role': ch.get('role', 'unknown'),
                'channel': ch.get('name', 'unknown')
            }

print(f"Checking DMX addresses for 'clip' roles...")
for addr, info in addr_map.items():
    if info['role'] == 'clip':
        print(f"Address {addr}: Fixture {info['fixture']}, Profile {info['profile']}, Role {info['role']}")

# Now the user can see what addresses to look for.
