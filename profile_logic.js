// --- SAFETY GLOBALS ---
var db = window.db || { profiles: [], stage: [], presets: [], liveConsole: [], savedConsoles: [] };
var activeProfileId = window.activeProfileId || null;
var currentProfileChannels = window.currentProfileChannels || [];
var currentProfileMappings = window.currentProfileMappings || [];
var collapsedChannels = window.collapsedChannels || new Set();
var getUniqueProfiles = window.getUniqueProfiles || function() { return []; };
var updateUniqueFunctions = window.updateUniqueFunctions || function() { };
var refreshUI = window.refreshUI || function() { };
var saveDB = window.saveDB || function() { };
var switchTab = window.switchTab || function() { };

function normalizeProfileData(profile) {
    if (!profile) return;
    
    // Canonical Mapping for Behaviors, Sources, and Holds
    const MAP = {
        behaviors: { 
            'lfo': 'sine', 'lfo_sine': 'sine', 
            'lfo_saw': 'saw', 'lfo_square': 'square', 
            'kinematic_push': 'push', 'kinematic_pull': 'pull',
            'direct': 'push',
            'noise_simplex': 'noise', 'noise_perlin': 'noise',
            'markov_adjacent': 'random', 'markov_erratic': 'random',
            'step_forward': 'step', 'step_pingpong': 'step'
        },
        sources: {
            'low': 'bass', 'volume': 'vol', 'raw': 'vol', 'ratio': 'flux'
        },
        holds: {
            'slowly': 'floorfreeze', 'quickly': 'peakpause'
        }
    };

    if (profile.mappings) {
        profile.mappings = profile.mappings.map(rules => {
            if (!Array.isArray(rules)) rules = [rules];
            return rules.map(rule => {
                // 1. Remap Keys to Canonical Engine IDs
                if (MAP.behaviors[rule.behavior]) rule.behavior = MAP.behaviors[rule.behavior];
                if (MAP.sources[rule.source]) rule.source = MAP.sources[rule.source];
                
                // Static Safety: Ensure 'value' exists
                if (rule.behavior === 'static' && rule.value === undefined) {
                    rule.value = rule.cal ? rule.cal.center : 0;
                }
                
                // 2. Consolidate into 'modifiers' object (SCRUB REDUNDANCY)
                if (!rule.modifiers) {
                    rule.modifiers = {
                        speed: rule.speed !== undefined ? rule.speed : 0.1,
                        react: rule.react !== undefined ? rule.react : 0.5,
                        hold_type: rule.hold_type !== undefined ? rule.hold_type : 'none'
                    };
                }
                
                // 3. Remap Hold Types
                if (MAP.holds[rule.modifiers.hold_type]) rule.modifiers.hold_type = MAP.holds[rule.modifiers.hold_type];
                
                // 4. Scrub Redundant/Legacy Root Keys
                delete rule.speed;
                delete rule.react;
                delete rule.hold_type;
                delete rule.lfo; 
                delete rule.audio;
                
                return rule;
            });
        });
    }
}

