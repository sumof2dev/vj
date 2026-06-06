// --- SAFETY GLOBALS ---
var db = window.db || { profiles: [], stage: [], presets: [], liveConsole: [], savedConsoles: [] };
var activeProfileId = window.activeProfileId || null;
window.currentProfileChannels = window.currentProfileChannels || [];
window.currentProfileMappings = window.currentProfileMappings || [];
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
            'push': 'direct', 'pull': 'direct',
            'kinematic_push': 'direct', 'kinematic_pull': 'direct',
            'noise_simplex': 'noise', 'noise_perlin': 'noise',
            'random': 'noise', 'step': 'noise',
            'markov_adjacent': 'noise', 'markov_erratic': 'noise',
            'step_forward': 'noise', 'step_pingpong': 'noise',
            'hum': 'direct'
        },
        sources: {
            'low': 'bass', 'mid': 'mids', 'high': 'highs',
            'vol': 'volume', 'raw': 'volume', 
            'flux': 'impact', 'ratio': 'impact', 'spectral flux': 'impact',
            'bar': 'bar phase', '2 bar phase': 'bar phase',
            'bin_0': 'bin 0', 'bin_1': 'bin 0', 'bin_2': 'bin 0', 
            'bin_3': 'bin 4', 'bin_4': 'bin 4', 'bin_5': 'bin 4'
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
                        gain: rule.gain !== undefined ? rule.gain : 1.0,
                        hold_type: rule.hold_type !== undefined ? rule.hold_type : 'none'
                    };
                }
                
                // Ensure mod keys exist
                if (rule.modifiers.gain === undefined) rule.modifiers.gain = 1.0;
                
                // 3. Remap Hold Types
                if (MAP.holds[rule.modifiers.hold_type]) rule.modifiers.hold_type = MAP.holds[rule.modifiers.hold_type];
                
                // 4. Scrub Redundant/Legacy Root Keys
                delete rule.speed;
                delete rule.react;
                delete rule.hold_type;
                delete rule.lfo; 
                delete rule.audio;
                delete rule.mod_type;
                delete rule.mod_target;
                if (rule.modifiers) {
                    delete rule.modifiers.mod_type;
                    delete rule.modifiers.mod_target;
                }
                
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
        window.currentProfileChannels = [];
        window.channelConfig = {};
    }

    const activeProfile = activeProfileId ? db.profiles.find(p => p.id === activeProfileId) : null;
    if (activeProfile) {
        normalizeProfileData(activeProfile);
        window.currentProfileName = activeProfile.name;
    }

    if (window.currentProfileChannels.length === 0) {
        window.currentProfileMappings = (activeProfile && activeProfile.mappings) ? JSON.parse(JSON.stringify(activeProfile.mappings)) : [];
        if (activeProfile && activeProfile.channels) {
            window.currentProfileChannels = JSON.parse(JSON.stringify(activeProfile.channels));
        } else if (window.currentProfileChannels.length === 0) {
            // Start with a default channel if brand new
            window.currentProfileChannels = [{ name: 'Master Dimmer', role: 'dimmer', default: 0 }];
            window.currentProfileMappings = [[{
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
            }]];
        }
    }

    const channels = window.currentProfileChannels;
    const container = document.getElementById('prof-mappings');

    if (channels.length === 0) { container.innerHTML = ''; return; }

    // 1. Initialize mappings if empty or length mismatch / LEGACY WIPE
    if (window.currentProfileMappings.length === 0 || window.currentProfileMappings.length !== channels.length || (window.currentProfileMappings[0] && !window.currentProfileMappings[0][0].modifiers)) {
        // START CLEAN: If NO mappings exist OR if they are in the old format (no .modifiers object), wipe and start fresh.
        window.currentProfileMappings = channels.map((ch) => {
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
    window.currentProfileMappings = window.currentProfileMappings.map(rules => {
        if (!Array.isArray(rules)) rules = [rules];
        if (rules.length === 0) {
            rules = [{ vibe: 'any', description: '', behavior: 'static', source: 'volume', cal: { min: 0, center: 127, max: 255 }, modifiers: { speed: 0.5, react: 0.5, gain: 1.0, hold_type: 'none' }, value: 0 }];
        }
        return rules;
    });

    if (typeof window.renderProfileMappings === 'function') {
        window.renderProfileMappings();
    }
}

function updateProfileMapping(chIdx, ruleIdx, path, val) {
    const rule = window.currentProfileMappings[chIdx][ruleIdx];
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
    if (window.currentProfileMappings[chIdx] && window.currentProfileMappings[chIdx][ruleIdx]) {
        const rule = window.currentProfileMappings[chIdx][ruleIdx];
        rule.manual_mode = !rule.manual_mode;
        loadProfileChannels(); // Re-render to show/hide the manual block
    }
}

function applyEasyBehavior(chIdx, ruleIdx, easyId) {
    const rule = window.currentProfileMappings[chIdx][ruleIdx];
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
    const rule = window.currentProfileMappings[chIdx][ruleIdx];
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
        rel_center: rule.cal ? (() => {
            const span = rule.cal.max - rule.cal.min;
            const divisor = Math.abs(span) >= 1 ? span : (span < 0 ? -1 : 1);
            return parseFloat(((rule.cal.center - rule.cal.min) / divisor).toFixed(3));
        })() : 0.5
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
                    <option value="chill" ${rule.vibe === 'chill' ? 'selected' : ''}>Chill</option>
                    <option value="mid" ${rule.vibe === 'mid' ? 'selected' : ''}>Mid</option>
                    <option value="high" ${rule.vibe === 'high' ? 'selected' : ''}>High</option>
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
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; padding:4px 0;">
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
                            <label style="font-size:7px; color:var(--text-dim); letter-spacing:0.5px; text-transform:uppercase;">React</label>
                            <span style="font-size:9px; color:#fff; font-family:monospace; font-weight:bold;">${parseFloat(rule.modifiers.react).toFixed(2)}</span>
                        </div>
                        <input type="range" min="0" max="1.0" step="0.01" value="${rule.modifiers.react}" 
                               oninput="updateProfileMapping(${chIdx}, ${ruleIdx}, 'modifiers.react', parseFloat(this.value)); this.previousElementSibling.querySelector('span').innerText=parseFloat(this.value).toFixed(2);"
                               style="height:4px; width:100%; accent-color:var(--secondary, #00f2ff); cursor:pointer;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:7px; color:var(--accent); letter-spacing:0.5px; text-transform:uppercase;">Gain</label>
                            <span style="font-size:9px; color:var(--accent); font-family:monospace; font-weight:bold;">${parseFloat(rule.modifiers.gain || 1.0).toFixed(2)}</span>
                        </div>
                        <input type="range" min="0" max="1.0" step="0.01" value="${rule.modifiers.gain || 1.0}" 
                               oninput="updateProfileMapping(${chIdx}, ${ruleIdx}, 'modifiers.gain', parseFloat(this.value)); this.previousElementSibling.querySelector('span').innerText=parseFloat(this.value).toFixed(2);"
                               style="height:4px; width:100%; accent-color:var(--accent); cursor:pointer;">
                    </div>
                </div>
            `}
        </div>
    `;
}

function applyVariety() {
    if (!confirm("Automatically de-synchronize duplicate role channels? This will shift audio bins and speed calibration on secondary heads.")) return;

    const roleCounts = {};
    window.currentProfileChannels.forEach((ch, chIdx) => {
        const role = ch.role || "none";
        if (role === "none" || role === "dimmer") return; // Ignore universal/dimmer

        roleCounts[role] = (roleCounts[role] || 0) + 1;
        const count = roleCounts[role];

        if (count > 1) {
            // This is a secondary channel for this role
            const rules = window.currentProfileMappings[chIdx];
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
    window.currentProfileChannels.push(newCh);

    // Add matching empty mapping rule
    window.currentProfileMappings.push([{
        vibe: 'any',
        description: '',
        behavior: 'static',
        source: 'volume',
        cal: { min: 0, center: 127, max: 255 },
        modifiers: { speed: 0.5, react: 0.5, gain: 1.0, hold_type: 'none' },
        value: 0
    }]);

    loadProfileChannels(); // Re-render
}

function removeProfileChannel(chIdx) {
    if (!confirm(`Are you sure you want to remove channel ${chIdx + 1}?`)) return;
    window.currentProfileChannels.splice(chIdx, 1);
    window.currentProfileMappings.splice(chIdx, 1);
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
        channels: JSON.parse(JSON.stringify(window.currentProfileChannels)),
        mappings: JSON.parse(JSON.stringify(window.currentProfileMappings)),
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
        mappings: JSON.parse(JSON.stringify(window.currentProfileMappings)),
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
                window.currentProfileMappings = profileData.mappings;
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
    if (!window.currentProfileMappings[chIdx]) window.currentProfileMappings[chIdx] = [];
    window.currentProfileMappings[chIdx].push({
        vibe: 'any',
        description: 'Partitioned Range',
        behavior: 'static',
        source: 'volume',
        cal: { min: 0, center: 127, max: 255 },
        modifiers: { speed: 0.5, react: 0.5, gain: 1.0, hold_type: 'none' },
        value: 127
    });

    const rules = window.currentProfileMappings[chIdx];
    // Ensure the first rule is 'any' if it's currently something else and it's the only rule
    if (rules.length === 1) {
        rules[0].vibe = 'any';
    }
    // Note: We no longer auto-assign mid/high to new rules to respect the user's "default to any" preference.

    loadProfileChannels();
}

function removeVibeRule(chIdx, ruleIdx) {
    if (window.currentProfileMappings[chIdx].length <= 1) return;
    window.currentProfileMappings[chIdx].splice(ruleIdx, 1);

    const rules = window.currentProfileMappings[chIdx];
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

    window.currentProfileMappings = JSON.parse(JSON.stringify(prof.mappings));
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
    currentPresetTriggers.push({ type: '' });
    renderPresetTriggers();
}

function changeTriggerType(idx, type) {
    let trigger = { type: type };
    if (type === 'vibe') trigger = { ...trigger, value: 'chill' };
    else if (type === 'state') trigger = { ...trigger, value: 'building' };
    else if (type === 'volume') trigger = { ...trigger, less_than: 100, greater_than: 0 };
    else if (type === 'bin') trigger = { ...trigger, target: 'bass' };

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
    if (!container) return;
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
                    <option value="mid" ${val === 'mid' ? 'selected' : ''}>Mid</option>
                    <option value="high" ${val === 'high' ? 'selected' : ''}>High</option>
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
            const currentTarget = target || 'bass';
            inputs = `
                <select onchange="updateTriggerVal(${idx}, 'target', this.value)" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); color:var(--accent); font-weight:bold;">
                    <option value="bass" ${currentTarget === 'bass' ? 'selected' : ''}>Bass</option>
                    <option value="mid" ${currentTarget === 'mid' ? 'selected' : ''}>Mid</option>
                    <option value="treble" ${currentTarget === 'treble' ? 'selected' : ''}>Treble</option>
                </select>
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
                        <option value="vibe" ${t.type === 'vibe' ? 'selected' : ''}>Vibe</option>
                        <option value="state" ${t.type === 'state' ? 'selected' : ''}>Performance State</option>
                        <option value="volume" ${t.type === 'volume' ? 'selected' : ''}>Overall Volume</option>
                        <option value="bin" ${t.type === 'bin' ? 'selected' : ''}>Dominant EQ</option>
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
    
    // Smart defaults per target type
    const VDMX_DEFAULTS = { strobe: 255, blackout: 1, spin: 1, invert: 1, next_visual: 1, next_fx: 1, zoom: 1, hue: 0, reset: 1 };
    let val = 255;
    if (fixId === 'visualdmx' && funcId in VDMX_DEFAULTS) val = VDMX_DEFAULTS[funcId];

    let id, target, type;
    if (fixId === 'global') {
        id = `global_${funcId}`;
        target = `Global: ${funcId}`;
        type = 'global';
    } else if (fixId === 'visualdmx') {
        id = 'visualdmx';
        target = 'visualdmx';
        type = 'instance';
    } else {
        id = fixId;
        target = fixId;
        type = 'instance';
    }

    currentPresetOverrides.push({
        id: id,
        target: target,
        type: type,
        name: funcId,
        role: funcId,
        value: val,
        channels: [{ name: funcId, value: val }],
        fixture: target
    });
    renderPresetOverrides();
}

function renderPresetOverrides() {
    const container = document.getElementById('pres-overrides-container');
    if (!container) return;

    // VisualDMX function → human-readable option map
    const VDMX_OPTIONS = {
        strobe:       [{label:'Off', val:0}, {label:'Slow', val:64}, {label:'Med', val:128}, {label:'Fast', val:200}, {label:'Max', val:255}],
        blackout:     [{label:'Normal', val:0}, {label:'Blackout', val:1}],
        spin:         [{label:'Off', val:0}, {label:'On', val:1}],
        invert:       [{label:'Off', val:0}, {label:'On', val:1}],
        next_visual:  [{label:'Trigger', val:1}],
        next_fx:      [{label:'Trigger', val:1}],
        zoom:         [{label:'Wide (0.5x)', val:0.5}, {label:'Fit (1x)', val:1}, {label:'Tight (1.5x)', val:1.5}, {label:'Macro (2x)', val:2}],
        hue:          [{label:'Red', val:0}, {label:'Orange', val:32}, {label:'Yellow', val:64}, {label:'Green', val:96}, {label:'Cyan', val:128}, {label:'Blue', val:160}, {label:'Purple', val:192}, {label:'Pink', val:224}],
        base_idx:     null, // numeric input
        fx_idx:       null, // numeric input
        reset:        [{label:'Reset', val:1}],
    };

    container.innerHTML = currentPresetOverrides.map((ov, ovIdx) => {
        const targetLabel = (ov.type === 'global') ? 'GLOBAL' : 
                            (ov.target === 'visualdmx') ? 'VISUALIZER' : 
                            (['left_harmonic', 'right_harmonic', 'left_percussive', 'right_percussive'].includes(ov.target)) ? `ZONE: ${ov.target.toUpperCase().replace('_', ' ')}` : 
                            `FIX: ${ov.target}`;
        const fn = (ov.role || ov.name || '').toLowerCase();

        let valueHtml = '';
        let optionSet = null;

        if (ov.target === 'visualdmx' && fn in VDMX_OPTIONS) {
            optionSet = VDMX_OPTIONS[fn];
        }

        if (optionSet) {
            // Render dropdown with human-readable labels
            const currentVal = ov.value;
            valueHtml = `
                <select class="glass-select" onchange="updateOverrideVal(${ovIdx}, this.value)" style="width:160px; height:32px; font-size:12px; font-weight:bold;">
                    ${optionSet.map(opt => `<option value="${opt.val}" ${String(currentVal) === String(opt.val) ? 'selected' : ''}>${opt.label}</option>`).join('')}
                </select>
            `;
        } else {
            // Split inputs: Value/Range, Offset, Speed
            const parts = parsePresetValueParts(ov.value);
            valueHtml = `
                <div style="display:flex; gap:8px; align-items:center; width:100%; flex-wrap: wrap;">
                    <input type="text" class="glass-input" id="ov-base-${ovIdx}" value="${parts.base}" onchange="updateOverrideParts(${ovIdx})" style="flex:2; min-width:100px; height:32px;" placeholder="e.g. 128 or 0-255">
                    <div style="display:flex; align-items:center; gap:4px; flex:1; min-width:70px;">
                        <span style="font-size:11px; opacity:0.5; font-weight:bold; color:var(--text);">+</span>
                        <input type="number" class="glass-input" id="ov-offset-${ovIdx}" value="${parts.offset}" onchange="updateOverrideParts(${ovIdx})" style="width:100%; height:32px; padding:0 6px; text-align:center;" placeholder="offset">
                    </div>
                    <div style="display:flex; align-items:center; gap:4px; flex:1; min-width:70px;">
                        <span style="font-size:11px; opacity:0.5; font-weight:bold; color:var(--text);">x</span>
                        <input type="number" class="glass-input" id="ov-speed-${ovIdx}" value="${parts.speed}" onchange="updateOverrideParts(${ovIdx})" style="width:100%; height:32px; padding:0 6px; text-align:center;" placeholder="speed" step="0.1" min="0.1">
                    </div>
                </div>
            `;
        }

        return `
            <div class="card" style="margin-bottom:10px; border-left: 3px solid ${ov.target === 'visualdmx' ? 'var(--secondary)' : 'var(--accent)'};">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <div style="font-weight:bold;">${targetLabel} - ${ov.role.toUpperCase()}</div>
                    <button class="btn btn-danger btn-sm" onclick="removePresetOverride(${ovIdx})">Remove Action</button>
                </div>
                <div id="ov-channels-${ovIdx}">
                    <div style="display:flex; gap:10px; align-items:center;">
                        <label style="font-size:0.8rem;">${optionSet ? 'Action:' : 'Value / Range:'}</label>
                        ${valueHtml}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}


function updateOverrideVal(idx, val) {
    const sVal = val.toString();
    const v = (sVal.includes('-') || sVal.includes(',') || sVal.includes('+') || sVal.toLowerCase().includes('x')) ? val : (parseInt(val) || 0);
    currentPresetOverrides[idx].value = v;
    if (currentPresetOverrides[idx].channels && currentPresetOverrides[idx].channels[0]) {
        currentPresetOverrides[idx].channels[0].value = v;
    }
}

window.parsePresetValueParts = function(val) {
    if (typeof val === 'number') {
        return { base: val, offset: '', speed: '' };
    }
    const valStr = String(val || '').trim();
    if (!valStr) {
        return { base: '', offset: '', speed: '' };
    }

    let base = valStr;
    let offset = '';
    let speed = '';

    // 1. Extract speed multiplier (x[number])
    const speedMatch = base.match(/x\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (speedMatch) {
        speed = speedMatch[1];
        base = base.replace(speedMatch[0], '').trim();
    }

    // 2. Extract offset (+ [number])
    const offsetMatch = base.match(/\+\s*([0-9]+(?:\.[0-9]+)?)/);
    if (offsetMatch) {
        offset = offsetMatch[1];
        base = base.replace(offsetMatch[0], '').trim();
    }

    return {
        base: base.trim(),
        offset: offset,
        speed: speed
    };
};

window.updateOverrideParts = function(ovIdx) {
    const baseInput = document.getElementById(`ov-base-${ovIdx}`);
    const offsetInput = document.getElementById(`ov-offset-${ovIdx}`);
    const speedInput = document.getElementById(`ov-speed-${ovIdx}`);
    if (!baseInput) return;

    const baseVal = baseInput.value.trim();
    const offsetVal = offsetInput ? offsetInput.value.trim() : '';
    const speedVal = speedInput ? speedInput.value.trim() : '';

    let combined = baseVal;
    if (offsetVal !== '' && !isNaN(offsetVal)) {
        combined += " + " + offsetVal;
    }
    if (speedVal !== '' && !isNaN(speedVal)) {
        combined += " x" + speedVal;
    }

    updateOverrideVal(ovIdx, combined);
};


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
    if (!funcSel) return;

    if (stageId === 'calibrated') {
        funcSel.innerHTML = '<option value="">-- Select Pattern --</option>' +
            ['Figure-8', 'Circle', 'Lissajous A', 'Lissajous B'].map(p => `<option value="${p}">${p}</option>`).join('');
    } else if (stageId === 'visualdmx') {
        funcSel.innerHTML = '<option value="">-- Select Visual Function --</option>' +
            ['strobe', 'blackout', 'spin', 'zoom', 'hue', 'invert', 'next_visual', 'next_fx', 'base_idx', 'fx_idx', 'reset'].map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
        funcSel.onchange = null;
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
            
            conf.ranges.forEach((r, rIdx) => {
                let rMin = parseFloat(r.min);
                let rMax = parseFloat(r.max);
                if (isNaN(rMin)) rMin = 0;
                if (isNaN(rMax)) rMax = 255;
                rMin = Math.max(0, Math.min(255, Math.round(rMin)));
                rMax = Math.max(0, Math.min(255, Math.round(rMax)));
                let rCtr = parseFloat(r.center !== undefined ? r.center : Math.floor((rMin + rMax) / 2));
                if (isNaN(rCtr)) rCtr = Math.floor((rMin + rMax) / 2);
                const boundsMin = Math.min(rMin, rMax);
                const boundsMax = Math.max(rMin, rMax);
                rCtr = Math.max(boundsMin, Math.min(boundsMax, Math.round(rCtr)));
                
                newMappings.push({
                    easy_id: conf.easy_id || undefined,
                    behavior: conf.behavior,
                    vibe: 'any',
                    description: 'Partitioned Range',
                    source: conf.source,
                    cal: { min: Math.round(rMin), max: Math.round(rMax), center: Math.round(rCtr) },
                    modifiers: { 
                        speed: conf.speed, 
                        react: conf.react, 
                        gain: r.gain !== undefined ? r.gain : 1.0,
                        threshold: conf.threshold || 0,
                        threshold_hold_active: conf.threshold_hold_active ? true : false,
                        threshold_hold_value: (conf.threshold_hold_value !== '' && conf.threshold_hold_value !== undefined) ? parseInt(conf.threshold_hold_value) : '',
                        hold_type: conf.hold_type || 'none',
                        muted: r.muted ? true : false
                    },
                    muted: r.muted ? true : false
                });
            });
            
            window.currentProfileMappings[chIdx] = newMappings;
        });
    };
    
    // --- 2. MAIN RENDERER ---
    window.renderProfileMappings = function() {
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
                    const rMin = (m.cal?.min !== undefined) ? m.cal.min : 0;
                    const rMax = (m.cal?.max !== undefined) ? m.cal.max : 255;
                    const rCtr = (m.cal?.center !== undefined) ? m.cal.center : Math.floor((rMin + rMax) / 2);
                    const rGain = (m.modifiers && m.modifiers.gain !== undefined) ? m.modifiers.gain : 1.0;
                    const rMuted = (m.muted !== undefined) ? !!m.muted : (m.modifiers?.muted !== undefined ? !!m.modifiers.muted : false);
                    return { min: rMin, center: rCtr, max: rMax, gain: rGain, muted: rMuted };
                });
                if(ranges.length === 0) ranges = [{min:0, center:127, max:255, gain:1.0, muted:false}];
                
                if (!window.vibeSplits) window.vibeSplits = {};
                if (!window.vibeSplits[chIdx]) {
                    // Try to infer from existing mappings if possible, or use default
                    window.vibeSplits[chIdx] = { chillMid: 33, midHigh: 66 };
                }
                const splits = window.vibeSplits[chIdx];
                
                window.channelConfig[chIdx] = { 
                    easy_id: first.easy_id || '',
                    behavior: defaultBehavior, 
                    source: defaultSource, 
                    speed: defaultSpeed, 
                    react: defaultReact, 
                    threshold: first.modifiers ? (first.modifiers.threshold !== undefined ? first.modifiers.threshold : 0) : 0,
                    threshold_hold_active: first.modifiers ? (first.modifiers.threshold_hold_active !== undefined ? !!first.modifiers.threshold_hold_active : false) : false,
                    threshold_hold_value: first.modifiers ? (first.modifiers.threshold_hold_value !== undefined ? first.modifiers.threshold_hold_value : '') : '',
                    hold_type: defaultHold,
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

            let roleOptions = '';
            (window.KNOWN_ROLES || []).forEach(r => {
                roleOptions += '<option value="' + r + '" ' + (r === ch.role ? 'selected' : '') + '>' + r.toUpperCase() + '</option>';
            });

            let rangesHtml = '';
            conf.ranges.forEach((r, rIdx) => {
                const isMuted = !!r.muted;
                const dimStyle = isMuted ? 'opacity:0.35; pointer-events:none; filter:grayscale(0.5);' : '';
                
                let muteBtn = '<button onclick="updateRange(' + chIdx + ', ' + rIdx + ', \'muted\', ' + (!isMuted) + ', this); setTimeout(() => window.renderProfileMappings(), 10);" ' +
                    'class="btn btn-sm" ' +
                    'style="width:22px; height:22px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:4px; font-size:10px; border:1px solid ' + (isMuted ? 'rgba(255, 71, 87, 0.4)' : 'rgba(45, 212, 191, 0.4)') + '; ' +
                    'background:' + (isMuted ? 'rgba(255, 71, 87, 0.15)' : 'rgba(45, 212, 191, 0.15)') + '; ' +
                    'color:' + (isMuted ? '#ff4757' : '#2dd4bf') + '; cursor:pointer;" ' +
                    'title="' + (isMuted ? 'Unmute range (activate)' : 'Mute range (deactivate)') + '">' +
                    (isMuted ? '🔇' : '🔊') +
                    '</button>';

                rangesHtml += '<div class="range-item" style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">' +
                    '<div style="display:flex; align-items:center; width:22px; justify-content:center;">' + muteBtn + '</div>' +
                    '<div style="display:flex; gap:8px; flex:1; align-items:center; transition:opacity 0.2s; ' + dimStyle + '">' +
                        '<div style="display:flex; gap:4px; flex:1; justify-content:center; align-items:center;">' +
                            '<input type="number" min="0" max="255" value="' + r.min + '" onchange="updateRange(' + chIdx + ', ' + rIdx + ', \'min\', this.value, this)" style="width:34px; background:rgba(45,212,191,0.05); color:#2dd4bf; border:1px solid #2dd4bf; border-radius:4px; text-align:center; font-size:11px; padding:2px 0; font-weight:bold;">' +
                            '<input type="number" min="0" max="255" value="' + (r.center !== undefined ? r.center : Math.floor((r.min + r.max) / 2)) + '" onchange="updateRange(' + chIdx + ', ' + rIdx + ', \'center\', this.value, this)" style="width:34px; background:rgba(14,165,233,0.05); color:#0ea5e9; border:1px solid #0ea5e9; border-radius:4px; text-align:center; font-size:11px; padding:2px 0; font-weight:bold;">' +
                            '<input type="number" min="0" max="255" value="' + r.max + '" onchange="updateRange(' + chIdx + ', ' + rIdx + ', \'max\', this.value, this)" style="width:34px; background:rgba(139,92,246,0.05); color:#8b5cf6; border:1px solid #8b5cf6; border-radius:4px; text-align:center; font-size:11px; padding:2px 0; font-weight:bold;">' +
                        '</div>' +
                        '<div style="display:flex; align-items:center; gap:4px; flex:1;">' +
                            '<span style="font-size:7px; color:var(--accent); font-weight:bold;">GAIN</span>' +
                            '<input type="range" min="0" max="1" step="0.05" value="' + (r.gain !== undefined ? r.gain : 1.0) + '" oninput="updateRange(' + chIdx + ', ' + rIdx + ', \'gain\', this.value, this)" style="flex:1; height:4px; accent-color:var(--accent);">' +
                        '</div>' +
                        '<button class="btn btn-sm btn-danger" onclick="removeRange(' + chIdx + ', ' + rIdx + ')" style="padding:2px 6px; font-size:10px; height:22px;">X</button>' +
                    '</div>' +
                '</div>';
            });
            
            const isCollapsed = collapsedChannels && collapsedChannels.has(chIdx);
            
            html += '<div class="channel-card ' + (isCollapsed ? 'collapsed' : '') + '" data-chidx="' + chIdx + '">' +
                '<div class="channel-header channel-card-header" onclick="toggleChannelCollapse(' + chIdx + ')" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.05); gap: 10px;">' +
                    '<div class="channel-title" style="margin:0; font-size:12px; font-weight:800; color:var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><span class="collapse-icon" style="margin-right:8px; display:inline-block; transition:transform 0.2s;">▼</span>CH ' + (chIdx + 1) + '</div>' +
                    '<select class="logic-selector" style="border-color:var(--accent-alt); color:var(--accent-alt); font-weight:900; margin-bottom: 0; width: auto; flex: 1.2; padding: 4px 8px; font-size: 11px;" onchange="updateChannelRole(' + chIdx + ', this.value)" onclick="event.stopPropagation()">' + roleOptions + '</select>' +
                    '<select id="preset-select-' + chIdx + '" class="logic-selector" style="border-color:var(--accent); color:var(--accent); font-weight:900; margin-bottom: 0; width: auto; flex: 1.2; padding: 4px 8px; font-size: 11px;" onchange="applyEasyBehaviorToChannel(' + chIdx + ', this.value)" onclick="event.stopPropagation()">' + libOptions + '</select>' +
                    '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); removeProfileChannel(' + chIdx + ')" style="background:transparent; border:1px solid #ff4757; color:#ff4757; flex-shrink: 0; font-weight: 900; font-size: 10px; padding: 4px 8px;">×</button>' +
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
                '<div class="section-title">Valid Value Ranges' +
                    '<button class="btn btn-sm" onclick="addRange(' + chIdx + ')" style="padding:2px 8px; font-size:9px;">+ ADD</button>' +
                '</div>' +
                '<div id="ranges-' + chIdx + '">' + rangesHtml + '</div>' +
                '<div class="controls-grid" style="display:flex; flex-direction:column; gap:8px;">' +
                    '<div class="control-group" style="display:flex; flex-direction:column; gap:4px;">' +
                        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">' +
                            '<label style="margin-bottom:0; font-size:10px; font-weight:800; color:var(--text-dim);">Threshold</label>' +
                            '<div style="display:flex; align-items:center; gap:6px;">' +
                                '<label style="margin-bottom:0; display:flex; align-items:center; gap:4px; font-size:10px; cursor:pointer; font-weight:normal; text-transform:none; color:var(--text-dim);">' +
                                    '<input type="checkbox" style="margin:0; width:12px; height:12px; vertical-align:middle; cursor:pointer;" ' + (conf.threshold_hold_active ? 'checked' : '') + ' onchange="updateChannelConfig(' + chIdx + ', \'threshold_hold_active\', this.checked)"> Hold gated DMX:' +
                                '</label>' +
                                '<input type="number" class="glass-input" style="width:50px; height:20px; font-size:10px; padding:2px 4px; margin:0; text-align:center; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#fff;" min="0" max="255" value="' + (conf.threshold_hold_value !== undefined ? conf.threshold_hold_value : '') + '" placeholder="e.g. 0" onchange="updateChannelConfig(' + chIdx + ', \'threshold_hold_value\', this.value)">' +
                            '</div>' +
                        '</div>' +
                        '<input type="range" class="slider-custom" min="0" max="1" step="0.05" value="' + (conf.threshold || 0) + '" onchange="updateChannelConfig(' + chIdx + ', \'threshold\', this.value)">' +
                    '</div>' +
                '</div>' +
            '</div></div>';
        });
        
        container.innerHTML = html;
        
        compileProfileMappings();
        startWaveformLoop();
    };
    
    // --- 3. EVENT HANDLERS & SIMULATION ---
    window.applyEasyBehaviorToChannel = function(chIdx, easyId) {
        const conf = window.channelConfig[chIdx];
        if (!conf) return;

        if (!easyId || easyId === 'custom') {
            conf.easy_id = '';
            window.renderProfileMappings();
            return;
        }

        const desc = (window.EASY_DESCRIPTORS || []).find(d => d.id === easyId);
        if (!desc) return;
        
        conf.easy_id = easyId;
        conf.behavior = desc.behavior || 'static';
        conf.source = desc.source || 'volume';
        conf.speed = desc.speed !== undefined ? desc.speed : 0.5;
        conf.react = desc.react !== undefined ? desc.react : 0.5;
        conf.threshold = desc.threshold !== undefined ? desc.threshold : 0.0;
        conf.hold_type = desc.hold_type || 'none';

        // Apply Relative Center Tuning (Gold Standard)
        if (desc.rel_center !== undefined && conf.ranges && conf.ranges[0]) {
            const r = conf.ranges[0];
            r.center = Math.round(r.min + (desc.rel_center * (r.max - r.min)));
        }

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
            const curr_beat_count = audio.beat_count || 0;
            if (st.last_beat_count === undefined) st.last_beat_count = curr_beat_count;
            const has_new_beat = (curr_beat_count > st.last_beat_count);
            const has_new_bar = has_new_beat && (curr_beat_count % 4 === 0);
            st.last_beat_count = curr_beat_count;
            
            let trigger_hold = false;
            if (hold_type === 'beat' && has_new_beat) trigger_hold = true;
            else if (hold_type === 'bar' && has_new_bar) trigger_hold = true;
            
            if (trigger_hold) {
                st.hold_active = true;
                st.held_dmx = null;
            } else if (hold_type === 'none') {
                st.hold_active = false;
            }
            
            // --- SOURCE RESOLUTION (matches engine LogicMatrix.state) ---
            let E = 0;
            const src = conf.source;
            if (src === 'volume') E = audio.vol || 0;
            else if (src === 'bass') E = audio.bass || 0;
            else if (src === 'mids' || src === 'mid') E = audio.mid || 0;
            else if (src === 'highs' || src === 'high') E = audio.high || 0;
            else if (src === 'bass_p') E = audio.bass_p || 0;
            else if (src === 'mids_p') E = audio.mid_p || 0;
            else if (src === 'highs_p') E = audio.high_p || 0;
            else if (src === 'bass_h') E = audio.bass_h || 0;
            else if (src === 'mids_h') E = audio.mid_h || 0;
            else if (src === 'highs_h') E = audio.high_h || 0;
            else if (src === 'spectral flux' || src === 'impact') E = audio.flux || 0;
            else if (src === 'beat phase') E = audio.beat_phase || 0;
            else if (src === 'bar phase') E = audio.bar_phase || 0;
            else if (src === 'kick') E = audio.kick || 0;
            else if (src === 'snare') E = audio.snare || 0;
            else if (src === 'cymbal') E = audio.cymbal || 0;
            else if (src === 'beat') {
                if (st.beat_env === undefined) st.beat_env = 0.0;
                if (audio.beat) {
                    st.beat_env = 1.0;
                }
                const speed = conf.speed !== undefined ? parseFloat(conf.speed) : 0.5;
                const decayRate = 1.0 + (speed * 20.0);
                st.beat_env = Math.max(0, st.beat_env - dt * decayRate * st.beat_env);
                E = st.beat_env;
            }
            else if (src && src.indexOf('bin ') === 0) {
                const bIdx = parseInt(src.split(' ')[1]);
                // Only bin 0 and 4 are valid now
                if (bIdx === 0 || bIdx === 4) {
                    E = (audio.bins && audio.bins[bIdx] !== undefined) ? Math.min(1.0, audio.bins[bIdx] * 2.0) : 0;
                } else {
                    E = 0;
                }
            }

            const threshold = conf.threshold !== undefined ? parseFloat(conf.threshold) : 0;
            let is_gated = false;
            if (E < threshold) {
                E = 0;
                is_gated = true;
            } else {
                if (threshold < 1.0) E = (E - threshold) / (1.0 - threshold);
                else E = 0;
            }

            // --- CAL RANGE (from first range entry) ---
            const r0 = (conf.ranges && conf.ranges[0]) || { min: 0, center: 127, max: 255 };
            const c_min = (r0.min !== undefined) ? parseInt(r0.min) : 0;
            const c_max = (r0.max !== undefined) ? parseInt(r0.max) : 255;
            const c_center = (r0.center !== undefined) ? parseInt(r0.center) : Math.floor((c_min + c_max) / 2);

            // Scale speed and react by the range span relative to 255
            const range_span = c_max - c_min;
            const scale_factor = range_span > 0 ? (range_span / 255.0) : 1.0;

            const speed = (conf.speed !== undefined ? conf.speed : 0.5) * scale_factor;
            const react = (conf.react !== undefined ? conf.react : 0.5) * scale_factor;
            const behavior = conf.behavior || 'static';
            
            // --- DYNAMIC VIBE PARTITIONING (Removed) ---
            // Vibe partitioning completely removed per user request
            const eff_min = c_min;
            const eff_max = c_max;
            const eff_center = c_center;

            // --- BEHAVIOR MATH (mirrors engine _apply_rule_math exactly) ---
            let y = 0.0;
            
            if (behavior === 'static') {
                window.simBuffers[chIdx].push(eff_center);
                if (window.simBuffers[chIdx].length > 100) window.simBuffers[chIdx].shift();
            } else {
                if (behavior === 'direct') {
                    y = (E * react * 2.0) - 1.0;
                    
                } else if (behavior === 'sine' || behavior === 'square' || behavior === 'saw' || behavior === 'triangle') {
                    const track_bpm = (audio && audio.bpm) || 120.0;
                    const freq = (track_bpm / 60.0) * speed;
                    st.phase = (st.phase + dt * freq) % 1.0;
                    const p = st.phase;
                    const amp = E * react;
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
                    
                } else if (behavior === 'fuzzy') {
                    st.t += dt * speed * 1.8;
                    const noise = (_noise1d(st.t) * 2.0 - 1.0) * react * 0.25;
                    y = ((E + noise) * 2.0) - 1.0;
                    
                } else if (behavior === 'direct_stepped') {
                    y = (Math.floor(E * 8) / 8 * 2.0) - 1.0;
                }
                
                let final_dmx;
                if (is_gated && conf.threshold_hold_active && conf.threshold_hold_value !== '' && conf.threshold_hold_value !== undefined) {
                    final_dmx = parseInt(conf.threshold_hold_value);
                } else {
                    if (is_gated) y = -1.0;
                    
                    // --- Y → DMX MAPPING (mirrors engine exactly) ---
                    const gain = r0.gain !== undefined ? parseFloat(r0.gain) : 1.0;
                    y = Math.max(-1.0, Math.min(1.0, y * gain));
                    if (y >= 0) final_dmx = eff_center + (y * (eff_max - eff_center));
                    else final_dmx = eff_center + (y * (eff_center - eff_min));
                }
                
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
        window.channelConfig[chIdx].ranges.push({min: 0, center: 127, max: 255, muted: false});
        window.renderProfileMappings();
    };
    
    window.removeRange = function(chIdx, rIdx) {
        window.channelConfig[chIdx].ranges.splice(rIdx, 1);
        if(window.channelConfig[chIdx].ranges.length === 0) {
            window.channelConfig[chIdx].ranges.push({min: 0, center: 127, max: 255, muted: false});
        }
        window.renderProfileMappings();
    };
    
    window.updateRange = function(chIdx, rIdx, field, val, inputEl) {
        let currentRange = window.channelConfig[chIdx].ranges[rIdx];
        if (!currentRange) return;

        // Resolve center to concrete number if it's undefined
        if (currentRange.center === undefined) {
            currentRange.center = Math.floor((currentRange.min + currentRange.max) / 2);
        }

        if (field === 'min' || field === 'max' || field === 'center') {
            val = parseInt(val);
            if (isNaN(val)) {
                if (inputEl) inputEl.value = currentRange[field];
                return;
            }
            val = Math.max(0, Math.min(255, val));
        } else if (field === 'gain') {
            val = parseFloat(val);
            if (isNaN(val)) {
                if (inputEl) inputEl.value = (currentRange.gain !== undefined ? currentRange.gain : 1.0);
                return;
            }
            val = Math.max(0.0, Math.min(1.0, val));
        } else if (field === 'muted') {
            val = !!val;
        }

        if (field === 'min') {
            currentRange.min = val;
            const boundsMin = Math.min(currentRange.min, currentRange.max);
            const boundsMax = Math.max(currentRange.min, currentRange.max);
            if (currentRange.center < boundsMin) {
                currentRange.center = boundsMin;
            } else if (currentRange.center > boundsMax) {
                currentRange.center = boundsMax;
            }
        } else if (field === 'max') {
            currentRange.max = val;
            const boundsMin = Math.min(currentRange.min, currentRange.max);
            const boundsMax = Math.max(currentRange.min, currentRange.max);
            if (currentRange.center < boundsMin) {
                currentRange.center = boundsMin;
            } else if (currentRange.center > boundsMax) {
                currentRange.center = boundsMax;
            }
        } else if (field === 'center') {
            const boundsMin = Math.min(currentRange.min, currentRange.max);
            const boundsMax = Math.max(currentRange.min, currentRange.max);
            if (val < boundsMin) {
                val = boundsMin;
            } else if (val > boundsMax) {
                val = boundsMax;
            }
            currentRange.center = val;
        } else if (field === 'gain') {
            currentRange.gain = val;
        } else if (field === 'muted') {
            currentRange.muted = val;
        }

        // Update DOM elements if inputEl is provided
        if (inputEl && (field === 'min' || field === 'max' || field === 'center')) {
            const parent = inputEl.parentElement;
            if (parent && parent.children.length === 3) {
                parent.children[0].value = currentRange.min;
                parent.children[1].value = currentRange.center;
                parent.children[2].value = currentRange.max;
            }
        } else if (inputEl && field === 'gain') {
            inputEl.value = currentRange.gain;
        }

        window.compileProfileMappings();
    };
    
    window.getActivePreset = function(conf) {
        if (!window.EASY_DESCRIPTORS || !conf) return "";
        if (conf.easy_id) {
            const exists = window.EASY_DESCRIPTORS.some(d => d.id === conf.easy_id);
            if (exists) return conf.easy_id;
        }
        for (let d of window.EASY_DESCRIPTORS) {
            let match = true;
            let behaviorTarget = d.behavior || 'static';
            if (behaviorTarget !== conf.behavior) match = false;
            
            let sourceTarget = d.source || 'volume';
            if (behaviorTarget !== 'static' && sourceTarget !== conf.source) match = false;
            
            let holdTarget = d.hold_type || 'none';
            if (holdTarget !== conf.hold_type) match = false;
            
            if (match) return d.id;
        }
        return "";
    };

    window.updateChannelConfig = function(chIdx, field, val) {
        if(field === 'speed' || field === 'react' || field === 'threshold') val = parseFloat(val);
        if(field === 'threshold_hold_value') val = val === '' ? '' : parseInt(val);
        window.channelConfig[chIdx][field] = val;
        window.channelConfig[chIdx].easy_id = ''; // Clear easy_id on manual parameter adjustments
        window.compileProfileMappings();
        
        const presetSelect = document.getElementById('preset-select-' + chIdx);
        if (presetSelect) {
            presetSelect.value = window.getActivePreset(window.channelConfig[chIdx]);
        }
    };

    window.updateChannelRole = function(chIdx, val) {
        if (!window.currentProfileChannels[chIdx]) return;
        window.currentProfileChannels[chIdx].role = val;
        // Optionally update UI title without full re-render if performance is an issue, 
        // but full re-render is safer for state consistency.
        window.renderProfileMappings();
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
window.sliderSetupChannels = {}; // { fixtureId: [channelIdx1, channelIdx2, ...] }

window.handleGlobalSideScroll = function(value) {
    const strips = document.getElementById('pres-slider-setup-strips');
    if (strips) {
        const maxScroll = strips.scrollWidth - strips.clientWidth;
        strips.scrollLeft = (value / 100) * maxScroll;
    }
};

window.handleChannelLabelClick = function(fixtureId, channelIdx, addr) {
    const isBusy = window.latestOverrides.has(addr);
    if (isBusy) {
        // Release that channel but keep the slider in display
        if (window.clearOverride) {
            window.clearOverride(addr);
        } else if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            window.ws.send(JSON.stringify({type: 'clear_channel_overrides', addresses: [addr]}));
            window.latestOverrides.delete(addr);
        }
        // Force update of DMX universe value locally for responsive UI
        window.latestDmxUniverse[addr] = 0;
        window.renderSliderSetup();
    } else {
        // Selecting a second time: remove the channel just as if deselected from dropdown
        window.toggleChannelInSliderSetup(fixtureId, channelIdx);
    }
};

window.toggleChannelInSliderSetup = function(fixtureId, channelIdx) {
    if (!window.sliderSetupChannels[fixtureId]) {
        window.sliderSetupChannels[fixtureId] = [];
    }
    const idx = window.sliderSetupChannels[fixtureId].indexOf(channelIdx);
    if (idx !== -1) {
        // Deselecting: remove from list
        window.sliderSetupChannels[fixtureId].splice(idx, 1);
        
        // Also clear its override!
        const inst = window.db.stage.find(s => s.id === fixtureId);
        if (inst) {
            const prof = window.db.profiles.find(p => p.id === inst.profileId);
            if (prof && prof.channels) {
                const ch = prof.channels[channelIdx];
                if (ch) {
                    const addr = (parseInt(inst.address) || 1) + (parseInt(ch.addrOffset) || channelIdx);
                    if (window.clearOverride) {
                        window.clearOverride(addr);
                    } else if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                        window.ws.send(JSON.stringify({type: 'clear_channel_overrides', addresses: [addr]}));
                        window.latestOverrides.delete(addr);
                    }
                }
            }
        }
    } else {
        // Selecting: add to list
        window.sliderSetupChannels[fixtureId].push(channelIdx);
    }
    
    // Clean up if no channels selected
    if (window.sliderSetupChannels[fixtureId].length === 0) {
        delete window.sliderSetupChannels[fixtureId];
    }
    
    // Sync with activeSliderSetupFixtures
    window.activeSliderSetupFixtures = Object.keys(window.sliderSetupChannels);
    
    window.renderSliderSetup();
};

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

    // 1. Fixture Picker (Dropdown multi-select)
    picker.innerHTML = stage.map(inst => {
        const selectedChs = window.sliderSetupChannels[inst.id] || [];
        const hasSelected = selectedChs.length > 0;
        const prof = window.db.profiles.find(p => p.id === inst.profileId);
        const channels = prof ? (prof.channels || []) : [];
        
        return `
            <div class="fixture-picker-select-wrapper" style="position:relative; display:inline-block;">
                <select class="fixture-picker-select ${hasSelected ? 'active' : ''}" 
                        onchange="window.toggleChannelInSliderSetup('${inst.id}', parseInt(this.value)); this.value='';" 
                        style="cursor:pointer; padding:4px 20px 4px 10px; border-radius:15px; background:${hasSelected ? 'var(--accent)' : 'rgba(255,255,255,0.05)'}; color:${hasSelected ? '#000' : '#fff'}; font-size:10px; font-weight:800; border:1px solid ${hasSelected ? 'transparent' : 'rgba(255,255,255,0.1)'}; outline:none; -webkit-appearance:none; -moz-appearance:none; appearance:none; transition:all 0.2s;">
                    <option value="" disabled selected>${inst.id}${hasSelected ? ` (${selectedChs.length})` : ''} ▾</option>
                    ${channels.map((ch, chIdx) => {
                        const isSel = selectedChs.includes(chIdx);
                        return `<option value="${chIdx}" style="background:#16161a; color:#fff;">${isSel ? '✓ ' : ''}${ch.role || ch.name}</option>`;
                    }).join('')}
                </select>
            </div>
        `;
    }).join('') || '<div style="color:#666; font-size:12px; padding:10px;">No fixtures found. Check Stage Tab.</div>';

    // Collect all active faders across all fixtures
    const allFaders = [];
    window.activeSliderSetupFixtures.forEach(id => {
        const inst = window.db.stage.find(s => s.id === id);
        if (!inst) return;
        const prof = window.db.profiles.find(p => p.id === inst.profileId);
        if (!prof) return;

        const baseAddr = parseInt(inst.address) || 1;
        const selectedChs = window.sliderSetupChannels[id] || [];
        if (!window.sliderSetupValues[id]) window.sliderSetupValues[id] = {};

        selectedChs.forEach(chIdx => {
            const ch = prof.channels[chIdx];
            if (!ch) return;
            const addr = baseAddr + (parseInt(ch.addrOffset) || chIdx);
            const isBusy = window.latestOverrides.has(addr);
            const val = (window.sliderSetupValues[id] && window.sliderSetupValues[id][chIdx] !== undefined)
                ? window.sliderSetupValues[id][chIdx] 
                : (window.latestDmxUniverse[addr] || 0);

            allFaders.push({
                id: id,
                chIdx: chIdx,
                ch: ch,
                addr: addr,
                isBusy: isBusy,
                val: val
            });
        });
    });

    // 2. Slider Strips (Grid wrap to maximum of 2 rows)
    if (allFaders.length === 0) {
        strips.innerHTML = '<div style="padding:40px; text-align:center; color:#444; width:100%; border:2px dashed #222; border-radius:12px; font-size:12px; background:rgba(0,0,0,0.2);">Select fixtures above to live-adjust sliders for snapshotting.</div>';
        const scrollContainer = document.getElementById('pres-slider-scroll-container');
        if (scrollContainer) scrollContainer.style.display = 'none';
        return;
    }

    // Distribute faders across 2 rows. If under limit, put them all in Row 1.
    const limit = 8;
    let row1 = [];
    let row2 = [];
    if (allFaders.length <= limit) {
        row1 = allFaders;
    } else {
        const cols = Math.ceil(allFaders.length / 2);
        row1 = allFaders.slice(0, cols);
        row2 = allFaders.slice(cols);
    }

    const renderFaderCol = (f) => {
        return `
            <div class="preset-slider-col ${f.isBusy ? 'busy' : ''}" data-addr="${f.addr}" data-fixture-id="${f.id}" data-idx="${f.chIdx}" style="display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
                <div class="preset-slider-role" style="font-size: 8px; font-weight: 800; color: ${f.isBusy ? 'var(--danger)' : '#777'}; height: 22px; overflow: visible; text-transform: uppercase; width: 38px; text-align: center; cursor: pointer; white-space: nowrap; transition: color 0.2s; display: flex; flex-direction: column; justify-content: center; line-height: 1.1;" 
                     onclick="window.handleChannelLabelClick('${f.id}', ${f.chIdx}, ${f.addr})">
                     <span style="font-size: 6.5px; color: var(--accent); font-weight: 900; opacity: 0.8; margin-bottom: 2px;">${f.id}</span>
                     <span>${f.ch.role || f.ch.name}</span>
                </div>
                <div class="vertical-slider-container" style="${f.isBusy ? 'border-color: var(--danger); box-shadow: 0 0 10px rgba(255, 71, 87, 0.2);' : ''}">
                    <div class="dmx-fader-track" style="background: rgba(255,255,255,0.05);"></div>
                    <input type="range" class="preset-slider-input" min="0" max="255" step="1" value="${f.val}" 
                        id="slider-setup-${f.id}-${f.chIdx}"
                        oninput="adjustSliderSetupValue('${f.id}', ${f.chIdx}, parseInt(this.value), ${f.addr})"
                        onchange="adjustSliderSetupValue('${f.id}', ${f.chIdx}, parseInt(this.value), ${f.addr})"
                        onkeydown="window.handleSliderKeyNav(event)">
                    <div class="dmx-fader-cap" id="cap-setup-${f.id}-${f.chIdx}" style="bottom: ${Math.round((f.val / 255) * (120 - 18))}px; ${f.isBusy ? 'background: linear-gradient(180deg, var(--danger) 0%, #900 100%); border-color: #f00; box-shadow: 0 0 8px var(--danger);' : ''}"></div>
                </div>
                <div class="preset-val-display" id="val-setup-${f.id}-${f.chIdx}" style="font-size: 10px; font-weight: 900; color: ${f.isBusy ? 'var(--danger)' : '#fff'}; font-family: 'JetBrains Mono', monospace; background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); min-width: 24px; text-align: center;">${f.val}</div>
            </div>
        `;
    };

    let html = `<div class="faders-row" style="display: flex; gap: 10px;">
        ${row1.map(renderFaderCol).join('')}
    </div>`;

    if (row2.length > 0) {
        html += `<div class="faders-row" style="display: flex; gap: 10px; margin-top: 10px;">
            ${row2.map(renderFaderCol).join('')}
        </div>`;
    }

    strips.innerHTML = html;

    // Toggle global scroll range slider visibility
    const scrollContainer = document.getElementById('pres-slider-scroll-container');
    if (scrollContainer) {
        scrollContainer.style.display = allFaders.length > 6 ? 'flex' : 'none';
    }

    // Attach scroll event listener to strips to update the global range slider
    if (!strips.dataset.scrollListenerAttached) {
        strips.addEventListener('scroll', () => {
            const maxScroll = strips.scrollWidth - strips.clientWidth;
            const pct = maxScroll > 0 ? Math.round((strips.scrollLeft / maxScroll) * 100) : 0;
            const bar = document.querySelector('.global-side-scroll-bar');
            if (bar && document.activeElement !== bar) {
                bar.value = pct;
            }
        });
        strips.dataset.scrollListenerAttached = "true";
    }

    // --- Horizontal Strips Layout Styles ---
    strips.style.display = 'flex';
    strips.style.flexDirection = 'column';
    strips.style.overflowX = 'auto';
    strips.style.overflowY = 'hidden';
    strips.style.gap = '0';
    strips.style.padding = '10px 0';
}

