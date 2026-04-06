import sys

file_path = '/home/sumof2/vj/setup.html'
with open(file_path, 'r') as f:
    lines = f.readlines()

# Find AESTHETIC_REGISTRY and update it + add applyAesthetic
start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if "const AESTHETIC_REGISTRY =" in line:
        start_idx = i
    if start_idx != -1 and "};" in line and i > start_idx:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_registry_code = [
        "        const AESTHETIC_REGISTRY = {\n",
        "            linear: [\n",
        "                { id: 'smooth_wave', label: 'Smooth Wave', behavior: 'lfo', lfo: { shape: 'sine', smoothing: 0.8, speed: 0.1, react: 0.5 }, source: 'raw' },\n",
        "                { id: 'rhythmic_snap', label: 'Rhythmic Snap', behavior: 'direct', audio: { smoothing: 0.1, threshold: 0.5, react: 2.0 }, source: 'beat' },\n",
        "                { id: 'jitter_center', label: 'Jitter Center', behavior: 'lfo', lfo: { shape: 'sawtooth', speed: 1.2, react: 0.8, smoothing: 0 }, source: 'flux' }\n",
        "            ],\n",
        "            index: [\n",
        "                { id: 'cycle_random', label: 'Cycle Random', behavior: 'lfo', lfo: { shape: 'square', speed: 0.2, react: 1.0 }, source: 'beat' },\n",
        "                { id: 'static_hold', label: 'Static Hold', behavior: 'static' }\n",
        "            ],\n",
        "            macro: [\n",
        "                { id: 'dynamic_hold', label: 'Dynamic Hold', behavior: 'lfo', lfo: { shape: 'square', hold: 0.5, speed: 0.1 }, source: 'bar' },\n",
        "                { id: 'speed_ramp', label: 'Speed Ramp', behavior: 'lfo', lfo: { shape: 'sawtooth', speed: 0.5 }, source: 'phrase' }\n",
        "            ]\n",
        "        };\n",
        "\n",
        "        function applyAesthetic(chIdx, ruleIdx, aestheticId) {\n",
        "            if (aestheticId === 'none') return;\n",
        "            const rule = currentProfileMappings[chIdx][ruleIdx];\n",
        "            const mechanicalClass = rule.mechanical_class;\n",
        "            const aesthetic = (AESTHETIC_REGISTRY[mechanicalClass] || []).find(a => a.id === aestheticId);\n",
        "            if (!aesthetic) return;\n",
        "\n",
        "            rule.aesthetic_id = aestheticId;\n",
        "            if (aesthetic.behavior) rule.behavior = aesthetic.behavior;\n",
        "            if (aesthetic.source) rule.source = aesthetic.source;\n",
        "            if (aesthetic.lfo) rule.lfo = { ...rule.lfo, ...aesthetic.lfo };\n",
        "            if (aesthetic.audio) rule.audio = { ...rule.audio, ...aesthetic.audio };\n",
        "            \n",
        "            if (rule.lfo) {\n",
        "                rule.lfo.phase = (chIdx * 0.15) % (Math.PI * 2);\n",
        "                rule.lfo.speed *= (0.95 + (Math.random() * 0.1));\n",
        "            }\n",
        "            loadProfileChannels();\n",
        "        }\n"
    ]
    lines[start_idx:end_idx+1] = new_registry_code
    with open(file_path, 'w') as f:
        f.writelines(lines)
    print("Successfully restored AESTHETIC_REGISTRY and applyAesthetic.")
else:
    print("Markers not found.")
    sys.exit(1)