function loadProfileChannels() {
    // CONTEXT ISOLATION: Clear AI instructions when switching profiles
    if (activeProfileId !== window.lastLoadedProfileId) {
        window.pendingAiInstructions = {};
        window.aiConversationHistory = [];
        window.lastLoadedProfileId = activeProfileId;
    }

    const activeProfile = activeProfileId ? db.profiles.find(p => p.id === activeProfileId) : null;
    if (activeProfile) normalizeProfileData(activeProfile);

    if (currentProfileChannels.length === 0 || !activeProfileId) {
        currentProfileMappings = (activeProfile && activeProfile.mappings) ? JSON.parse(JSON.stringify(activeProfile.mappings)) : [];
        if (activeProfile && activeProfile.channels) {
            currentProfileChannels = JSON.parse(JSON.stringify(activeProfile.channels));
        } else if (currentProfileChannels.length === 0) {
            // Start with a default channel if brand new
            currentProfileChannels = [{ name: 'Master Dimmer', role: 'dimmer', default: 0 }];
            currentProfileMappings = [[{
                vibe: 'any',
                description: '',
                behavior: 'static',
                source: 'vol',
                cal: { min: 0, center: 127, max: 255 },
                modifiers: { speed: 0.5, react: 0.5, hold_type: 'none' },
                value: 0
            }]];
        }
    }

    const channels = currentProfileChannels;
    const container = document.getElementById('prof-mappings');

    if (channels.length === 0) { container.innerHTML = ''; return; }

    // 1. Initialize mappings if empty or length mismatch / LEGACY WIPE
    if (currentProfileMappings.length === 0 || currentProfileMappings.length !== channels.length || (currentProfileMappings[0] && !currentProfileMappings[0][0].modifiers)) {
        // START CLEAN: If NO mappings exist OR if they are in the old format (no .modifiers object), wipe and start fresh.
        currentProfileMappings = channels.map((ch) => {
            return [{
                vibe: 'any',
                description: '',
                behavior: 'static',
                source: 'volume',
                cal: { min: 0, center: 127, max: 255 },
                modifiers: { 
                    speed: 0.5, 
                    react: 0.5, 
                    hold_type: 'none' 
                },
                value: 0
            }];
        });
    }

    // Final Size Check & Padding
    currentProfileMappings = currentProfileMappings.map(rules => {
        if (!Array.isArray(rules)) rules = [rules];
        if (rules.length === 0) {
            rules = [{ vibe: 'any', description: '', behavior: 'static', source: 'volume', cal: { min: 0, center: 127, max: 255 }, modifiers: { speed: 0.5, react: 0.5, hold_type: 'none' }, value: 0 }];
        }
        return rules;
    });

    container.innerHTML = channels.map((ch, chIdx) => {
        const rules = currentProfileMappings[chIdx] || [];
        const isCollapsed = collapsedChannels.has(chIdx);

        return `
        <div class="card channel-card ${isCollapsed ? 'collapsed' : ''}" style="margin-bottom: 8px; padding: 10px; border-left: 5px solid var(--accent); background:rgba(255,255,255,0.015); border-radius:10px;">
            <div class="channel-card-header" onclick="toggleChannelCollapse(${chIdx})" style="display:flex; flex-direction:column; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:10px; flex:1;">
                        <input type="text" value="${ch.name}" 
                               oninput="currentProfileChannels[${chIdx}].name=this.value; event.stopPropagation()" 
                               class="glass-input" style="font-weight:900; color:var(--text); font-size:15px; border:none; background:transparent; width:130px;"
                               onclick="event.stopPropagation()">
                        <span class="collapse-icon" style="transition: transform 0.2s; transform: rotate(${isCollapsed ? '-90deg' : '0deg'})">▼</span>
                    </div>
                     <div style="display:flex; align-items:center; gap:8px;">
                         <button class="btn btn-sm btn-danger-soft" onclick="event.stopPropagation(); removeProfileChannel(${chIdx})" style="background:rgba(255,85,85,0.1); border:1px solid rgba(255,85,85,0.2); color:#ff5555; padding:3px 6px; border-radius:4px; font-size:10px;">Remove</button>
                     </div>
                </div>
                <div class="mobile-role-row" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                    <div style="display:flex; align-items:center; gap:10px; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:6px; flex:1;">
                        <span style="font-size:9px; color:var(--text-dim); text-transform:uppercase; font-weight:bold;">ROLE:</span>
                        <select onchange="currentProfileChannels[${chIdx}].role=this.value; event.stopPropagation()" 
                                onclick="event.stopPropagation()"
                                class="glass-select" style="font-size:12px; border:none; background:transparent; color:var(--accent); font-weight:bold; padding:0; flex:1;">
                            <option value="none">UNMAPPED</option>
                            ${KNOWN_ROLES.map(r => `<option value="${r}" ${ch.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}
                        </select>
                    </div>
                    <div style="display:flex; gap:5px;">
                        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); addVibeRule(${chIdx})" title="Add Vibe Rule" style="width:36px; height:32px; padding:0; font-size:18px; font-weight:bold; display:flex; align-items:center; justify-content:center;">+</button>
                    </div>
                </div>
            </div>

            <div class="channel-card-body">
                <div id="rules-container-${chIdx}">
                    ${rules.map((rule, ruleIdx) => renderVibeRuleHtml(chIdx, ruleIdx, rule, rules.length)).join('')}
                </div>
            </div>
        </div>`;
    }).join('');
}

function updateProfileMapping(chIdx, ruleIdx, path, val) {
    const rule = currentProfileMappings[chIdx][ruleIdx];
    if (!rule) return;

    // Any manual tweak to behavior, source, modifiers, or calibration makes it custom
    const behaviorPaths = ['behavior', 'source', 'modifiers.', 'cal.', 'value'];
    if (behaviorPaths.some(bp => path.startsWith(bp))) {
        rule.easy_id = 'custom';
    }

    // Handle nested paths like "modifiers.hold_type"
    if (path.includes('.')) {
        const parts = path.split('.');
        let obj = rule;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!obj[parts[i]]) obj[parts[i]] = {};
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = val;
    } else {
        rule[path] = val;
    }
}

function toggleManualMode(chIdx, ruleIdx) {
    if (currentProfileMappings[chIdx] && currentProfileMappings[chIdx][ruleIdx]) {
        const rule = currentProfileMappings[chIdx][ruleIdx];
        rule.manual_mode = !rule.manual_mode;
        loadProfileChannels(); // Re-render to show/hide the manual block
    }
}

function applyEasyBehavior(chIdx, ruleIdx, easyId) {
    const rule = currentProfileMappings[chIdx][ruleIdx];
    if (!rule) return;

    if (!easyId || easyId === 'custom') {
        rule.easy_id = 'custom';
        loadProfileChannels();
        return;
    }

    const desc = EASY_DESCRIPTORS.find(d => d.id === easyId);
    if (!desc) return;

    rule.easy_id = easyId;
    rule.behavior = desc.behavior || 'static';
    rule.source = desc.source || 'volume';
    if (desc.speed !== undefined) rule.modifiers.speed = desc.speed;
    if (desc.react !== undefined) rule.modifiers.react = desc.react;
    if (desc.hold_type !== undefined) rule.modifiers.hold_type = desc.hold_type;

    // Apply Relative Center Tuning (Gold Standard)
    if (desc.rel_center !== undefined && rule.cal) {
        rule.cal.center = Math.round(rule.cal.min + (desc.rel_center * (rule.cal.max - rule.cal.min)));
    }

    loadProfileChannels();
}

async function saveCurrentRuleAsPremade(chIdx, ruleIdx) {
    const rule = currentProfileMappings[chIdx][ruleIdx];
    const labelInput = document.getElementById(`save-label-${chIdx}-${ruleIdx}`);
    const label = labelInput.value.trim() || rule.description || "Custom Behavior";
    
    // Build payload matching server expectations
    const payload = {
        label: label,
        behavior: rule.behavior,
        source: rule.source || 'vol',
        speed: rule.modifiers ? rule.modifiers.speed : 0.1,
        react: rule.modifiers ? rule.modifiers.react : 0.5,
        hold_type: rule.modifiers ? rule.modifiers.hold_type : 'none',
        value: rule.value,
        rel_center: rule.cal ? parseFloat(((rule.cal.center - rule.cal.min) / Math.max(1, (rule.cal.max - rule.cal.min))).toFixed(3)) : 0.5
    };

    try {
        console.log("💾 Attempting to save premade behavior:", payload);
        const res = await fetch(`${window.API_BASE_ROOT}/api/descriptors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (data.status === 'ok') {
            console.log("✅ Premade Saved Successfully:", data.descriptor);
            
            // 1. Update active memory in browser
            if (window.EASY_DESCRIPTORS) {
                window.EASY_DESCRIPTORS.push(data.descriptor);
            }
            
            // 2. Clear custom state and bind to new premade
            rule.easy_id = data.descriptor.id;
            
            // 3. Re-render UI
            loadProfileChannels();
            
            // 4. Subtle toast
            console.log(`Saved "${label}" to Premade library!`);
        } else {
            alert("Error saving behavior: " + (data.message || "Unknown error"));
        }
    } catch (e) {
        console.error("Save Error:", e);
        alert("Failed to communicate with server to save premade.");
    }
}