window.toggleFixtureInSliderSetup = function(id) {
    // Deprecated: now handled by window.toggleChannelInSliderSetup
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
    const baseAddr = parseInt(inst.address) || 1;
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
    Object.keys(window.sliderSetupChannels).forEach(id => {
        const inst = window.db.stage.find(s => s.id === id);
        if (!inst) return;
        const baseAddr = parseInt(inst.address) || 1;
        const prof = window.db.profiles.find(p => p.id === inst.profileId);
        if (!prof) return;
        const selectedChs = window.sliderSetupChannels[id] || [];
        selectedChs.forEach(chIdx => {
            const ch = prof.channels[chIdx];
            if (ch) {
                addresses.push(baseAddr + (parseInt(ch.addrOffset) || chIdx));
            }
        });
    });

    if (window.ws && window.ws.readyState === WebSocket.OPEN && addresses.length > 0) {
        window.ws.send(JSON.stringify({
            type: 'clear_channel_overrides',
            addresses: addresses
        }));
        addresses.forEach(addr => window.latestOverrides.delete(addr));
    }

    window.activeSliderSetupFixtures = [];
    window.sliderSetupChannels = {};
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
            const baseAddr = parseInt(inst.address) || 1;
            const addr = baseAddr + (parseInt(ch.addrOffset) || parseInt(chIdx));
            
            // Only capture if this specific channel is currently active in sliderSetupChannels and overridden (locked)
            if (!window.sliderSetupChannels[fixId] || !window.sliderSetupChannels[fixId].includes(parseInt(chIdx))) return;
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

/**
 * High-frequency UI update for Preset Slider Setup.
 * Updates slider values and labels from window.latestDmxUniverse.
 */
window.updateSliderSetupVisuals = function() {
    const strips = document.getElementById('pres-slider-setup-strips');
    if (!strips || strips.innerHTML.includes('Select fixtures above')) return;

    Object.keys(window.sliderSetupChannels).forEach(id => {
        const inst = window.db.stage.find(s => s.id === id);
        if (!inst) return;
        const prof = window.db.profiles.find(p => p.id === inst.profileId);
        if (!prof) return;

        const baseAddr = parseInt(inst.address) || 1;
        const selectedChs = window.sliderSetupChannels[id] || [];

        selectedChs.forEach(chIdx => {
            const ch = prof.channels[chIdx];
            if (!ch) return;
            const addr = baseAddr + (parseInt(ch.addrOffset) || chIdx);
            const val = window.latestDmxUniverse[addr] || 0;
            
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
