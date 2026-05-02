
import json
import numpy as np

def analyze_dmx(file_path, profile_path):
    with open(file_path, 'r') as f:
        data = json.load(f)
    with open(profile_path, 'r') as f:
        profile = json.load(f)
        
    addresses = sorted(list(data[0]['v'].keys()))
    num_frames = len(data)
    
    dmx_arrays = {addr: np.zeros(num_frames) for addr in addresses}
    audio_metrics = {
        'b': np.zeros(num_frames),
        'm': np.zeros(num_frames),
        'h': np.zeros(num_frames),
        'f': np.zeros(num_frames),
        'vl': np.zeros(num_frames),
        'bt': np.zeros(num_frames),
        'bp': np.zeros(num_frames) # beat phase (predicted)
    }
    
    # Source mapping from Grandma profile
    # 0 -> bin 0, 1 -> bass (b), 2 -> bin 1, 3 -> bin 2, 4 -> impact (f?), 
    # 5 -> volume (vl), 6 -> spectral flux (f), 7 -> bin 0, 8 -> highs (h),
    # 9 -> volume (vl), 10 -> volume (vl), 11 -> beat phase (bt?), 12 -> bass (b),
    # 13 -> volume (vl), 14 -> highs (h), 15 -> mids (m)
    source_map = {
        "200": "b", # bin 0 is usually bass bin 0
        "201": "b", 
        "202": "b", # bin 1
        "203": "b", # bin 2
        "204": "f", # impact
        "205": "vl",
        "206": "f", # flux
        "207": "b", # bin 0
        "208": "h",
        "209": "vl",
        "210": "vl",
        "211": "bt",
        "212": "b",
        "213": "vl",
        "214": "h",
        "215": "m"
    }

    for i, frame in enumerate(data):
        for addr in addresses:
            dmx_arrays[addr][i] = frame['v'].get(addr, 0)
        
        a = frame.get('a', {})
        audio_metrics['b'][i] = a.get('b', 0)
        audio_metrics['m'][i] = a.get('m', 0)
        audio_metrics['h'][i] = a.get('h', 0)
        audio_metrics['f'][i] = a.get('f', 0)
        audio_metrics['vl'][i] = a.get('vl', 0)
        audio_metrics['bt'][i] = 1.0 if a.get('bt', False) else 0.0

    print(f"Analyzed {num_frames} frames.")
    
    # Check "Follower" vs "Behavior"
    print("\n--- Behavior Specificity Analysis ---")
    for addr in addresses:
        source_key = source_map.get(addr)
        if source_key and source_key in audio_metrics:
            source_arr = audio_metrics[source_key]
            # Normalize source to 0-255 for comparison
            s_min, s_max = source_arr.min(), source_arr.max()
            if s_max > s_min:
                s_norm = (source_arr - s_min) / (s_max - s_min) * 255
            else:
                s_norm = source_arr * 0
            
            corr = np.corrcoef(dmx_arrays[addr], source_arr)[0, 1]
            # Variance of difference (how much it deviates from just following)
            diff = dmx_arrays[addr] - s_norm
            std_diff = np.std(diff)
            
            mapping = profile['mappings'][int(addr)-200][0]
            beh = mapping['behavior']
            
            print(f"Address {addr} ({beh} {source_key}): Corr={corr:.3f}, DevStd={std_diff:.1f}")
            if corr > 0.98 and beh not in ['direct', 'static']:
                print(f"  WARNING: {beh} behavior is acting like a pure direct follower.")
            if corr < 0.1 and beh == 'direct':
                 print(f"  WARNING: direct behavior has no correlation with source.")

    # Duplicate check
    print("\n--- Redundancy Matrix (Correlation > 0.98) ---")
    for i, addr1 in enumerate(addresses):
        for addr2 in addresses[i+1:]:
            corr = np.corrcoef(dmx_arrays[addr1], dmx_arrays[addr2])[0, 1]
            if corr > 0.98:
                print(f"{addr1} <-> {addr2}: {corr:.3f}")

analyze_dmx('/home/sumof2/vj/recordings/REC_20260501_0940/dmx.json', '/home/sumof2/vj/fixtures/profiles/0501.p.grandma.json')