function renderVibeRuleHtml(chIdx, ruleIdx, rule, rulesCount) {
    const vibeDisabled = (rulesCount <= 1);
    const isNever = rule.vibe === 'never';
    const isStatic = rule.behavior === 'static';
    const isCustom = !rule.easy_id || rule.easy_id === 'custom';
    
    // REDESIGNED TIGHT LAYOUT
    return `
        <div class="rule-card" style="background:${isNever ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.02)'}; border:1px solid ${isNever ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.04)'}; opacity:${isNever ? 0.35 : 1}; padding:6px 10px; border-radius:10px; margin-bottom:4px; position:relative; ${(isNever) ? 'filter: grayscale(1);' : ''}">
            
            <!-- LINE 1: DESCRIPTION (PRIORITY) -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <input type="text" placeholder="Description of this range..." value="${rule.description || ''}" 
                       oninput="updateProfileMapping(${chIdx}, ${ruleIdx}, 'description', this.value)"
                       style="font-size:11px; font-weight:900; color:#fff; text-transform:uppercase; background:transparent; border:none; flex:1; outline:none; text-align:left; letter-spacing:0.5px;">
                <button class="btn btn-sm" onclick="removeVibeRule(${chIdx}, ${ruleIdx})" style="padding:0 4px; color:rgba(255,85,85,0.5); background:none; border:none; font-size:16px;">×</button>
            </div>

            <!-- LINE 2: VIBE | PREMADE | RANGE -->
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; background:rgba(255,255,255,0.02); padding:3px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.03);">
                <!-- VIBE: NARROWER FIXED WIDTH -->
                <select onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'vibe', this.value)" ${vibeDisabled ? 'disabled' : ''} 
                        style="font-size:10px; font-weight:bold; padding:2px 5px; border-radius:4px; text-transform:uppercase; color:var(--accent-alt); background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); width:75px;">
                    <option value="any" ${rule.vibe === 'any' ? 'selected' : ''}>Any</option>
                    <option value="any 1" ${rule.vibe === 'any 1' ? 'selected' : ''}>Any 1</option>
                    <option value="any 2" ${rule.vibe === 'any 2' ? 'selected' : ''}>Any 2</option>
                    <option value="any 3" ${rule.vibe === 'any 3' ? 'selected' : ''}>Any 3</option>
                    <option value="chill" ${rule.vibe === 'chill' ? 'selected' : ''}>Chill</option>
                    <option value="chill 1" ${rule.vibe === 'chill 1' ? 'selected' : ''}>Chill 1</option>
                    <option value="chill 2" ${rule.vibe === 'chill 2' ? 'selected' : ''}>Chill 2</option>
                    <option value="chill 3" ${rule.vibe === 'chill 3' ? 'selected' : ''}>Chill 3</option>
                    <option value="mid" ${rule.vibe === 'mid' ? 'selected' : ''}>Mid</option>
                    <option value="mid 1" ${rule.vibe === 'mid 1' ? 'selected' : ''}>Mid 1</option>
                    <option value="mid 2" ${rule.vibe === 'mid 2' ? 'selected' : ''}>Mid 2</option>
                    <option value="mid 3" ${rule.vibe === 'mid 3' ? 'selected' : ''}>Mid 3</option>
                    <option value="high" ${rule.vibe === 'high' ? 'selected' : ''}>High</option>
                    <option value="high 1" ${rule.vibe === 'high 1' ? 'selected' : ''}>High 1</option>
                    <option value="high 2" ${rule.vibe === 'high 2' ? 'selected' : ''}>High 2</option>
                    <option value="high 3" ${rule.vibe === 'high 3' ? 'selected' : ''}>High 3</option>
                    <option value="build" ${rule.vibe === 'build' ? 'selected' : ''}>Build</option>
                    <option value="drop" ${rule.vibe === 'drop' ? 'selected' : ''}>Drop</option>
                    <option value="never" ${rule.vibe === 'never' ? 'selected' : ''}>Never</option>
                </select>

                <!-- PREMADE SELECT -->
                <select onchange="applyEasyBehavior(${chIdx}, ${ruleIdx}, this.value)" 
                        style="font-size:10px; font-weight:bold; padding:2px 5px; border-radius:4px; text-transform:uppercase; color:var(--accent); background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); flex:1;">
                    <option value="custom" ${isCustom ? 'selected' : ''}>-- CUSTOM / MANUAL --</option>
                    ${EASY_DESCRIPTORS.map(d => `<option value="${d.id}" ${rule.easy_id === d.id ? 'selected' : ''}>${d.label.toUpperCase()}</option>`).join('')}
                </select>

                <!-- RANGE: WIDER FOR READABILITY (HIDDEN IF STATIC) -->
                ${isStatic ? `<div style="width:10px;"></div>` : `
                <div style="display:flex; align-items:center; gap:4px; font-size:9px; font-family:var(--font-mono); color:rgba(255,255,255,0.2); background:rgba(255,255,255,0.03); padding:0 6px; border-radius:4px; width:135px; justify-content:center;">
                    <input type="number" min="0" max="255" value="${rule.cal.min}" onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'cal.min', parseInt(this.value))" style="background:none; border:none; color:#fff; width:33px; text-align:center; padding:0; font-size:10px;">
                    <span>-</span>
                    <input type="number" min="0" max="255" value="${rule.cal.center}" onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'cal.center', parseInt(this.value))" style="background:none; border:none; color:var(--accent); width:33px; text-align:center; padding:0; font-size:10px;">
                    <span>-</span>
                    <input type="number" min="0" max="255" value="${rule.cal.max}" onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'cal.max', parseInt(this.value))" style="background:none; border:none; color:#fff; width:33px; text-align:center; padding:0; font-size:10px;">
                </div>
                `}
            </div>

            <!-- LINE 3: [DRIVER] [SHAPE] [HOLD] - HIDDEN IF PREMADE SELECTED -->
            <div style="display:${isCustom ? 'flex' : 'none'}; align-items:center; gap:4px; margin-bottom:6px; background:rgba(0,0,0,0.2); padding:3px; border-radius:6px; font-size:10px;">
                <select onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'source', this.value); loadProfileChannels();" 
                        class="glass-select" style="color:var(--accent); font-size:9px; padding:2px; min-width:65px; ${isStatic ? 'opacity:0.3; pointer-events:none;' : ''}">
                    ${SOURCES.map(s => `<option value="${s.id}" ${rule.source === s.id ? 'selected' : ''}>${s.label.toUpperCase()}</option>`).join('')}
                </select>
                <select onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'behavior', this.value); loadProfileChannels();" 
                        class="glass-select" style="color:var(--accent-alt); font-size:9px; padding:2px; min-width:85px;">
                    ${BEHAVIORS.map(b => `<option value="${b.id}" ${rule.behavior === b.id ? 'selected' : ''}>${b.label.toUpperCase()}</option>`).join('')}
                </select>
                <select onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'modifiers.hold_type', this.value); loadProfileChannels();" 
                        class="glass-select" style="color:var(--success); font-size:9px; padding:2px; min-width:65px; ${isStatic ? 'opacity:0.3; pointer-events:none;' : ''}">
                    <option value="none" ${rule.modifiers.hold_type === 'none' ? 'selected' : ''}>NONE</option>
                    <option value="floorfreeze" ${rule.modifiers.hold_type === 'floorfreeze' ? 'selected' : ''}>FLOORFREEZE</option>
                    <option value="peakpause" ${rule.modifiers.hold_type === 'peakpause' ? 'selected' : ''}>PEAKPAUSE</option>
                    <option value="beat" ${rule.modifiers.hold_type === 'beat' ? 'selected' : ''}>BEAT</option>
                    <option value="bar" ${rule.modifiers.hold_type === 'bar' ? 'selected' : ''}>BAR</option>
                </select>

                <!-- SAVE AS PREMADE -->
                <div style="display:flex; align-items:center; gap:2px; border-left:1px solid rgba(255,255,255,0.1); padding-left:4px; margin-left:2px;">
                    <input type="text" id="save-label-${chIdx}-${ruleIdx}" placeholder="NAME" 
                           style="width:50px; font-size:8px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); color:var(--text-dim); text-transform:uppercase; padding:2px; height:18px; outline:none;">
                    <button class="btn btn-sm" onclick="saveCurrentRuleAsPremade(${chIdx}, ${ruleIdx})" 
                            style="padding:0 4px; height:18px; font-size:10px; background:var(--accent); color:#000; border-radius:4px; font-weight:bold; border:none; cursor:pointer;" title="Save as Premade Behavior">💾</button>
                </div>
            </div>

            <!-- LINE 4: SLIDERS / STATIC VALUE - SLIDERS ALWAYS VISIBLE FOR TUNING -->
            ${isStatic ? `
                <div style="display:flex; align-items:center; gap:10px; padding:4px 0;">
                    <label style="font-size:9px; font-weight:bold; color:var(--accent);">STATIC VALUE</label>
                    <input type="number" min="0" max="255" value="${rule.value || 0}" 
                           onchange="updateProfileMapping(${chIdx}, ${ruleIdx}, 'value', parseInt(this.value))" 
                           class="glass-input" style="width:60px; height:22px; font-size:11px; font-weight:bold; background:rgba(255,255,255,0.05);">
                    <span style="font-size:8px; color:var(--text-dim);">(Bypasses ranges)</span>
                </div>
            ` : `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; padding:4px 0;">
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:7px; color:var(--text-dim); letter-spacing:0.5px; text-transform:uppercase;">Speed</label>
                            <span style="font-size:9px; color:#fff; font-family:monospace; font-weight:bold;">${parseFloat(rule.modifiers.speed).toFixed(2)}</span>
                        </div>
                        <input type="range" min="0" max="1.0" step="0.01" value="${rule.modifiers.speed}" 
                               oninput="updateProfileMapping(${chIdx}, ${ruleIdx}, 'modifiers.speed', parseFloat(this.value)); this.previousElementSibling.querySelector('span').innerText=parseFloat(this.value).toFixed(2);"
                               style="height:4px; width:100%; accent-color:var(--accent); cursor:pointer;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:7px; color:var(--text-dim); letter-spacing:0.5px; text-transform:uppercase;">Reactivity</label>
                            <span style="font-size:9px; color:#fff; font-family:monospace; font-weight:bold;">${parseFloat(rule.modifiers.react).toFixed(2)}</span>
                        </div>
                        <input type="range" min="0" max="1.0" step="0.01" value="${rule.modifiers.react}" 
                               oninput="updateProfileMapping(${chIdx}, ${ruleIdx}, 'modifiers.react', parseFloat(this.value)); this.previousElementSibling.querySelector('span').innerText=parseFloat(this.value).toFixed(2);"
                               style="height:4px; width:100%; accent-color:var(--secondary, #00f2ff); cursor:pointer;">
                    </div>
                </div>
            `}
        </div>
    `;
}

