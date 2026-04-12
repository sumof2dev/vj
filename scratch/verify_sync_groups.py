import sys
import os

# Add parent dir to path to import backend
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.dmx_engine import ChannelConfig

def test_sync_rotation():
    print("🧪 Testing Sync Group Rotation Logic...")
    
    # Define rules with variants
    rules = [
        {'vibe': 'chill 1', 'desc': 'Rule C1'},
        {'vibe': 'chill 2', 'desc': 'Rule C2'},
        {'vibe': 'chill 3', 'desc': 'Rule C3'},
        {'vibe': 'any 1', 'desc': 'Rule A1'},
        {'vibe': 'any 2', 'desc': 'Rule A2'},
        {'vibe': 'any 3', 'desc': 'Rule A3'},
        {'vibe': 'mid', 'desc': 'Generic Mid'}
    ]
    
    config = ChannelConfig(rules=rules, states={}, default_val=0)
    
    # Mock global sync indices (replicated from DMXEngine logic)
    sync_indices = {'chill': 0, 'any': 0, 'mid': 0}
    
    # 1. Test Chill Variant 1
    rule = config.get_active_rule('chill', None, 'inst1', sync_indices)
    print(f"Vibe: 'chill', SyncIdx: {sync_indices['chill']+1} -> Selected: {rule.get('desc')}")
    assert rule.get('vibe') == 'chill 1'

    # 2. Simulate rotation (Mid -> Chill)
    sync_indices['chill'] = (sync_indices['chill'] + 1) % 3
    rule = config.get_active_rule('chill', None, 'inst1', sync_indices)
    print(f"Vibe: 'chill', SyncIdx: {sync_indices['chill']+1} -> Selected: {rule.get('desc')}")
    assert rule.get('vibe') == 'chill 2'

    # 3. Simulate further rotation
    sync_indices['chill'] = (sync_indices['chill'] + 1) % 3
    rule = config.get_active_rule('chill', None, 'inst1', sync_indices)
    print(f"Vibe: 'chill', SyncIdx: {sync_indices['chill']+1} -> Selected: {rule.get('desc')}")
    assert rule.get('vibe') == 'chill 3'

    # 4. Test Any Fallback (e.g. Vibe is 'high' but we have 'any 1')
    sync_indices['any'] = 0 # Variant 1
    rule = config.get_active_rule('high', None, 'inst1', sync_indices)
    print(f"Vibe: 'high', AnySyncIdx: {sync_indices['any']+1} -> Selected: {rule.get('desc')}")
    assert rule.get('vibe') == 'any 1'

    # 5. Test Generic Fallback (Vibe is 'mid')
    rule = config.get_active_rule('mid', None, 'inst1', sync_indices)
    print(f"Vibe: 'mid', Selected: {rule.get('desc')}")
    assert rule.get('vibe') == 'mid'

    print("\n✅ Sync Rotation Verification SUCCESS!")

def test_bin_sources():
    print("\n🧪 Testing Frequency Bin Sources...")
    from backend.dmx_engine import LogicMatrix
    
    lm = LogicMatrix()
    dt = 0.016
    audio = {
        'vol': 0.5,
        'bins': [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
    }
    
    lm.update(dt, audio, 'steady')
    
    for i in range(6):
        key = f'bin_{i}'
        val = lm.state.get(key)
        print(f"Checking {key}: {val}")
        assert val == audio['bins'][i]
        
    print("\n✅ Bin Source Verification SUCCESS!")

if __name__ == "__main__":
    try:
        test_sync_rotation()
        test_bin_sources()
        print("\n🎉 ALL TESTS PASSED!")
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
