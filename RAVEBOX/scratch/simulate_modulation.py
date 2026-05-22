import math
import json
import os

def simulate_logic(mod_type="none"):
    # Constants
    DT = 0.016
    STEPS = 300 # ~5 seconds
    
    # Logic state for 2 channels
    st0 = {'phase': 0.0, 't': 0.0, 'hold_active': False}
    st1 = {'phase': 0.0, 't': 0.0, 'hold_active': False}
    
    # Previous universe (simulated)
    prev_universe = [0] * 513
    
    # Results
    ch0_vals = []
    ch1_vals = []
    
    # Simple simulated audio: Volume ramps up and down
    for i in range(STEPS):
        t = i * DT
        # Driver (Channel 0): Low frequency sine wave 0.0 to 1.0
        vol = (math.sin(t * 2.0) + 1.0) / 2.0
        
        # Channel 0 rule: Direct volume mapping
        # E0 = vol
        y0 = (vol * 2.0) - 1.0
        dmx0 = 127 + (y0 * 128)
        dmx0 = max(0, min(255, int(dmx0)))
        
        # Modulated (Channel 1) rule: Faster sine wave
        # E1 = 1.0 (static driver)
        freq1 = 10.0 # 10Hz
        st1['phase'] = (st1['phase'] + DT * freq1) % 1.0
        y1 = math.sin(st1['phase'] * 2.0 * math.pi)
        
        # Apply Modulation
        target_val_normalized = prev_universe[1] / 255.0 # Modulation target is Channel 0 (addr 1)
        
        if mod_type == "dampen_amp":
            y1 = y1 * (1.0 - target_val_normalized)
        elif mod_type == "clamp":
            y1 = min(y1, (target_val_normalized * 2.0) - 1.0)
        elif mod_type == "gate":
            if target_val_normalized < 0.2: # Using 0.2 for clearer visual in sim
                y1 = -1.0
        
        dmx1 = 127 + (y1 * 128)
        dmx1 = max(0, min(255, int(dmx1)))
        
        # Update universe
        prev_universe[1] = dmx0
        prev_universe[2] = dmx1
        
        ch0_vals.append(dmx0)
        ch1_vals.append(dmx1)
        
    return ch0_vals, ch1_vals

def format_waveform(vals, length=50):
    # Very simple ASCII waveform
    chars = " .:-=+*#%@"
    max_val = 255
    res = ""
    for v in vals[::len(vals)//length]:
        idx = int((v / max_val) * (len(chars) - 1))
        res += chars[idx]
    return res

results = {}
for m in ["none", "dampen_amp", "clamp", "gate"]:
    results[m] = simulate_logic(m)

# Output summary
print("Modulation Strategy Review\n")
print(f"{'Strategy':<15} | {'CH0 (Modulator)':<20} | {'CH1 (Targeted)':<20}")
print("-" * 60)
for m, (ch0, ch1) in results.items():
    print(f"{m:<15} | {format_waveform(ch0):<20} | {format_waveform(ch1):<20}")

# Save detailed data for potential plotting
with open("modulation_results.json", "w") as f:
    json.dump(results, f)