function applyVariety() {
    if (!confirm("Automatically de-synchronize duplicate role channels? This will shift audio bins and speed calibration on secondary heads.")) return;

    const roleCounts = {};
    currentProfileChannels.forEach((ch, chIdx) => {
        const role = ch.role || "none";
        if (role === "none" || role === "dimmer") return; // Ignore universal/dimmer

        roleCounts[role] = (roleCounts[role] || 0) + 1;
        const count = roleCounts[role];

        if (count > 1) {
            // This is a secondary channel for this role
            const rules = currentProfileMappings[chIdx];
            rules.forEach(rule => {
                // 1. Shift Audio Bin (Source Mapping)
                // If source is a bin, increment it. If it's a generic source, move it to a bin.
                if (rule.source.startsWith('bin_')) {
                    const binNum = parseInt(rule.source.split('_')[1]);
                    rule.source = `bin_${(binNum + (count - 1)) % 6}`;
                } else if (['bass', 'vol', 'low'].includes(rule.source)) {
                    rule.source = `bin_${(count - 1) % 6}`;
                }

                // 2. Micro-Desync via Speed / React
                if (rule.modifiers) {
                    rule.modifiers.speed = Math.max(0.01, Math.min(1.0, rule.modifiers.speed + (0.05 * (count - 1))));
                    rule.modifiers.react = Math.max(0, Math.min(1.0, rule.modifiers.react + (0.1 * (count - 1))));
                }
            });
        }
    });
    loadProfileChannels();
    alert("Variety Applied Successfully.");
}

function addProfileChannel() {
    const newCh = { name: "New Function", role: "none", default: 0 };
    currentProfileChannels.push(newCh);

    // Add matching empty mapping rule
    currentProfileMappings.push([{
        vibe: 'any',
        description: '',
        behavior: 'static',
        source: 'volume',
        cal: { min: 0, center: 127, max: 255 },
        modifiers: { speed: 0.5, react: 0.5, hold_type: 'none' },
        value: 0
    }]);

    loadProfileChannels(); // Re-render
}

function removeProfileChannel(chIdx) {
    if (!confirm(`Are you sure you want to remove channel ${chIdx + 1}?`)) return;
    currentProfileChannels.splice(chIdx, 1);
    currentProfileMappings.splice(chIdx, 1);
    loadProfileChannels();
}


async function duplicateProfileById(id) {
    const original = db.profiles.find(p => p.id === id);
    if (!original) return;

    const copy = JSON.parse(JSON.stringify(original));
    copy.id = 'prof_' + Date.now();
    copy.name = (copy.name || "Unnamed Profile") + " (Copy)";
    
    // Ensure we don't accidentally copy the filename reference which would overwrite the original
    delete copy._fileName;

    db.profiles.push(copy);
    saveDB();
    await window.saveProfileToServer(copy);
    refreshUI();
}

function duplicateProfile() {
    activeProfileId = null;
    const nameField = document.getElementById('prof-name');
    if (nameField) {
        nameField.value = '';
        nameField.focus();
    }
}

