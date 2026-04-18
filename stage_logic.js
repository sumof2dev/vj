// --- SAFETY GLOBALS ---
var everActivatedPresets = new Set();
var activePresets = []; 
var db = window.db || { profiles: [], stage: [], presets: [], liveConsole: [], savedConsoles: [] };
var activeTestFixtures = window.activeTestFixtures || [];
var activeTestFunctions = window.activeTestFunctions || new Set();
var current_editing_preset_id = window.current_editing_preset_id || null;
var currentPresetOverrides = window.currentPresetOverrides || [];
var currentPresetTriggers = window.currentPresetTriggers || [];
var hiddenTestChannels = window.hiddenTestChannels || {};
var muteOthersActive = window.muteOthersActive || false;
var mutedTestAddresses = window.mutedTestAddresses || new Set();
var getUniqueProfiles = window.getUniqueProfiles || function() { return []; };
var updateUniqueFunctions = window.updateUniqueFunctions || function() { };
var refreshUI = window.refreshUI || function() { };
var saveDB = window.saveDB || function() { };
var switchTab = window.switchTab || function() { };


// --- GLOBAL STATE (Managed in shared_setup.js) ---

// (savePreset, editPreset, deletePreset moved to profile_logic.js)

        function updateStageProfileList() {
            const profDrop = document.getElementById('stage-profile');
            if (profDrop) {
                const uniqueAllProfs = getUniqueProfiles();
                profDrop.innerHTML = uniqueAllProfs.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            }
        }

        async function patchToStage() {
            const profId = document.getElementById('stage-profile').value;
            const addr = parseInt(document.getElementById('stage-addr').value);
            const offset = parseInt(document.getElementById('stage-offset').value) || 0;
            const zone = document.getElementById('stage-zone').value;

            if (!profId) return alert("Select a Profile first");

            const prof = db.profiles.find(p => p.id === profId);
            if (!prof) return alert("Profile not found in memory. Save it first!");

            db.stage.push({
                id: 'inst_' + Date.now(),
                profileId: profId,
                profileName: prof.name,
                address: addr,
                offset: offset,
                zone
            });
            await saveDB();
            refreshUI();
        }

        async function updateInstanceProfile(instId, newProfId) {
            const inst = db.stage.find(s => s.id === instId);
            const prof = db.profiles.find(p => p.id === newProfId);
            if (inst && prof) {
                inst.profileId = newProfId;
                inst.profileName = prof.name;
                await saveDB();
                // refreshUI naturally called by any upstream trigger, but let's be safe
                renderStageList(); 
            }
        }

        async function updateInstanceId(oldId, newId) {
            newId = newId.trim();
            if (!newId || newId === oldId) return;
            if (db.stage.find(s => s.id === newId)) {
                alert("ID already exists!");
                refreshUI(); // revert
                return;
            }
            const inst = db.stage.find(s => s.id === oldId);
            if (inst) {
                inst.id = newId;
                // Update any preset references
                if (db.presets) {
                    db.presets.forEach(p => {
                        if (p.overrides) {
                            p.overrides.forEach(o => {
                                if (o.type === 'stage_instance' && o.target === oldId) {
                                    o.target = newId;
                                }
                            });
                        }
                    });
                }
                await saveDB();
                refreshUI();
            }
        }

        async function updateInstanceZone(instId, newZone) {
            const inst = db.stage.find(s => s.id === instId);
            if (inst) {
                inst.zone = newZone.trim();
                await saveDB();
            }
        }

        async function updateInstanceAddress(instId, newAddr) {
            const inst = db.stage.find(s => s.id === instId);
            if (inst && !isNaN(newAddr) && newAddr >= 1 && newAddr <= 512) {
                inst.address = newAddr;
                await saveDB();
            }
        }

        function updateInstanceOffset(instId, newOffset) {
            const inst = db.stage.find(s => s.id === instId);
            if (inst && !isNaN(newOffset) && newOffset >= 0 && newOffset <= 512) {
                inst.offset = newOffset;
                saveDB();
            }
        }

        function toggleStageJson() {
            const list = document.getElementById('stage-list');
            const jsonContainer = document.getElementById('stage-json-container');
            const editor = document.getElementById('stage-json-editor');
            const btn = document.getElementById('btn-toggle-json');
            if (list.style.display === 'none') {
                list.style.display = 'block';
                jsonContainer.style.display = 'none';
                btn.classList.remove('active');
            } else {
                list.style.display = 'none';
                jsonContainer.style.display = 'block';
                editor.value = JSON.stringify(db.stage, null, 4);
                btn.classList.add('active');
            }
        }

        async function saveStageJson() {
            try {
                const editor = document.getElementById('stage-json-editor');
                const parsed = JSON.parse(editor.value);
                db.stage = parsed;
                await saveDB();
                refreshUI();
                alert('Stage JSON Saved Successfully!');
            } catch (e) {
                alert('Invalid JSON: ' + e.message);
            }
        }

        function renderStageList() {
            const list = document.getElementById('stage-list');
            if (!list) return;

            const uniqueAllProfs = getUniqueProfiles();
            list.innerHTML = (db.stage || []).map(s => {
                const profile = uniqueAllProfs.find(p => p.id === s.profileId);
                const profName = profile ? profile.name : (s.profileName || 'Unknown Profile');
                const profOptions = uniqueAllProfs.map(p => `<option value="${p.id}" ${p.id === s.profileId ? 'selected' : ''}>${p.name}</option>`).join('');

                return `<div class="item-row" onclick="goToProfile('${s.profileId}')" style="cursor:pointer; display:flex; flex-direction:column; align-items:stretch; gap:12px; padding:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:700; font-size:1.1rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${profName}">${profName}</div>
                            <div style="display:flex; align-items:center; gap:12px; margin-top:6px;">
                                <div class="live-badge"><span class="live-dot"></span> LIVE</div>
                                <div class="channel-count">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                                    ${profile ? (profile.channels || []).length : 0} Channels
                                </div>
                            </div>
                        </div>
                        <button class="btn btn-danger btn-sm" style="width:24px; height:24px; border-radius:50%; padding:0; display:flex; align-items:center; justify-content:center; min-width:24px; flex-shrink:0; opacity:0.6;" onclick="event.stopPropagation(); deleteStageInstance('${s.id}')" title="Delete">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>

                    <div style="display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.05);" onclick="event.stopPropagation()">
                         <div style="display:flex; align-items:center; gap:4px;">
                            <span style="color:#666; font-size:9px; font-weight:bold;">ADDR</span>
                            <input type="number" value="${s.address}" min="1" max="512" style="width:42px; background:none; border:none; color:white; font-weight:900; font-size:14px; padding:0; outline:none; text-align:center;" onchange="updateInstanceAddress('${s.id}', parseInt(this.value))">
                         </div>
                         <div style="color:#444; margin:0 4px;">|</div>
                         <div style="flex:1; display:flex; flex-direction:column; min-width:0;">
                             <input type="text" value="${s.id}" style="font-size:11px; color:#fff; font-weight:600; background:transparent; border:none; width:100%; outline:none; padding:0;" onchange="updateInstanceId('${s.id}', this.value)" title="Instance ID">
                             <input type="text" value="${s.zone}" list="zone-options" style="color:var(--accent-alt); font-size:9px; font-weight:bold; background:transparent; border:none; outline:none; padding:0; height:auto; line-height:1; text-transform:uppercase;" onchange="updateInstanceZone('${s.id}', this.value)" title="Zone (Editable)">
                         </div>
                         <select class="btn-sm" style="width:90px; background:#222; border:1px solid #444; border-radius:6px; color:#fff; font-size:10px; height:28px; padding:0 4px;" onchange="updateInstanceProfile('${s.id}', this.value)">
                            ${profOptions}
                         </select>
                    </div>
                </div>`;
            }).join('') || '<div style="padding:10px; color:#666;">No behaviors currently active on stage.</div>';

            const presList = document.getElementById('saved-presets-list');
            if (presList) {
                presList.innerHTML = (db.presets || []).map(p => {
                    let triggerDesc = (p.triggers || []).map(t => {
                        if (t.type === 'vibe') return `Vibe=${t.value}`;
                        if (t.type === 'state') return `State=${t.value}`;
                        if (t.type === 'volume') return `${t.greater_than}≤Vol≤${t.less_than}`;
                        if (t.type === 'bin') return `${t.greater_than}≤${t.target}≤${t.less_than}`;
                        if (t.type === 'channel') return `${t.greater_than}≤Ch[${t.target}]≤${t.less_than}`;
                        return t.type;
                    }).join(', ') || 'Manual';

                    const overrideCount = (p.overrides || []).reduce((acc, ov) => acc + ov.channels.length, 0);

                    return `<div class="item-row" style="flex-wrap:wrap; gap:10px; padding:12px;">
                        <div style="flex:1; min-width:150px;">
                            <div style="font-weight:bold; font-size:1.1rem; color:#fff; display:flex; align-items:center; gap:8px;">
                                ${p.name}
                                <span style="font-size:10px; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; color:#888;">${p.overrides?.length || 0} Targets</span>
                            </div>
                            <div style="font-size:11px; color:var(--accent-alt); margin-top:4px; font-family:monospace; opacity:0.8;">${triggerDesc}</div>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button class="btn btn-sm" onclick="editPreset('${p.id}')">Edit</button>
                            <button class="btn btn-sm btn-danger" onclick="deletePreset('${p.id}')">Delete</button>
                        </div>
                    </div>`;
                }).join('') || '<div style="padding:20px; text-align:center; color:#444;">No presets created. Combine triggers + actions to automate the show.</div>';
            }

            // Sync numerical DMX values to Test Tab if active
            // Sync numerical DMX values to Test Tab if active
            if (activeTestFixtures.length > 0) {
                renderTestTab();
            }
        }

        /* --- 4. COMMAND HUB: LIVE TEST ENSEMBLE ENGINE --- */
        let testFeedInterval = null;
        let isRecording = false;
        let recordingStartTime = 0;
        let recordingTimerInterval = null;

        function toggleTestFeed() {
            const container = document.getElementById('test-live-feed-container');
            const btn = document.getElementById('btn-toggle-feed');
            const img = document.getElementById('test-live-feed-img');

            if (testFeedInterval) {
                clearInterval(testFeedInterval);
                testFeedInterval = null;
                container.classList.remove('active');
                btn.innerText = "📷 Live Feed: OFF";
                btn.classList.remove('btn-primary');
            } else {
                container.classList.add('active');
                btn.innerText = "📷 Live Feed: ON";
                btn.classList.add('btn-primary');
                testFeedInterval = setInterval(() => {
                    // Ported from calibration.html - high-efficiency polling
                    img.src = `${API_BASE_ROOT}/capture?t=${Date.now()}`;
                }, 300);
            }
        }

        function renderTestTab() {
            const container = document.getElementById('tab-test');
            if (!container) return;
            const stripsContainer = document.getElementById('test-ensemble-strips');
            const emptyState = document.getElementById('test-empty-state');
            renderEnsemblePicker();

            if (window.activeTestFixtures.length === 0 && window.activeTestFunctions.size === 0) {
                if (emptyState) emptyState.style.display = 'block';
                stripsContainer.querySelectorAll('.test-strip-card').forEach(s => s.remove());
                return;
            }

            if (emptyState) emptyState.style.display = 'none';

            // Determine which fixtures to show. 
            // A fixture only shows up if it has at least one channel that is:
            // 1. Part of the active function set (if defined)
            // 2. Not hidden
            const fixturesToShow = (db.stage || []).filter(inst => {
                const profile = db.profiles.find(p => p.id === inst.profileId);
                if (!profile) return false;
                
                const inEnsemble = window.activeTestFixtures.includes(inst.id);
                const fixtureHidden = hiddenTestChannels[inst.id] || [];
                
                return (profile.channels || []).some((ch, idx) => {
                    // Exclusion check first
                    if (fixtureHidden.includes(idx)) return false;
                    
                    // Filter logic
                    if (window.activeTestFunctions.size > 0) {
                        // If filtering by function, it MUST match the function AND either be in ensemble or just exist
                        return window.activeTestFunctions.has(ch.role);
                    } else {
                        // No function filter? SHOW if in ensemble
                        return inEnsemble;
                    }
                });
            }).map(inst => inst.id);

            // Clean up old strips
            stripsContainer.querySelectorAll('.test-strip-card').forEach(strip => {
                if (!fixturesToShow.includes(strip.dataset.fixtureId)) {
                    strip.remove();
                }
            });

            fixturesToShow.forEach(id => {
                const inst = db.stage.find(s => s.id === id);
                if (!inst) return;
                const profile = db.profiles.find(p => p.id === inst.profileId);
                if (!profile) return;

                let strip = stripsContainer.querySelector(`.test-strip-card[data-fixture-id="${id}"]`);
                if (!strip) {
                    strip = document.createElement('div');
                    strip.className = 'test-strip-card';
                    strip.dataset.fixtureId = id;
                    stripsContainer.appendChild(strip);
                }

                const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
                const fixtureHidden = hiddenTestChannels[id] || [];

                strip.innerHTML = `
                    <div class="test-strip-header">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div style="font-size:12px; font-weight:900; color:var(--accent);">${inst.id}</div>
                            <div style="font-size:10px; color:var(--text-dim); opacity:0.6;">${profile.name} (Base: ${baseAddr})</div>
                        </div>
                        <div style="display:flex; gap:6px;">
                            ${fixtureHidden.length > 0 ? `<button class="btn btn-sm" style="font-size:9px; padding:2px 8px;" onclick="unhideAllTestChannels('${id}')">SHOW ALL</button>` : ''}
                            <button class="btn btn-danger btn-sm" style="font-size:9px; padding:2px 8px;" onclick="clearFixtureOverrides('${id}')">RELEASE</button>
                            ${window.activeTestFunctions.size === 0 ? `<button class="btn btn-sm" style="font-size:9px; padding:2px 8px;" onclick="toggleFixtureInTest('${id}')">REMOVE</button>` : ''}
                        </div>
                    </div>
                    <div class="compact-slider-list">
                        ${(profile.channels || []).map((ch, idx) => {
                    // FILTER: If we have active functions, ONLY show matching channels
                    if (window.activeTestFunctions.size > 0 && !window.activeTestFunctions.has(ch.role)) return '';
                    if (fixtureHidden.includes(idx)) return '';
                    
                    const addr = baseAddr + (parseInt(ch.addrOffset) || idx);
                    const val = latestDmxUniverse[addr] || 0;
                    const isBusy = latestOverrides.has(addr);
                    return `
                                <div class="compact-slider-row ${isBusy ? 'busy' : ''}" data-addr="${addr}">
                                    <div class="compact-role-label">${ch.role || ch.name}</div>
                                    <div class="compact-addr-label">${addr}</div>
                                    <input type="range" min="0" max="255" value="${val}" class="compact-slider-input"
                                           oninput="sendCompactTestOverride('${id}', ${idx}, this.value)">
                                    <div class="compact-val-display">${val}</div>
                                    <div style="display:flex; gap:4px; align-items:center;">
                                        <button class="compact-release-btn" onclick="clearOverride(${addr})">✖</button>
                                        <button class="compact-hide-btn" onclick="toggleHideTestChannel('${id}', ${idx})" title="Hide Channel">✖</button>
                                    </div>
                                </div>
                            `;
                }).join('')}
                    </div>
                `;
            });

            syncMuteState();

        }

        function toggleMuteOthers() {
            muteOthersActive = !muteOthersActive;
            const btn = document.getElementById('btn-mute-others');
            if (btn) {
                if (muteOthersActive) {
                    btn.style.background = 'var(--accent)';
                    btn.style.color = '#000';
                    btn.style.borderColor = 'var(--accent)';
                    btn.innerText = '🔔 Muting Others';
                } else {
                    btn.style.background = '#222';
                    btn.style.color = '#fff';
                    btn.style.borderColor = '#444';
                    btn.innerText = '🔕 Mute Others';
                }
            }
            syncMuteState();
            renderActivePresets();
        }

