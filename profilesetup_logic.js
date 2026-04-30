// profilesetup_logic.js (V4: Complete Multi-Channel Orchestrator)

const state = {
    profileId: null,
    profileName: "New Profile",
    channels: []
};

// --- Initialization ---
setTimeout(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    loadProfileById(id);
}, 200);

// --- Loading Logic ---
async function loadProfileById(id) {
    if (!id) {
        state.profileName = "New Profile";
        addChannel('pos_x', 'X Moving');
        return;
    }

    try {
        const fetchUrl = `${window.API_BASE}/profiles/${id}.json`;
        console.log(`📂 Loading Profile: ${id}...`);
        console.log(`🔗 Target URL: ${fetchUrl}`);
        const resp = await fetch(fetchUrl);
        if (!resp.ok) throw new Error("Profile not found");
        const json = await resp.json();
        
        state.profileId = id;
        state.profileName = json.name || id;
        document.getElementById('profileNameDisplay').innerText = state.profileName;
        
        state.channels = (json.channels || []).map(ch => reverseEngineerChannel(ch));
        
        renderAllChannels();
    } catch (err) {
        console.error("❌ Load Failed:", err);
        state.profileName = "New Profile (Load Error)";
        addChannel('pos_x', 'X Moving');
    }
}

function reverseEngineerChannel(ch) {
    // Determine Global Logic from MID vibe
    const midRule = ch.rules?.mid?.steady || {};
    const chillRule = ch.rules?.chill?.steady || {};
    const highRule = ch.rules?.high?.steady || {};

    const chillMax = chillRule.cal?.max || 25;
    const highMin = highRule.cal?.min || 230;

    // Extract ranges if they exist
    let ranges = [];
    // If the original profile had multiple rules in a vibe, we try to capture them as "Compact Ranges"
    // For now, we'll just show the role-based summary
    if (ch.rules) {
        Object.entries(ch.rules).forEach(([vibe, ruleSet]) => {
            Object.entries(ruleSet).forEach(([key, rule]) => {
                if (key !== 'steady') {
                    ranges.push({ min: rule.cal?.min || 0, max: rule.cal?.max || 255, label: `${vibe.toUpperCase()} ${key.toUpperCase()}` });
                }
            });
        });
    }
    if (ranges.length === 0) {
        ranges.push({ min: 0, max: 255, label: 'ANY' });
    }

    return {
        role: (ch.role || 'custom').toUpperCase(),
        name: ch.name || ch.role,
        logic: midRule.easy_id || 'static',
        chillPercent: Math.round((chillMax / 255) * 100),
        highPercent: Math.round(((255 - highMin) / 255) * 100),
        speed: midRule.modifiers?.speed || 0.5,
        react: midRule.modifiers?.react || 0.5,
        sensitivity: 0.5,
        ranges: ranges
    };
}