async function saveProfile(silent = false) {
    const name = document.getElementById('prof-name').value.trim();
    const activeProfile = db.profiles.find(p => p.id === activeProfileId);

    if (!name) {
        if (!silent) alert("Please enter a Profile Label.");
        return false;
    }
    const profileData = {
        id: activeProfileId || ('prof_' + Date.now()),
        name: name,
        channels: JSON.parse(JSON.stringify(currentProfileChannels)),
        mappings: JSON.parse(JSON.stringify(currentProfileMappings))
    };

    // Use centralized saving logic in shared_setup.js
    const success = await window.saveProfileToServer(profileData);
    if (!success) return false;

    if (silent) {
        activeProfileId = profileData.id;
        refreshUI();
        return true;
    }

    showProfileList();
    refreshUI();
    return true;
}
function downloadBehaviorProfile() {
    const name = document.getElementById('prof-name').value;
    const activeProfile = db.profiles.find(p => p.id === activeProfileId);
    if (!name) return alert("Enter a behavior label first");

    const profile = {
        id: activeProfileId,
        name: name,
        channels: (activeProfile && activeProfile.channels) ? activeProfile.channels : [],
        mappings: JSON.parse(JSON.stringify(currentProfileMappings))
    };

    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\s+/g, '_')}_unified_profile.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
function loadBehaviorProfile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const profileData = JSON.parse(e.target.result);

            if (profileData.name) document.getElementById('prof-name').value = profileData.name;
            if (profileData.id) activeProfileId = profileData.id;
            if (profileData.mappings) {
                currentProfileMappings = profileData.mappings;
                loadProfileChannels(); // This will render the UI
            }
        } catch (err) {
            alert("Error loading behavior: " + err.message);
        }
        event.target.value = ''; // Reset input
    };
    reader.readAsText(file);
}

// Stage management functions moved to stage_logic.js

// Shared Instance update functions moved to stage_logic.js

// Core UI updates: saveDB moved to shared_setup.js, sendIt moved to shared_setup.js

function resetMockDB() {
    if (!confirm("Clear local cache? This does not delete files on the engine.")) return;
    localStorage.removeItem('ravebox_v2_db');
    location.reload();
}

// editFixture removed (legacy)

function toggleChannelCollapse(chIdx) {
    if (collapsedChannels.has(chIdx)) {
        collapsedChannels.delete(chIdx);
    } else {
        collapsedChannels.add(chIdx);
    }
    loadProfileChannels(); // Re-render to reflect state
}

function addVibeRule(chIdx) {
    if (!currentProfileMappings[chIdx]) currentProfileMappings[chIdx] = [];
    currentProfileMappings[chIdx].push({
        vibe: 'any',
        description: 'New Trigger State',
        behavior: 'static',
        source: 'vol',
        cal: { min: 0, center: 127, max: 255 },
        modifiers: { speed: 0.5, react: 0.5, hold_type: 'none' },
        value: 127
    });

    const rules = currentProfileMappings[chIdx];
    if (rules.length === 1) {
        rules[0].vibe = 'any';
    } else if (rules.length > 1) {
        rules[0].vibe = 'any';
        rules[rules.length - 1].vibe = 'high';
        for (let i = 1; i < rules.length - 1; i++) {
            if (rules[i].vibe === 'any' || rules[i].vibe === 'high') {
                rules[i].vibe = 'mid';
            }
        }
    }

    loadProfileChannels();
}

function removeVibeRule(chIdx, ruleIdx) {
    if (currentProfileMappings[chIdx].length <= 1) return;
    currentProfileMappings[chIdx].splice(ruleIdx, 1);

    const rules = currentProfileMappings[chIdx];
    if (rules.length === 1) {
        rules[0].vibe = 'any';
    } else if (rules.length > 1) {
        rules[0].vibe = 'any';
        rules[rules.length - 1].vibe = 'high';
    }

    loadProfileChannels();
}


function editProfile(id) {
    activeProfileId = id;
    const prof = db.profiles.find(p => p.id === id);
    if (!prof) return;

    // Normalization / Healing Layer
    normalizeProfileData(prof);

    document.getElementById('prof-name').value = prof.name;
    
    // Set collapsed state FIRST (Start collapsed as requested)
    collapsedChannels = new Set();
    if (prof.mappings) {
        prof.mappings.forEach((_, i) => collapsedChannels.add(i));
    }

    currentProfileMappings = JSON.parse(JSON.stringify(prof.mappings));

    document.getElementById('profile-list-view').style.display = 'none';
    document.getElementById('profile-editor-view').style.display = 'block';

    loadProfileChannels();
}

function createNewProfile() {
    window.location.href = 'fixture_ai.html';
}



async function deleteProfile(id) {
    if (!confirm("Delete this profile?")) return;

    const prof = db.profiles.find(p => p.id === id);
    if (prof && prof._fileName) {
        console.log(`🗑️ Deleting server file: ${prof._fileName}`);
        try {
            const res = await fetch(`${API_BASE_ROOT}/api/fixtures/${prof._fileName}`, { method: 'DELETE' });
            if (!res.ok) console.warn("⚠️ Server file deletion returned an error, but proceeding with local removal.");
        } catch (e) {
            console.error("❌ Failed to delete server file:", e);
        }
    }

    db.profiles = db.profiles.filter(p => p.id !== id);
    db.stage = db.stage.filter(s => s.profileId !== id);
    saveDB();
    refreshUI();
}

function goToProfile(profileId) {
    // currentTab = 'tab-profile'; // Controlled by switchTab hook now
    if (document.getElementById('tab-profile')) currentTab = 'tab-profile';
    switchTab('tab-profile', true); // Skip the list reset
    editProfile(profileId);
}

// --- 7. PRESET BUILDER LOGIC (Globals defined in shared_setup.js) ---

function updatePresetTriggerFields() {
    // No longer needed for single select, we use addTrigger instead
}

function addEmptyTrigger() {
    currentPresetTriggers.push({ type: '' });
    renderPresetTriggers();
}

function changeTriggerType(idx, type) {
    let trigger = { type: type };
    if (type === 'vibe') trigger = { ...trigger, value: 'chill' };
    else if (type === 'state') trigger = { ...trigger, value: 'building' };
    else if (type === 'volume') trigger = { ...trigger, less_than: 100, greater_than: 0 };
    else if (type === 'bin') trigger = { ...trigger, target: 'BASS', less_than: '', greater_than: '' };
    else if (type === 'channel') trigger = { ...trigger, target: 1, less_than: '', greater_than: '' };

    currentPresetTriggers[idx] = trigger;
    renderPresetTriggers();
}

function removePresetTrigger(idx) {
    currentPresetTriggers.splice(idx, 1);
    renderPresetTriggers();
}

function updateTriggerVal(idx, key, val) {
    currentPresetTriggers[idx][key] = val;
    renderPresetTriggers();
}