// (updatePresetFunctionDropdown moved to profile_logic.js)

// (renderActivePresets moved to profile_logic.js)

        function syncMuteState() {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            const nextMuted = new Set();
            
            // Calculate which channels SHOULD be muted
            if (muteOthersActive) {
                // Determine which addresses are VISIBLE in the UI
                const visibleAddresses = new Set();
                const strips = document.querySelectorAll('.test-strip-card');
                strips.forEach(strip => {
                    const rows = strip.querySelectorAll('.compact-slider-row');
                    rows.forEach(row => {
                        const addr = parseInt(row.dataset.addr);
                        if (!isNaN(addr)) visibleAddresses.add(addr);
                    });
                });

                // Compare against ALL possible stage addresses
                (db.stage || []).forEach(inst => {
                    const profile = db.profiles.find(p => p.id === inst.profileId);
                    if (!profile) return;
                    const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
                    (profile.channels || []).forEach((ch, idx) => {
                        const addr = baseAddr + (parseInt(ch.addrOffset) || idx);
                        if (!visibleAddresses.has(addr)) {
                            nextMuted.add(addr);
                        }
                    });
                });
            }

            // Addresses to UNMUTE: those in current but not in next
            const toUnmute = Array.from(mutedTestAddresses).filter(a => !nextMuted.has(a));
            if (toUnmute.length > 0) {
                ws.send(JSON.stringify({
                    type: 'clear_overrides',
                    addresses: toUnmute
                }));
            }

            // Addresses to MUTE: those in next but not in current
            const toMute = Array.from(nextMuted).filter(a => !mutedTestAddresses.has(a));
            if (toMute.length > 0) {
                ws.send(JSON.stringify({
                    type: 'laser_override',
                    overrides: toMute.map(addr => ({ address: addr, value: 0 }))
                }));
            }

            mutedTestAddresses = nextMuted;
        }

        function updateTestFunctions(role) {
            if (!role) return;
            console.log("Adding function to test:", role);
            window.activeTestFunctions.add(role);
            // Auto-add fixtures that have this function to the ensemble
            (db.stage || []).forEach(inst => {
                const prof = db.profiles.find(p => p.id === inst.profileId);
                if (prof && (prof.channels || []).some(ch => ch.role === role)) {
                    if (!window.activeTestFixtures.includes(inst.id)) window.activeTestFixtures.push(inst.id);
                }
            });
            renderTestTab();
            updateUniqueFunctions();
        }

        function clearTestFunctions() {
            console.log("Clearing all test functions");
            window.activeTestFunctions.clear();
            renderTestTab();
            updateUniqueFunctions();
        }

        function toggleHideTestChannel(fixtureId, channelIdx) {
            if (!hiddenTestChannels[fixtureId]) hiddenTestChannels[fixtureId] = [];
            if (!hiddenTestChannels[fixtureId].includes(channelIdx)) {
                hiddenTestChannels[fixtureId].push(channelIdx);
            }
            localStorage.setItem('vj_hidden_test_channels', JSON.stringify(hiddenTestChannels));
            renderTestTab();
        }

        function unhideAllTestChannels(fixtureId) {
            if (hiddenTestChannels[fixtureId]) {
                delete hiddenTestChannels[fixtureId];
                localStorage.setItem('vj_hidden_test_channels', JSON.stringify(hiddenTestChannels));
                renderTestTab();
            }
        }

        function updateTestNumericalValues() {
            renderActivePresets();
            // Traverse all active strips and update their small displays
            const strips = document.querySelectorAll('.test-strip-card');
            strips.forEach(strip => {
                const rows = strip.querySelectorAll('.compact-slider-row');
                rows.forEach((row, rowIdx) => {
                    const addr = parseInt(row.dataset.addr);
                    const val = latestDmxUniverse[addr] || 0;
                    const isBusy = latestOverrides.has(addr);

                    const valDisplay = row.querySelector('.compact-val-display');
                    if (valDisplay) valDisplay.innerText = val;

                    const slider = row.querySelector('.compact-slider-input');
                    if (slider && document.activeElement !== slider) slider.value = val;

                    if (isBusy) row.classList.add('busy');
                    else row.classList.remove('busy');
                });
            });
        }

        function sendCompactTestOverride(id, channelIdx, val) {
            const inst = db.stage.find(s => s.id === id);
            const profile = db.profiles.find(p => p.id === inst.profileId);
            const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
            const ch = (profile.channels || [])[channelIdx] || {};
            const addr = baseAddr + (parseInt(ch.addrOffset) || channelIdx);

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'laser_override',
                    overrides: [{ address: addr, value: parseInt(val) }]
                }));
            }
        }

        function clearFixtureOverrides(id) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'clear_overrides',
                    device: id
                }));
            }
        }

        function clearAllGlobalOverrides() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'clear_overrides',
                    device: 'all'
                }));
            }
        }

        function updateTestOverride(idx, val) {
            // Deprecated in favor of sendCompactTestOverride
        }
        function clearAllOverrides() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                // Now releases ALL active test strips
                ws.send(JSON.stringify({
                    type: 'clear_overrides',
                    device: 'all'
                }));
            }
        }

        function adjustTestValue(id, idx, delta) {
            const inst = db.stage.find(s => s.id === id);
            const profile = db.profiles.find(p => p.id === inst.profileId);
            const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
            const ch = (profile.channels || [])[idx] || {};
            const addr = baseAddr + (parseInt(ch.addrOffset) || idx);
            const current = latestDmxUniverse[addr] || 0;
            sendCompactTestOverride(fixtureId, idx, Math.max(0, Math.min(255, current + delta)));
        }

        /* --- RECORDING LOGIC --- */
        function toggleRecording() {
            if (isRecording) stopRecording();
            else startRecording();
        }

        function startRecording() {
            if (!ws || ws.readyState !== WebSocket.OPEN) return alert("System disconnected.");
            
            const addresses = new Set();
            const roles = {};

            // Hybrid Approach: Look at what strips are physically on screen, 
            // but fetch their roles from the data source (db).
            const strips = document.querySelectorAll('.test-strip-card');
            strips.forEach(strip => {
                const fixtureId = strip.dataset.fixtureId;
                const inst = (db.stage || []).find(s => s.id === fixtureId);
                if (!inst) return;
                
                const profile = (db.profiles || []).find(p => p.id === inst.profileId);
                if (!profile) return;
                
                const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
                const rows = strip.querySelectorAll('.compact-slider-row');
                
                rows.forEach(row => {
                    const addr = parseInt(row.dataset.addr);
                    addresses.add(addr);
                    
                    // Match this address to a profile channel
                    const channel = (profile.channels || []).find((ch, idx) => {
                        const chAddr = baseAddr + (parseInt(ch.addrOffset) || idx);
                        return chAddr === addr;
                    });
                    
                    if (channel) {
                        roles["" + addr] = (channel.role || channel.name || "unknown").toLowerCase();
                    }
                });
            });

            if (addresses.size === 0) {
                console.warn("Recording attempted with 0 addresses found in DOM.");
                return alert("No active channels to record. Please ensure fixtures are loaded in the Test Hub.");
            }

            console.log("🎬 Sending Start Recording:", { addrCount: addresses.size, roles: Object.keys(roles).length });

            ws.send(JSON.stringify({
                type: 'start_recording',
                name: null,
                addresses: Array.from(addresses),
                roles: roles
            }));
        }

        function stopRecording() {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            
            // Generate default name based on time
            const now = new Date();
            const ts = now.getFullYear() + 
                       String(now.getMonth() + 1).padStart(2, "0") + 
                       String(now.getDate()).padStart(2, "0") + "_" +
                       String(now.getHours()).padStart(2, "0") + 
                       String(now.getMinutes()).padStart(2, "0");
            
            const name = prompt("Recording complete! Save as (optional):", "REC_" + ts);
            
            ws.send(JSON.stringify({ 
                type: 'stop_recording',
                name: name || null 
            }));
        }

        function updateRecordingTimer() {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            const timerEl = document.getElementById('rec-timer');
            if (timerEl) timerEl.innerText = `${mins}:${secs}`;
        }

        function clearOverride(addr) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'clear_channel_overrides',
                    addresses: [addr]
                }));
            }
        }

        function toggleTestWaveform(idx) {
            // Waveform logic disabled in compact view to maintain ultra-tight layout
        }

        function drawTestWaveform() {
            // Waveform logic disabled in compact view
        }

        function deleteStageInstance(id) {
            if (!confirm("Remove this instance from stage?")) return;
            db.stage = db.stage.filter(x => x.id !== id);
            saveDB();
            refreshUI();
        }

        // --- 6. LIVE DMX WEBSOCKET & RENDER ENGINE ---
        // (Globals now shared from shared_setup.js)
        let testWaveformChannel = -1;
        let simulationPhases = {};
        let simulationPrevPs = {}; // { ruleId: prevP } for transition detection
        let simulationSamples = {}; // { ruleId: sampledEnergy }
        window.simulationPrevVals = {}; // { ruleId: prevVal } for smoothing

        let ws_reconnect_delay = 2000;
        function connectWs() {
            if (window.isStandaloneMode) return;
            if (!window.RAVEBOX_READY) return setTimeout(connectWs, 500);
            
            const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const savedPort = localStorage.getItem('vj_ws_port') || '8765';

            // Use globally exposed flags from shared_setup.js for robust routing
            const { isOriginalCloud, isCustomTunnel, wsHost, isCustomSubdomain, host } = window;
            console.log("📡 Routing Check:", { isOriginalCloud, isCustomTunnel, wsHost, host });

            // Prioritize the dedicated wsHost (custom proxy path) over general subdomain/host
            let wsUrl = isOriginalCloud ? `${wsProtocol}://wss.ravebox.love` : 
                        (window.isCustomTunnel ? `${wsProtocol}://${window.wsHost}` : 
                        (window.isCustomSubdomain ? `${wsProtocol}://${window.location.host}` : 
                        `${wsProtocol}://${window.host}:${savedPort}`));
            
            console.log("🔌 Attempting WebSocket connection to:", wsUrl);
            const newWs = new WebSocket(wsUrl);

            newWs.onopen = () => {
                ws = newWs;
                dmx_connected = true;
                ws_reconnect_delay = 2000; // Reset on success
                console.log("✅ WebSocket Connected!");
            };

            newWs.binaryType = 'arraybuffer';
            newWs.onmessage = (event) => {
                if (event.data instanceof ArrayBuffer) {
                    const view = new DataView(event.data);
                    window.lastDmxUpdate = Date.now();

                    // 1. UPDATE AUDIO STATE
                    latestAudioState.vol = view.getFloat32(20, true);
                    latestAudioState.bpm = view.getFloat32(24, true);
                    latestAudioState.beat = view.getUint8(52) === 1;

                    const bins = [];
                    for (let i = 0; i < 6; i++) bins.push(view.getFloat32(28 + (i * 4), true));
                    latestAudioState.bins = bins;

                    // Populate top-level fields for visualizers and legacy logic
                    latestAudioState.flux = view.getFloat32(4, true);
                    latestAudioState.bass = view.getFloat32(8, true);
                    latestAudioState.mid = view.getFloat32(12, true);
                    latestAudioState.high = view.getFloat32(16, true);

                    latestAudioState.mods = {
                        flux: latestAudioState.flux,
                        bass: latestAudioState.bass,
                        high: latestAudioState.high,
                        vol: latestAudioState.vol
                    };

                    // 2. UPDATE DMX UNIVERSE (offset 82)
                    for (let i = 0; i < 513; i++) {
                        latestDmxUniverse[i] = view.getUint8(82 + i);
                    }

                    // 3. TRIGGER THROTTLED UI UPDATES
                    if (document.getElementById('tab-test').classList.contains('active')) {
                        updateTestNumericalValues();
                    }

                    const heart = document.getElementById('editor-heartbeat');
                    if (heart && latestAudioState.beat) {
                        heart.style.background = 'var(--accent)';
                        setTimeout(() => heart.style.background = '#333', 50);
                    }
                    return;
                }

                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'state') {
                        if (msg.vibe) latestAudioState.vibe = msg.vibe;
                        if (msg.transient) latestAudioState.transient = msg.transient;
                        if (msg.blackout !== undefined) latestAudioState.blackout = msg.blackout;
                        if (msg.overrides) latestOverrides = new Set(msg.overrides.map(a => parseInt(a)));
                        if (msg.active_presets) {
                            activePresets = msg.active_presets;
                            latestAudioState.manual_active_presets = msg.active_presets;
                            // Track that these have been activated at least once
                            msg.active_presets.forEach(p => everActivatedPresets.add(p));
                        }
                        if (msg.lissajous_active !== undefined) latestAudioState.lissajous_active = msg.lissajous_active;
                        if (msg.calibrated_preset_active !== undefined) latestAudioState.calibrated_preset_active = msg.calibrated_preset_active;
                        if (document.getElementById('tab-test')?.classList.contains('active')) {
                            updateTestNumericalValues();
                        }
                        if (msg.active_presets && document.getElementById('tab-live')?.classList.contains('active')) {
                            if (typeof renderLiveTab === 'function') renderLiveTab();
                        }
                    } else if (msg.type === 'audio') {
                        // SYNC FROM BACKEND (Throttled/Batched JSON)
                        if (msg.data) {
                            Object.assign(latestAudioState, msg.data);
                        }
                        if (msg.logic) {
                            // Sync logic states for visualizers
                            Object.assign(latestAudioState, msg.logic);
                        }
                        
                        // Periodic full UI sync if needed
                        if (document.getElementById('tab-test').classList.contains('active')) {
                             updateTestNumericalValues();
                        }
                    } else if (msg.type === 'current_params') {
                        if (msg.master) {
                            if ('sensitivity' in msg.master) document.getElementById('master-sensitivity-input').value = msg.master.sensitivity;
                            if ('speed' in msg.master) document.getElementById('master-speed-input').value = msg.master.speed;
                            if ('intensity' in msg.master) document.getElementById('master-intensity-input').value = msg.master.intensity;
                        }
                    } else if (msg.type === 'recording_started') {
                        if (msg.success) {
                            isRecording = true;
                            recordingStartTime = Date.now();
                            document.getElementById('rec-status').classList.add('active');
                            document.getElementById('btn-record').innerText = "⏹ Stop Rec";
                            document.getElementById('btn-record').style.borderColor = "var(--danger)";
                            recordingTimerInterval = setInterval(updateRecordingTimer, 1000);
                        }
                    } else if (msg.type === 'recording_stopped') {
                        isRecording = false;
                        clearInterval(recordingTimerInterval);
                        document.getElementById('rec-status').classList.remove('active');
                        document.getElementById('btn-record').innerText = "🔴 Record";
                        document.getElementById('btn-record').style.borderColor = "#444";
                        
                        if (msg.path) {
                            const folder = msg.path.split('/').pop();
                            const link = `<a href="player.html?session=${folder}" target="_blank" style="color:var(--accent); font-weight:bold; text-decoration:underline;">Open X-Ray Player 📈</a>`;
                            showToast(`🎬 Recording Saved! ${link}`, 10000);
                        }
                    }
                } catch (e) { }
            };

            newWs.onclose = () => {
                dmx_connected = false;
                const backoff = document.hidden ? 15000 : ws_reconnect_delay;
                setTimeout(() => {
                    connectWs();
                    ws_reconnect_delay = Math.min(ws_reconnect_delay * 1.5, 30000);
                }, backoff);
            };
        }
        connectWs();

        // --- DIGITAL TWIN SIMULATION ASSETS ---
        let simManifest = null;
        let simImageCache = {}; // { filename: Image }
        async function loadSimManifest() {
            try {
                const res = await fetch(`${BACKEND_ROOT}/backend/static/sim_manifest.json`);
                if (res.ok) {
                    simManifest = await res.json();
                    console.log("📸 Sim Manifest Loaded:", simManifest);
                }
            } catch (e) { console.warn("Could not load sim manifest", e); }
        }
        loadSimManifest();

        function getSimFrame(patVal, xRot, yRot, drawVal, drawingVal) {
            if (!simManifest) return null;

            // Priority 1: X/Y Rotation Deformation
            // If either X or Y rotation is significantly active, show the captured deformation frame
            const rotThreshold = 20;
            if ((xRot > rotThreshold || yRot > rotThreshold) && simManifest.rot_deformations && simManifest.rot_deformations.length > 0) {
                let best = null, minDist = 99999;
                for (const r of simManifest.rot_deformations) {
                    const dist = Math.abs(r.x - xRot) + Math.abs(r.y - yRot);
                    if (dist < minDist) { minDist = dist; best = r; }
                }
                if (best) return best.file;
            }

            // Priority 2: Drawing Interaction Deformation (draw or drawing channel active)
            const drawThreshold = 10;
            if ((drawVal > drawThreshold || drawingVal > drawThreshold) && simManifest.draw_deformations && simManifest.draw_deformations.length > 0) {
                let best = null, minDist = 99999;
                for (const d of simManifest.draw_deformations) {
                    const dist = Math.abs(d.draw - drawVal) + Math.abs(d.drawing - drawingVal);
                    if (dist < minDist) { minDist = dist; best = d; }
                }
                if (best) return best.file;
            }

            // Priority 3: Pattern Scan (CH 4) - exact match
            const p = simManifest.patterns[String(patVal)];
            if (p) return p.file;

            // Fallback: nearest pattern
            let bestP = null, minDistP = 99999;
            for (const key in simManifest.patterns) {
                const dist = Math.abs(parseInt(key) - patVal);
                if (dist < minDistP) { minDistP = dist; bestP = simManifest.patterns[key]; }
            }
            return bestP ? bestP.file : null;
        }

        // Simulated/Live History removed

        function calculateRuleSimulation(chIdx, ruleIdx, dt, instId = null) {
            const rules = currentProfileMappings[chIdx];
            if (!rules || !rules[ruleIdx]) return 127;
            const rule = rules[ruleIdx];

            const behavior = rule.behavior || rule.mod || 'static';
            const source = rule.source || 'raw';
            const cal = rule.cal || { min: 0, center: 127, max: 255 };
            const min = parseInt(cal.min || 0);
            const max = parseInt(cal.max || 255);
            const center = parseInt(cal.center || (min + max) / 2);

            if (behavior === 'static' || behavior === 'state_machine') return rule.value || center;

            let norm = 0;
            const audioCfg = rule.audio || { bin: 0, smoothing: 0.5, threshold: 0.5, react: 1.0 };
            const binIdx = parseInt(rule.bin_idx !== undefined ? rule.bin_idx : (rule.lfo ? rule.lfo.bin : 0));

            // Pull simulated energy based on Source
            let energy = 0;
            const mods = latestAudioState.mods || {};
            if (source === 'raw') {
                if (binIdx === 0 && mods.bass !== undefined) energy = mods.bass;
                else energy = (latestAudioState.bins || [0])[binIdx] || 0;
            } else if (source === 'ratio') {
                energy = (latestAudioState.ratios || [0])[binIdx] || 0;
            } else if (source === 'attack') {
                energy = (latestAudioState.attacks || [0])[binIdx] || 0;
            } else if (source === 'flux') {
                energy = (mods.flux !== undefined) ? (mods.flux * 0.5) : (latestAudioState.flux || 0) * 0.3;
            } else if (source === 'volume') {
                energy = mods.vol !== undefined ? mods.vol : (latestAudioState.vol || 0);
            }

            if (behavior === 'lfo') {
                const lfo = rule.lfo || { shape: 'sine', speed: 0.5, bin: 0, react: 0.5, smoothing: 0, threshold: 0.1 };
                const id = instId ? `sim_${instId}_${chIdx}_${ruleIdx}` : `sim_${chIdx}_${ruleIdx}`;
                if (simulationPhases[id] === undefined) simulationPhases[id] = 0;
                if (simulationPrevPs[id] === undefined) simulationPrevPs[id] = 0;
                if (simulationSamples[id] === undefined) simulationSamples[id] = energy;

                const speed = parseFloat(lfo.speed || 0.5);
                const react = parseFloat(lfo.react || 0.5);

                // Simulation: Match backend which uses 0.3x baseline multiplier
                const freq = (speed + (energy * react)) * 0.3 * 2 * Math.PI;
                simulationPhases[id] = (simulationPhases[id] + dt * freq) % (2 * Math.PI);
                const p = simulationPhases[id] / (2 * Math.PI);
                const prevP = simulationPrevPs[id];
                simulationPrevPs[id] = p;

                const shape = lfo.shape || 'sine';

                if (shape === 'sine') {
                    norm = Math.sin(simulationPhases[id]);
                } else if (shape === 'sawtooth') {
                    norm = (p * 2.0) - 1.0;
                } else if (shape === 'triangle') {
                    norm = 4.0 * Math.abs(p - 0.5) - 1.0;
                } else if (shape === 'square') {
                    // EDGE TRANSITION: Sample energy on transition (Select & Hold) to match backend
                    if (p < prevP || (p >= 0.5 && prevP < 0.5)) {
                        simulationSamples[id] = energy;
                    }
                    norm = p < 0.5 ? 1.0 : -1.0;
                }

                if (lfo.invert) norm = -norm;

                // Square wave uses sampled energy. Others use real-time.
                const targetEnergy = (shape === 'square') ? simulationSamples[id] : energy;

                // Simulation: Match backend amplitude scaling: (1.0 - reactivity) + (s_energy * reactivity * 1.0)
                const ampScale = (1.0 - react) + (targetEnergy * react * 1.0);
                norm *= Math.max(0, Math.min(1.0, ampScale));

                // RETURN TO MIN logic (simulated)
                if (lfo.return_to_min && energy < (lfo.threshold || 0.1)) {
                    norm = lfo.invert ? 1.0 : -1.0;
                }

            } else if (behavior === 'direct') {
                norm = (energy * (audioCfg.react || 1.0)) * 2.0 - 1.0;
            } else if (behavior === 'cycle' || behavior.includes('beat')) {
                norm = latestAudioState.beat ? 1.0 : -1.0;
            }

            // Apply Smoothing to Simulation
            const simId = `sim_val_${chIdx}_${ruleIdx}`;
            if (simulationPrevVals[simId] === undefined) simulationPrevVals[simId] = norm;

            // FIX: behavior used instead of undefined 'mod'
            const smooth = (behavior === 'lfo') ? (rule.lfo.smoothing || 0) : (audioCfg.smoothing || 0);
            if (smooth > 0) {
                norm = (norm * (1.0 - smooth)) + (simulationPrevVals[simId] * smooth);
            }
            simulationPrevVals[simId] = norm;

            // Map norm (-1..1) to min/center/max
            let out = center;
            if (norm < 0) out = center + norm * (center - min);
            else out = center + norm * (max - center);

            return Math.max(0, Math.min(255, out));
        }

        const simulationShapes = [
            (ctx, x, y, s) => { ctx.beginPath(); ctx.arc(x, y, s / 2, 0, Math.PI * 2); ctx.stroke(); }, // Circle
            (ctx, x, y, s) => { ctx.strokeRect(x - s / 2, y - s / 2, s, s); }, // Square
            (ctx, x, y, s) => { // Star
                ctx.beginPath();
                for (let i = 0; i < 5; i++) {
                    ctx.lineTo(x + Math.cos((18 + 72 * i) * Math.PI / 180) * s / 2, y - Math.sin((18 + 72 * i) * Math.PI / 180) * s / 2);
                    ctx.lineTo(x + Math.cos((54 + 72 * i) * Math.PI / 180) * s / 4, y - Math.sin((54 + 72 * i) * Math.PI / 180) * s / 4);
                }
                ctx.closePath(); ctx.stroke();
            },
            (ctx, x, y, s) => { ctx.beginPath(); ctx.moveTo(x - s / 2, y); ctx.lineTo(x + s / 2, y); ctx.stroke(); }, // Line
            (ctx, x, y, s) => { // Hexagon
                ctx.beginPath();
                for (let i = 0; i < 6; i++) ctx.lineTo(x + Math.cos(i * 60 * Math.PI / 180) * s / 2, y + Math.sin(i * 60 * Math.PI / 180) * s / 2);
                ctx.closePath(); ctx.stroke();
            },
            (ctx, x, y, s) => { // Triangle
                ctx.beginPath();
                for (let i = 0; i < 3; i++) ctx.lineTo(x + Math.cos((i * 120 - 90) * Math.PI / 180) * s / 2, y + Math.sin((i * 120 - 90) * Math.PI / 180) * s / 2);
                ctx.closePath(); ctx.stroke();
            },
            (ctx, x, y, s) => { // Spiral
                ctx.beginPath();
                for (let i = 0; i < 20; i++) {
                    const r = (i / 20) * s / 2;
                    const a = i * 0.5;
                    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
                }
                ctx.stroke();
            }
        ];

        // Numerical DMX Tracking for Test Hub
        let simMuted = {}; // { instanceId: boolean }

        function toggleSimMute(id) {
            simMuted[id] = !simMuted[id];
        }

        function getRangeMapping(profile, chIdx, val) {
            const mappings = profile.mappings || [];
            const rules = mappings[chIdx] || [];
            if (rules.length === 0) return { min: 0, max: 255, isLowest: true };

            const ranges = rules.map(r => ({
                min: parseInt(r.cal?.min || 0),
                max: parseInt(r.cal?.max || 255),
                vibe: r.vibe || 'any'
            })).sort((a, b) => a.min - b.min);

            const lowestMin = ranges[0].min;
            const currentVibe = latestAudioState.vibe || 'any';

            // Find active range
            let active = ranges.find(r => (r.vibe === currentVibe || r.vibe === 'any') && val >= r.min && val <= r.max);
            if (!active) active = ranges.find(r => val >= r.min && val <= r.max);
            if (!active) active = ranges[0];

            return {
                min: active.min,
                max: active.max,
                isLowest: (active.min === lowestMin)
            };
        }

        function drawSimulation(dt) {
            const canvas = document.getElementById('sim-canvas');
            if (!canvas) return;
            if (canvas.width !== canvas.clientWidth) canvas.width = canvas.clientWidth;
            if (canvas.height !== canvas.clientHeight) canvas.height = canvas.clientHeight;
            const ctx = canvas.getContext('2d');
            const w = canvas.width, h = canvas.height;

            ctx.fillStyle = '#050508';
            ctx.fillRect(0, 0, w, h);

            if (Date.now() - window.lastDmxUpdate > 2000) return;

            // Draw Grid
            ctx.strokeStyle = '#1a1a1f';
            ctx.lineWidth = 1;
            for (let x = 0; x < w; x += w / 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
            for (let y = 0; y < h; y += h / 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

            const activeList = document.getElementById('sim-active-list');
            const listItems = [];

            db.stage.forEach((inst, originalIndex) => {
                const profile = db.profiles.find(p => p.id === inst.profileId);
                if (!profile) return;

                const instBaseAddr = parseInt(inst.address) || 0;
                const instOffset = parseInt(inst.offset || 0);
                const baseAddr = (instBaseAddr > 0) ? instBaseAddr + instOffset : -1;

                let xNorm = 0.5, yNorm = 0.5, patVal = 0, intensity = 255, scale = 0.5, rotation = 0;
                let isDimOn = true;

                (profile.channels || []).forEach((ch, chIdx) => {
                    const role = (ch.role || ch.name || "").toLowerCase().trim();
                    const addr = baseAddr !== -1 ? baseAddr + (parseInt(ch.addrOffset) || chIdx) : -1;
                    const val = (addr > 0 && addr <= 512) ? latestDmxUniverse[addr] : 0;

                    const mapping = getRangeMapping(profile, chIdx, val);
                    const rangeLen = Math.max(1, mapping.max - mapping.min);
                    const normInside = Math.max(0, Math.min(1, (val - mapping.min) / rangeLen));

                    if (role === 'dimmer' || role === 'intensity' || role === 'brightness' || role === 'shutter' || role === 'dim') {
                        intensity = val;
                        isDimOn = (val > 0);
                    } else if (role.includes('x position') || role.includes('x pos') || role === 'x' || role.includes('x_pos') || role.includes('x axis')) {
                        xNorm = normInside;
                    } else if (role.includes('y position') || role.includes('y pos') || role === 'y' || role.includes('y_pos') || role.includes('y axis')) {
                        yNorm = 1.0 - normInside; // Lowest is bottom, highest is top
                    } else if (role.includes('rotation') || role.includes('rotate z') || role === 'rot') {
                        rotation = normInside * Math.PI * 2; // Clockwise 0-360
                    } else if (role.includes('zoom') || role.includes('scale')) {
                        if (mapping.isLowest) scale = 1.0 - (normInside * 0.9); // Big to dot
                        else scale = 0.1 + (normInside * 0.9); // Small to big
                    } else if (role.includes('pattern') || role.includes('gobo') || role.includes('shape')) {
                        patVal = val;
                    }
                });

                const zone = (inst.zone || "center").toLowerCase();
                const isMuted = !!simMuted[inst.id];

                if (isDimOn && !isMuted) {
                    let zX = 0, zY = 0, zW = w, zH = h;
                    if (zone === 'left') { zX = 0; zW = w * 0.4; zY = h * 0.1; zH = h * 0.8; }
                    else if (zone === 'right') { zX = w * 0.6; zW = w * 0.4; zY = h * 0.1; zH = h * 0.8; }
                    else if (zone === 'top') { zX = w * 0.1; zW = w * 0.8; zY = 0; zH = h * 0.4; }
                    else if (zone === 'bottom') { zX = w * 0.1; zW = w * 0.8; zY = h * 0.6; zH = h * 0.4; }
                    else { zX = w * 0.25; zY = h * 0.25; zW = w * 0.5; zH = h * 0.5; }

                    const posX = zX + (xNorm * zW);
                    const posY = zY + (yNorm * zH);
                    const alpha = intensity / 255;
                    const shapeSize = Math.min(zW, zH) * 0.3 * scale;
                    const safePatVal = Number(patVal) || 0;
                    const shapeIdx = Math.floor(safePatVal / (256 / simulationShapes.length)) % simulationShapes.length;
                    const safeIdx = isNaN(shapeIdx) ? 0 : shapeIdx;

                    ctx.save();
                    ctx.translate(posX, posY);
                    ctx.rotate(rotation);
                    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
                    ctx.lineWidth = 2;
                    ctx.shadowBlur = 15 * alpha;
                    ctx.shadowColor = '#fff';
                    simulationShapes[safeIdx](ctx, 0, 0, shapeSize);
                    ctx.restore();

                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                    ctx.font = 'bold 9px Inter';
                    const label = `${inst.id}`;
                    ctx.fillText(label, posX - (ctx.measureText(label).width / 2), posY - (shapeSize / 2) - 10);
                }

                const muteBtnLabel = isMuted ? "UNMUTE" : "MUTE";
                const muteBtnColor = isMuted ? "#666" : "var(--accent)";

                const html = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; padding-bottom:5px; border-bottom:1px solid #333;">
                        <div>
                            <b style="${isMuted ? 'opacity:0.5' : ''}">${inst.id}</b> <span style="font-size:10px; color:#888;">[${zone.toUpperCase()}]</span><br>
                            <span style="font-size:11px; ${isMuted ? 'opacity:0.5' : ''}">X=${Math.round(xNorm * 255)} Y=${Math.round(yNorm * 255)} | Scale=${scale.toFixed(2)} | INT=${intensity}</span>
                        </div>
                        <button onclick="toggleSimMute('${inst.id}')" style="background:transparent; border:1px solid ${muteBtnColor}; color:${muteBtnColor}; border-radius:4px; font-size:9px; padding:2px 6px; cursor:pointer;">
                            ${muteBtnLabel}
                        </button>
                    </div>`;

                listItems.push({ html, isMuted, index: originalIndex });
            });

            listItems.sort((a, b) => (a.isMuted === b.isMuted ? a.index - b.index : (a.isMuted ? 1 : -1)));
            const newHtml = listItems.map(item => item.html).join('');
            if (activeList && activeList._lastHtml !== newHtml) {
                activeList.innerHTML = newHtml;
                activeList._lastHtml = newHtml;
            }
        }

        // --- ENSEMBLE PICKER RENDERER ---
        function renderEnsemblePicker() {
            const picker = document.getElementById('test-fixture-picker');
            if (!picker) return;

            const stage = db.stage || [];
            picker.innerHTML = stage.map(inst => {
                const isActive = window.activeTestFixtures.includes(inst.id);
                return `<div class="fixture-picker-pill ${isActive ? 'active' : ''}" onclick="toggleFixtureInTest('${inst.id}')">
                    ${inst.id}
                </div>`;
            }).join('');
        }

        function toggleFixtureInTest(id) {
            if (window.activeTestFixtures.includes(id)) {
                window.activeTestFixtures = window.activeTestFixtures.filter(f => f !== id);
            } else {
                window.activeTestFixtures.push(id);
            }

            // Restore hidden channels when toggled (added or removed)
            if (hiddenTestChannels[id]) {
                delete hiddenTestChannels[id];
                localStorage.setItem('vj_hidden_test_channels', JSON.stringify(hiddenTestChannels));
            }

            renderTestTab();
        }

        // Helper to simulate multiple instances without shared phases
        function calculateRuleSimulationForInstance(instId, chIdx, ruleIdx, dt, profile) {
            const rules = profile.mappings ? profile.mappings[chIdx] : [];
            if (!rules || !rules[ruleIdx]) return 127;
            const rule = rules[ruleIdx];

            const behavior = rule.behavior || rule.mod || 'static';
            const source = rule.source || 'raw';
            const cal = rule.cal || { min: 0, center: 127, max: 255 };
            const min = parseInt(cal.min || 0);
            const max = parseInt(cal.max || 255);
            const center = parseInt(cal.center || (min + max) / 2);

            if (behavior === 'static' || behavior === 'state_machine') return rule.value || center;

            let norm = 0;
            const binIdx = parseInt(rule.bin_idx !== undefined ? rule.bin_idx : (rule.lfo ? rule.lfo.bin : 0));
            let energy = 0;
            const mods = latestAudioState.mods || {};
            if (source === 'raw') energy = (latestAudioState.bins || [0])[binIdx] || 0;
            else if (source === 'flux') energy = (mods.flux !== undefined) ? (mods.flux * 0.5) : (latestAudioState.flux || 0) * 0.3;
            else if (source === 'volume') energy = mods.vol !== undefined ? mods.vol : (latestAudioState.vol || 0);

            if (behavior === 'lfo') {
                const lfo = rule.lfo || { shape: 'sine', speed: 0.5, bin: 0, react: 0.5 };
                const id = `inst_${instId}_${chIdx}`;
                if (simulationPhases[id] === undefined) simulationPhases[id] = 0;
                const freq = (parseFloat(lfo.speed || 0.5) + (energy * parseFloat(lfo.react || 0.5))) * 0.3 * 2 * Math.PI;
                simulationPhases[id] = (simulationPhases[id] + dt * freq) % (2 * Math.PI);
                const p = simulationPhases[id] / (2 * Math.PI);

                if (lfo.shape === 'sine') norm = Math.sin(simulationPhases[id]);
                else if (lfo.shape === 'sawtooth') norm = (p * 2.0) - 1.0;
                else if (lfo.shape === 'triangle') norm = 4.0 * Math.abs(p - 0.5) - 1.0;
                else if (lfo.shape === 'square') norm = p < 0.5 ? 1.0 : -1.0;

                if (lfo.invert) norm = -norm;
            }

            let out = center;
            if (norm < 0) out = center + norm * (center - min);
            else out = center + norm * (max - center);
            return Math.max(0, Math.min(255, out));
        }

        function drawCanvasLoop() {
            if (!window.RAVEBOX_READY) return requestAnimationFrame(drawCanvasLoop);
            
            const now = performance.now();
            if (window.simulationLastTime === 0) window.simulationLastTime = now - 16;
            const dt = Math.min(0.1, (now - window.simulationLastTime) / 1000);
            window.simulationLastTime = now;

            // 0. Simulation Tab
            const simTab = document.getElementById('tab-sim');
            if (simTab && simTab.classList.contains('active')) {
                drawSimulation(dt);
            }

            // 1. Update Test Tab Numerical Values
            const activeTestCount = (window.activeTestFixtures || []).length;
            const testTab = document.getElementById('tab-test');
            if (activeTestCount > 0 && testTab && testTab.classList.contains('active')) {
                updateTestNumericalValues();
            }
            // 2. Clear simulation if no recent updates
            if (Date.now() - (window.lastDmxUpdate || 0) > 2000) {
                window.simulationLastTime = 0;
            }
            requestAnimationFrame(drawCanvasLoop);
        }

        let bootAttempts = 0;
        async function initApp() {
            if (!window.RAVEBOX_READY) {
                bootAttempts++;
                if (bootAttempts > 50) { // 5 seconds
                    console.error("🚨 EMERGENCY BOOT: Core failed to report READY. Forcing initialization...");
                    window.RAVEBOX_READY = true;
                } else {
                    console.warn(`⏳ Waiting for Core (Attempt ${bootAttempts})...`);
                    return setTimeout(initApp, 100);
                }
            }

            try {
                // Fetch the list of all files in fixtures/
                const root = window.API_BASE_ROOT || "";
                const resList = await fetch(`${root}/api/fixtures`);
                if (resList.ok) {
                    const fileList = await resList.json();

                    if (fileList && Array.isArray(fileList)) {
                        // Keep track of which profiles we found on the server
                        const serverProfileIds = new Set();
                        const serverFileNames = new Set(fileList);

                        for (const fileName of fileList) {
                            try {
                                const resFile = await fetch(`${root}/api/fixtures/${fileName}`);
                                if (!resFile.ok) continue;
                                const data = await resFile.json();

                                if (fileName.startsWith('profiles/')) {
                                    data._fileName = fileName;
                                    // Overwrite or add
                                    db.profiles = db.profiles.filter(p => p.id !== data.id && p._fileName !== fileName);
                                    db.profiles.push(data);
                                    serverProfileIds.add(data.id);
                                } else if (fileName === 'stage_config.json') {
                                    db.stage = data;
                                } else if (fileName === 'presets.json') {
                                    db.presets = data;
                                }
                            } catch (err) {
                                console.error(`Error loading ${fileName}:`, err);
                            }
                        }

                        // PRUNE GHOSTS: Remove profiles from memory that HAVE a _fileName but weren't found in serverFileNames
                        // OR profiles that match IDs we expect to be on the server but weren't present.
                        const originalCount = db.profiles.length;
                        db.profiles = db.profiles.filter(p => {
                            if (!p._fileName) return true; // Keep local-only unsaved stuff
                            return serverFileNames.has(p._fileName);
                        });

                        if (db.profiles.length !== originalCount) {
                            console.log(`🧹 Pruned ${originalCount - db.profiles.length} ghost profiles not found on server.`);
                        }

                        saveDB();
                    }
                }
            } catch (e) {
                console.warn("Init load failed, using local cache:", e);
            }
            updateUniqueFunctions();
            refreshUI();
            document.querySelectorAll('.active-model-name').forEach(el => {
                const select = document.getElementById('ai-model-select-settings') || document.getElementById('ai-model-select');
                if (select && select.selectedIndex >= 0) {
                    el.innerText = select.options[select.selectedIndex].text;
                }
            });

        }
        
        // Swipe Gestures
        let touchStartX = 0, touchStartY = 0;
        document.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY; }, { passive: true });
        document.addEventListener('touchend', e => { handleSwipe(e.changedTouches[0].screenX - touchStartX, e.changedTouches[0].screenY - touchStartY); }, { passive: true });
        function handleSwipe(dx, dy) {
            if (window.innerWidth <= 768 && dx > 80 && Math.abs(dx) > Math.abs(dy)) window.location.href = 'manager.html';
        }

        initApp();
        drawCanvasLoop();

        // --- WEBSOCKET FLOW ---

function togglePreset(presetId) {
    if (!presetId) return;
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: presetId }));
    } else {
        console.warn("WebSocket not connected, cannot toggle preset:", presetId);
    }
}
window.togglePreset = togglePreset;
window.everActivatedPresets = everActivatedPresets;
window.activePresets = activePresets;
