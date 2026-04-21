import os
import json
import glob

def migrate_rule(rule):
    # Mapping for sources
    source_map = {
        'vol': 'volume',
        'mid': 'mids',
        'high': 'highs',
        'flux': 'spectral flux',
        'beat': 'beat phase',
        'bar': 'bar phase',
        'bin_0': 'bin 0',
        'bin_1': 'bin 1',
        'bin_2': 'bin 2',
        'bin_3': 'bin 3',
        'bin_4': 'bin 4',
        'bin_5': 'bin 5'
    }
    
    # Mapping for behaviors
    behavior_map = {
        'push': 'direct',
        'pull': 'direct',
        'kinematic_push': 'direct',
        'kinematic_pull': 'direct',
        'random': 'noise',
        'step': 'noise'
    }
    
    # Mapping for hold types
    hold_map = {
        'floorfreeze': 'none',
        'peakpause': 'none'
    }

    modified = False
    
    if 'source' in rule:
        old_val = rule['source']
        if old_val in source_map:
            rule['source'] = source_map[old_val]
            modified = True
            
    if 'behavior' in rule:
        old_val = rule['behavior']
        if old_val in behavior_map:
            rule['behavior'] = behavior_map[old_val]
            modified = True
            
    if 'modifiers' in rule and 'hold_type' in rule['modifiers']:
        old_val = rule['modifiers']['hold_type']
        if old_val in hold_map:
            rule['modifiers']['hold_type'] = hold_map[old_val]
            modified = True
            
    return modified

def migrate_profile(filepath):
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        changed = False
        if 'mappings' in data:
            for rules in data['mappings']:
                for rule in rules:
                    if migrate_rule(rule):
                        changed = True
        
        if changed:
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=4)
            print(f"✅ Migrated profile: {os.path.basename(filepath)}")
        else:
            print(f"⚪ No changes needed for profile: {os.path.basename(filepath)}")
            
    except Exception as e:
        print(f"❌ Error migrating profile {filepath}: {e}")

def migrate_presets(filepath):
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
            
        changed = False
        for preset in data:
            if 'overrides' in preset:
                for ov in preset['overrides']:
                    if migrate_rule(ov):
                        changed = True
            
        if changed:
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=4)
            print(f"✅ Migrated presets: {os.path.basename(filepath)}")
        else:
            print(f"⚪ No changes needed for presets.")
            
    except Exception as e:
        print(f"❌ Error migrating presets: {e}")

if __name__ == "__main__":
    profiles_dir = "/home/sumof2/vj/fixtures/profiles"
    presets_file = "/home/sumof2/vj/fixtures/presets.json"
    
    print("🚀 Starting DMX data migration...")
    
    for profile_path in glob.glob(os.path.join(profiles_dir, "*.json")):
        migrate_profile(profile_path)
        
    if os.path.exists(presets_file):
        migrate_presets(presets_file)
        
    print("🏁 Migration complete.")