function renderPresetTriggers() {
    const container = document.getElementById('pres-active-triggers');
    container.innerHTML = currentPresetTriggers.map((t, idx) => {
        let inputs = '';
        const type = t.type || 'manual';
        const val = t.value || '';
        const target = t.target || '';
        const gt = t.greater_than ?? 0;
        const lt = t.less_than ?? 100;

        if (type === 'vibe') {
            inputs = `
                <select onchange="updateTriggerVal(${idx}, 'value', this.value)" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); color:var(--accent-alt); font-weight:bold;">
                    <option value="chill" ${val === 'chill' ? 'selected' : ''}>Chill</option>
                    <option value="chill 1" ${val === 'chill 1' ? 'selected' : ''}>Chill 1</option>
                    <option value="chill 2" ${val === 'chill 2' ? 'selected' : ''}>Chill 2</option>
                    <option value="chill 3" ${val === 'chill 3' ? 'selected' : ''}>Chill 3</option>
                    <option value="mid" ${val === 'mid' ? 'selected' : ''}>Mid</option>
                    <option value="mid 1" ${val === 'mid 1' ? 'selected' : ''}>Mid 1</option>
                    <option value="mid 2" ${val === 'mid 2' ? 'selected' : ''}>Mid 2</option>
                    <option value="mid 3" ${val === 'mid 3' ? 'selected' : ''}>Mid 3</option>
                    <option value="high" ${val === 'high' ? 'selected' : ''}>High</option>
                    <option value="high 1" ${val === 'high 1' ? 'selected' : ''}>High 1</option>
                    <option value="high 2" ${val === 'high 2' ? 'selected' : ''}>High 2</option>
                    <option value="high 3" ${val === 'high 3' ? 'selected' : ''}>High 3</option>
                </select>
            `;
        } else if (type === 'state') {
            inputs = `
                <select onchange="updateTriggerVal(${idx}, 'value', this.value)">
                    <option value="building" ${val === 'building' ? 'selected' : ''}>Building</option>
                    <option value="tension" ${val === 'tension' ? 'selected' : ''}>Tension</option>
                    <option value="dropping" ${val === 'dropping' ? 'selected' : ''}>Dropping</option>
                </select>
            `;
        } else if (type === 'volume') {
            inputs = `
                <input type="number" value="${gt}" style="width:85px;" placeholder="Min" onchange="updateTriggerVal(${idx}, 'greater_than', parseFloat(this.value))">
                <span>&le;</span>
                <span style="font-weight:bold; color:#ccc;">VOL</span>
                <span>&le;</span>
                <input type="number" value="${lt}" style="width:85px;" placeholder="Max" onchange="updateTriggerVal(${idx}, 'less_than', parseFloat(this.value))">
            `;
        } else if (type === 'bin') {
            inputs = `
                <input type="number" value="${gt}" style="width:85px;" placeholder="Min" onchange="updateTriggerVal(${idx}, 'greater_than', parseFloat(this.value))">
                <span>&le;</span>
                <select onchange="updateTriggerVal(${idx}, 'target', this.value)">
                    ${['SUB', 'BASS', 'KICK', 'LOW_MID', 'MID', 'HIGH_MID', 'PRESENCE', 'BRILLIANCE'].map(b => `<option value="${b}" ${target === b ? 'selected' : ''}>${b}</option>`).join('')}
                </select>
                <span>&le;</span>
                <input type="number" value="${lt}" style="width:85px;" placeholder="Max" onchange="updateTriggerVal(${idx}, 'less_than', parseFloat(this.value))">
            `;
        } else if (type === 'channel') {
            inputs = `
                <input type="number" value="${gt}" style="width:85px;" placeholder="Min" onchange="updateTriggerVal(${idx}, 'greater_than', parseFloat(this.value))">
                <span>&le;</span>
                <input type="number" value="${target}" style="width:85px;" placeholder="Ch #" onchange="updateTriggerVal(${idx}, 'target', parseInt(this.value))">
                <span>&le;</span>
                <input type="number" value="${lt}" style="width:85px;" placeholder="Max" onchange="updateTriggerVal(${idx}, 'less_than', parseFloat(this.value))">
            `;
        } else if (type === 'manual') {
            inputs = 'Manual Activation Only';
        }

        const label = idx === 0 ? "IF:" : "AND:";

        return `
            <div class="item-row" style="background:rgba(255,255,255,0.05); padding:8px; border-radius:4px; margin-bottom:5px; display:flex; flex-direction:column; align-items:flex-start; gap:8px;">
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                    <select style="flex:1; margin-left:10px; margin-right:10px; color:var(--accent); font-weight:bold;" onchange="changeTriggerType(${idx}, this.value)">
                        <option value="" ${t.type === '' ? 'selected' : ''}>-- Select Trigger --</option>
                        <option value="manual" ${t.type === 'manual' ? 'selected' : ''}>Manual Activation</option>
                        <option value="vibe" ${t.type === 'vibe' ? 'selected' : ''}>Vibe Change</option>
                        <option value="state" ${t.type === 'state' ? 'selected' : ''}>Performance State</option>
                        <option value="volume" ${t.type === 'volume' ? 'selected' : ''}>Overall Volume</option>
                        <option value="bin" ${t.type === 'bin' ? 'selected' : ''}>Frequency Bin</option>
                        <option value="channel" ${t.type === 'channel' ? 'selected' : ''}>Channel DMX Value</option>
                    </select>
                    <button class="btn btn-danger btn-sm" onclick="removePresetTrigger(${idx})">X</button>
                </div>
                ${t.type && t.type !== 'manual' ? `<div style="display:flex; gap:10px; align-items:center; margin-left:50px; width:calc(100% - 50px);">${inputs}</div>` : ''}
            </div>
        `;
    }).join('') || '<div style="color:#666; font-size:0.8rem;">No conditionals set.</div>';
}

function addOverrideToCurrentPreset() {
    const fixId = document.getElementById('pres-add-stage-fix')?.value;
    const funcId = document.getElementById('pres-add-global-func')?.value;
    const valInput = document.getElementById('pres-add-global-val')?.value || "0";

    if (!funcId) return alert("Select a function to override.");
    const val = valInput.includes('-') ? valInput : (parseInt(valInput) || 0);

    currentPresetOverrides.push({
        id: fixId,
        target: fixId,
        type: (fixId === 'global') ? 'global' : 'instance',
        name: funcId,
        role: funcId,
        value: val,
        smoothing: 0,
        channels: [{ name: funcId, value: val }]
    });
    renderPresetOverrides();
    // Clear input after adding
    if (document.getElementById('pres-add-global-val')) document.getElementById('pres-add-global-val').value = '';
}

