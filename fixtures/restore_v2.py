import json
import os

# Paths
BACKUP_DIR = "/home/sumof2/vj/fixtures/backup/fixtures/"
CONFIGS_DIR = "/home/sumof2/vj/fixtures/configs/"
PROFILES_DIR = "/home/sumof2/vj/fixtures/profiles/"

# Hardcoded Mappings for Fixture IDs and Names
FIXTURE_MAP = {
    'Ehaho.json': {
        'id': 'fix_1774209417123',
        'name': 'Ehaho Laser'
    },
    'movinghead.json': {
        'id': 'fix_1774209561055',
        'name': 'Moving Head'
    },
    'temu.json': {
        'id': 'fix_1774212535335',
        'name': 'Temu Wash'
    },
    'direct.json': {
        'id': 'fix_direct',
        'name': 'Direct DMX'
    },
    'xbox.json': {
        'id': 'fix_xbox',
        'name': 'Xbox Controller'
    }
}

def convert_fixture_v2(backup_file, meta):
    with open(backup_file, 'r') as f:
        data = json.load(f)
    
    # In these backups, 'channels' is a dict: { role: index }
    ch_dict = data.get('channels', {})
    if not ch_dict:
        # Fallback for files that might already be in a different format
        return None

    # Determine max index to size the array
    max_idx = max(ch_dict.values()) if ch_dict else 0
    channels = [None] * (max_idx + 1)
    
    # Fill the channels
    for role, idx in ch_dict.items():
        # Get default value if possible
        default_val = 0
        state_data = data.get('state_data', {})
        if role in state_data:
            s = state_data[role]
            if isinstance(s, dict):
                default_val = s.get('default', 0)
            else:
                default_val = s
        
        channels[idx] = {
            "name": role.replace('_', ' ').title(),
            "role": role,
            "default": default_val,
            "currentValue": default_val
        }
    
    # Fill remaining gaps
    for i in range(len(channels)):
        if channels[i] is None:
            channels[i] = {
                "name": f"Channel {i+1}",
                "role": f"ch{i+1}",
                "default": 0,
                "currentValue": 0
            }
            
    new_fixture = {
        "id": meta['id'],
        "name": meta['name'],
        "channels": channels
    }
    
    return new_fixture

# 1. Restore Fixture Definitions to configs/
for fname, meta in FIXTURE_MAP.items():
    backup_path = os.path.join(BACKUP_DIR, fname)
    if os.path.exists(backup_path):
        try:
            converted = convert_fixture_v2(backup_path, meta)
            if converted:
                with open(os.path.join(CONFIGS_DIR, fname), 'w') as f:
                    json.dump(converted, f, indent=2)
                print(f"✅ Converted and saved {fname} to configs/ with ID {meta['id']}")
        except Exception as e:
            print(f"❌ Failed to convert {fname}: {e}")

# 2. Restore Profiles to profiles/ (Split from profiles.json)
profiles_backup_path = os.path.join(BACKUP_DIR, 'profiles.json')
if os.path.exists(profiles_backup_path):
    try:
        with open(profiles_backup_path, 'r') as f:
            profiles_list = json.load(f)
        
        for profile in profiles_list:
            # File name friendly name
            safe_name = "".join([c if c.isalnum() else "_" for c in profile.get('name', 'UNNAMED_PROFILE')])
            # Use ID in filename to ensure uniqueness
            profile_fname = f"{safe_name}_{profile['id']}.json"
            
            with open(os.path.join(PROFILES_DIR, profile_fname), 'w') as f:
                json.dump(profile, f, indent=2)
            print(f"✅ Split and saved {profile_fname} to profiles/")
    except Exception as e:
        print(f"❌ Failed to split profiles.json: {e}")

print("🚀 Restoration v2 process completed.")