// --- Rendering ---
function renderAllChannels() {
    const list = document.getElementById('channelList');
    list.innerHTML = state.channels.map((ch, idx) => `
        <div class="channel-card" data-index="${idx}">
            <div class="channel-header">
                <div class="channel-title">${ch.name} (${ch.role})</div>
                <div style="color:var(--text-dim); cursor:pointer" onclick="removeChannel(${idx})">󰆴</div>
            </div>

            <div class="section-title">GLOBAL CHANNEL LOGIC</div>
            <select class="logic-selector" onchange="updateChannelState(${idx}, 'logic', this.value)">
                ${window.EASY_DESCRIPTORS.map(d => `<option value="${d.id}" ${ch.logic === d.id ? 'selected' : ''}>${d.label.toUpperCase()}</option>`).join('')}
            </select>

            <div class="section-title">VIBE PROPORTIONS</div>
            <div class="proportion-container" data-index="${idx}">
                <div class="vibe-segment chill-seg" style="width: ${ch.chillPercent}%">CHILL</div>
                <div class="vibe-segment mid-seg" style="width: ${100 - ch.chillPercent - ch.highPercent}%">MID</div>
                <div class="vibe-segment high-seg" style="width: ${ch.highPercent}%">HIGH</div>
                
                <div class="handle handle-left" style="left: ${ch.chillPercent}%"></div>
                <div class="handle handle-right" style="left: ${100 - ch.highPercent}%"></div>
            </div>
            <div class="percentage-labels">
                <span>CHILL: ${ch.chillPercent}%</span>
                <span>HIGH: ${ch.highPercent}%</span>
            </div>

            <div class="section-title">COMPACT RANGES</div>
            <div class="range-list">
                ${ch.ranges.map((r, rIdx) => `
                    <div class="range-item">
                        <div class="range-bounds">[${r.min} - ${r.max}]</div>
                        <div class="range-label">${r.label}</div>
                        <div style="color:var(--text-dim); cursor:pointer" onclick="removeRange(${idx}, ${rIdx})">󰆴</div>
                    </div>
                `).join('')}
            </div>
            <button class="btn-ghost" onclick="addRange(${idx})">+ Add Range</button>

            <div class="controls-grid">
                <div class="control-group">
                    <label>SPEED <span style="float:right">${(ch.speed || 0).toFixed(2)}</span></label>
                    <input type="range" class="slider-custom" min="0" max="1" step="0.01" value="${ch.speed}" oninput="updateChannelState(${idx}, 'speed', this.value)">
                </div>
                <div class="control-group">
                    <label>REACTIVITY <span style="float:right">${(ch.react || 0).toFixed(2)}</span></label>
                    <input type="range" class="slider-custom" min="0" max="1" step="0.01" value="${ch.react}" oninput="updateChannelState(${idx}, 'react', this.value)">
                </div>
            </div>
        </div>
    `).join('');

    initDragHandlers();
}

// --- State Management ---
window.updateChannelState = (idx, key, val) => {
    const ch = state.channels[idx];
    if (key === 'speed' || key === 'react' || key === 'sensitivity') {
        ch[key] = parseFloat(val);
    } else {
        ch[key] = val;
    }
    renderAllChannels();
};

window.addChannel = (role, name) => {
    state.channels.push({
        role: (role || 'CUSTOM').toUpperCase(),
        name: name || 'New Channel',
        logic: 'pause_jitter',
        chillPercent: 10,
        highPercent: 10,
        speed: 0.1,
        react: 0.5,
        sensitivity: 0.5,
        ranges: [{ min: 0, max: 255, label: 'ANY' }]
    });
    renderAllChannels();
};

window.removeChannel = (idx) => {
    if (confirm("Delete this channel?")) {
        state.channels.splice(idx, 1);
        renderAllChannels();
    }
};

window.addRange = (idx) => {
    state.channels[idx].ranges.push({ min: 0, max: 255, label: 'NEW RANGE' });
    renderAllChannels();
};

window.removeRange = (idx, rIdx) => {
    state.channels[idx].ranges.splice(rIdx, 1);
    renderAllChannels();
};

// --- Drag Logic ---
function initDragHandlers() {
    document.querySelectorAll('.proportion-container').forEach(container => {
        const idx = parseInt(container.dataset.index);
        const handleLeft = container.querySelector('.handle-left');
        const handleRight = container.querySelector('.handle-right');

        handleLeft.onmousedown = (e) => startDrag(e, idx, 'left');
        handleRight.onmousedown = (e) => startDrag(e, idx, 'right');
    });
}