function renderPresetOverrides() {
    const container = document.getElementById('pres-overrides-container');
    container.innerHTML = currentPresetOverrides.map((ov, ovIdx) => {
        const targetLabel = (ov.target === 'global') ? 'GLOBAL' : `FIX: ${ov.target}`;
        return `
            <div class="card" style="margin-bottom:10px; border-left: 3px solid var(--accent);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <div style="font-weight:bold;">${targetLabel} - ${ov.role.toUpperCase()}</div>
                    <button class="btn btn-danger btn-sm" onclick="removePresetOverride(${ovIdx})">Remove Action</button>
                </div>
                <div id="ov-channels-${ovIdx}">
                    <!-- Channel-specific settings for this override -->
                    <div style="display:flex; gap:10px; align-items:center;">
                        <label style="font-size:0.8rem;">Value / Range:</label>
                        <input type="text" value="${ov.value || 0}" onchange="updateOverrideVal(${ovIdx}, this.value)" style="width:120px;" placeholder="e.g. 128 or 0-255">
                        <label style="font-size:0.8rem;">Smoothing:</label>
                        <input type="number" min="0" max="1" step="0.1" value="${ov.smoothing || 0}" onchange="updateOverrideSmooth(${ovIdx}, this.value)" style="width:85px;">
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateOverrideVal(idx, val) {
    const v = val.toString().includes('-') ? val : (parseInt(val) || 0);
    currentPresetOverrides[idx].value = v;
    if (currentPresetOverrides[idx].channels && currentPresetOverrides[idx].channels[0]) {
        currentPresetOverrides[idx].channels[0].value = v;
    }
}

function updateOverrideSmooth(idx, val) {
    currentPresetOverrides[idx].smoothing = parseFloat(val);
}

function removePresetOverride(idx) {
    currentPresetOverrides.splice(idx, 1);
    renderPresetOverrides();
}

function removeOverrideChannel(ovIdx, chIdx) {
    currentPresetOverrides[ovIdx].channels.splice(chIdx, 1);
    if (currentPresetOverrides[ovIdx].channels.length === 0) {
        currentPresetOverrides.splice(ovIdx, 1);
    }
    renderPresetOverrides();
}

function resetPresetForm() {
    current_editing_preset_id = null;
    document.getElementById('pres-name').value = '';
    currentPresetOverrides = [];
    currentPresetTriggers = [{ type: '' }];
    document.getElementById('pres-overrides-container').innerHTML = '';
    
    // Reset AI Button label
    const aiBtn = document.getElementById('preset-ai-gen-btn');
    if (aiBtn) aiBtn.innerText = "✨ Generate";

    renderPresetTriggers();
    renderPresetOverrides();
}

// renderEnsemblePicker and toggleFixtureInTest moved to stage_logic.js


function renderProfileList() {
    const activeProfList = document.getElementById('active-profiles-list');
    if (activeProfList) {
        const stageInstances = db.stage || [];
        const uniqueProfs = [];
        const seenIds = new Set();
        stageInstances.forEach(inst => {
            if (inst.profileId && !seenIds.has(inst.profileId)) {
                const prof = (db.profiles || []).find(p => p.id === inst.profileId);
                if (prof) {
                    uniqueProfs.push(prof);
                    seenIds.add(inst.profileId);
                }
            }
        });
        activeProfList.innerHTML = uniqueProfs.map(p => `
            <div class="item-row" style="cursor:pointer; display:flex; flex-direction:column; align-items:stretch; gap:8px; padding:12px 16px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:700; font-size:1rem; color:#fff;" onclick="editProfile('${p.id}')">${p.name}</div>
                </div>
                <div style="display:flex; align-items:center; gap:12px;" onclick="editProfile('${p.id}')">
                    <div class="live-badge"><span class="live-dot"></span> LIVE</div>
                    <div class="channel-count">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                        ${p.channels?.length || 0} Channels
                    </div>
                </div>
            </div>`).join('') || '<div style="padding:10px; color:#666; font-size:13px;">No behaviors currently active on stage.</div>';
    }

    const savedProfList = document.getElementById('saved-profiles-list');
    if (savedProfList) {
        const uniqueAllProfs = getUniqueProfiles();
        savedProfList.innerHTML = uniqueAllProfs.map(p => `
            <div class="item-row" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; padding:10px 16px;">
                <div style="display:flex; align-items:center; gap:10px;" onclick="editProfile('${p.id}')">
                    <div style="width:8px; height:8px; border-radius:50%; background:var(--accent); opacity:0.5;"></div>
                    <span style="font-weight:600; font-size:13px;">${p.name}</span>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button class="btn btn-danger btn-sm" style="opacity:0; transition:opacity 0.2s; padding:2px 8px; font-size:9px;" onclick="event.stopPropagation(); deleteProfile('${p.id}')">Delete</button>
                </div>
            </div>`).join('') || '<div style="padding:10px; color:#666; font-size:13px;">No profiles yet.</div>';
        
        // Add hover effect to show delete button
        const rows = savedProfList.querySelectorAll('.item-row');
        rows.forEach(row => {
            row.addEventListener('mouseenter', () => { if(row.querySelector('.btn-danger')) row.querySelector('.btn-danger').style.opacity = '1'; });
            row.addEventListener('mouseleave', () => { if(row.querySelector('.btn-danger')) row.querySelector('.btn-danger').style.opacity = '0'; });
        });
    }
}

function showProfileList() {
    const list = document.getElementById('profile-list-view');
    const editor = document.getElementById('profile-editor-view');
    if (list) list.style.display = 'block';
    if (editor) editor.style.display = 'none';
    if (document.getElementById('saved-profiles-list')) renderProfileList();
}

function toggleAllProfiles() {
    const sec = document.getElementById('all-profiles-section');
    if (sec) sec.classList.toggle('collapsed');
}

// Ensure critical UI handlers are global for inline oncick access
window.addVibeRule = addVibeRule;
window.removeVibeRule = removeVibeRule;
window.renderProfileList = renderProfileList;
window.editProfile = editProfile;
window.loadProfileChannels = loadProfileChannels;
window.saveProfile = saveProfile;
window.addProfileChannel = addProfileChannel;
window.duplicateProfileById = duplicateProfileById;
window.removeProfileChannel = removeProfileChannel;
window.addProfileChannel = addProfileChannel;
window.updateProfileMapping = updateProfileMapping;

// --- PRESET CRUD LOGIC (Consolidated from stage_logic.js) ---
async function savePreset(silent = false) {
    const name = document.getElementById('pres-name').value;
    if (!name) return alert("Enter preset name");

    if (current_editing_preset_id) {
        const idx = db.presets.findIndex(p => p.id === current_editing_preset_id);
        if (idx !== -1) {
            db.presets[idx].name = name;
            db.presets[idx].triggers = JSON.parse(JSON.stringify(currentPresetTriggers));
            db.presets[idx].overrides = JSON.parse(JSON.stringify(currentPresetOverrides));
        }
    } else {
        db.presets.push({
            id: 'pre_' + Date.now(),
            name,
            triggers: JSON.parse(JSON.stringify(currentPresetTriggers)),
            overrides: JSON.parse(JSON.stringify(currentPresetOverrides))
        });
    }
    await saveDB();
    refreshUI();
    if (!silent) resetPresetForm();
}

function editPreset(id) {
    const pre = db.presets.find(p => p.id === id);
    if (!pre) return;

    current_editing_preset_id = id;
    document.getElementById('pres-name').value = pre.name;
    currentPresetTriggers = JSON.parse(JSON.stringify(pre.triggers || []));
    currentPresetOverrides = JSON.parse(JSON.stringify(pre.overrides || []));

    renderPresetTriggers();
    renderPresetOverrides();
    
    // Update AI Button label to indicate edit mode
    const aiBtn = document.getElementById('preset-ai-gen-btn');
    if (aiBtn) aiBtn.innerText = "✨ Edit";
    // Use window.switchTab if available (Stage page)
    if (window.switchTab && currentTab !== 'tab-presets') {
        window.switchTab('tab-presets');
    }
    
    // Scroll main container to top to reveal the editing form
    const mainContainer = document.querySelector('.main');
    if (mainContainer) {
        mainContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

async function deletePreset(id) {
    if (!confirm("Delete preset?")) return;
    db.presets = db.presets.filter(p => p.id !== id);
    await saveDB();
    refreshUI();
}

function updatePresetFunctionDropdown() {
    const stageId = document.getElementById('pres-add-stage-fix')?.value;
    const funcSel = document.getElementById('pres-add-global-func');
    const valInput = document.getElementById('pres-add-global-val');
    const valLabel = valInput?.parentElement?.querySelector('label');
    if (!funcSel) return;

    // Reset Defaults
    if (valLabel) valLabel.innerText = "Value / Range (0-255)";
    if (valInput) valInput.placeholder = "e.g. 255 or 0-255";

    if (stageId === 'calibrated') {
        funcSel.innerHTML = '<option value="">-- Select Pattern --</option>' +
            ['Figure-8', 'Circle', 'Lissajous A', 'Lissajous B'].map(p => `<option value="${p}">${p}</option>`).join('');
        if (valLabel) valLabel.innerText = "Pattern Speed (Optional)";
    } else if (stageId === 'visualdmx') {
        funcSel.innerHTML = '<option value="">-- Select Visual Function --</option>' +
            ['strobe', 'blackout', 'spin', 'zoom', 'hue', 'invert', 'next_visual', 'next_fx', 'base_idx', 'fx_idx', 'reset'].map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
        
        funcSel.onchange = () => {
            const fn = funcSel.value;
            if (fn === 'zoom') {
                if (valLabel) valLabel.innerText = "Scale (1.0 = Fit, 0.5 = Wide, 2.0 = Macro)";
                if (valInput) valInput.placeholder = "e.g. 1.5";
            } else if (fn === 'hue') {
                if (valLabel) valLabel.innerText = "Color Wheel (0-255 Rotation)";
                if (valInput) valInput.placeholder = "e.g. 128";
            } else if (fn === 'invert' || fn === 'strobe' || fn === 'blackout' || fn === 'spin') {
                if (valLabel) valLabel.innerText = "Trigger (1 = On, 0 = Off)";
                if (valInput) valInput.placeholder = "1";
            } else if (fn.includes('next_')) {
                if (valLabel) valLabel.innerText = "Pulse (Enter 1 to jump)";
                if (valInput) valInput.placeholder = "1";
            } else if (fn.includes('_idx')) {
                if (valLabel) valLabel.innerText = "Shader Index (0, 1, 2...)";
                if (valInput) valInput.placeholder = "0";
            } else {
                if (valLabel) valLabel.innerText = "Value (Decimals supported)";
            }
        };
        funcSel.onchange(); 
    } else if (stageId === 'system') {
        funcSel.innerHTML = '<option value="">-- Select System Function --</option>' +
            ['rate', 'intensity'].map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
        
        funcSel.onchange = () => {
             const fn = funcSel.value;
             if (fn === 'rate') if (valLabel) valLabel.innerText = "Speed Multiplier (100 = Normal, 200 = 2x)";
             else if (fn === 'intensity') if (valLabel) valLabel.innerText = "Global Output (100 = Normal, 0 = Blk)";
             else if (valLabel) valLabel.innerText = "Multiplier (100 = 1.0x)";
             if (valInput) valInput.placeholder = "100";
        };
        funcSel.onchange();
    } else {
        funcSel.onchange = null;
        funcSel.innerHTML = '<option value="">-- Select Function --</option>' +
            window.KNOWN_ROLES.map(f => `<option value="${f}">${f}</option>`).join('');
    }
}

function renderActivePresets() {
    const bar = document.getElementById('active-presets-bar');
    if (!bar) return;

    const allPresets = (db.presets || []);
    let indicatorHtml = '';
    
    // Core engine states (Lissajous, Calibrated)
    if (window.latestAudioState) {
        if (latestAudioState.lissajous_active > 0.5) {
            indicatorHtml += `<div class="preset-btn active" style="box-shadow: 0 0 15px var(--accent);">LISSAJOUS</div>`;
        }
        if (latestAudioState.calibrated_preset_active) {
            indicatorHtml += `<div class="preset-btn active" style="box-shadow: 0 0 15px var(--success); background:var(--success); border-color:var(--success);">CALIBRATED</div>`;
        }
    }

    // Filtered List: Only show if ever activated during this session OR currently active
    const filteredPresets = allPresets.filter(p => {
        const isActive = (window.activePresets || []).includes(p.id) || (window.activePresets || []).includes(p.name);
        const everActive = window.everActivatedPresets && (window.everActivatedPresets.has(p.id) || window.everActivatedPresets.has(p.name));
        return isActive || everActive;
    });

    if (filteredPresets.length === 0 && !indicatorHtml) {
        bar.innerHTML = '<span style="opacity:0.3; font-size:10px; margin-left:10px;">Waiting for preset triggers...</span>';
        return;
    }

    bar.innerHTML = indicatorHtml + filteredPresets.map(p => {
        const isActive = (window.activePresets || []).includes(p.id) || (window.activePresets || []).includes(p.name);
        const activeClass = isActive ? 'active' : '';
        
        return `<div class="preset-btn ${activeClass}" onclick="togglePreset('${p.id}')">
                    ${p.name.toUpperCase()}
                </div>`;
    }).join('');
}


// Ensure Preset CRUD handlers are global
window.savePreset = savePreset;
window.editPreset = editPreset;
window.deletePreset = deletePreset;
window.updatePresetFunctionDropdown = updatePresetFunctionDropdown;
window.renderActivePresets = renderActivePresets;
window.addEmptyTrigger = addEmptyTrigger;
window.resetPresetForm = resetPresetForm;
window.addOverrideToCurrentPreset = addOverrideToCurrentPreset;
