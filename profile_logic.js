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

const MOD_TYPES = [
    { id: 'none', label: 'NONE' },
    { id: 'dampen_amp', label: 'DAMPEN AMP' },
    { id: 'clamp', label: 'CLAMP' },
    { id: 'gate', label: 'GATE' }
];

function normalizeProfileData(profile) {
    if (!profile) return;
    
    // Canonical Mapping for Behaviors, Sources, and Holds
    const MAP = {
        behaviors: { 
            'lfo': 'sine', 'lfo_sine': 'sine', 
            'lfo_saw': 'saw', 'lfo_square': 'square', 
            'push': 'direct', 'pull': 'direct',
            'kinematic_push': 'direct', 'kinematic_pull': 'direct',
            'noise_simplex': 'noise', 'noise_perlin': 'noise',
            'random': 'noise', 'step': 'noise',
            'markov_adjacent': 'noise', 'markov_erratic': 'noise',
            'step_forward': 'noise', 'step_pingpong': 'noise'
        },
        sources: {
            'low': 'bass', 'mid': 'mids', 'high': 'highs',
            'vol': 'volume', 'raw': 'volume', 
            'flux': 'spectral flux', 'ratio': 'spectral flux',
            'beat': 'beat phase', 'bar': 'bar phase',
            'bin_0': 'bin 0', 'bin_1': 'bin 1', 'bin_2': 'bin 2', 
            'bin_3': 'bin 3', 'bin_4': 'bin 4', 'bin_5': 'bin 5'
        },
        holds: {
            'slowly': 'none', 'quickly': 'none',
            'floorfreeze': 'none', 'peakpause': 'none'
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
                        hold_type: rule.hold_type !== undefined ? rule.hold_type : 'none',
                        mod_type: rule.mod_type || 'none',
                        mod_target: rule.mod_target !== undefined ? rule.mod_target : null
                    };
                }
                
                // Ensure mod keys exist even if modifiers object was partially present
                if (rule.modifiers.mod_type === undefined) rule.modifiers.mod_type = 'none';
                if (rule.modifiers.mod_target === undefined) rule.modifiers.mod_target = null;
                
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
    if (activeProfile) {
        normalizeProfileData(activeProfile);
        window.currentProfileName = activeProfile.name;
    }

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
                source: 'volume',
                cal: { min: 0, center: 127, max: 255 },
                modifiers: { 
                    speed: 0.5, 
                    react: 0.5, 
                    hold_type: 'none',
                    mod_type: 'none',
                    mod_target: null
                },
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
                    hold_type: 'none',
                    mod_type: 'none',
                    mod_target: null
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

    if (typeof window.renderProfileMappings === 'function') {
        window.renderProfileMappings();
    }
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
        source: rule.source || 'volume',
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
        <div class="rule-card" style="background:${isNever ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)'}; border:1px solid ${isNever ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.04)'}; opacity:${isNever ? 0.35 : 1}; padding:6px 10px; border-radius:10px; margin-bottom:4px; position:relative; ${(isNever) ? 'filter: grayscale(1);' : ''}">
            
            <!-- LINE 1: DESCRIPTION (PRIORITY) -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <input type="text" placeholder="Description of this range..." value="${rule.description || ''}" 
                       oninput="updateProfileMapping(${chIdx}, ${ruleIdx}, 'description', this.value)"
                       style="font-size:11px; font-weight:900; color:#fff; text-transform:uppercase; background:transparent; border:none; flex:1; outline:none; text-align:left; letter-spacing:0.5px;">
                <button class="btn btn-sm" onclick="removeVibeRule(${chIdx}, ${ruleIdx})" style="padding:0 4px; color:rgba(255,85,85,0.5); background:none; border:none; font-size:16px;">×</button>
            </div>

            <!-- LINE 2: VIBE | PREMADE | RANGE -->
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; background:rgba(0,0,0,0.25); padding:3px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.03);">
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

                <!-- RANGE: 3-POINT CALIBRATION (HIDDEN IF STATIC) -->
                ${isStatic ? `<div style="width:10px;"></div>` : `
                <div style="display:flex; align-items:center; gap:2px; font-family:var(--font-mono); background:rgba(255,255,255,0.03); padding:3px 5px; border-radius:4px;">
                    <div style="display:flex; flex-direction:column; align-items:center; gap:1px;">
                        <span style="font-size:6px; color:rgba(255,255,255,0.25); letter-spacing:0.5px; text-transform:uppercase;">MIN</span>
                        <input type="text" value="${rule.cal.min}" oninput="enforceDmxLimit(this); updateProfileMapping(${chIdx}, ${ruleIdx}, 'cal.min', parseInt(this.value))" style="background:none; border:none; border-bottom:1px solid rgba(255,255,255,0.1); color:#fff; width:60px; text-align:center; padding:1px 0; font-size:10px; font-weight:bold;">
                    </div>
                    <span style="color:rgba(255,255,255,0.15); font-size:8px; margin:6px 1px 0;">–</span>
                    <div style="display:flex; flex-direction:column; align-items:center; gap:1px;">
                        <span style="font-size:6px; color:var(--accent); letter-spacing:0.5px; text-transform:uppercase; opacity:0.7;">CTR</span>
                        <input type="text" value="${rule.cal.center}" oninput="enforceDmxLimit(this); updateProfileMapping(${chIdx}, ${ruleIdx}, 'cal.center', parseInt(this.value))" style="background:rgba(0,242,255,0.05); border:none; border-bottom:1px solid var(--accent); color:var(--accent); width:60px; text-align:center; padding:1px 0; font-size:10px; font-weight:bold; border-radius:2px;">
                    </div>
                    <span style="color:rgba(255,255,255,0.15); font-size:8px; margin:6px 1px 0;">–</span>
                    <div style="display:flex; flex-direction:column; align-items:center; gap:1px;">
                        <span style="font-size:6px; color:rgba(255,255,255,0.25); letter-spacing:0.5px; text-transform:uppercase;">MAX</span>
                        <input type="text" value="${rule.cal.max}" oninput="enforceDmxLimit(this); updateProfileMapping(${chIdx}, ${ruleIdx}, 'cal.max', parseInt(this.value))" style="background:none; border:none; border-bottom:1px solid rgba(255,255,255,0.1); color:#fff; width:60px; text-align:center; padding:1px 0; font-size:10px; font-weight:bold;">
                    </div>
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
                    ${(window.HOLD_TYPES || []).map(h => `<option value="${h.id}" ${rule.modifiers.hold_type === h.id ? 'selected' : ''}>${h.label.toUpperCase()}</option>`).join('')}
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
                    <input type="text" value="${rule.value || 0}" 
                           oninput="enforceDmxLimit(this); updateProfileMapping(${chIdx}, ${ruleIdx}, 'value', parseInt(this.value))" 
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
                if (rule.source.startsWith('bin ')) {
                    const binNum = parseInt(rule.source.split(' ')[1]);
                    rule.source = `bin ${(binNum + (count - 1)) % 6}`;
                } else if (['bass', 'volume', 'low'].includes(rule.source)) {
                    rule.source = `bin ${(count - 1) % 6}`;
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
    copy.id = window.generateFriendlyId('p', db.profiles.map(p => p.id));
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
    window.compileProfileMappings(); // Force refresh of partitioning mappings before save
    const name = document.getElementById('prof-name').value.trim();
    const activeProfile = db.profiles.find(p => p.id === activeProfileId);

    if (!name) {
        if (!silent) alert("Please enter a Profile Label.");
        return false;
    }
    const profileData = {
        id: activeProfileId || window.generateFriendlyId('p', db.profiles.map(p => p.id)),
        name: name,
        channels: JSON.parse(JSON.stringify(currentProfileChannels)),
        mappings: JSON.parse(JSON.stringify(currentProfileMappings)),
        vibeSplits: JSON.parse(JSON.stringify(window.vibeSplits || {})),
        calibration: activeProfile && activeProfile.calibration ? JSON.parse(JSON.stringify(activeProfile.calibration)) : undefined
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
        mappings: JSON.parse(JSON.stringify(currentProfileMappings)),
        vibeSplits: JSON.parse(JSON.stringify(window.vibeSplits || {}))
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
                if (profileData.vibeSplits) window.vibeSplits = profileData.vibeSplits;
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
        source: 'volume',
        cal: { min: 0, center: 127, max: 255 },
        modifiers: { speed: 0.5, react: 0.5, hold_type: 'none' },
        value: 127
    });

    const rules = currentProfileMappings[chIdx];
    // Ensure the first rule is 'any' if it's currently something else and it's the only rule
    if (rules.length === 1) {
        rules[0].vibe = 'any';
    }
    // Note: We no longer auto-assign mid/high to new rules to respect the user's "default to any" preference.

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

    const nameField = document.getElementById('prof-name');
    if (nameField) nameField.value = prof.name;
    else {
        console.warn("⚠️ [Profile Editor] UI elements missing. Ensure you are on profile.html.");
        return;
    }
    
    // Set collapsed state FIRST (Start collapsed as requested)
    collapsedChannels = new Set();
    if (prof.mappings) {
        prof.mappings.forEach((_, i) => collapsedChannels.add(i));
    }

    currentProfileMappings = JSON.parse(JSON.stringify(prof.mappings));
    if (prof.vibeSplits) window.vibeSplits = JSON.parse(JSON.stringify(prof.vibeSplits));
    else window.vibeSplits = {};

    const listView = document.getElementById('profile-list-view');
    const editorView = document.getElementById('profile-editor-view');
    if (listView) listView.style.display = 'none';
    if (editorView) editorView.style.display = 'block';

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
    // If we are NOT on the profile page (indicated by missing editor view), redirect.
    if (!document.getElementById('profile-editor-view')) {
        console.log(`🚀 Redirecting to profile.html for profile: ${profileId}`);
        window.location.href = `profile.html?id=${profileId}`;
        return;
    }

    if (document.getElementById('tab-profile')) currentTab = 'tab-profile';
    switchTab('tab-profile', true); // Skip the list reset
    editProfile(profileId);
}

// --- 7. PRESET BUILDER LOGIC (Globals defined in shared_setup.js) ---

function updatePresetTriggerFields() {
    // No longer needed for single select, we use addTrigger instead
}

function addConditionFromUI() {
    const typeDrop = document.getElementById('pres-new-trigger-type');
    const type = typeDrop ? typeDrop.value : 'vibe';
    
    let trigger = { type: type };
    if (type === 'vibe') trigger = { ...trigger, value: 'chill' };
    else if (type === 'state') trigger = { ...trigger, value: 'building' };
    else if (type === 'volume') trigger = { ...trigger, less_than: 100, greater_than: 0 };
    else if (type === 'bin') trigger = { ...trigger, target: 'BIN 0', less_than: 100, greater_than: 0 };
    else if (type === 'channel') trigger = { type: 'channel', fixture: (db.stage[0]?.id || ""), role: "dimmer", greater_than: 0, less_than: 255 };

    currentPresetTriggers.push(trigger);
    renderPresetTriggers();
}

function changeTriggerType(idx, type) {
    let trigger = { type: type };
    if (type === 'vibe') trigger = { ...trigger, value: 'chill' };
    else if (type === 'state') trigger = { ...trigger, value: 'building' };
    else if (type === 'volume') trigger = { ...trigger, less_than: 100, greater_than: 0 };
    else if (type === 'bin') trigger = { ...trigger, target: 'BASS', less_than: '', greater_than: '' };
    else if (type === 'channel') trigger = { type: "channel", fixture: (db.stage[0]?.id || ""), role: "dimmer", greater_than: 0, less_than: 255 };

    currentPresetTriggers[idx] = trigger;
    renderPresetTriggers();
}

function removePresetTrigger(idx) {
    currentPresetTriggers.splice(idx, 1);
    renderPresetTriggers();
}

function updateTriggerVal(idx, key, val, silent = false) {
    if (currentPresetTriggers[idx]) {
        currentPresetTriggers[idx][key] = val;
    }
    if (!silent) renderPresetTriggers();
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
                <select onchange="updateTriggerVal(${idx}, 'target', this.value)" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); color:var(--accent); font-weight:bold;">
                    ${['BIN 0', 'BIN 1', 'BIN 2', 'BIN 3', 'BIN 4', 'BIN 5'].map(b => `<option value="${b}" ${target === b ? 'selected' : ''}>${b}</option>`).join('')}
                </select>
                <span>&le;</span>
                <input type="number" value="${lt}" style="width:85px;" placeholder="Max" onchange="updateTriggerVal(${idx}, 'less_than', parseFloat(this.value))">
            `;
        } else if (type === 'channel') {
            const stage = db.stage || [];
            const roles = getFixtureRoles(t.fixture);
            inputs = `
                <input type="text" value="${gt}" style="width:60px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; text-align:center;" placeholder="Min" 
                       oninput="enforceDmxLimit(this); updateTriggerVal(${idx}, 'greater_than', parseInt(this.value), true)">
                <span style="font-size:10px; opacity:0.5;">&le;</span>
                <select onchange="updateTriggerVal(${idx}, 'fixture', this.value); renderPresetTriggers()" style="width:90px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:var(--accent); font-weight:bold; font-size:10px;">
                    <option value="">-- FIX --</option>
                    ${stage.map(s => `<option value="${s.id}" ${t.fixture === s.id ? 'selected' : ''}>${s.id}</option>`).join('')}
                </select>
                <select onchange="updateTriggerVal(${idx}, 'role', this.value)" style="width:100px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:var(--accent-alt); font-weight:bold; font-size:10px;">
                    <option value="">-- FUNC --</option>
                    ${roles.map(r => `<option value="${r}" ${t.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}
                </select>
                <span style="font-size:10px; opacity:0.5;">&le;</span>
                <input type="text" value="${lt}" style="width:60px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; text-align:center;" placeholder="Max" 
                       oninput="enforceDmxLimit(this); updateTriggerVal(${idx}, 'less_than', parseInt(this.value), true)">
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
                        <option value="channel" ${t.type === 'channel' ? 'selected' : ''}>Fixture Function</option>
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

    if (!funcId) return alert("Select a function to override.");
    
    // Default to full intensity (255) for new overrides; user can edit in the list
    const val = 255;

    currentPresetOverrides.push({
        id: (fixId === 'global') ? `global_${funcId}` : fixId,
        target: (fixId === 'global') ? `Global: ${funcId}` : fixId,
        type: (fixId === 'global') ? 'global' : 'instance',
        name: funcId,
        role: funcId,
        value: val,
        channels: [{ name: funcId, value: val }]
    });
    renderPresetOverrides();
}