function startDrag(e, idx, type) {
    const container = document.querySelector(`.proportion-container[data-index="${idx}"]`);
    const onMove = (moveEvent) => {
        const rect = container.getBoundingClientRect();
        let x = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        x = Math.max(0, Math.min(100, x));

        const ch = state.channels[idx];
        if (type === 'left') {
            const rightBound = 100 - ch.highPercent - 5;
            ch.chillPercent = Math.round(Math.min(x, rightBound));
        } else {
            const leftBound = ch.chillPercent + 5;
            ch.highPercent = Math.round(100 - Math.max(x, leftBound));
        }
        
        // Visual update only during drag for performance
        const segChill = container.querySelector('.chill-seg');
        const segMid = container.querySelector('.mid-seg');
        const segHigh = container.querySelector('.high-seg');
        const handleL = container.querySelector('.handle-left');
        const handleR = container.querySelector('.handle-right');

        segChill.style.width = ch.chillPercent + '%';
        segMid.style.width = (100 - ch.chillPercent - ch.highPercent) + '%';
        segHigh.style.width = ch.highPercent + '%';
        handleL.style.left = ch.chillPercent + '%';
        handleR.style.left = (100 - ch.highPercent) + '%';
        
        const labels = container.nextElementSibling;
        labels.innerHTML = `<span>CHILL: ${ch.chillPercent}%</span><span>HIGH: ${ch.highPercent}%</span>`;
    };

    const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        renderAllChannels(); // Full sync on release
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
}

// --- Baking & Saving ---
function bakeProfile() {
    return {
        name: state.profileName,
        manufacturer: "RaveBox",
        channels: state.channels.map((ch, i) => {
            const baseLogic = window.EASY_DESCRIPTORS.find(d => d.id === ch.logic) || { behavior: 'sine', source: 'volume' };
            
            // Build the rules object
            const buildVibeRules = (vibe, min, max, center) => {
                const rules = {
                    steady: { 
                        easy_id: ch.logic, 
                        behavior: baseLogic.behavior, 
                        source: baseLogic.source, 
                        modifiers: { speed: ch.speed, react: ch.react }, 
                        cal: { min, max, center } 
                    }
                };
                // Add back any custom ranges that were captured
                ch.ranges.forEach(r => {
                    // Logic: if the range label matches the vibe, or is generic 'ANY'
                    if (r.label.toLowerCase().includes(vibe) || r.label === 'ANY') {
                        const key = r.label.split(' ').pop().toLowerCase() || 'custom';
                        if (key !== 'steady') {
                            rules[key] = {
                                easy_id: ch.logic,
                                behavior: baseLogic.behavior,
                                source: baseLogic.source,
                                modifiers: { speed: ch.speed, react: ch.react },
                                cal: { min: r.min, max: r.max, center: Math.floor((r.min + r.max)/2) }
                            };
                        }
                    }
                });
                return rules;
            };

            const chillMax = Math.floor(255 * (ch.chillPercent / 100));
            const highMin = Math.floor(255 * (1 - ch.highPercent / 100));

            return {
                index: i,
                name: ch.name,
                role: ch.role.toLowerCase(),
                default: 127,
                rules: {
                    chill: buildVibeRules('chill', 0, chillMax, Math.floor(chillMax/2)),
                    mid: buildVibeRules('mid', chillMax + 1, highMin - 1, 127),
                    high: buildVibeRules('high', highMin, 255, Math.floor((highMin + 255)/2))
                }
            };
        })
    };
}

window.handleSaveClick = async () => {
    const profile = bakeProfile();
    profile.id = state.profileId; // Ensure ID is present for the system's save function
    
    if (!profile.id) {
        const name = prompt("Enter a filename for this profile (e.g. moving_head_new):");
        if (!name) return;
        state.profileId = profile.id = name.toLowerCase().replace(/\s+/g, '_');
    }
    
    // Call the system's global save function from shared_setup.js
    // We wrap it to match the button's expectation
    const success = await window.saveProfileToServer(profile);
    if (success) alert("✅ Profile Saved to Pi!");
    else alert("❌ Save Failed");
};

window.downloadProfile = () => {
    const profile = bakeProfile();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profile, null, 4));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `${state.profileId || 'new_profile'}.json`);
    dl.click();
};
