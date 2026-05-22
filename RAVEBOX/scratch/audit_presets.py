import os

WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
presets_file = os.path.join(WORKSPACE, 'fixtures', 'presets.json')
with open(presets_file, 'r') as f:
    presets = json.load(f)

behaviors = ['sine', 'saw', 'triangle', 'square', 'pulse', 'sparkle', 'random', 'direct', 'cosine']
found = []
for p in presets:
    for ov in p.get('overrides', []):
        for ch in ov.get('channels', []):
            val = str(ch.get('value', '')).lower()
            mode = ch.get('mode', 'value')
            if '-' in val and mode == 'behavior':
                found.append(f"MISM (Seq in Beh): {p['name']} -> {val}")
            if any(b in val for b in behaviors) and mode == 'value':
                 found.append(f"MISM (Beh in Val): {p['name']} -> {val}")

if found:
    print("\n".join(found))
else:
    print("No mismatches found.")
