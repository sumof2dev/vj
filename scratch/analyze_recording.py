
import json
import numpy as np

def analyze_dmx(file_path):
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    addresses = sorted(list(data[0]['v'].keys()))
    num_frames = len(data)
    
    dmx_arrays = {addr: np.zeros(num_frames) for addr in addresses}
    audio_metrics = {
        'b': np.zeros(num_frames),
        'm': np.zeros(num_frames),
        'h': np.zeros(num_frames),
        'f': np.zeros(num_frames),
        'vl': np.zeros(num_frames),
        'bt': np.zeros(num_frames)
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
    
    # Correlation between addresses
    print("\n--- Nearly Duplicate Behaviors (Correlation > 0.9) ---")
    duplicate_found = False
    for i, addr1 in enumerate(addresses):
        for addr2 in addresses[i+1:]:
            corr = np.corrcoef(dmx_arrays[addr1], dmx_arrays[addr2])[0, 1]
            if corr > 0.9:
                print(f"Address {addr1} and {addr2}: {corr:.3f}")
                duplicate_found = True
    if not duplicate_found:
        print("No nearly duplicate behaviors found.")
        
    # Correlation with audio sources
    print("\n--- Audio Correlation (Max Correlation with b, m, h, f, vl, bt) ---")
    for addr in addresses:
        corrs = {}
        for metric, arr in audio_metrics.items():
            corrs[metric] = np.corrcoef(dmx_arrays[addr], arr)[0, 1]
        
        max_metric = max(corrs, key=lambda k: abs(corrs[k]))
        max_val = corrs[max_metric]
        print(f"Address {addr}: Max correlation with '{max_metric}' is {max_val:.3f}")
        if abs(max_val) < 0.2:
            print(f"  WARNING: Address {addr} has very low correlation with all audio metrics.")

analyze_dmx('/home/sumof2/vj/recordings/REC_20260501_0940/dmx.json')