function renderPresetOverrides() {
    const container = document.getElementById('pres-overrides-container');
    container.innerHTML = currentPresetOverrides.map((ov, ovIdx) => {
        const targetLabel = (ov.type === 'global') ? 'GLOBAL' : `FIX: ${ov.target}`;
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
                        <input type="text" class="glass-input" value="${ov.value || 0}" onchange="updateOverrideVal(${ovIdx}, this.value)" style="width:120px;" placeholder="e.g. 128 or 0-255">
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

function resetPresetForm(skipToggle = false) {
    current_editing_preset_id = null;
    document.getElementById('pres-name').value = '';
    currentPresetOverrides = [];
    currentPresetTriggers = [{ type: '' }];
    document.getElementById('pres-overrides-container').innerHTML = '';
    
    // Reset AI Button label
    const aiBtn = document.getElementById('preset-ai-gen-btn');
    if (aiBtn) aiBtn.innerText = "Generate";

    // Deactivate test mode if active
    if (window.presetTestActive) {
        testPreset(false);
    }

    // 4. Decay
    const decayDrop = document.getElementById('pres-decay-select');
    if (decayDrop) decayDrop.value = "0";

    renderPresetTriggers();
    renderPresetOverrides();

    // Collapse if open
    if (!skipToggle && typeof togglePresetEditor === 'function') togglePresetEditor(false);
}

function addNewPreset() {
    resetPresetForm(true);
    if (typeof togglePresetEditor === 'function') togglePresetEditor(true);
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

    const savedProfList = document.getElementById('saved-profiles-list') || document.getElementById('all-profiles-list');
    if (savedProfList) {
        const uniqueAllProfs = getUniqueProfiles();
        const isAllProfiles = savedProfList.id === 'all-profiles-list';
        
        if (isAllProfiles) {
            const countEl = document.getElementById('all-profiles-count');
            if (countEl) countEl.innerText = `${uniqueAllProfs.length} SAVED`;
            
            savedProfList.innerHTML = uniqueAllProfs.map(p => `
                <div class="item-row" style="padding:10px 16px; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); border-bottom:1px solid rgba(255,255,255,0.02);">
                    <div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="goToProfile('${p.id}')">
                        <div style="width:6px; height:6px; border-radius:50%; background:var(--accent); opacity:0.4;"></div>
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:700; font-size:13px; color:#fff;">${p.name}</span>
                            <span style="font-size:9px; color:#666; font-family:monospace;">${p.id}</span>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button class="btn btn-sm" style="font-size:10px; background:rgba(0, 242, 255, 0.1); border-color:rgba(0, 242, 255, 0.2); color:var(--accent);" onclick="addProfileToStage('${p.id}')">Add to Stage</button>
                        <button class="btn btn-sm" style="font-size:10px;" onclick="goToProfile('${p.id}')">Edit</button>
                        <button class="btn btn-danger btn-sm" style="padding:4px 8px; font-size:9px; opacity:0.4; transition:opacity 0.2s;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.4" onclick="event.stopPropagation(); deleteProfile('${p.id}')">Delete</button>
                    </div>
                </div>`).join('') || '<div style="padding:15px; color:#444; font-size:12px; text-align:center;">No profiles found.</div>';
        } else {
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
        }
        
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
window.testPreset = testPreset;

// --- PRESET CRUD LOGIC (Consolidated from stage_logic.js) ---
window.presetTestActive = false;
function testPreset(forceState) {
    const btn = document.getElementById('preset-test-btn');
    window.presetTestActive = (forceState !== undefined) ? forceState : !window.presetTestActive;

    if (window.presetTestActive) {
        if (btn) {
            btn.innerText = "Deactivate";
            btn.style.background = "var(--accent)";
            btn.style.color = "#000";
            btn.style.borderColor = "var(--accent)";
            btn.style.boxShadow = "0 0 15px var(--accent)";
        }
        
        // Broadcast overrides
        if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            const tempPreset = {
                id: current_editing_preset_id || 'temp_test',
                name: 'TESTING',
                overrides: JSON.parse(JSON.stringify(currentPresetOverrides))
            };
            window.ws.send(JSON.stringify({ 
                type: 'toggle_preset', 
                preset: tempPreset, 
                state: true, 
                exclusive: true 
            }));
        }
    } else {
        if (btn) {
            btn.innerText = "Test";
            btn.style.background = "transparent";
            btn.style.color = "var(--accent-alt)";
            btn.style.borderColor = "var(--accent)";
            btn.style.boxShadow = "none";
        }
        
        // Clear overrides
        if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            window.ws.send(JSON.stringify({ type: 'clear_overrides' }));
        }
    }
}

async function savePreset(silent = false) {
    const name = document.getElementById('pres-name').value;
    if (!name) return alert("Enter preset name");

    if (current_editing_preset_id) {
        const idx = db.presets.findIndex(p => p.id === current_editing_preset_id);
        if (idx !== -1) {
            db.presets[idx].name = name;
            // Filter out any accidental empty triggers
            db.presets[idx].triggers = JSON.parse(JSON.stringify(currentPresetTriggers.filter(t => t.type && t.type !== '')));
            db.presets[idx].overrides = JSON.parse(JSON.stringify(currentPresetOverrides));
            db.presets[idx].decay = parseInt(document.getElementById('pres-decay-select')?.value || 0);
        }
    } else {
        db.presets.push({
            id: window.generateFriendlyId('pr', db.presets.map(p => p.id)),
            name,
            triggers: JSON.parse(JSON.stringify(currentPresetTriggers.filter(t => t.type && t.type !== ''))),
            overrides: JSON.parse(JSON.stringify(currentPresetOverrides)),
            decay: parseInt(document.getElementById('pres-decay-select')?.value || 0)
        });
    }
    await saveDB();
    refreshUI();
    if (!silent) {
        resetPresetForm();
        if (typeof togglePresetEditor === 'function') togglePresetEditor(false);
    }
    if (typeof closePresetAiModal === 'function') closePresetAiModal();
}

function editPreset(id) {
    const pre = db.presets.find(p => p.id === id);
    if (!pre) return;

    if (typeof togglePresetEditor === 'function') togglePresetEditor(true);

    current_editing_preset_id = id;
    document.getElementById('pres-name').value = pre.name;
    currentPresetTriggers = JSON.parse(JSON.stringify(pre.triggers || []));
    currentPresetOverrides = JSON.parse(JSON.stringify(pre.overrides || []));

    renderPresetTriggers();
    renderPresetOverrides();
    
    if (document.getElementById('pres-decay-select')) {
        document.getElementById('pres-decay-select').value = String(pre.decay || 0);
    }
    
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
            ['pause'].map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
        
        funcSel.onchange = () => {
             const fn = funcSel.value;
             if (fn === 'pause') {
                 if (valLabel) valLabel.innerText = "Freeze Engine (255 = Pause, 0 = Play)";
                 if (valInput) valInput.placeholder = "255";
             } else {
                 if (valLabel) valLabel.innerText = "Value";
                 if (valInput) valInput.placeholder = "100";
             }
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
window.savePresetDecay = async function(id, decayValue) {
    const pre = db.presets.find(p => p.id === id);
    if (!pre) return;
    pre.decay = parseInt(decayValue);
    await saveDB();
    console.log(`✅ Preset "${pre.name}" decay updated to ${decayValue}s`);
};
window.renderActivePresets = renderActivePresets;
window.togglePresetMute = async function(id) {
    const pre = db.presets.find(p => p.id === id);
    if (!pre) return;
    pre.active = (pre.active === false) ? true : false;
    await saveDB();
    refreshUI();
    console.log(`✅ Preset "${pre.name}" active state toggled to: ${pre.active}`);
};
window.addConditionFromUI = addConditionFromUI;
window.resetPresetForm = resetPresetForm;
window.addNewPreset = addNewPreset;
window.addOverrideToCurrentPreset = addOverrideToCurrentPreset;
function getFixtureRoles(fixtureId) {
    if (!fixtureId) return [];
    const inst = db.stage.find(s => s.id === fixtureId);
    if (!inst) return [];
    const prof = (db.profiles || []).find(p => p.id === inst.profileId);
    if (!prof) return [];
    return (prof.channels || []).map(ch => ch.role || ch.name).filter(r => r && r !== 'none');
}

    window.channelConfig = window.channelConfig || {};
    window.vibeSplits = window.vibeSplits || {};
    window.simBuffers = {}; 
    window.simPhases = {}; 
    
    // --- 1. COMPILE UI STATE TO LEGACY DB STATE ---
    window.compileProfileMappings = function() {
        if (!window.currentProfileMappings) return;
        
        (window.currentProfileChannels || []).forEach((ch, chIdx) => {
            const conf = window.channelConfig[chIdx];
            if (!conf) return;
            
            const newMappings = [];
            
            conf.ranges.forEach((r) => {
                const rMin = parseFloat(r.min);
                const rMax = parseFloat(r.max);
                const rCtr = parseFloat(r.center !== undefined ? r.center : Math.floor((rMin + rMax) / 2));
                
                newMappings.push({
                    behavior: conf.behavior,
                    vibe: r.vibeNum === 'any' ? 'any' : ('any ' + r.vibeNum),
                    description: 'Partitioned Range',
                    source: conf.source,
                    cal: { min: Math.round(rMin), max: Math.round(rMax), center: Math.round(rCtr) },
                    modifiers: { 
                        speed: conf.speed, 
                        react: conf.react, 
                        hold_type: conf.hold_type || 'none',
                        mod_type: conf.mod_type || 'none',
                        mod_target: conf.mod_target !== undefined ? conf.mod_target : null
                    }
                });
            });
            
            window.currentProfileMappings[chIdx] = newMappings;
        });
    };
    
    // --- 2. MAIN RENDERER ---
    window.renderProfileMappings = function() {
        renderProfileCalibration();
        const container = document.getElementById('prof-mappings');
        if (!container) return;
        
        const titleEl = document.getElementById('prof-name');
        if (titleEl && !titleEl.dataset.loaded) {
            titleEl.value = window.currentProfileName || '';
            titleEl.dataset.loaded = 'true';
        }
        
        let html = '';
        
        (window.currentProfileChannels || []).forEach((ch, chIdx) => {
            const mappings = (window.currentProfileMappings && window.currentProfileMappings[chIdx]) || [];
            
            if (!window.channelConfig[chIdx]) {
                const first = mappings[0] || {};
                const defaultBehavior = first.behavior || 'static';
                const defaultSource = first.source || 'volume';
                const defaultSpeed = first.modifiers ? (first.modifiers.speed !== undefined ? first.modifiers.speed : 0.5) : 0.5;
                const defaultReact = first.modifiers ? (first.modifiers.react !== undefined ? first.modifiers.react : 0.5) : 0.5;
                const defaultHold = first.modifiers ? (first.modifiers.hold_type || 'none') : 'none';
                
                let ranges = mappings.map(m => {
                    const vibeParts = (m.vibe || 'any').split(' ');
                    const rMin = (m.cal?.min !== undefined) ? m.cal.min : 0;
                    const rMax = (m.cal?.max !== undefined) ? m.cal.max : 255;
                    const rCtr = (m.cal?.center !== undefined) ? m.cal.center : Math.floor((rMin + rMax) / 2);
                    return { min: rMin, center: rCtr, max: rMax, vibeNum: vibeParts[1] || 'any' };
                });
                if(ranges.length === 0) ranges = [{min:0, center:127, max:255, vibeNum: 'any'}];
                
                if (!window.vibeSplits) window.vibeSplits = {};
                if (!window.vibeSplits[chIdx]) {
                    // Try to infer from existing mappings if possible, or use default
                    window.vibeSplits[chIdx] = { chillMid: 33, midHigh: 66 };
                }
                const splits = window.vibeSplits[chIdx];
                
                window.channelConfig[chIdx] = { 
                    behavior: defaultBehavior, 
                    source: defaultSource, 
                    speed: defaultSpeed, 
                    react: defaultReact, 
                    hold_type: defaultHold,
                    mod_type: first.modifiers?.mod_type || 'none',
                    mod_target: first.modifiers?.mod_target !== undefined ? first.modifiers.mod_target : null,
                    ranges: ranges 
                };
            }
            
            const conf = window.channelConfig[chIdx];
            const splits = window.vibeSplits[chIdx];
            
            let activeEasyId = window.getActivePreset(conf);
            
            let libOptions = '<option value="">-- Custom / Manual --</option>';
            (window.EASY_DESCRIPTORS || []).forEach(d => {
                libOptions += '<option value="' + d.id + '" ' + (d.id === activeEasyId ? 'selected' : '') + '>' + d.label + '</option>';
            });

            let behaviorOptions = '';
            (window.BEHAVIORS || []).forEach(b => {
                behaviorOptions += '<option value="' + b.id + '" ' + (b.id === conf.behavior ? 'selected' : '') + '>' + b.label + '</option>';
            });

            let sourceOptions = '';
            (window.SOURCES || []).forEach(s => {
                sourceOptions += '<option value="' + s.id + '" ' + (s.id === conf.source ? 'selected' : '') + '>' + s.label + '</option>';
            });

            let rangesHtml = '';
            conf.ranges.forEach((r, rIdx) => {
                rangesHtml += '<div class="range-item" style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">' +
                    '<div style="display:flex; align-items:center; gap:4px;">' +
                        '<select onchange="updateRange(' + chIdx + ', ' + rIdx + ', \'vibeNum\', this.value)" style="background:#1a1a1a; color:var(--accent); border:1px solid #333; border-radius:4px; font-size:9px; padding:1px 4px; font-weight:900; outline:none; cursor:pointer; width:45px;">' +
                            '<option value="any" ' + (r.vibeNum === 'any' ? 'selected' : '') + '>ANY</option>' +
                            '<option value="1" ' + (r.vibeNum === '1' ? 'selected' : '') + '>1</option>' +
                            '<option value="2" ' + (r.vibeNum === '2' ? 'selected' : '') + '>2</option>' +
                            '<option value="3" ' + (r.vibeNum === '3' ? 'selected' : '') + '>3</option>' +
                        '</select>' +
                    '</div>' +
                    '<div style="display:flex; gap:4px; flex:1; justify-content:center; align-items:center;">' +
                        '<input type="number" value="' + r.min + '" onchange="updateRange(' + chIdx + ', ' + rIdx + ', \'min\', this.value)" style="width:36px; background:rgba(45,212,191,0.05); color:#2dd4bf; border:1px solid #2dd4bf; border-radius:4px; text-align:center; font-size:12px; padding:2px 0; font-weight:bold;">' +
                        '<span style="color:var(--text-dim);">-</span>' +
                        '<input type="number" value="' + (r.center !== undefined ? r.center : Math.floor((r.min + r.max) / 2)) + '" onchange="updateRange(' + chIdx + ', ' + rIdx + ', \'center\', this.value)" style="width:36px; background:rgba(14,165,233,0.05); color:#0ea5e9; border:1px solid #0ea5e9; border-radius:4px; text-align:center; font-size:12px; padding:2px 0; font-weight:bold;">' +
                        '<span style="color:var(--text-dim);">-</span>' +
                        '<input type="number" value="' + r.max + '" onchange="updateRange(' + chIdx + ', ' + rIdx + ', \'max\', this.value)" style="width:36px; background:rgba(139,92,246,0.05); color:#8b5cf6; border:1px solid #8b5cf6; border-radius:4px; text-align:center; font-size:12px; padding:2px 0; font-weight:bold;">' +
                    '</div>' +
                    '<button class="btn btn-sm btn-danger" onclick="removeRange(' + chIdx + ', ' + rIdx + ')" style="padding:2px 6px; font-size:10px; height:22px;">X</button>' +
                '</div>';
            });
            
            const isCollapsed = collapsedChannels && collapsedChannels.has(chIdx);
            
            html += '<div class="channel-card ' + (isCollapsed ? 'collapsed' : '') + '" data-chidx="' + chIdx + '">' +
                '<div class="channel-header channel-card-header" onclick="toggleChannelCollapse(' + chIdx + ')" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.05); gap: 10px;">' +
                    '<div class="channel-title" style="margin:0; font-size:12px; font-weight:800; color:var(--accent); flex: 1;"><span class="collapse-icon" style="margin-right:8px; display:inline-block; transition:transform 0.2s;">▼</span>CH ' + (chIdx + 1) + ': ' + (ch.name || ch.role || 'Unassigned') + '</div>' +
                    '<select id="preset-select-' + chIdx + '" class="logic-selector" style="border-color:var(--accent); color:var(--accent); font-weight:bold; margin-bottom: 0; width: auto; flex: 1; padding: 4px 8px;" onchange="applyEasyBehaviorToChannel(' + chIdx + ', this.value)" onclick="event.stopPropagation()">' + libOptions + '</select>' +
                    '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); removeProfileChannel(' + chIdx + ')" style="background:transparent; border:1px solid #ff4757; color:#ff4757; flex-shrink: 0;">Remove</button>' +
                '</div>' +
                '<div class="channel-card-body">' +
                '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:8px;">' +
                    '<div><div class="section-title">LOGIC</div><select class="logic-selector" onchange="updateChannelConfig(' + chIdx + ', \'behavior\', this.value)">' + behaviorOptions + '</select></div>' +
                    '<div><div class="section-title">SOURCE</div><select class="logic-selector" onchange="updateChannelConfig(' + chIdx + ', \'source\', this.value)">' + sourceOptions + '</select></div>' +
                '</div>' +
                '<div class="waveform-wrap" style="height:60px; background:#09090b; border-radius:8px; border:1px solid #27272a; margin-bottom:10px; position:relative; overflow:hidden;">' +
                    '<canvas id="wave-' + chIdx + '" class="behavior-wave" style="width:100%; height:100%; display:block;"></canvas>' +
                    '<div style="position:absolute; top:4px; left:6px; font-size:8px; color:#444; pointer-events:none; font-weight:bold; letter-spacing:1px;">LIVE BEHAVIOR PREVIEW</div>' +
                '</div>' +
                '<div class="section-title">Vibe Mapping Spectrum</div>' +
                '<div class="proportion-container" id="prop-cont-' + chIdx + '" style="touch-action:none;">' +
                    '<div class="vibe-segment chill-seg" style="width: ' + splits.chillMid + '%">CHILL</div>' +
                    '<div class="handle" id="handle1-' + chIdx + '" style="left: calc(' + splits.chillMid + '% - 6px); touch-action:none;"></div>' +
                    '<div class="vibe-segment mid-seg" style="width: ' + (splits.midHigh - splits.chillMid) + '%">MID</div>' +
                    '<div class="handle" id="handle2-' + chIdx + '" style="left: calc(' + splits.midHigh + '% - 6px); touch-action:none;"></div>' +
                    '<div class="vibe-segment high-seg" style="width: ' + (100 - splits.midHigh) + '%">HIGH</div>' +
                '</div>' +
                '<div style="font-size:10px; color:#666; text-align:center; margin-bottom:20px;">Drag handles to adjust the distribution of ranges across vibes.</div>' +
                '<div class="section-title">Valid Value Ranges' +
                    '<button class="btn btn-sm" onclick="addRange(' + chIdx + ')" style="padding:2px 8px; font-size:9px;">+ ADD</button>' +
                '</div>' +
                '<div id="ranges-' + chIdx + '">' + rangesHtml + '</div>' +
                '<div class="controls-grid">' +
                    '<div class="control-group"><label>Base Speed</label><input type="range" class="slider-custom" min="0" max="1" step="0.05" value="' + conf.speed + '" onchange="updateChannelConfig(' + chIdx + ', \'speed\', this.value)"></div>' +
                    '<div class="control-group"><label>Reactivity</label><input type="range" class="slider-custom" min="0" max="1" step="0.05" value="' + conf.react + '" onchange="updateChannelConfig(' + chIdx + ', \'react\', this.value)"></div>' +
                    '<div><div class="section-title">Modulation Type</div><select class="logic-selector" onchange="updateChannelConfig(' + chIdx + ', \'mod_type\', this.value)">' + 
                        MOD_TYPES.map(m => `<option value="${m.id}" ${m.id === conf.mod_type ? 'selected' : ''}>${m.label}</option>`).join('') + 
                    '</select></div>' +
                    '<div><div class="section-title">Mod Target</div><select class="logic-selector" onchange="updateChannelConfig(' + chIdx + ', \'mod_target\', this.value)">' + 
                        '<option value="">-- NONE --</option>' + 
                        (window.currentProfileChannels || []).map((otherCh, otherIdx) => {
                            if (otherIdx === chIdx) return '';
                            return `<option value="${otherIdx}" ${conf.mod_target == otherIdx ? 'selected' : ''}>CH ${otherIdx + 1}: ${(otherCh.name || otherCh.role || 'Unassigned').toUpperCase()}</option>`;
                        }).join('') + 
                    '</select></div>' +
                '</div>' +
            '</div></div>';
        });
        
        container.innerHTML = html;
        
        (window.currentProfileChannels || []).forEach((ch, chIdx) => {
            attachHandleDrag(chIdx, 1);
            attachHandleDrag(chIdx, 2);
        });
        
        compileProfileMappings();
        startWaveformLoop();
    };
    
    // --- 3. EVENT HANDLERS & SIMULATION ---
    window.applyEasyBehaviorToChannel = function(chIdx, easyId) {
        if (!easyId) return;
        const desc = (window.EASY_DESCRIPTORS || []).find(d => d.id === easyId);
        if (!desc) return;
        
        const conf = window.channelConfig[chIdx];
        conf.behavior = desc.behavior || 'static';
        conf.source = desc.source || 'volume';
        conf.speed = desc.speed !== undefined ? desc.speed : 0.5;
        conf.react = desc.react !== undefined ? desc.react : 0.5;
        conf.hold_type = desc.hold_type || 'none';
        
        window.renderProfileMappings();
    };

    window.startWaveformLoop = function() {
        if (window.waveformRunning) return;
        window.waveformRunning = true;
        const loop = () => {
            if (!window.waveformRunning) return;
            drawAllWaveforms();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    };

    // Simple 1D hash for Perlin-like noise (matches engine's _hash1d / _noise1d)
    function _hash1d(x) { return (Math.sin(x) * 43758.5453123) % 1.0; }
    function _noise1d(t) {
        const i = Math.floor(t);
        const f = t - i;
        const u = f * f * f * (f * (f * 6 - 15) + 10);
        const v0 = _hash1d(i);
        const v1 = _hash1d(i + 1);
        return v0 + (v1 - v0) * u;
    }

    window.drawAllWaveforms = function() {
        const audio = window.latestAudioState;
        if (!audio) return;
        const dt = 0.016; // ~60fps frame time
        
        Object.keys(window.channelConfig).forEach(function(chKey) {
            const chIdx = parseInt(chKey);
            const conf = window.channelConfig[chIdx];
            const canvas = document.getElementById('wave-' + chIdx);
            if (!canvas) return;
            
            // Initialize state (mirrors engine's per-rule state)
            if (!window.simStates) window.simStates = {};
            if (!window.simStates[chIdx]) window.simStates[chIdx] = { phase: 0, t: 0, spike_val: 0, last_E: 0, hold_active: false, held_dmx: null };
            if (!window.simBuffers[chIdx]) window.simBuffers[chIdx] = Array(100).fill(127);
            const st = window.simStates[chIdx];
            
            const hold_type = (conf.hold_type || 'none').toLowerCase();
            const is_beat = audio.beat || false;
            const is_bar = audio.bar || false;
            
            if (hold_type === 'beat') {
                if (is_beat) st.hold_active = false;
                else st.hold_active = true;
            } else if (hold_type === 'bar') {
                if (is_bar) st.hold_active = false;
                else st.hold_active = true;
            } else {
                st.hold_active = false;
            }
            
            // --- SOURCE RESOLUTION (matches engine LogicMatrix.state) ---
            let E = 0;
            const src = conf.source;
            if (src === 'volume') E = audio.vol || 0;
            else if (src === 'bass') E = audio.bass || 0;
            else if (src === 'mids' || src === 'mid') E = audio.mid || 0;
            else if (src === 'highs' || src === 'high') E = audio.high || 0;
            else if (src === 'spectral flux') E = audio.flux || 0;
            else if (src === 'impact') E = audio.impact || audio.flux || 0;
            else if (src === 'beat phase') E = audio.beat_phase || 0;
            else if (src === 'bar phase') E = audio.bar_phase || 0;
            else if (src && src.indexOf('bin ') === 0) {
                const bIdx = parseInt(src.split(' ')[1]);
                E = (audio.bins && audio.bins[bIdx] !== undefined) ? Math.min(1.0, audio.bins[bIdx] * 2.0) : 0;
            }

            const speed = conf.speed !== undefined ? conf.speed : 0.5;
            const react = conf.react !== undefined ? conf.react : 0.5;
            const behavior = conf.behavior || 'static';
            
            // --- CAL RANGE (from first range entry) ---
            const r0 = (conf.ranges && conf.ranges[0]) || { min: 0, center: 127, max: 255 };
            const c_min = (r0.min !== undefined) ? parseInt(r0.min) : 0;
            const c_max = (r0.max !== undefined) ? parseInt(r0.max) : 255;
            const c_center = (r0.center !== undefined) ? parseInt(r0.center) : Math.floor((c_min + c_max) / 2);
            
            // --- DYNAMIC VIBE PARTITIONING (Matches Engine) ---
            const vibe = audio.vibe || 'mid';
            const splits = (window.vibeSplits && window.vibeSplits[chIdx]) ? window.vibeSplits[chIdx] : { chillMid: 33, midHigh: 66 };
            let l_bound = 0.0;
            let r_bound = 1.0;
            const s1 = splits.chillMid / 100.0;
            const s2 = splits.midHigh / 100.0;

            if (vibe === 'chill') r_bound = s1;
            else if (vibe === 'mid') { l_bound = s1; r_bound = s2; }
            else if (vibe === 'high') l_bound = s2;

            const span = c_max - c_min;
            const eff_min = c_min + span * l_bound;
            const eff_max = c_min + span * r_bound;
            const eff_center = (eff_min + eff_max) / 2.0;

            // --- BEHAVIOR MATH (mirrors engine _apply_rule_math exactly) ---
            let y = 0.0;
            
            if (behavior === 'static') {
                window.simBuffers[chIdx].push(eff_center);
                if (window.simBuffers[chIdx].length > 100) window.simBuffers[chIdx].shift();
            } else {
                if (behavior === 'direct') {
                    y = (E * 2.0) - 1.0;
                    
                } else if (behavior === 'sine' || behavior === 'square' || behavior === 'saw' || behavior === 'triangle') {
                    const freq = (speed * 0.1) + (E * 5.0 * react);
                    st.phase = (st.phase + dt * freq) % 1.0;
                    const p = st.phase;
                    const amp = react;
                    if (behavior === 'sine') y = amp * Math.sin(p * 2.0 * Math.PI);
                    else if (behavior === 'saw') y = amp * ((p * 2.0) - 1.0);
                    else if (behavior === 'square') y = p < 0.5 ? amp : -amp;
                    
                } else if (behavior === 'noise') {
                    st.t += dt * (speed * 0.5 + E * react * 2.0);
                    y = (_noise1d(st.t) * 2.0) - 1.0;
                    
                } else if (behavior === 'beat phase') {
                    const bp = audio.beat_phase || 0;
                    y = (bp * 2.0 * E) - 1.0;
                    
                } else if (behavior === 'bar phase') {
                    const barp = audio.bar_phase || 0;
                    y = (barp * 2.0 * E) - 1.0;
                    
                } else if (behavior === 'stochastic') {
                    y = (Math.random() * 2.0) - 1.0;
                    
                } else if (behavior === 'spike') {
                    const threshold = (1.0 - react) * 0.35;
                    if (E > st.last_E + threshold) st.spike_val = E;
                    st.spike_val *= Math.max(0.0, 1.0 - dt * speed * 1.2);
                    st.last_E = E;
                    y = (st.spike_val * 2.0) - 1.0;
                    
                } else if (behavior === 'hum') {
                    st.t += dt * speed * 2.5;
                    const osc = Math.sin(st.t) * react * 0.2;
                    y = ((E + osc) * 2.0) - 1.0;
                    
                } else if (behavior === 'fuzzy') {
                    st.t += dt * speed * 1.8;
                    const noise = (_noise1d(st.t) * 2.0 - 1.0) * react * 0.25;
                    y = ((E + noise) * 2.0) - 1.0;
                    
                } else if (behavior === 'direct_stepped') {
                    y = (Math.floor(E * 8) / 8 * 2.0) - 1.0;
                }
                
                // --- CHANNEL MODULATION (Simulation) ---
                if (conf.mod_type && conf.mod_type !== 'none' && conf.mod_target !== null) {
                    const targetIdx = parseInt(conf.mod_target);
                    const targetBuffer = window.simBuffers[targetIdx];
                    if (targetBuffer && targetBuffer.length > 0) {
                        const targetVal = targetBuffer[targetBuffer.length - 1];
                        const targetNorm = targetVal / 255.0;
                        
                        if (conf.mod_type === 'dampen_amp') {
                            y = y * (1.0 - targetNorm);
                        } else if (conf.mod_type === 'dampen_speed') {
                            // Speed modification in simulation is tricky as phase is already updated,
                            // but we can scale the amplitude as a proxy or accept the limitation.
                            // However, the user specifically asked for dampen_speed.
                            // We'll scale y for now as the 'output' of the logic.
                            y = y * (1.0 - targetNorm);
                        } else if (conf.mod_type === 'clamp') {
                            y = Math.min(y, (targetNorm * 2.0) - 1.0);
                        } else if (conf.mod_type === 'gate') {
                            if (targetNorm < 0.1) y = -1.0;
                        }
                    }
                }
                
                // --- Y → DMX MAPPING (mirrors engine exactly) ---
                y = Math.max(-1.0, Math.min(1.0, y));
                let final_dmx;
                if (y >= 0) final_dmx = eff_center + (y * (eff_max - eff_center));
                else final_dmx = eff_center + (y * (eff_center - eff_min));
                
                // Hold Logic
                if (hold_type !== 'none') {
                    if (st.hold_active) {
                        if (st.held_dmx === null) st.held_dmx = final_dmx;
                        final_dmx = st.held_dmx;
                    } else {
                        st.held_dmx = null;
                    }
                }
                
                final_dmx = Math.max(0, Math.min(255, Math.round(final_dmx)));
                
                window.simBuffers[chIdx].push(final_dmx);
                if (window.simBuffers[chIdx].length > 100) window.simBuffers[chIdx].shift();
            }
            
            // --- DRAW ---
            const ctx = canvas.getContext('2d');
            if (canvas.width !== canvas.clientWidth) {
                canvas.width = canvas.clientWidth;
                canvas.height = canvas.clientHeight;
            }
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            
            // Draw range guide lines (min, center, max)
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            // Min line
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.beginPath();
            const yMin = h - (eff_min / 255) * h;
            ctx.moveTo(0, yMin); ctx.lineTo(w, yMin);
            ctx.stroke();
            // Max line
            ctx.beginPath();
            const yMax = h - (eff_max / 255) * h;
            ctx.moveTo(0, yMax); ctx.lineTo(w, yMax);
            ctx.stroke();
            // Center line
            ctx.strokeStyle = 'rgba(0,242,255,0.15)';
            ctx.beginPath();
            const yCtr = h - (eff_center / 255) * h;
            ctx.moveTo(0, yCtr); ctx.lineTo(w, yCtr);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw waveform
            ctx.beginPath();
            ctx.strokeStyle = '#00f2ff';
            ctx.lineWidth = 2;
            const buf = window.simBuffers[chIdx];
            for (let i = 0; i < buf.length; i++) {
                const x = (i / (buf.length - 1)) * w;
                const vy = h - (buf[i] / 255) * h;
                if (i === 0) ctx.moveTo(x, vy);
                else ctx.lineTo(x, vy);
            }
            ctx.stroke();
        });
    };
    
    window.attachHandleDrag = function(chIdx, handleNum) {
        const handle = document.getElementById('handle' + handleNum + '-' + chIdx);
        const cont = document.getElementById('prop-cont-' + chIdx);
        if(!handle || !cont) return;
        
        const startDrag = (e) => {
            e.preventDefault();
            const onMove = (moveEvent) => {
                const clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
                const rect = cont.getBoundingClientRect();
                let pct = ((clientX - rect.left) / rect.width) * 100;
                pct = Math.max(0, Math.min(100, pct));
                
                const splits = window.vibeSplits[chIdx];
                if (handleNum === 1) {
                    pct = Math.min(pct, splits.midHigh - 5);
                    splits.chillMid = pct;
                } else {
                    pct = Math.max(pct, splits.chillMid + 5);
                    splits.midHigh = pct;
                }
                
                // Real-time UI updates
                cont.querySelector('.chill-seg').style.width = splits.chillMid + '%';
                cont.querySelector('.mid-seg').style.width = (splits.midHigh - splits.chillMid) + '%';
                cont.querySelector('.high-seg').style.width = (100 - splits.midHigh) + '%';
                
                const h1 = document.getElementById('handle1-' + chIdx);
                const h2 = document.getElementById('handle2-' + chIdx);
                if (h1) h1.style.left = 'calc(' + splits.chillMid + '% - 6px)';
                if (h2) h2.style.left = 'calc(' + splits.midHigh + '% - 6px)';
                
                window.compileProfileMappings(); // Real-time preview!
            };
            
            const stopDrag = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('mouseup', stopDrag);
                document.removeEventListener('touchend', stopDrag);
            };
            
            document.addEventListener('mousemove', onMove);
            document.addEventListener('touchmove', onMove);
            document.addEventListener('mouseup', stopDrag);
            document.addEventListener('touchend', stopDrag);
        };
        
        handle.onmousedown = startDrag;
        handle.ontouchstart = startDrag;
    };
    
    window.addRange = function(chIdx) {
        window.channelConfig[chIdx].ranges.push({min: 0, center: 127, max: 255, vibeNum: 'any'});
        window.renderProfileMappings();
    };
    
    window.removeRange = function(chIdx, rIdx) {
        window.channelConfig[chIdx].ranges.splice(rIdx, 1);
        if(window.channelConfig[chIdx].ranges.length === 0) {
            window.channelConfig[chIdx].ranges.push({min: 0, center: 127, max: 255, vibeNum: 'any'});
        }
        window.renderProfileMappings();
    };
    
    window.updateRange = function(chIdx, rIdx, field, val) {
        if (field === 'min' || field === 'max' || field === 'center') val = parseInt(val);
        window.channelConfig[chIdx].ranges[rIdx][field] = val;
        window.compileProfileMappings();
    };
    
    window.getActivePreset = function(conf) {
        if (!window.EASY_DESCRIPTORS || !conf) return "";
        for (let d of window.EASY_DESCRIPTORS) {
            let match = true;
            let behaviorTarget = d.behavior || 'static';
            if (behaviorTarget !== conf.behavior) match = false;
            
            let sourceTarget = d.source || 'volume';
            if (behaviorTarget !== 'static' && sourceTarget !== conf.source) match = false;
            
            let speedTarget = d.speed !== undefined ? d.speed : 0.5;
            if (Math.abs(parseFloat(speedTarget) - parseFloat(conf.speed)) > 0.001) match = false;
            
            let reactTarget = d.react !== undefined ? d.react : 0.5;
            if (Math.abs(parseFloat(reactTarget) - parseFloat(conf.react)) > 0.001) match = false;
            
            let holdTarget = d.hold_type || 'none';
            if (holdTarget !== conf.hold_type) match = false;
            
            if (match) return d.id;
        }
        return "";
    };

    window.updateChannelConfig = function(chIdx, field, val) {
        if(field === 'speed' || field === 'react') val = parseFloat(val);
        if(field === 'mod_target') val = val === "" ? null : parseInt(val);
        window.channelConfig[chIdx][field] = val;
        window.compileProfileMappings();
        
        const presetSelect = document.getElementById('preset-select-' + chIdx);
        if (presetSelect) {
            presetSelect.value = window.getActivePreset(window.channelConfig[chIdx]);
        }
    };
    
    const _originalSaveProfile = window.saveProfile;
    window.saveProfile = async function(isSilent) {
        window.compileProfileMappings(); 
        const urlParams = new URLSearchParams(window.location.search);
        const profile = window.db.profiles.find(p => p.id === urlParams.get('id'));
        if(profile) {
            const titleEl = document.getElementById('prof-name');
            if(titleEl) profile.name = titleEl.value;
        }
        if (_originalSaveProfile) return await _originalSaveProfile(isSilent === true);
        else {
            await window.saveProfileToServer(profile);
            if (isSilent !== true) alert("Profile Saved!");
            return true;
        }
    };
    
    window.removeProfileChannel = function(chIdx) {
        if(!confirm(`Remove channel ${chIdx + 1}?`)) return;
        window.currentProfileChannels.splice(chIdx, 1);
        window.currentProfileMappings.splice(chIdx, 1);
        delete window.channelConfig[chIdx];
        delete window.vibeSplits[chIdx];
        const newConf = {};
        const newSplits = {};
        let newIdx = 0;
        for(let key in window.channelConfig) {
            const k = parseInt(key);
            if(k !== chIdx) {
                newConf[newIdx] = window.channelConfig[key];
                newSplits[newIdx] = window.vibeSplits[key];
                newIdx++;
            }
        }
        window.channelConfig = newConf;
        window.vibeSplits = newSplits;
        window.renderProfileMappings();
    };
    
    const _originalAddProfileChannel = window.addProfileChannel;
    window.addProfileChannel = function() {
        if (_originalAddProfileChannel) _originalAddProfileChannel();
        else {
            if(!window.currentProfileChannels) window.currentProfileChannels = [];
            window.currentProfileChannels.push({name: "New Channel", role: "unassigned"});
        }
        setTimeout(() => window.renderProfileMappings(), 50);
    };
// --- 8. PRESET SLIDER SETUP (Tactile Recording) ---
window.activeSliderSetupFixtures = [];
window.sliderSetupValues = {}; // { fixtureId: { channelIdx: value } }

window.renderSliderSetup = function() {
    // 0. Ensure DB is populated
    if (!window.db) {
        console.error("❌ [SliderSetup] window.db is missing!");
        return;
    }

    let stage = window.db.stage || [];
    
    // Nuclear Fallback: If stage is empty, try to force a reload from localStorage
    if (stage.length === 0) {
        const stored = localStorage.getItem('ravebox_v2_db');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed.stage && Array.isArray(parsed.stage) && parsed.stage.length > 0) {
                    console.log("🔄 [SliderSetup] Recovered stage from LocalStorage fallback.");
                    window.db.stage = parsed.stage;
                    stage = parsed.stage;
                }
            } catch(e) {}
        }
    }

    console.log("🛠️ [SliderSetup] Rendering... Fixtures found:", stage.length);
    
    const picker = document.getElementById('pres-slider-setup-picker');
    const strips = document.getElementById('pres-slider-setup-strips');
    if (!picker || !strips) return;

    // 1. Fixture Picker
    picker.innerHTML = stage.map(inst => {
        const isActive = window.activeSliderSetupFixtures.includes(inst.id);
        return `<div class="fixture-picker-pill ${isActive ? 'active' : ''}" onclick="toggleFixtureInSliderSetup('${inst.id}')" style="cursor:pointer; padding:4px 10px; border-radius:15px; background:${isActive ? 'var(--accent)' : 'rgba(255,255,255,0.05)'}; color:${isActive ? '#000' : '#fff'}; font-size:10px; font-weight:800; border:1px solid ${isActive ? 'transparent' : 'rgba(255,255,255,0.1)'}; transition:all 0.2s;">
            ${inst.id}
        </div>`;
    }).join('') || '<div style="color:#666; font-size:12px; padding:10px;">No fixtures found. Check Stage Tab.</div>';

    // 2. Slider Strips
    if (window.activeSliderSetupFixtures.length === 0) {
        strips.innerHTML = '<div style="padding:40px; text-align:center; color:#444; width:100%; border:2px dashed #222; border-radius:12px; font-size:12px; background:rgba(0,0,0,0.2);">Select fixtures above to live-adjust sliders for snapshotting.</div>';
        return;
    }

    let html = '';
    window.activeSliderSetupFixtures.forEach(id => {
        const inst = window.db.stage.find(s => s.id === id);
        if (!inst) return;
        const prof = window.db.profiles.find(p => p.id === inst.profileId);
        if (!prof) return;

        const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
        const channels = prof.channels || [];
        if (!window.sliderSetupValues[id]) window.sliderSetupValues[id] = {};

        html += `
            <div class="test-strip-card" data-fixture-id="${id}" style="min-width: unset; flex-shrink: 0; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; align-items: stretch; gap: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size: 11px; font-weight: 900; color: var(--accent); text-transform: uppercase; letter-spacing: 1px;">${id}</div>
                    <div style="font-size: 9px; color: #555; font-family: monospace;">ADDR: ${baseAddr}</div>
                </div>
                <div style="display: flex; gap: 12px; overflow-x: auto; padding-bottom: 5px; scrollbar-width: none;">
                    ${channels.map((ch, chIdx) => {
                        const addr = baseAddr + (parseInt(ch.addrOffset) || chIdx);
                        const isBusy = window.latestOverrides.has(addr);
                        const val = (window.sliderSetupValues[id] && window.sliderSetupValues[id][chIdx] !== undefined)
                            ? window.sliderSetupValues[id][chIdx] 
                            : (window.latestDmxUniverse[addr] || 0);
                        
                        return `
                            <div class="preset-slider-col ${isBusy ? 'busy' : ''}" data-addr="${addr}" data-fixture-id="${id}" data-idx="${chIdx}" style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                                <div class="preset-slider-role" style="font-size: 8px; font-weight: 800; color: ${isBusy ? 'var(--danger)' : '#777'}; height: 12px; overflow: visible; text-transform: uppercase; width: 36px; text-align: center; cursor: pointer; white-space: nowrap; transition: color 0.2s;" 
                                     onclick="if(window.clearOverride) window.clearOverride(${addr}); else { window.ws.send(JSON.stringify({type: 'clear_overrides', addresses: [${addr}]})); window.latestOverrides.delete(${addr}); window.renderSliderSetup(); }">
                                     ${ch.role || ch.name}
                                </div>
                                <div class="vertical-slider-container" style="${isBusy ? 'border-color: var(--danger); box-shadow: 0 0 10px rgba(255, 71, 87, 0.2);' : ''}">
                                    <div class="dmx-fader-track" style="background: rgba(255,255,255,0.05);"></div>
                                    <input type="range" class="preset-slider-input" min="0" max="255" step="1" value="${val}" 
                                        id="slider-setup-${id}-${chIdx}"
                                        oninput="adjustSliderSetupValue('${id}', ${chIdx}, parseInt(this.value), ${addr})"
                                        onchange="adjustSliderSetupValue('${id}', ${chIdx}, parseInt(this.value), ${addr})"
                                        onkeydown="window.handleSliderKeyNav(event)">
                                    <div class="dmx-fader-cap" id="cap-setup-${id}-${chIdx}" style="bottom: ${Math.round((val / 255) * (120 - 18))}px; ${isBusy ? 'background: linear-gradient(180deg, var(--danger) 0%, #900 100%); border-color: #f00; box-shadow: 0 0 8px var(--danger);' : ''}"></div>
                                </div>
                                <div class="preset-val-display" id="val-setup-${id}-${chIdx}" style="font-size: 10px; font-weight: 900; color: ${isBusy ? 'var(--danger)' : '#fff'}; font-family: 'JetBrains Mono', monospace; background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); min-width: 24px; text-align: center;">${val}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div style="display:flex; justify-content:center;">
                     <button class="btn btn-sm" style="font-size:8px; opacity:0.5; padding:2px 10px; background:transparent;" onclick="clearFixtureOverrides('${id}')">Release Fix</button>
                </div>
            </div>
        `;
    });
    strips.innerHTML = html;
}

window.toggleFixtureInSliderSetup = function(id) {
    if (window.activeSliderSetupFixtures.includes(id)) {
        window.activeSliderSetupFixtures = window.activeSliderSetupFixtures.filter(f => f !== id);
        delete window.sliderSetupValues[id];
    } else {
        window.activeSliderSetupFixtures.push(id);
    }
    window.renderSliderSetup();
}

window.adjustSliderSetupValue = function(id, chIdx, val, addr) {
    if (!window.sliderSetupValues[id]) window.sliderSetupValues[id] = {};
    window.sliderSetupValues[id][chIdx] = val;

    if (addr !== undefined) {
        window.latestOverrides.add(addr);
    }

    // Update visuals inline — do NOT rebuild DOM (renderSliderSetup) during interaction
    const cap = document.getElementById(`cap-setup-${id}-${chIdx}`);
    const valDisplay = document.getElementById(`val-setup-${id}-${chIdx}`);
    if (cap) {
        cap.style.bottom = Math.round((val / 255) * (120 - 18)) + 'px';
        cap.style.background = 'linear-gradient(180deg, var(--danger) 0%, #900 100%)';
        cap.style.borderColor = '#f00';
    }
    if (valDisplay) {
        valDisplay.innerText = val;
        valDisplay.style.color = 'var(--danger)';
    }

    window.sendSliderSetupOverride(id, chIdx, val);
}

window.sendSliderSetupOverride = function(id, chIdx, val) {
    const inst = window.db.stage.find(s => s.id === id);
    if (!inst) return;
    const prof = window.db.profiles.find(p => p.id === inst.profileId);
    if (!prof) return;
    const ch = (prof.channels || [])[chIdx] || {};
    const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
    const addr = baseAddr + (parseInt(ch.addrOffset) || chIdx);

    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
            type: 'laser_override',
            overrides: [{ address: addr, value: val }]
        }));
    }
}

window.clearSliderSetup = function() {
    const addresses = [];
    window.activeSliderSetupFixtures.forEach(id => {
        const inst = window.db.stage.find(s => s.id === id);
        if (!inst) return;
        const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
        const prof = window.db.profiles.find(p => p.id === inst.profileId);
        if (!prof) return;
        (prof.channels || []).forEach((ch, chIdx) => {
            addresses.push(baseAddr + (parseInt(ch.addrOffset) || chIdx));
        });
    });

    if (window.ws && window.ws.readyState === WebSocket.OPEN && addresses.length > 0) {
        window.ws.send(JSON.stringify({
            type: 'clear_channel_overrides',
            addresses: addresses
        }));
    }

    window.activeSliderSetupFixtures = [];
    window.sliderSetupValues = {};
    window.renderSliderSetup();
}

window.recordSliderSetup = function() {
    let capturedCount = 0;
    // Iterate through all fixtures that have been adjusted in the Slider Setup
    Object.keys(window.sliderSetupValues).forEach(fixId => {
        const channels = window.sliderSetupValues[fixId];
        Object.keys(channels).forEach(chIdx => {
            const val = channels[chIdx];
            const inst = window.db.stage.find(s => s.id === fixId);
            if (!inst) return;
            const prof = window.db.profiles.find(p => p.id === inst.profileId);
            if (!prof) return;
            
            const ch = prof.channels[chIdx];
            const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
            const addr = baseAddr + (parseInt(ch.addrOffset) || parseInt(chIdx));
            
            // Only capture if this specific channel is currently overridden (locked)
            if (!window.latestOverrides.has(addr)) return;

            const role = ch.role || ch.name;

            // Check if an override for this fixture/role already exists in currentPresetOverrides
            const existingIdx = currentPresetOverrides.findIndex(ov => ov.id === fixId && ov.role === role);
            const override = {
                id: fixId,
                target: fixId,
                type: 'instance',
                name: role,
                role: role,
                value: val,
                channels: [{ name: role, value: val }]
            };

            if (existingIdx !== -1) {
                currentPresetOverrides[existingIdx] = override;
            } else {
                currentPresetOverrides.push(override);
            }
            capturedCount++;
        });
    });

    if (capturedCount > 0) {
        renderPresetOverrides();
        if (typeof showToast === 'function') showToast(`📸 Snapshot: Captured ${capturedCount} locked values!`, 3000, "success");
    } else {
        if (typeof showToast === 'function') showToast("Move sliders to lock values before snapshotting.", 3000, "warning");
    }
}
function renderProfileCalibration() {
    const profileId = new URLSearchParams(window.location.search).get('id');
    const prof = db.profiles.find(p => p.id === profileId);
    if (!prof) return;

    const roles = (prof.channels || []).map(ch => ch.role || ch.name || '');
    const hasXY = roles.some(r => ['pos_x', 'pos_y', 'pan', 'tilt'].includes(r.toLowerCase()));
    const hasZoom = roles.some(r => r.toLowerCase().includes('zoom'));

    const container = document.getElementById('profile-calibration-container');
    if (!container) return;

    if (!hasXY && !hasZoom) {
        container.innerHTML = '';
        return;
    }

    const cal = prof.calibration || {};
    const x = cal.x || {};
    const y = cal.y || {};
    const zoom = cal.zoom || {};

    const xLeft = (x.left !== undefined && x.left !== null) ? x.left : (x.min !== undefined ? x.min : '');
    const xRight = (x.right !== undefined && x.right !== null) ? x.right : (x.max !== undefined ? x.max : '');
    const yTop = (y.top !== undefined && y.top !== null) ? y.top : '';
    const yBottom = (y.bottom !== undefined && y.bottom !== null) ? y.bottom : '';
    const zSmall = (zoom.smallest !== undefined && zoom.smallest !== null) ? zoom.smallest : '';
    const zLarge = (zoom.largest !== undefined && zoom.largest !== null) ? zoom.largest : '';

    container.innerHTML = `
        <div class="card" style="margin-bottom: 20px; border: 1px solid var(--accent-alt); background: rgba(0, 242, 255, 0.05); padding:15px; border-radius:12px;">
            <div style="font-weight: 900; font-size: 11px; margin-bottom: 15px; color: var(--accent-alt); text-transform: uppercase; letter-spacing: 1px; display:flex; align-items:center; gap:8px;">
                <span style="font-size:14px;">🎯</span> Positional Calibration
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                ${hasXY ? `
                <div>
                    <label style="font-size: 9px; color: var(--text-dim); display: block; margin-bottom: 5px; font-weight:bold;">X RANGE (LEFT - RIGHT)</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="number" value="${xLeft}" onchange="updateCalibration('${prof.id}', 'x', 'left', this.value)" style="width: 100%; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:6px; padding:4px 8px;">
                        <span style="opacity: 0.3;">-</span>
                        <input type="number" value="${xRight}" onchange="updateCalibration('${prof.id}', 'x', 'right', this.value)" style="width: 100%; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:6px; padding:4px 8px;">
                    </div>
                </div>
                <div>
                    <label style="font-size: 9px; color: var(--text-dim); display: block; margin-bottom: 5px; font-weight:bold;">Y RANGE (TOP - BOTTOM)</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="number" value="${yTop}" onchange="updateCalibration('${prof.id}', 'y', 'top', this.value)" style="width: 100%; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:6px; padding:4px 8px;">
                        <span style="opacity: 0.3;">-</span>
                        <input type="number" value="${yBottom}" onchange="updateCalibration('${prof.id}', 'y', 'bottom', this.value)" style="width: 100%; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:6px; padding:4px 8px;">
                    </div>
                </div>
                ` : ''}
                ${hasZoom ? `
                <div>
                    <label style="font-size: 9px; color: var(--text-dim); display: block; margin-bottom: 5px; font-weight:bold;">ZOOM (SMALLEST - LARGEST)</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="number" value="${zSmall}" onchange="updateCalibration('${prof.id}', 'zoom', 'smallest', this.value)" style="width: 100%; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:6px; padding:4px 8px;">
                        <span style="opacity: 0.3;">-</span>
                        <input type="number" value="${zLarge}" onchange="updateCalibration('${prof.id}', 'zoom', 'largest', this.value)" style="width: 100%; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:6px; padding:4px 8px;">
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

function updateCalibration(profId, axis, side, val) {
    const prof = db.profiles.find(p => p.id === profId);
    if (!prof) return;
    if (!prof.calibration) prof.calibration = {};
    if (!prof.calibration[axis]) {
         prof.calibration[axis] = {};
    }
    let num = parseInt(val, 10);
    prof.calibration[axis][side] = isNaN(num) ? null : num;
    saveProfileToServer(prof);
}

/**
 * High-frequency UI update for Preset Slider Setup.
 * Updates slider values and labels from window.latestDmxUniverse.
 */
window.updateSliderSetupVisuals = function() {
    const strips = document.getElementById('pres-slider-setup-strips');
    if (!strips || strips.innerHTML.includes('Select fixtures above')) return;

    window.activeSliderSetupFixtures.forEach(id => {
        const inst = window.db.stage.find(s => s.id === id);
        if (!inst) return;
        const prof = window.db.profiles.find(p => p.id === inst.profileId);
        if (!prof) return;

        const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
        const channels = prof.channels || [];

        channels.forEach((ch, chIdx) => {
            const addr = baseAddr + (parseInt(ch.addrOffset) || chIdx);
            const val = window.latestDmxUniverse[addr];
            
            const slider = document.getElementById(`slider-setup-${id}-${chIdx}`);
            const cap = document.getElementById(`cap-setup-${id}-${chIdx}`);
            const valDisplay = document.getElementById(`val-setup-${id}-${chIdx}`);

            if (slider && !slider.matches(':active')) { // Don't override if user is dragging
                slider.value = val;
            }
            if (cap) {
                cap.style.bottom = Math.round((val / 255) * (120 - 18)) + 'px';
            }
            if (valDisplay) {
                valDisplay.innerText = val;
            }
        });
    });
};

window.handleSliderKeyNav = function(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const current = event.target;
        const all = Array.from(document.querySelectorAll('.preset-slider-input'));
        const idx = all.indexOf(current);
        if (idx === -1) return;
        
        let target = null;
        if (event.key === 'ArrowLeft' && idx > 0) target = all[idx - 1];
        if (event.key === 'ArrowRight' && idx < all.length - 1) target = all[idx + 1];
        
        if (target) {
            event.preventDefault();
            target.focus();
        }
    }
};
