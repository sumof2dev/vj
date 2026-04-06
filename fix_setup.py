import sys

file_path = '/home/sumof2/vj/setup.html'
with open(file_path, 'r') as f:
    lines = f.readlines()

start_line = -1
end_line = -1

for i, line in enumerate(lines):
    if 'function loadProfileChannels()' in line:
        start_line = i
    if start_line != -1 and 'loadProfileChannels();' in line and 'addVibeRule' in lines[i+2]: # Heuristic for end of loadProfileChannels
        # Actually loadProfileChannels is much longer.
        pass

# Refined search for end of loadProfileChannels
# It ends at the end of the container.innerHTML = ... map(...).join('') block.
# Which is followed by "    }".

# Let's just find the start and end by markers
start_marker = "        function loadProfileChannels() {"
# It ends before "        function addVibeRule(chIdx) {"

for i, line in enumerate(lines):
    if start_marker in line:
        start_line = i
    if "        function addVibeRule(chIdx) {" in line:
        end_line = i
        break

if start_line != -1 and end_line != -1:
    new_function = r"""        function loadProfileChannels() {
            const activeProfile = activeProfileId ? db.profiles.find(p => p.id === activeProfileId) : null;
            const fixId = document.getElementById('prof-base-fixture').value;
            const legacyFix = db.fixtures.find(f => f.id === fixId);

            const channels = (activeProfile && activeProfile.channels) ? activeProfile.channels : (legacyFix ? legacyFix.channels : []);
            const container = document.getElementById('prof-mappings');

            if (channels.length === 0) { container.innerHTML = ''; return; }

            // Initialize mappings if empty or length mismatch
            if (currentProfileMappings.length === 0 || currentProfileMappings.length !== channels.length) {
                const isOldFormat = currentProfileMappings.length > 0 && !Array.isArray(currentProfileMappings[0]);

                if (isOldFormat) {
                    currentProfileMappings = currentProfileMappings.map(m => ([{
                        vibe: 'any',
                        mechanical_class: 'unverified',
                        behavior: m.behavior || m.mod || 'direct',
                        cal: m.cal || { min: 0, center: 127, max: 255 },
                        lfo: m.lfo || { shape: 'sine', speed: 0.1, react: 0.5 },
                        audio: m.audio || { smoothing: 0.5, threshold: 0.5, react: 1.0 },
                        value: m.value || 0
                    }]));
                } else {
                    currentProfileMappings = channels.map((ch) => {
                        return [{
                            vibe: 'any',
                            mechanical_class: 'unverified',
                            behavior: 'static',
                            source: 'raw',
                            cal: { min: 0, center: 127, max: 255 },
                            lfo: { shape: 'sine', bin: 0, speed: 0.5, react: 0.5, return_to_min: false, threshold: 0.1, hold: 0, invert: false, smoothing: 0 },
                            audio: { smoothing: 0.5, threshold: 0.5, react: 1.0 },
                            value: 0
                        }];
                    });
                }
            }
            
            // Final Size Check & Padding
            if (currentProfileMappings.length < channels.length) {
                while (currentProfileMappings.length < channels.length) {
                    currentProfileMappings.push([{ vibe: 'any', mechanical_class: 'unverified', behavior: 'static', source: 'raw', cal: { min: 0, center: 127, max: 255 }, lfo: { shape: 'sine', bin: 0, speed: 0.25, react: 0.5, return_to_min: false, threshold: 0.1, hold: 0, invert: false, smoothing: 0 }, audio: { smoothing: 0.5, threshold: 0.5, react: 1.0 }, value: 0 }]);
                }
            } else {
                currentProfileMappings = currentProfileMappings.map(rules => {
                    if (!Array.isArray(rules)) rules = [rules];
                    if (rules.length === 0) {
                        rules = [{ vibe: 'any', mechanical_class: 'unverified', behavior: 'static', source: 'raw', cal: { min: 0, center: 127, max: 255 }, lfo: { shape: 'sine', bin: 0, speed: 0.25, react: 0.5, return_to_min: false, threshold: 0.1, hold: 0, invert: false, smoothing: 0 }, audio: { smoothing: 0.5, threshold: 0.5, react: 1.0 }, value: 0 }];
                    }
                    return rules.map(rule => {
                        if (!rule.behavior) {
                            const mod = rule.mod || 'static';
                            rule.behavior = (mod === 'lfo') ? 'lfo' : 'direct';
                        }
                        if (!rule.source) rule.source = 'raw';
                        if (!rule.cal) rule.cal = { min: 0, center: 127, max: 255 };
                        if (!rule.audio) rule.audio = { smoothing: 0.5, threshold: 0.1, react: 1.0 };
                        if (!rule.lfo) rule.lfo = { shape: 'sine', bin: 0, speed: 0.1, react: 0.5, return_to_min: false, threshold: 0.1, hold: 0, invert: false, smoothing: 0 };
                        if (rule.mechanical_class === undefined) rule.mechanical_class = 'unverified';
                        return rule;
                    });
                });
            }

            container.innerHTML = channels.map((ch, chIdx) => {
                const rules = currentProfileMappings[chIdx] || [];
                const isCollapsed = collapsedChannels.has(chIdx);

                return `
                <div class="card channel-card ${isCollapsed ? 'collapsed' : ''}" style="margin-bottom: 10px; padding: 10px 12px; border-left: 4px solid var(--accent); background:rgba(255,255,255,0.01);">
                    <div class="channel-card-header" onclick="toggleChannelCollapse(${chIdx})" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: ${isCollapsed ? '0' : '8px'};">
                        <div style="font-weight:bold; color:var(--accent); font-size:14px; display:flex; align-items:center; gap:8px;">
                            <span class="collapse-icon">▼</span>
                            ${ch.name} (${ch.role || 'Unassigned'})
                            <span style="font-size:10px; color:#666; font-weight:normal;">(Offset +${chIdx})</span>
                            <button class="ai-sparkle-btn" onclick="event.stopPropagation(); toggleChannelAiInput(${chIdx})" title="Toggle AI instructions for this channel">✨</button>
                        </div>
                        <div style="flex:1; margin: 0 20px; opacity:1.0; min-width:150px; position:relative;">
                           <canvas id="live-canvas-${chIdx}" style="width:100%; height:32px; background:rgba(0,0,0,0.7); border-radius:4px; border:1px solid #444; display:block;"></canvas>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); addVibeRule(${chIdx})">➕ Add Vibe Rule</button>
                    </div>

                    <div class="channel-card-body">
                        <div id="ai-comment-${chIdx}" class="ai-comment-box ${pendingAiInstructions[chIdx] ? 'active' : ''}" style="margin-bottom: 15px;">
                            <textarea class="ai-comment-input" placeholder="Channel-wide tweaks..." oninput="updateAiInstruction('${chIdx}', this.value)">${pendingAiInstructions[chIdx] || ''}</textarea>
                        </div>

                        <div id="rules-container-${chIdx}">
                            ${rules.map((rule, ruleIdx) => {
                                let modSettingsHtml = '';
                                if (rule.behavior === 'lfo') {
                                    modSettingsHtml = `
                                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:4px;">
                                            <div><label>SHAPE</label><select onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'lfo.shape', this.value)">
                                                <option value="sine" ${rule.lfo.shape === 'sine' ? 'selected' : ''}>Sine</option>
                                                <option value="triangle" ${rule.lfo.shape === 'triangle' ? 'selected' : ''}>Triangle</option>
                                                <option value="sawtooth" ${rule.lfo.shape === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
                                                <option value="square" ${rule.lfo.shape === 'square' ? 'selected' : ''}>Square</option>
                                            </select></div>
                                            <div><label>SPEED: ${rule.lfo.speed}</label><input type="range" min="0" max="1.5" step="0.01" value="${rule.lfo.speed}" oninput="updateProfileMapping(${chIdx}, ${ruleIdx}, 'lfo.speed', parseFloat(this.value))"></div>
                                        </div>`;
                                } else if (rule.behavior === 'direct') {
                                    modSettingsHtml = `<div><label>SMOOTH: ${rule.audio.smoothing}</label><input type="range" min="0" max="0.99" step="0.01" value="${rule.audio.smoothing}" oninput="updateProfileMapping(${chIdx}, ${ruleIdx}, 'audio.smoothing', parseFloat(this.value))"></div>`;
                                }

                                let calFieldsHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-top:10px;">
                                    <div><label>MIN</label><input type="number" value="${rule.cal.min}" onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'cal.min', parseInt(this.value))"></div>
                                    <div><label>CENTER</label><input type="number" value="${rule.cal.center}" onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'cal.center', parseInt(this.value))"></div>
                                    <div><label>MAX</label><input type="number" value="${rule.cal.max}" onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'cal.max', parseInt(this.value))"></div>
                                </div>`;

                                const vibeDisabled = (rules.length <= 1);
                                return `
                                    <div style="background:rgba(255,255,255,0.03); border:1px solid #333; padding:12px; border-radius:4px; margin-bottom:10px; position:relative;">
                                        <div style="display:grid; grid-template-columns: 1fr 1fr 0.8fr auto; gap:10px; align-items:flex-end;">
                                            <div>
                                                <label>VIBE STATE</label>
                                                <select onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'vibe', this.value)" ${vibeDisabled ? 'disabled' : ''}>
                                                    <option value="any" ${rule.vibe === 'any' ? 'selected' : ''}>Any / Fallback</option>
                                                    <option value="chill" ${rule.vibe === 'chill' ? 'selected' : ''}>Chill</option>
                                                    <option value="mid" ${rule.vibe === 'mid' ? 'selected' : ''}>Mid</option>
                                                    <option value="high" ${rule.vibe === 'high' ? 'selected' : ''}>High</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label style="font-weight:bold; color:var(--accent);">PHYSICS (CLASS)</label>
                                                <select onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'mechanical_class', this.value)">
                                                    <option value="unverified" ${rule.mechanical_class === 'unverified' ? 'selected' : ''}>⚠️ Unverified</option>
                                                    <option value="linear" ${rule.mechanical_class === 'linear' ? 'selected' : ''}>Linear</option>
                                                    <option value="index" ${rule.mechanical_class === 'index' ? 'selected' : ''}>Index</option>
                                                    <option value="macro" ${rule.mechanical_class === 'macro' ? 'selected' : ''}>Macro</option>
                                                </select>
                                            </div>
                                            <div>
                                                <button class="btn ${rule.manual_mode ? 'btn-primary' : 'btn-outline'}" onclick="toggleManualMode(${chIdx}, ${ruleIdx})">
                                                    ${rule.manual_mode ? '🔓 Manual' : '🔒 Easy'}
                                                </button>
                                            </div>
                                            <button class="btn btn-danger btn-sm" onclick="removeVibeRule(${chIdx}, ${ruleIdx})">×</button>
                                        </div>

                                        <div style="margin-top:10px; display:${rule.mechanical_class !== 'unverified' ? 'block' : 'none'};">
                                            <label>AESTHETIC VIBE</label>
                                            <select onchange="applyAesthetic(${chIdx}, ${ruleIdx}, this.value)">
                                                <option value="none">--- Select Aesthetic ---</option>
                                                <option value="custom" ${rule.aesthetic_id === 'custom' ? 'selected' : ''}>✏️ Custom</option>
                                                ${(AESTHETIC_REGISTRY[rule.mechanical_class] || []).map(a => `<option value="${a.id}" ${rule.aesthetic_id === a.id ? 'selected' : ''}>${a.label}</option>`).join('')}
                                            </select>
                                        </div>

                                        <div style="margin-top:10px; display:${(rule.manual_mode || rule.aesthetic_id === 'custom') ? 'block' : 'none'}; border:1px dashed #444; padding:8px;">
                                            <div style="display:grid; grid-template-columns: 1fr 1fr auto; gap:10px;">
                                                <select onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'behavior', this.value)">
                                                    ${BEHAVIORS.map(b => `<option value="${b.id}" ${rule.behavior === b.id ? 'selected' : ''}>${b.label}</option>`).join('')}
                                                </select>
                                                <select onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'source', this.value)">
                                                    ${SOURCES.map(s => `<option value="${s.id}" ${rule.source === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
                                                </select>
                                            </div>
                                            ${modSettingsHtml}
                                            ${calFieldsHtml}
                                        </div>
                                    </div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>`;
            }).join('');
            
            // Re-trigger Canvas initializers for new elements
            channels.forEach((ch, idx) => {
                 const canvas = document.getElementById('live-canvas-' + idx);
                 if (canvas && !canvas._initialized) {
                     setupLiveVisualizer(canvas, idx);
                     canvas._initialized = true;
                 }
            });
        }
"""
    lines[start_line:end_line] = [new_function + "\n"]
    with open(file_path, 'w') as f:
        f.writelines(lines)
    print("Successfully patched setup.html")
else:
    print(f"Failed to find markers: start={start_line}, end={end_line}")
    sys.exit(1)
