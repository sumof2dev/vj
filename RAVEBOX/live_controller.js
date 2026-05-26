
/* --- 6. LIVE CONSOLE LOGIC --- */
let liveEditMode = false;
let liveConfig = []; // [{type, targetId, channelIdx, color}]
let assigningBtnIdx = null;
let draggedBtnIdx = null;
let dragTargetIdx = null;
let isDraggingBtn = false;
let dragPointerStart = { x: 0, y: 0 };
let longPressTimer = null;
let isLongPress = false;
let activePointerIdx = null;
let pointerInitialClientY = 0;
let pointerInitialClientX = 0;
let pointerCurrentClientY = 0;
let pointerCurrentClientX = 0;
let buttonHoldActive = false;
let buttonHoldType = null;
let buttonHoldId = null;
let buttonHoldMoved = false;

function loadLiveConfig() {
    if (window.db.liveConsole && Array.isArray(window.db.liveConsole) && window.db.liveConsole.length > 0) {
        liveConfig = window.db.liveConsole;
    } else {
        const saved = localStorage.getItem('vj_live_console_config');
        if (saved) {
            liveConfig = JSON.parse(saved);
        } else {
            // Initialize with 16 buttons
            liveConfig = Array(16).fill(null).map(() => ({ type: 'none', color: '#333' }));
        }
    }
    
    // Backfill for XY and Live Feed and Instance IDs
    liveConfig.forEach(cfg => {
        if (cfg && cfg.type === 'slider') {
            if (cfg.min === undefined) cfg.min = 0;
            if (cfg.max === undefined) cfg.max = 255;
            // X axis defaults
            if (cfg.minX === undefined) cfg.minX = 0;
            if (cfg.maxX === undefined) cfg.maxX = 255;
            
            // Convert old Profile IDs to Instance IDs if possible
            if (cfg.targetId && !window.db.stage.find(s => s.id === cfg.targetId)) {
                const inst = window.db.stage.find(s => s.profileId === cfg.targetId);
                if (inst) cfg.targetId = inst.id;
            }
            if (cfg.targetIdX && !window.db.stage.find(s => s.id === cfg.targetIdX)) {
                const inst = window.db.stage.find(s => s.profileId === cfg.targetIdX);
                if (inst) cfg.targetIdX = inst.id;
            }
        }
    });
}

async function saveLiveConfig(skipServer = false) {
    localStorage.setItem('vj_live_console_config', JSON.stringify(liveConfig));
    window.db.liveConsole = [...liveConfig];
    if (typeof saveDB === 'function') await saveDB(skipServer);
}

function toggleLiveEditMode() {
    liveEditMode = !liveEditMode;
    const controls = document.getElementById('live-edit-controls');
    const gear = document.getElementById('live-gear-btn');
    if (controls) controls.style.display = liveEditMode ? 'flex' : 'none';
    if (gear) gear.style.background = liveEditMode ? 'var(--danger)' : '#333';
    renderLiveTab();
}

async function saveLiveConfigToServer() {
    const name = prompt("Enter a unique name for this console layout:", "My Console");
    if (!name) return;
    const fileName = `live_consoles/${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;

    console.log(`💾 [LIVE CONSOLE] Saving to ${fileName}...`);
    try {
        const res = await fetch(`${window.API_BASE}/${fileName}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(liveConfig)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        window.db.liveConsole = liveConfig;
        // Add to list if new
        if (!window.db.savedConsoles.find(c => c._fileName === fileName)) {
            window.db.savedConsoles.push({ _fileName: fileName, name: name });
        }
        if (typeof saveDB === 'function') saveDB();
        alert(`✅ Saved as ${name}`);
    } catch (e) {
        console.error("❌ Save failed:", e);
        alert("Error saving: " + e.message);
    }
}

async function loadLiveConfigFromServer() {
    if (!window.db.savedConsoles || window.db.savedConsoles.length === 0) {
        alert("No saved consoles found on server.");
        return;
    }
    const list = (window.db.savedConsoles || []).map((c, i) => `${i + 1}. ${(c._fileName || '').split('/').pop().replace('.json','')}`).join('\n');
    const choice = prompt("Select a console to load (number):\n" + list);
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    const consoleMeta = window.db.savedConsoles[idx];
    if (!consoleMeta) return;

    console.log(`🔄 [LIVE CONSOLE] Loading ${consoleMeta._fileName}...`);
    try {
        const res = await fetch(`${window.API_BASE_ROOT}/api/fixtures/${consoleMeta._fileName}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data && Array.isArray(data)) {
            liveConfig = data;
            window.db.liveConsole = data;
            saveLiveConfig();
            if (typeof saveDB === 'function') saveDB();
            renderLiveTab();
            alert("✅ Console loaded!");
        }
    } catch (e) {
        console.error("❌ Load failed:", e);
        alert("Error loading: " + e.message);
    }
}

function renderLiveTab() {
    const grid = document.getElementById('live-console-grid');
    if (!grid) return;

    let html = '';
    // Show existing buttons + 4 extra slots in Edit Mode to allow addition
    const displayCount = liveEditMode ? Math.max(16, liveConfig.length + 4) : liveConfig.length;

    for (let i = 0; i < displayCount; i++) {
        // Special Hijack: Index 3 (Top-Right in a 4-col grid) is always Gear/Home
        if (i === 3) {
            html += `
                <div class="live-btn system-slot" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); height:100px; display:flex; gap:15px; align-items:center; justify-content:center; cursor:default; position:relative; overflow:hidden; border-radius:15px; grid-column: 4 / 5; grid-row: 1 / 2;">
                    <button class="btn btn-sm" id="live-gear-btn" onclick="toggleLiveEditMode()" title="Settings" style="padding: 8px; border-radius: 50%; width: 40px; height: 40px; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); cursor:pointer; transition:all 0.2s;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm" onclick="window.location.href='manager.html'" title="Home" style="padding: 8px; border-radius: 50%; width: 40px; height: 40px; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); cursor:pointer; transition:all 0.2s;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                            <polyline points="9 22 9 12 15 12 15 22"></polyline>
                        </svg>
                    </button>
                </div>
            `;
            continue;
        }

        const cfg = liveConfig[i] || { type: 'none', color: '#333' };
        let content = '';
        let label = '';
        let sublabel = '';
        let extraClass = '';
        let style = `background:${cfg.color || 'rgba(255,255,255,0.03)'}; opacity:${(cfg.type === 'none' && !liveEditMode) ? 0 : 1};`;
        
        if (liveEditMode) style += `border-color: var(--danger); border-style: ${cfg.type === 'none' ? 'dashed' : 'solid'};`;

        if (cfg.type === 'preset') {
            const preset = (window.db.presets || []).find(p => p.id === cfg.targetId);
            label = preset ? preset.name : 'PRESET';
            const isActive = (window.latestAudioState.manual_active_presets || []).some(id => String(id).toLowerCase() === String(cfg.targetId).toLowerCase());
            content = `<div style="font-size:10px; font-weight:800; opacity:0.8;">PRESET</div>`;
            if (isActive) extraClass = 'active';
        } else if (cfg.type === 'slider') {
            const instY = (window.db.stage || []).find(s => s.id === cfg.targetId);
            const profY = instY ? (window.db.profiles || []).find(p => p.id === instY.profileId) : null;
            const chY = (profY && profY.channels) ? profY.channels[cfg.channelIdx] : null;
            const addrY = (instY && chY) ? (parseInt(instY.address) || 1) + (parseInt(instY.offset) || 0) + (parseInt(chY.addrOffset) || cfg.channelIdx) : null;
            const isOverriddenY = addrY !== null && window.latestOverrides && window.latestOverrides.has(addrY);
            const valY = addrY !== null ? (window.latestDmxUniverse[addrY] || (window.latestAudioState && window.latestAudioState.manual_overrides ? window.latestAudioState.manual_overrides[addrY] : 0) || 0) : 0;
            
            const minY = cfg.min !== undefined ? cfg.min : 0;
            const maxY = cfg.max !== undefined ? cfg.max : 255;
            const pctY = Math.max(0, Math.min(100, ((valY - minY) / (maxY - minY)) * 100));

            label = instY ? instY.id : (profY ? profY.name : '2 AXIS');
            sublabel = chY ? (chY.role || chY.name) : '';

            let xyLabelHtml = `<div style="display:flex; gap:4px; align-items:center; z-index:1; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
                                <span style="color:var(--accent); font-size:9px; font-weight:700;">Y:</span>
                                <span class="val-indicator-y" style="font-size:11px; font-weight:900; opacity:${isOverriddenY ? 1 : 0.6}">${isOverriddenY ? valY : 'AUTO'}</span>
                               </div>`;

            if (cfg.targetIdX) {
                const instX = (window.db.stage || []).find(s => s.id === cfg.targetIdX);
                const profX = instX ? (window.db.profiles || []).find(p => p.id === instX.profileId) : null;
                const chX = (profX && profX.channels) ? profX.channels[cfg.channelIdxX] : null;
                const addrX = (instX && chX) ? (parseInt(instX.address) || 1) + (parseInt(instX.offset) || 0) + (parseInt(chX.addrOffset) || cfg.channelIdxX) : null;
                const isOverriddenX = addrX !== null && window.latestOverrides && window.latestOverrides.has(addrX);
                const valX = addrX !== null ? (window.latestDmxUniverse[addrX] || (window.latestAudioState && window.latestAudioState.manual_overrides ? window.latestAudioState.manual_overrides[addrX] : 0) || 0) : 0;
                
                xyLabelHtml += `<div style="display:flex; gap:4px; align-items:center; z-index:1; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
                                    <span style="color:var(--accent-alt); font-size:9px; font-weight:700;">X:</span>
                                    <span class="val-indicator-x" style="font-size:11px; font-weight:900; opacity:${isOverriddenX ? 1 : 0.6}">${isOverriddenX ? valX : 'AUTO'}</span>
                                </div>`;
            }

            content = `<div class="fill-indicator" style="position:absolute; bottom:0; left:0; width:100%; height:${pctY}%; pointer-events:none; transition: height 0.05s;"></div>
                       ${xyLabelHtml}`;
            if (isOverriddenY) extraClass = 'active';
        } else if (cfg.type === 'dmx_slider') {
            const inst = (window.db.stage || []).find(s => s.id === cfg.targetId);
            const prof = inst ? (window.db.profiles || []).find(p => p.id === inst.profileId) : null;
            const ch = (prof && prof.channels) ? prof.channels[cfg.channelIdx] : null;
            const addr = (inst && ch) ? (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0) + (parseInt(ch.addrOffset) || cfg.channelIdx) : null;
            const isOverridden = addr !== null && window.latestOverrides && window.latestOverrides.has(addr);
            const val = addr !== null ? (window.latestDmxUniverse[addr] || (window.latestAudioState && window.latestAudioState.manual_overrides ? window.latestAudioState.manual_overrides[addr] : 0) || 0) : 0;
            
            const min = cfg.min !== undefined ? cfg.min : 0;
            const max = cfg.max !== undefined ? cfg.max : 255;
            const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

            label = inst ? inst.id : (prof ? prof.name : 'FADER');
            sublabel = ch ? (ch.role || ch.name) : '';

            content = `<div class="dmx-fader-track">
                            <div class="dmx-fader-cap" style="bottom:${pct}%;"></div>
                       </div>
                       <div class="val-indicator-dmx" style="font-size:10px; font-weight:900; color:var(--accent); position:absolute; top:25px; left:50%; transform:translateX(-50%); z-index:5;">${isOverridden ? val : 'AUTO'}</div>`;
            if (isOverridden) extraClass = 'active';
        } else if (cfg.type === 'knob') {
            const inst = (window.db.stage || []).find(s => s.id === cfg.targetId);
            const prof = inst ? (window.db.profiles || []).find(p => p.id === inst.profileId) : null;
            const ch = (prof && prof.channels) ? prof.channels[cfg.channelIdx] : null;
            const addr = (inst && ch) ? (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0) + (parseInt(ch.addrOffset) || cfg.channelIdx) : null;
            const isOverridden = addr !== null && window.latestOverrides && window.latestOverrides.has(addr);
            const val = addr !== null ? (window.latestDmxUniverse[addr] || (window.latestAudioState && window.latestAudioState.manual_overrides ? window.latestAudioState.manual_overrides[addr] : 0) || 0) : 0;
            
            const min = cfg.min !== undefined ? cfg.min : 0;
            const max = cfg.max !== undefined ? cfg.max : 255;
            const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
            const rotation = -135 + (pct * 2.7); // Map 0-100 to -135 to +135 deg

            label = inst ? inst.id : (prof ? prof.name : 'KNOB');
            sublabel = ch ? (ch.role || ch.name) : '';

            content = `<div class="knob-container">
                            <div class="knob-body" style="transform: rotate(${rotation}deg);">
                                <div class="knob-pointer"></div>
                            </div>
                       </div>
                       <div class="val-indicator-knob" style="font-size:10px; font-weight:900; color:var(--accent); position:absolute; top:25px; left:50%; transform:translateX(-50%); z-index:5;">${isOverridden ? val : 'AUTO'}</div>`;
            if (isOverridden) extraClass = 'active';
        } else if (cfg.type === 'live_feed') {
            const isFeedActive = document.getElementById('live-console-feed-container') && document.getElementById('live-console-feed-container').style.display === 'block';
            label = "LIVE FEED";
            content = `<div style="font-size:24px; z-index:1;">📷 ${isFeedActive ? 'ON' : 'OFF'}</div>`;
            if (isFeedActive) extraClass = 'active';
        } else if (cfg.type === 'blackout') {
            const isBlackout = window.latestAudioState && window.latestAudioState.blackout;
            label = "BLACKOUT";
            content = `<div style="font-size:24px; z-index:1;">🌑 ${isBlackout ? 'ACTIVE' : 'READY'}</div>`;
            if (isBlackout) extraClass = 'active';
        } else {
            if (liveEditMode) {
                label = "ADD BUTTON";
                content = `<div style="font-size:24px; opacity:0.3; z-index:1;">+</div>`;
            } else {
                label = "";
                content = "";
            }
        }

        html += `<div class="live-btn ${extraClass}" style="${style} ${draggedBtnIdx === i ? 'opacity:0.5; transform:scale(0.9); z-index:10;' : ''} ${dragTargetIdx === i ? 'box-shadow: 0 0 15px var(--accent);' : ''}; height:100px; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; position:relative; overflow:hidden; touch-action:none; gap:4px;" 
                     onpointerdown="handleLivePointerDown(event, ${i})"
                     onpointermove="handleLivePointerMove(event, ${i})"
                     onpointerup="handleLivePointerUp(event, ${i})"
                     onpointerleave="handleLivePointerUp(event, ${i})"
                     oncontextmenu="return false;">
            <div style="font-size:8px; opacity:0.6; position:absolute; top:5px; left:5px; z-index:2;">#${i + 1}</div>
            <div style="font-size:11px; font-weight:800; text-align:center; padding:0 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; z-index:1; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${label}</div>
            ${content}
            ${sublabel ? `<div style="font-size:8px; opacity:0.6; z-index:1; text-shadow: 0 1px 2px rgba(0,0,0,0.5); ${cfg.type === 'dmx_slider' ? 'position:absolute; bottom:5px;' : ''}">${sublabel}</div>` : ''}
        </div>`;
    }
    grid.innerHTML = html;
}

// --- PRESET INTERACTION STATE ---
let presetHoldActive = false;      // Is a preset currently held?
let presetHoldId = null;           // Which preset targetId is held?
let presetHoldMoved = false;       // Did the pointer move during hold?
let presetCycleInterval = null;    // Interval for movement-based cycling
let presetCycleState = false;      // Current on/off state during cycling
let presetLastMovePos = { x: 0, y: 0 };
let presetMoveSpeed = 0;           // Pixels/frame movement speed

function handleLivePointerDown(e, idx) {
    activePointerIdx = idx;
    pointerInitialClientY = e.clientY;
    pointerInitialClientX = e.clientX;
    pointerCurrentClientY = e.clientY;
    pointerCurrentClientX = e.clientX;
    dragPointerStart = { x: e.clientX, y: e.clientY };
    isLongPress = false;
    draggedBtnIdx = null;
    dragTargetIdx = null;
    isDraggingBtn = false;
    buttonHoldMoved = false;

    if (liveEditMode) {
        longPressTimer = setTimeout(() => {
            if (!isDraggingBtn) {
                isLongPress = true;
                handleLiveRemoveButton(idx);
            }
        }, 800);
        return;
    }

    const cfg = liveConfig[idx];
    if (!cfg || cfg.type === 'none') return;

    if (cfg.type === 'preset' || cfg.type === 'live_feed' || cfg.type === 'blackout') {
        e.target.closest('.live-btn')?.setPointerCapture(e.pointerId);
        buttonHoldActive = true;
        buttonHoldType = cfg.type;
        buttonHoldId = cfg.targetId;
        presetLastMovePos = { x: e.clientX, y: e.clientY };
        presetMoveSpeed = 0;

        // Start hold timer — after 1000ms without a pointerup, activate momentary mode
        longPressTimer = setTimeout(() => {
            if (buttonHoldActive && !buttonHoldMoved) {
                isLongPress = true;
                // Momentary hold: activate now, will deactivate on release
                if (buttonHoldType === 'preset') {
                    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                        window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: buttonHoldId, state: true, exclusive: true }));
                    }
                } else if (buttonHoldType === 'live_feed') {
                    toggleLiveConsoleFeed(true);
                } else if (buttonHoldType === 'blackout') {
                    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                        window.ws.send(JSON.stringify({ type: 'blackout', state: true }));
                    }
                }
                
                // Visual feedback for long press
                const btn = document.querySelectorAll('.live-btn')[idx];
                if (btn) btn.classList.add('active');
            }
        }, 1000);

        // Immediate visual feedback for the start of any interaction
        const btn = document.querySelectorAll('.live-btn')[idx];
        if (btn) {
            // For presets, we can pre-toggle the highlight if it was a quick tap,
            // but for now, just adding a pressed state or keeping it simple.
            // Actually, let's just let the state update or the long-press timer handle the "active" class.
            // But we can add a 'pressed' class for tactile feedback.
            btn.classList.add('pressed');
        }
    } else if (cfg.type === "slider" || cfg.type === "dmx_slider" || cfg.type === "knob") {
        e.target.closest(".live-btn")?.setPointerCapture(e.pointerId);
        buttonHoldActive = true;
        buttonHoldType = cfg.type;
        buttonHoldId = cfg.targetId;
        buttonHoldMoved = false;
        isLongPress = false;

        // Track whether this slider was already overridden BEFORE we touch it
        const inst = (window.db.stage || []).find(s => s.id === cfg.targetId);
        const prof = inst ? (window.db.profiles || []).find(p => p.id === inst.profileId) : null;
        const ch = (prof && prof.channels) ? prof.channels[cfg.channelIdx] : null;
        const addr = (inst && ch) ? (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0) + (parseInt(ch.addrOffset) || cfg.channelIdx) : null;
        window.wasSliderOverriddenAtStart = addr !== null && window.latestOverrides && window.latestOverrides.has(addr);

        // Send immediate override so slider responds on first touch
        handleLivePointerMove(e, idx);

        // After 1 second without release, mark as long press (momentary mode)
        longPressTimer = setTimeout(() => {
            if (buttonHoldActive && !buttonHoldMoved) {
                isLongPress = true;
                const btn = e.target.closest(".live-btn");
                if (btn) btn.classList.add("active");
            }
        }, 1000);
    }
}
window.renderLiveTabActual = renderLiveTab;

function handleLivePointerMove(e, idx) {
    if (activePointerIdx !== idx) return;

    pointerCurrentClientY = e.clientY;
    pointerCurrentClientX = e.clientX;

    if (liveEditMode) {
        isDraggingBtn = true;
        draggedBtnIdx = idx;
    } else if (buttonHoldActive) {
        buttonHoldMoved = true;
    }

    if (longPressTimer && !isLongPress) {
        const dist = Math.sqrt(Math.pow(e.clientX - dragPointerStart.x, 2) + Math.pow(e.clientY - dragPointerStart.y, 2));
        if (dist > 15) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
            if (liveEditMode) {
                isDraggingBtn = true;
                draggedBtnIdx = idx;
            } else if (buttonHoldActive) {
                // Movement detected during button hold — enter cycle mode (presets only)
                buttonHoldMoved = true;
            }
        }
    }

    // --- PRESET CYCLE MODE (hold + move) ---
    if (buttonHoldActive && buttonHoldMoved && !liveEditMode && buttonHoldType === 'preset') {
        const dx = e.clientX - presetLastMovePos.x;
        const dy = e.clientY - presetLastMovePos.y;
        const moveDist = Math.sqrt(dx * dx + dy * dy);
        presetLastMovePos = { x: e.clientX, y: e.clientY };

        // Smooth the speed (exponential moving average)
        presetMoveSpeed = presetMoveSpeed * 0.7 + moveDist * 0.3;

        // Map speed to cycle interval: faster movement = shorter interval
        // Speed range roughly 0-50px/event → interval 500ms-50ms
        const clampedSpeed = Math.min(50, Math.max(2, presetMoveSpeed));
        const cycleMs = Math.round(500 - (clampedSpeed / 50) * 450); // 500ms → 50ms

        // Start or update the cycle interval
        if (!presetCycleInterval) {
            // First cycle activation
            presetCycleState = true;
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: buttonHoldId, state: true }));
            }
            const btn = document.querySelectorAll('.live-btn')[idx];
            if (btn) btn.classList.add('active');
        }

        // Clear and reset interval at new speed
        if (presetCycleInterval) clearInterval(presetCycleInterval);
        presetCycleInterval = setInterval(() => {
            presetCycleState = !presetCycleState;
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: buttonHoldId, state: presetCycleState }));
            }
            const btn = document.querySelectorAll('.live-btn')[idx];
            if (btn) {
                if (presetCycleState) btn.classList.add('active');
                else btn.classList.remove('active');
            }
        }, cycleMs);

        // Visual: move the button with the finger like sliders do
        const btn = e.target.closest('.live-btn');
        if (btn) {
            const tdx = pointerCurrentClientX - pointerInitialClientX;
            const tdy = pointerCurrentClientY - pointerInitialClientY;
            btn.style.transform = `translate(${tdx}px, ${tdy}px)`;
            btn.style.zIndex = "1000";
        }

        return; // Don't process slider logic
    }

    if (isDraggingBtn) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const btnEl = target ? target.closest('.live-btn') : null;
        if (btnEl) {
            const allBtns = Array.from(document.querySelectorAll('.live-btn'));
            const tIdx = allBtns.indexOf(btnEl);
            if (tIdx !== -1 && tIdx !== dragTargetIdx) {
                dragTargetIdx = tIdx;
                renderLiveTab();
            }
        }
        return;
    }

    if (liveEditMode || isLongPress) return;
    const cfg = liveConfig[idx];
    if (!cfg || (cfg.type !== 'slider' && cfg.type !== 'dmx_slider' && cfg.type !== 'knob')) return;

    const screenH = window.innerHeight;
    const screenW = window.innerWidth;
    
    const minY = cfg.min !== undefined ? cfg.min : 0;
    const maxY = cfg.max !== undefined ? cfg.max : 255;
    const yRatio = pointerCurrentClientY / screenH;
    let targetValY = Math.round(maxY - (yRatio * (maxY - minY)));
    targetValY = Math.max(minY, Math.min(maxY, targetValY));

    const dmxPerPixelY = (maxY - minY) / screenH;
    const snapThresholdPxY = 5 / (dmxPerPixelY || 1);
    const distFromStartY = Math.abs(pointerCurrentClientY - pointerInitialClientY);
    const isHomeY = distFromStartY < Math.max(15, snapThresholdPxY);

    let targetValX = null;
    let isHomeX = false;
    if (cfg.targetIdX) {
        const minX = cfg.minX !== undefined ? cfg.minX : 0;
        const maxX = cfg.maxX !== undefined ? cfg.maxX : 255;
        const xRatio = pointerCurrentClientX / screenW;
        targetValX = Math.round(minX + (xRatio * (maxX - minX)));
        targetValX = Math.max(minX, Math.min(maxX, targetValX));

        const dmxPerPixelX = (maxX - minX) / screenW;
        const snapThresholdPxX = 5 / (dmxPerPixelX || 1);
        const distFromStartX = Math.abs(pointerCurrentClientX - pointerInitialClientX);
        isHomeX = distFromStartX < Math.max(15, snapThresholdPxX);
    }

    const btn = e.target.closest('.live-btn');
    if (btn && cfg.type !== 'dmx_slider' && cfg.type !== 'knob') {
        const dy = pointerCurrentClientY - pointerInitialClientY;
        const dx = cfg.targetIdX ? (pointerCurrentClientX - pointerInitialClientX) : 0;
        btn.style.transform = `translate(${dx}px, ${dy}px)`;
        btn.style.zIndex = "1000";
    } else if (btn) {
        btn.style.zIndex = "1000";
    }

    processOverride(cfg.targetId, cfg.channelIdx, targetValY, isHomeY, btn);
    if (cfg.targetIdX) {
        processOverride(cfg.targetIdX, cfg.channelIdxX, targetValX, isHomeX, btn, 'x');
    }
}

function processOverride(targetId, chIdx, val, isHome, btn, axis = 'y') {
    const inst = (window.db.stage || []).find(s => String(s.id).toLowerCase() === String(targetId).toLowerCase());
    if (!inst) return;
    const profile = (window.db.profiles || []).find(p => p.id === inst.profileId);
    if (!profile) return;
    const ch = profile.channels ? profile.channels[chIdx] : null;
    if (!ch) return;

    const addr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0) + (parseInt(ch.addrOffset) || chIdx);
    
    if (isHome) {
        if (window.latestOverrides.has(addr)) {
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'clear_channel_overrides', addresses: [addr] }));
            }
            window.latestOverrides.delete(addr);
            if (window.latestAudioState.manual_overrides) delete window.latestAudioState.manual_overrides[addr];
            window.latestDmxUniverse[addr] = 0;
            syncBtnVisuals(btn, axis, 'AUTO', 0, false);
        }
    } else {
        if (window.latestDmxUniverse[addr] !== val || !window.latestOverrides.has(addr)) {
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'laser_override', overrides: [{ address: addr, value: val }] }));
            }
            window.latestDmxUniverse[addr] = val;
            window.latestOverrides.add(addr);
            if (!window.latestAudioState.manual_overrides) window.latestAudioState.manual_overrides = {};
            window.latestAudioState.manual_overrides[addr] = val;
            syncBtnVisuals(btn, axis, val, val, true);
        }
    }
}


function syncBtnVisuals(btn, axis, label, val, active) {
    if (!btn) return;
    const valDisplay = btn.querySelector(`.val-indicator-${axis}`);
    if (valDisplay) {
        valDisplay.innerText = active ? val : 'AUTO';
        valDisplay.style.opacity = active ? 1 : 0.5;
    }
    
    // Also try general ones for dmx/knob
    if (axis === 'y') {
        const dmxVal = btn.querySelector('.val-indicator-dmx');
        if (dmxVal) {
            dmxVal.innerText = active ? val : 'AUTO';
        }
        const knobVal = btn.querySelector('.val-indicator-knob');
        if (knobVal) {
            knobVal.innerText = active ? val : 'AUTO';
        }
    }
    
    if (axis === 'y' || axis === 'dmx') {
        const fill = btn.querySelector('.fill-indicator');
        if (fill) fill.style.background = `rgba(255,255,255,${active ? '0.2' : '0.05'})`;
        
        const cap = btn.querySelector('.dmx-fader-cap');
        if (cap) {
            const cfg = liveConfig[activePointerIdx];
            if (cfg) {
                const min = cfg.min !== undefined ? cfg.min : 0;
                const max = cfg.max !== undefined ? cfg.max : 255;
                const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
                cap.style.bottom = pct + '%';
                
                const valIndicator = btn.querySelector('div[style*="color:var(--accent)"]');
                if (valIndicator) valIndicator.innerText = active ? val : 'AUTO';
            }
        }

        const knob = btn.querySelector('.knob-body');
        if (knob) {
            const cfg = liveConfig[activePointerIdx];
            if (cfg) {
                const min = cfg.min !== undefined ? cfg.min : 0;
                const max = cfg.max !== undefined ? cfg.max : 255;
                const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
                const rotation = -135 + (pct * 2.7);
                knob.style.transform = `rotate(${rotation}deg)`;
                
                const valIndicator = btn.querySelector('div[style*="color:var(--accent)"]');
                if (valIndicator) valIndicator.innerText = active ? val : 'AUTO';
            }
        }
    }
}

async function handleLivePointerUp(e, idx) {
    if (activePointerIdx !== idx) return;

    if (isDraggingBtn && draggedBtnIdx !== null && dragTargetIdx !== null) {
        while (liveConfig.length <= Math.max(draggedBtnIdx, dragTargetIdx)) {
            liveConfig.push({ type: 'none', color: '#333' });
        }
        const temp = liveConfig[draggedBtnIdx];
        liveConfig[draggedBtnIdx] = liveConfig[dragTargetIdx] || { type: 'none', color: '#333' };
        liveConfig[dragTargetIdx] = temp || { type: 'none', color: '#333' };
        await saveLiveConfig();
    }

    const wasButtonHold = buttonHoldActive;
    const wasButtonMoved = buttonHoldMoved;
    const wasLongPress = isLongPress;

    if (presetCycleInterval) {
        clearInterval(presetCycleInterval);
        presetCycleInterval = null;
    }

    if (wasButtonHold) {
        const cfg = liveConfig[idx];
        const dist = Math.sqrt(Math.pow(pointerCurrentClientX - pointerInitialClientX, 2) + Math.pow(pointerCurrentClientY - pointerInitialClientY, 2));

        if (wasButtonMoved && buttonHoldType === 'preset') {
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: buttonHoldId, state: false }));
            }
        } else if (wasLongPress) {
            // MOMENTARY MODE: held >1s, release clears everything
            if (buttonHoldType === 'preset') {
                if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                    window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: buttonHoldId, state: false }));
                }
            } else if (buttonHoldType === 'live_feed') {
                toggleLiveConsoleFeed(false);
            } else if (buttonHoldType === 'blackout') {
                if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                    window.ws.send(JSON.stringify({ type: 'blackout', state: false }));
                }
            } else if (['slider', 'dmx_slider', 'knob'].includes(buttonHoldType)) {
                // Momentary: clear override on release
                await clearSliderOverrides(cfg);
            }
        } else if (['slider', 'dmx_slider', 'knob'].includes(buttonHoldType)) {
            // SLIDER-SPECIFIC: not a long press
            if (dist < 15 && !wasButtonMoved) {
                // TAP on the handle: if already overridden, clear it back to AUTO
                if (window.wasSliderOverriddenAtStart) {
                    await clearSliderOverrides(cfg);
                }
                // If NOT overridden at start, the pointerdown already sent the override — it stays (sticky)
            }
            // If dist >= 15 or wasButtonMoved: quick drag — override stays (sticky), do nothing on release
        } else if (dist < 15) {
            // NON-SLIDER quick tap logic (presets, feed, blackout)
            if (buttonHoldType === 'preset') {
                if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                    const isActive = (window.latestAudioState.manual_active_presets || []).some(id => String(id).toLowerCase() === String(buttonHoldId).toLowerCase());
                    window.ws.send(JSON.stringify({ type: "toggle_preset", preset_id: buttonHoldId, state: !isActive, exclusive: true }));
                }
            } else if (buttonHoldType === 'live_feed') {
                toggleLiveConsoleFeed();
            } else if (buttonHoldType === 'blackout') {
                if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                    window.ws.send(JSON.stringify({ type: 'blackout' }));
                }
            }
        }

        const btn = document.querySelectorAll('.live-btn')[idx];
        if (btn) {
            btn.classList.remove('pressed');
            if (wasLongPress) btn.classList.remove('active');
        }

        buttonHoldActive = false;
        buttonHoldId = null;
        buttonHoldType = null;
        buttonHoldMoved = false;
        presetCycleState = false;
        presetMoveSpeed = 0;
    }

    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }

    if (liveEditMode && !wasLongPress && !isDraggingBtn && draggedBtnIdx === null) {
        openAssignment(idx);
    }

    isLongPress = false;
    isDraggingBtn = false;
    draggedBtnIdx = null;
    dragTargetIdx = null;

    const btn = e.target.closest('.live-btn');
    if (btn) {
        btn.style.transform = 'translate(0,0)';
        btn.style.zIndex = '';
    }

    activePointerIdx = null;
    renderLiveTab();
}


async function clearSliderOverrides(cfg) {
    const addrs = [];
    const instY = (window.db.stage || []).find(s => s.id === cfg.targetId);
    const profY = instY ? (window.db.profiles || []).find(p => p.id === instY.profileId) : null;
    if (instY && profY) {
        const ch = profY.channels[cfg.channelIdx];
        if (ch) addrs.push((parseInt(instY.address) || 1) + (parseInt(instY.offset) || 0) + (parseInt(ch.addrOffset) || cfg.channelIdx));
    }
    if (cfg.targetIdX) {
        const instX = (window.db.stage || []).find(s => s.id === cfg.targetIdX);
        const profX = instX ? (window.db.profiles || []).find(p => p.id === instX.profileId) : null;
        if (instX && profX) {
            const ch = profX.channels[cfg.channelIdxX];
            if (ch) addrs.push((parseInt(instX.address) || 1) + (parseInt(instX.offset) || 0) + (parseInt(ch.addrOffset) || cfg.channelIdxX));
        }
    }
    if (addrs.length > 0 && window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({ type: 'clear_channel_overrides', addresses: addrs }));
    }
}

async function handleLiveRemoveButton(idx) {
    const cfg = liveConfig[idx];
    if (cfg && cfg.type !== 'none') {
        if (confirm(`Remove button #${idx + 1}?`)) {
            liveConfig[idx] = { type: 'none', color: '#333' };
            await saveLiveConfig();
            renderLiveTab();
        }
    } else {
        openAssignment(idx);
    }
}

let liveConsoleFeedInterval = null;
async function toggleLiveConsoleFeed(forceState) {
    const container = document.getElementById('live-console-feed-container');
    const img = document.getElementById('live-console-feed-img');
    if (!container || !img) return;

    const isCurrentlyActive = container.style.display === 'block';
    const activate = (forceState !== undefined) ? forceState : !isCurrentlyActive;

    if (activate) {
        container.style.display = 'block';
        
        // Ensure camera is started
        try {
            await fetch(`${window.API_BASE_ROOT}/api/camera/start`);
            // Brief pause for the camera service to spin up
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) { 
            console.error("Failed to start camera:", e); 
        }

        if (!liveConsoleFeedInterval) {
            liveConsoleFeedInterval = setInterval(() => {
                img.src = `${window.API_BASE_ROOT}/capture?t=${Date.now()}`;
            }, 400);
        }
    } else {
        container.style.display = 'none';
        if (liveConsoleFeedInterval) {
            clearInterval(liveConsoleFeedInterval);
            liveConsoleFeedInterval = null;
        }
    }
}

function openAssignment(idx) {
    assigningBtnIdx = idx;
    const cfg = liveConfig[idx] || { type: 'none', color: '#333' };
    document.getElementById('assign-btn-idx').innerText = `#${idx + 1}`;
    
    const typeSel = document.getElementById('assign-type');
    typeSel.value = cfg.type || 'none';
    
    updateAssignmentOptions();
    
    if (cfg.type === 'preset') {
        document.getElementById('assign-preset-id').value = cfg.targetId || '';
    } else if (cfg.type === 'slider' || cfg.type === 'dmx_slider' || cfg.type === 'knob') {
        const profileId = cfg.targetId || document.getElementById('assign-profile-id').value;
        const profileIdX = cfg.targetIdX !== undefined ? cfg.targetIdX : document.getElementById('assign-profile-id-x').value;

        document.getElementById('assign-profile-id').value = profileId;
        updateAssignmentChannels('assign-channel-idx', profileId);
        document.getElementById('assign-channel-idx').value = cfg.channelIdx || 0;

        document.getElementById('assign-min').value = cfg.min !== undefined ? cfg.min : 0;
        document.getElementById('assign-max').value = cfg.max !== undefined ? cfg.max : 255;
        
        document.getElementById('assign-profile-id-x').value = profileIdX;
        updateAssignmentChannels('assign-channel-idx-x', profileIdX);
        document.getElementById('assign-channel-idx-x').value = cfg.channelIdxX || 0;

        document.getElementById('assign-min-x').value = cfg.minX !== undefined ? cfg.minX : 0;
        document.getElementById('assign-max-x').value = cfg.maxX !== undefined ? cfg.maxX : 255;
    }
    document.getElementById('live-assignment-modal').style.display = 'flex';
}

function updateAssignmentOptions() {
    const type = document.getElementById('assign-type').value;
    document.getElementById('assign-preset-wrap').style.display = type === 'preset' ? 'block' : 'none';
    document.getElementById('assign-slider-wrap').style.display = (type === 'slider' || type === 'dmx_slider' || type === 'knob') ? 'block' : 'none';

    const fixtureList = (window.db.stage || []).map(inst => {
        const prof = (window.db.profiles || []).find(p => p.id === inst.profileId);
        const profName = prof ? prof.name : (inst.profileName || 'Unknown');
        return `<option value="${inst.id}">${inst.id} (${profName})</option>`;
    }).join('');

    if (type === 'preset') {
        const sel = document.getElementById('assign-preset-id');
        sel.innerHTML = (window.db.presets || []).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    } else if (type === 'slider' || type === 'dmx_slider' || type === 'knob') {
        const selY = document.getElementById('assign-profile-id');
        selY.innerHTML = fixtureList;
        updateAssignmentChannels('assign-channel-idx', selY.value);

        const selX = document.getElementById('assign-profile-id-x');
        selX.innerHTML = '<option value="">-- None (Single Axis) --</option>' + fixtureList;
        updateAssignmentChannels('assign-channel-idx-x', selX.value);
        
        // Hide X axis for dmx_slider and knob
        const xWrap = document.getElementById('assign-x-wrap');
        if (xWrap) xWrap.style.display = (type === 'dmx_slider' || type === 'knob') ? 'none' : 'block';
    }
}

function updateAssignmentChannels(elementId, instanceId) {
    const inst = (window.db.stage || []).find(s => s.id === instanceId);
    const profile = inst ? (window.db.profiles || []).find(p => p.id === inst.profileId) : null;
    const sel = document.getElementById(elementId);
    if (!sel) return;

    if (profile && profile.channels) {
        sel.innerHTML = profile.channels.map((ch, idx) => `<option value="${idx}">${ch.role || ch.name}</option>`).join('');
    } else {
        sel.innerHTML = '<option value="">No channels</option>';
    }
}

let tempAssignColor = '#333';
function setAssignColor(c) {
    tempAssignColor = c;
    document.querySelectorAll('.color-swatch').forEach(s => {
        s.style.border = s.getAttribute('style').includes(c) ? '2px solid white' : '2px solid transparent';
    });
}

function closeAssignment() {
    document.getElementById('live-assignment-modal').style.display = 'none';
}

async function saveAssignment() {
    const type = document.getElementById('assign-type').value;
    const cfg = { type: type, color: tempAssignColor };
    
    if (type === 'preset') {
        cfg.targetId = document.getElementById('assign-preset-id').value;
    } else if (type === 'slider' || type === 'dmx_slider' || type === 'knob') {
        cfg.targetId = document.getElementById('assign-profile-id').value;
        cfg.channelIdx = parseInt(document.getElementById('assign-channel-idx').value);
        cfg.min = parseInt(document.getElementById('assign-min').value) || 0;
        cfg.max = parseInt(document.getElementById('assign-max').value) || 255;
        const profX = document.getElementById('assign-profile-id-x').value;
        if (profX) {
            cfg.targetIdX = profX;
            cfg.channelIdxX = parseInt(document.getElementById('assign-channel-idx-x').value);
            cfg.minX = parseInt(document.getElementById('assign-min-x').value) || 0;
            cfg.maxX = parseInt(document.getElementById('assign-max-x').value) || 255;
        }
    }
    liveConfig[assigningBtnIdx] = cfg;
    await saveLiveConfig();
    closeAssignment();
    renderLiveTab();
}

// --- AUDIO TIMELINE VISUALIZER ---
window.selectedAudio = window.selectedAudio || new Set(['b', 'h', 'f', 'vl', 'bp', 'mp', 'hp']);
window.selectedAddrs = window.selectedAddrs || new Set();
window.timelineZoom = window.timelineZoom || 1.0;

window.getTrackedDmxAddresses = function() {
    const list = [];
    const stage = (window.db && window.db.stage) || [];
    const profiles = (window.db && window.db.profiles) || [];

    stage.forEach(inst => {
        const baseAddr = (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0);
        const profile = profiles.find(p => p.id === inst.profileId);
        if (profile && profile.channels) {
            profile.channels.forEach((ch, idx) => {
                const offset = parseInt(ch.addrOffset !== undefined ? ch.addrOffset : idx);
                const addr = baseAddr + offset;
                const roleName = ch.role || ch.name || `CH${offset}`;
                list.push({
                    addr: addr,
                    role: `${inst.id}: ${roleName}`,
                    fixtureId: inst.id,
                    roleName: roleName
                });
            });
        }
    });

    // Sort by address
    list.sort((a, b) => a.addr - b.addr);
    return list;
};

window.updateChannelGrid = function() {
    const container = document.getElementById('channel-grid');
    if (!container) return;

    const list = window.getTrackedDmxAddresses();
    const activeCountEl = document.getElementById('grid-selection-count');
    if (activeCountEl) {
        activeCountEl.innerText = `${window.selectedAddrs.size} Selected`;
    }

    container.innerHTML = list.map(item => {
        const isActive = window.selectedAddrs.has(item.addr);
        const color = `hsla(${(item.addr * 45) % 360}, 70%, 70%, 1)`;
        const val = window.latestDmxUniverse ? window.latestDmxUniverse[item.addr] || 0 : 0;
        
        return `
            <div class="channel-chip ${isActive ? 'active' : ''}" 
                 onclick="window.toggleChannel(${item.addr})"
                 style="border-left: 4px solid ${color};"
                 title="${item.role}">
                <span class="chip-label">${item.addr}:${item.role}</span>
                <span class="chip-val" id="val-${item.addr}">${val}</span>
            </div>
        `;
    }).join('');
};

window.toggleAudio = function(key) {
    if (window.selectedAudio.has(key)) {
        window.selectedAudio.delete(key);
    } else {
        window.selectedAudio.add(key);
    }
    const el = document.getElementById('leg-' + key);
    if (el) el.classList.toggle('off', !window.selectedAudio.has(key));
};

window.adjustZoom = function(amount) {
    const zoomLevels = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0];
    let curIdx = zoomLevels.indexOf(window.timelineZoom);
    if (curIdx === -1) {
        let minDiff = Infinity;
        curIdx = 1;
        for (let i = 0; i < zoomLevels.length; i++) {
            let diff = Math.abs(zoomLevels[i] - window.timelineZoom);
            if (diff < minDiff) { minDiff = diff; curIdx = i; }
        }
    }
    let nextIdx = Math.max(0, Math.min(zoomLevels.length - 1, curIdx + amount));
    window.timelineZoom = zoomLevels[nextIdx];
    
    const canvas = document.getElementById('audio-timeline-canvas');
    if (canvas) {
        canvas.style.width = (window.timelineZoom * 100) + '%';
    }
    const valEl = document.getElementById('zoom-val');
    if (valEl) {
        valEl.innerText = window.timelineZoom + 'x';
    }
};

window.resetZoom = function() {
    window.timelineZoom = 1.0;
    const canvas = document.getElementById('audio-timeline-canvas');
    if (canvas) {
        canvas.style.width = '100%';
    }
    const valEl = document.getElementById('zoom-val');
    if (valEl) {
        valEl.innerText = '1x';
    }
};

window.toggleChannel = function(addr) {
    if (window.selectedAddrs.has(addr)) {
        window.selectedAddrs.delete(addr);
    } else {
        window.selectedAddrs.add(addr);
    }
    window.updateChannelGrid();
};

let audioTimelineBuffer = [];
const TIMELINE_MAX_FRAMES = 300; // ~10 seconds of history at 30fps

// 1. Constantly record the incoming audio state into a rolling buffer
setInterval(() => {
    if (window.latestAudioState) {
        audioTimelineBuffer.push({
            bass: window.latestAudioState.bass || 0,
            mid: window.latestAudioState.mid || 0,
            high: window.latestAudioState.high || 0,
            flux: window.latestAudioState.flux || 0,
            vol: window.latestAudioState.vol || 0,
            // HPSS bands
            bass_p: window.latestAudioState.bass_p || 0,
            mid_p: window.latestAudioState.mid_p || 0,
            high_p: window.latestAudioState.high_p || 0,
            bass_h: window.latestAudioState.bass_h || 0,
            mid_h: window.latestAudioState.mid_h || 0,
            high_h: window.latestAudioState.high_h || 0,
            // active presets
            presets: [...(window.activePresets || [])],
            // DMX state
            v: Array.from(window.latestDmxUniverse || []),
            // vibe and transient
            vibe: window.latestAudioState.vibe || 'mid',
            transient: window.latestAudioState.transient || 'steady'
        });
        // Remove oldest frame when we exceed 10 seconds
        if (audioTimelineBuffer.length > TIMELINE_MAX_FRAMES) {
            audioTimelineBuffer.shift();
        }
    }
}, 33); // ~30 fps update

// 2. The Modal UI & Interaction
function openAudioTimelineModal() {
    // Create the modal container if it doesn't exist
    let modal = document.getElementById('audio-timeline-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'audio-timeline-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            z-index: 9999; display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1); pointer-events: none;
        `;
        modal.innerHTML = `
            <style>
                #audio-timeline-modal .timeline-wrapper { position: relative; width: 100%; height: 260px; background: #000; border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; overflow-x: auto; overflow-y: hidden; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5); }
                #audio-timeline-modal canvas { display: block; height: 100%; cursor: crosshair; }
                
                #audio-timeline-modal .legend { display: flex; flex-direction: column; gap: 12px; font-size: 11px; font-weight: bold; justify-content: center; background: rgba(26, 26, 36, 0.85); backdrop-filter: blur(10px); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); margin-top: 15px; }
                #audio-timeline-modal .legend span { cursor: pointer; transition: all 0.2s ease; }
                #audio-timeline-modal .legend span:hover { opacity: 0.8; }
                #audio-timeline-modal .legend span.off { opacity: 0.25; text-decoration: line-through; }

                #audio-timeline-modal .channel-grid-wrapper { display: flex; flex-direction: column; gap: 10px; margin-top: 15px; }
                #audio-timeline-modal .grid-header { font-size: 12px; font-weight: bold; color: #888; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
                #audio-timeline-modal .channel-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; max-height: 120px; overflow-y: auto; padding-right: 5px; }
                
                #audio-timeline-modal .channel-chip { 
                    background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); 
                    padding: 4px 10px; border-radius: 6px; font-size: 10px; cursor: pointer;
                    transition: all 0.2s; white-space: nowrap; overflow: hidden;
                    min-height: 28px; display: flex; align-items: center; justify-content: space-between;
                }
                #audio-timeline-modal .channel-chip:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.15); }
                #audio-timeline-modal .channel-chip.active { background: rgba(0, 242, 255, 0.1); border-color: var(--accent); box-shadow: 0 0 10px rgba(0, 242, 255, 0.1); }
                
                #audio-timeline-modal .chip-label { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; padding-right: 5px; color: #fff; text-align: left; }
                #audio-timeline-modal .chip-val { 
                    background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 4px; 
                    font-family: monospace; font-weight: bold; min-width: 20px; text-align: center; color: #fff;
                }
                
                #audio-timeline-modal .step-btn { background: rgba(255,255,255,0.05); color: #fff; border: 1px solid rgba(255,255,255,0.1); width: 30px; padding: 2px 0; border-radius: 4px; cursor: pointer; font-weight: bold; }
                #audio-timeline-modal .step-btn:hover { background: rgba(255,255,255,0.15); }
            </style>
            <div style="background: #111114; border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; width: 95%; max-width: 1100px; padding: 30px; position: relative; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 100px rgba(0, 242, 255, 0.05);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 20px;">
                    <div>
                        <h2 style="margin: 0; color: #fff; font-weight: 800; font-size: 1.8rem; letter-spacing: -0.5px; display:flex; align-items:center; gap:12px;">
                            <span style="color:var(--accent); text-shadow: 0 0 20px rgba(0,242,255,0.4);">📈</span> Audio & DMX Timeline
                        </h2>
                        <p style="color: #666; font-size: 13px; margin: 4px 0 0 35px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Real-time 10-second history of audio reactivity.</p>
                    </div>
                    <button onclick="closeAudioTimelineModal()" style="background: rgba(255,255,255,0.05); border: none; color: #fff; font-size: 20px; width:40px; height:40px; border-radius:50%; cursor: pointer; display:flex; align-items:center; justify-content:center; transition: all 0.2s;">&times;</button>
                </div>

                <div class="timeline-wrapper">
                    <canvas id="audio-timeline-canvas" style="width: ${window.timelineZoom * 100}%; height: 100%; cursor: crosshair; display: block;"></canvas>
                    <div id="audio-timeline-inspect" style="position: absolute; top: 0; left: 0; height: 100%; width: 2px; background: linear-gradient(to bottom, transparent, var(--accent), transparent); display: none; pointer-events: none; box-shadow: 0 0 15px var(--accent);">
                        <div id="audio-timeline-tooltip" style="position: absolute; top: 30px; left: 15px; background: rgba(10,10,12,0.95); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); padding: 12px 18px; border-radius: 12px; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: bold; white-space: nowrap; color: #fff; box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 10;"></div>
                    </div>
                </div>

                <div class="legend">
                    <!-- Row 1: Standard Bands & Zoom Controls -->
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px; width: 100%;">
                        <div style="display:flex; gap:15px; flex-wrap:wrap; align-items:center;">
                            <span style="color:#888; font-size:9px; text-transform:uppercase; letter-spacing:1px; cursor:default; pointer-events:none; margin-right:5px;">Standard:</span>
                            <span id="leg-b" class="${window.selectedAudio.has('b') ? '' : 'off'}" style="color:#ff4757;" onclick="window.toggleAudio('b')">— Audio Bass</span>
                            <span id="leg-f" class="${window.selectedAudio.has('f') ? '' : 'off'}" style="color:#f1c40f;" onclick="window.toggleAudio('f')">— Spectral Flux</span>
                            <span id="leg-h" class="${window.selectedAudio.has('h') ? '' : 'off'}" style="color:#1e90ff;" onclick="window.toggleAudio('h')">— Audio High</span>
                            <span id="leg-vl" class="${window.selectedAudio.has('vl') ? '' : 'off'}" style="color:#fff;" onclick="window.toggleAudio('vl')">— Master Vol</span>
                        </div>
                        
                        <div style="display:flex; gap:8px; align-items:center; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 15px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 15px; color:#fff;">
                            <span style="opacity:0.5; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;">Timeline Zoom</span>
                            <button class="step-btn" onclick="window.adjustZoom(-1)">−</button>
                            <span id="zoom-val" style="width: 30px; text-align:center;">${window.timelineZoom}x</span>
                            <button class="step-btn" onclick="window.adjustZoom(1)">+</button>
                            <button class="step-btn" style="width: 50px;" onclick="window.resetZoom()">Reset</button>
                        </div>
                        
                        <div style="display:flex; gap:15px; opacity:0.6; font-size:11px; color:#fff;">
                            <span style="color:#fff; text-shadow: 0 0 5px #fff; cursor: default;">▬▬ DMX Tracked</span>
                            <span style="color:#fff; cursor: default;">| Beat Flash</span>
                        </div>
                    </div>
                    
                    <!-- Row 2: HPSS Percussive & Harmonic Bands -->
                    <div style="display:flex; align-items:center; flex-wrap:wrap; gap:20px; width: 100%; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px;">
                        <div style="display:flex; gap:15px; flex-wrap:wrap; align-items:center;">
                            <span style="color:#888; font-size:9px; text-transform:uppercase; letter-spacing:1px; cursor:default; pointer-events:none; margin-right:5px;">Percussive (HPSS):</span>
                            <span id="leg-bp" class="${window.selectedAudio.has('bp') ? '' : 'off'}" style="color:#ff3838;" onclick="window.toggleAudio('bp')">— Bass Perc</span>
                            <span id="leg-mp" class="${window.selectedAudio.has('mp') ? '' : 'off'}" style="color:#ff9f43;" onclick="window.toggleAudio('mp')">— Mid Perc</span>
                            <span id="leg-hp" class="${window.selectedAudio.has('hp') ? '' : 'off'}" style="color:#2ed573;" onclick="window.toggleAudio('hp')">— High Perc</span>
                        </div>
                        <div style="display:flex; gap:15px; flex-wrap:wrap; align-items:center; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 15px;">
                            <span style="color:#888; font-size:9px; text-transform:uppercase; letter-spacing:1px; cursor:default; pointer-events:none; margin-right:5px;">Harmonic (HPSS):</span>
                            <span id="leg-bh" class="${window.selectedAudio.has('bh') ? '' : 'off'}" style="color:#a55eea;" onclick="window.toggleAudio('bh')">— Bass Harm</span>
                            <span id="leg-mh" class="${window.selectedAudio.has('mh') ? '' : 'off'}" style="color:#45aaf2;" onclick="window.toggleAudio('mh')">— Mid Harm</span>
                            <span id="leg-hh" class="${window.selectedAudio.has('hh') ? '' : 'off'}" style="color:#fd9644;" onclick="window.toggleAudio('hh')">— High Harm</span>
                        </div>
                    </div>
                </div>

                <div class="channel-grid-wrapper">
                    <div class="grid-header">
                        <span>DMX CHANNELS</span>
                        <span id="grid-selection-count" style="font-size: 11px; opacity: 0.6;">0 Selected</span>
                    </div>
                    <div id="channel-grid" class="channel-grid">
                        <!-- Populated via JS -->
                    </div>
                </div>

                <div id="timeline-presets-container" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; padding: 0 10px;">
                        <h4 style="margin: 0; color: #fff; font-size: 10px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.5;">Interactive Preset Bubbles</h4>
                        <span style="font-size:9px; color:var(--accent); font-weight:800; opacity:0.6; letter-spacing:0.5px;">CLICK TO TRIGGER (EXCLUSIVE)</span>
                    </div>
                    <div id="timeline-preset-bubbles" style="display: flex; flex-wrap: wrap; gap: 8px; max-height: 100px; overflow-y: auto; padding: 0 10px;">
                        <!-- Dynamically populated -->
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Interaction for tooltip
        initTimelineInspector('audio-timeline-canvas', 'audio-timeline-inspect', 'audio-timeline-tooltip');

        const canvas = document.getElementById('audio-timeline-canvas');
        const inspect = document.getElementById('audio-timeline-inspect');
        canvas.addEventListener('mouseleave', () => inspect.style.display = 'none');

        // Modal close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeAudioTimelineModal();
        });
    }

    modal.style.opacity = '1';
    modal.style.pointerEvents = 'auto';
    window.updateChannelGrid();
    startAudioTimelineLoop();
}

function closeAudioTimelineModal() {
    const modal = document.getElementById('audio-timeline-modal');
    if (modal) {
        modal.style.opacity = '0';
        modal.style.pointerEvents = 'none';
        stopAudioTimelineLoop();
    }
}

function initTimelineInspector(canvasId, inspectId, tooltipId) {
    const canvas = document.getElementById(canvasId);
    const inspect = document.getElementById(inspectId);
    const tooltip = document.getElementById(tooltipId);
    if (!canvas || !inspect || !tooltip) return;

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const frameIdx = Math.floor((x / rect.width) * (audioTimelineBuffer.length || 1));
        const data = audioTimelineBuffer[frameIdx];

        if (data) {
            inspect.style.display = 'block';
            inspect.style.left = x + 'px';
            
            let html = `
                <div style="margin-bottom:6px; color:#aaa; font-size:10px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:4px; display:flex; justify-content:space-between;">
                    <span>T-MINUS ${((audioTimelineBuffer.length - 1 - frameIdx) / 30).toFixed(1)}s</span>
                    <span style="color:var(--accent)">${((data.vol || 0) * 100).toFixed(0)}% VOL</span>
                </div>
                <div style="display:grid; grid-template-columns: auto auto auto; gap: 6px 12px; font-size: 11px;">
            `;
            // Standard values
            html += `
                <span style="color:#ff4757">BASS:</span> <span>${(data.bass || 0).toFixed(2)}</span> <span></span>
                <span style="color:#1e90ff">HIGH:</span> <span>${(data.high || 0).toFixed(2)}</span> <span></span>
                <span style="color:#f1c40f">FLUX:</span> <span>${(data.flux || 0).toFixed(2)}</span> <span></span>
            `;
            // HPSS Percussive
            if (data.bass_p !== undefined) {
                html += `
                    <span style="color:#ff3838">B_PC:</span> <span>${(data.bass_p || 0).toFixed(2)}</span> <span></span>
                    <span style="color:#ff9f43">M_PC:</span> <span>${(data.mid_p || 0).toFixed(2)}</span> <span></span>
                    <span style="color:#2ed573">H_PC:</span> <span>${(data.high_p || 0).toFixed(2)}</span> <span></span>
                `;
            }
            // Tracked DMX Channels
            if (window.selectedAddrs.size > 0) {
                html += `
                    <div style="grid-column: span 3; border-top: 1px solid rgba(255,255,255,0.05); margin-top: 4px; padding-top: 4px; font-weight:bold; color:#888;">DMX CHANNELS</div>
                `;
                window.selectedAddrs.forEach(addr => {
                    const color = `hsla(${(addr * 45) % 360}, 70%, 70%, 1)`;
                    const val = data.v ? data.v[addr] || 0 : 0;
                    html += `
                        <span style="color:${color}">CH ${addr}:</span> <span>${val}</span> <span></span>
                    `;
                });
            }
            html += `</div>`;
            tooltip.innerHTML = html;

            if (x > rect.width * 0.7) {
                tooltip.style.left = 'auto';
                tooltip.style.right = '15px';
            } else {
                tooltip.style.left = '15px';
                tooltip.style.right = 'auto';
            }
        }
    });
    canvas.addEventListener('mouseleave', () => inspect.style.display = 'none');
}

function startConsoleTimelineLoop() {
    const canvas = document.getElementById('console-timeline-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Initialize inspector for console version
    initTimelineInspector('console-timeline-canvas', 'audio-timeline-inspect', 'audio-timeline-tooltip');

    function tick() {
        if (!document.getElementById('console-timeline-canvas')) return;
        drawAudioTimeline(canvas, ctx);
        requestAnimationFrame(tick);
    }
    tick();
}

let timelineLoopId = null;
function startAudioTimelineLoop() {
    if (timelineLoopId) return;
    const canvas = document.getElementById('audio-timeline-canvas');
    const ctx = canvas.getContext('2d');
    
    function tick() {
        drawAudioTimeline(canvas, ctx);
        timelineLoopId = requestAnimationFrame(tick);
    }
    tick();
}

function stopAudioTimelineLoop() {
    if (timelineLoopId) cancelAnimationFrame(timelineLoopId);
    timelineLoopId = null;
}

function updateTimelinePresetBubbles() {
    const container = document.getElementById('timeline-preset-bubbles');
    if (!container) return;

    const presets = (window.db && window.db.presets) || [];
    const activeIds = (window.activePresets || []).map(id => String(id));
    
    // Simple state-aware rendering to avoid flickering
    let newHtml = presets.map(p => {
        const isActive = activeIds.includes(String(p.id));
        return `<div class="timeline-preset-bubble ${isActive ? 'active' : ''}" 
                      onclick="window.togglePreset('${p.id}')"
                      style="padding: 6px 14px; background: ${isActive ? 'var(--accent)' : 'rgba(255,255,255,0.05)'}; 
                             color: ${isActive ? '#000' : '#fff'}; border-radius: 20px; font-size: 11px; 
                             font-weight: 800; cursor: pointer; transition: all 0.2s; white-space: nowrap;
                             border: 1px solid ${isActive ? 'var(--accent)' : 'rgba(255,255,255,0.1)'};
                             box-shadow: ${isActive ? '0 0 15px rgba(0,242,255,0.3)' : 'none'};
                             text-transform: uppercase; letter-spacing: 0.5px;">
                    ${p.name}
                </div>`;
    }).join('');

    if (container.innerHTML !== newHtml) {
        container.innerHTML = newHtml;
    }
}

function drawPerformanceRow(ctx, w, h) {
    const rowHeight = 24;
    if (audioTimelineBuffer.length < 2) return rowHeight;

    const segments = [];
    let activeSeg = { vibe: audioTimelineBuffer[0].vibe, transient: audioTimelineBuffer[0].transient, start: 0 };

    for (let i = 1; i < audioTimelineBuffer.length; i++) {
        const frame = audioTimelineBuffer[i];
        if (frame.vibe !== activeSeg.vibe || frame.transient !== activeSeg.transient) {
            segments.push({ ...activeSeg, end: i });
            activeSeg = { vibe: frame.vibe, transient: frame.transient, start: i };
        }
    }
    segments.push({ ...activeSeg, end: audioTimelineBuffer.length });

    segments.forEach(seg => {
        const x1 = (seg.start / TIMELINE_MAX_FRAMES) * w;
        const x2 = (seg.end / TIMELINE_MAX_FRAMES) * w;
        const width = x2 - x1;

        // Vibe Background
        if (seg.vibe === 'high') ctx.fillStyle = 'rgba(255, 50, 50, 0.3)';
        else if (seg.vibe === 'chill') ctx.fillStyle = 'rgba(50, 150, 255, 0.3)';
        else ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';

        ctx.fillRect(x1, 0, width, rowHeight);

        // Transient Highlight
        if (seg.transient === 'dropping') {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.strokeRect(x1 + 1, 1, width - 2, rowHeight - 2);
        } else if (seg.transient === 'building') {
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x1 + 1, 1, width - 2, rowHeight - 2);
        }

        // Label
        if (width > 40) {
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = '900 8px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            let label = seg.vibe.toUpperCase();
            if (seg.transient && seg.transient !== 'steady') label += ` [${seg.transient.toUpperCase()}]`;
            ctx.fillText(label, x1 + width / 2, rowHeight / 2);
        }
    });

    // Divider line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, rowHeight);
    ctx.lineTo(w, rowHeight);
    ctx.stroke();

    return rowHeight;
}

function drawAudioTimeline(canvas, ctx) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== canvas.clientWidth * dpr) {
        canvas.width = canvas.clientWidth * dpr;
        canvas.height = canvas.clientHeight * dpr;
        ctx.scale(dpr, dpr);
    }

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const perfHeight = drawPerformanceRow(ctx, w, h);
    const graphTop = perfHeight;

    updateTimelinePresetBubbles();

    const presetHeight = 12;
    const presetPadding = 3;
    const activePresetsAtT = new Map();
    const intervals = {};

    audioTimelineBuffer.forEach((f, idx) => {
        const names = new Set(f.presets || []);
        Object.keys(intervals).forEach(name => {
            if (!names.has(name) && activePresetsAtT.has(name)) {
                intervals[name].push({ s: activePresetsAtT.get(name), e: idx });
                activePresetsAtT.delete(name);
            }
        });
        names.forEach(name => {
            if (!intervals[name]) intervals[name] = [];
            if (!activePresetsAtT.has(name)) activePresetsAtT.set(name, idx);
        });
    });
    activePresetsAtT.forEach((s, name) => {
        intervals[name].push({ s, e: audioTimelineBuffer.length });
    });

    const graphBottom = h - (Object.keys(intervals).length * (presetHeight + presetPadding)) - 10;
    const graphH = Math.max(50, graphBottom - graphTop);

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, graphTop + (graphH / 4) * i);
        ctx.lineTo(w, graphTop + (graphH / 4) * i);
        ctx.stroke();
    }
    for (let i = 1; i < 10; i++) {
        ctx.beginPath();
        ctx.moveTo((w / 10) * i, 0);
        ctx.lineTo((w / 10) * i, h);
        ctx.stroke();
    }

    if (audioTimelineBuffer.length < 2) return;

    let row = 0;
    const sortedNames = Object.keys(intervals).sort();
    sortedNames.forEach(name => {
        const y = h - (row + 1) * (presetHeight + presetPadding);
        ctx.fillStyle = 'rgba(0, 255, 204, 0.15)';
        ctx.strokeStyle = 'rgba(0, 255, 204, 0.8)';
        ctx.lineWidth = 1;

        intervals[name].forEach(inv => {
            const x1 = (inv.s / TIMELINE_MAX_FRAMES) * w;
            const x2 = (inv.e / TIMELINE_MAX_FRAMES) * w;
            const width = Math.max(2, x2 - x1);

            ctx.fillRect(x1, y, width, presetHeight);
            ctx.strokeRect(x1, y, width, presetHeight);

            if (width > 40) {
                ctx.fillStyle = '#fff';
                ctx.font = '10px Roboto, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(name.toUpperCase(), x1 + width / 2, y + presetHeight / 2, width - 10);
            }
        });
        row++;
    });

    const drawLine = (key, color, width, alpha = 1, fill = false) => {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.beginPath();
        
        const points = [];
        let started = false;
        for (let i = 0; i < audioTimelineBuffer.length; i++) {
            const x = (i / TIMELINE_MAX_FRAMES) * w;
            const val = Math.max(0, Math.min(1.0, audioTimelineBuffer[i][key] || 0));
            const y = graphTop + (graphH - (val * graphH * 0.85) - (graphH * 0.05));
            points.push({x, y});
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        
        if (fill && points.length > 0) {
            ctx.lineTo(points[points.length - 1].x, graphTop + graphH);
            ctx.lineTo(points[0].x, graphTop + graphH);
            ctx.closePath();
            ctx.globalAlpha = alpha * 0.08;
            ctx.fillStyle = color;
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    };

    if (window.selectedAudio.has('f')) drawLine('flux', 'rgba(255,255,255,0.5)', 1, 0.4);
    if (window.selectedAudio.has('h')) drawLine('high', '#ffaa00', 2, 1, true);
    if (window.selectedAudio.has('mid')) drawLine('mid', '#00f2ff', 2, 1, true);
    if (window.selectedAudio.has('b')) drawLine('bass', '#ff3366', 3, 1, true);
    if (window.selectedAudio.has('vl')) drawLine('vol', 'rgba(255,255,255,0.7)', 2, 1, true);

    if (window.selectedAudio.has('bp')) drawLine('bass_p', 'rgba(255, 56, 56, 0.6)', 1.5, 0.8);
    if (window.selectedAudio.has('mp')) drawLine('mid_p', 'rgba(255, 159, 67, 0.6)', 1.5, 0.8);
    if (window.selectedAudio.has('hp')) drawLine('high_p', 'rgba(46, 213, 115, 0.6)', 1.5, 0.8);
    if (window.selectedAudio.has('bh')) drawLine('bass_h', 'rgba(165, 94, 234, 0.6)', 1.5, 0.8);
    if (window.selectedAudio.has('mh')) drawLine('mid_h', 'rgba(69, 170, 242, 0.6)', 1.5, 0.8);
    if (window.selectedAudio.has('hh')) drawLine('high_h', 'rgba(253, 150, 68, 0.6)', 1.5, 0.8);

    window.selectedAddrs.forEach(addr => {
        const color = `hsla(${(addr * 45) % 360}, 70%, 70%, 1)`;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < audioTimelineBuffer.length; i++) {
            const x = (i / TIMELINE_MAX_FRAMES) * w;
            const val = (audioTimelineBuffer[i].v && audioTimelineBuffer[i].v[addr] || 0) / 255.0;
            const y = graphTop + (graphH - (val * graphH * 0.85) - (graphH * 0.05));
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    });

    if (window.latestDmxUniverse) {
        const list = window.getTrackedDmxAddresses();
        list.forEach(item => {
            const valEl = document.getElementById(`val-${item.addr}`);
            if (valEl) {
                const val = window.latestDmxUniverse[item.addr] || 0;
                valEl.innerText = val;
            }
        });
    }
}
function updateLiveConsoleHighlights() {
    if (!window.latestAudioState) return;
    const manualActive = window.latestAudioState.manual_active_presets || [];
    const blackoutActive = window.latestAudioState.blackout || false;

    const btns = document.querySelectorAll('.live-btn');
    liveConfig.forEach((cfg, idx) => {
        const btn = btns[idx];
        if (!btn) return;

        if (cfg.type === 'preset') {
            if (manualActive.includes(cfg.targetId)) {
                btn.classList.add('active');
            } else {
                // Only remove if not currently being held for a long press
                if (!buttonHoldActive || buttonHoldId !== cfg.targetId) {
                    btn.classList.remove('active');
                }
            }
        } else if (cfg.type === 'blackout') {
            if (blackoutActive) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });
}
window.updateLiveConsoleHighlights = updateLiveConsoleHighlights;

/**
 * High-frequency UI update for Live Console buttons.
 * Updates visual indicators (fill bars, fader caps, labels) from window.latestDmxUniverse.
 */
window.updateLiveConsoleVisuals = function() {
    const grid = document.getElementById('live-console-grid');
    if (!grid) return;
    
    const btns = grid.querySelectorAll('.live-btn');
    btns.forEach((btn, i) => {
        const cfg = liveConfig[i];
        if (!cfg || cfg.type === 'none') return;

        // 1. Resolve Address & Current Value
        let addr = null;
        let addrX = null;
        
        if (cfg.type === 'slider' || cfg.type === 'dmx_slider' || cfg.type === 'knob') {
            const inst = (window.db.stage || []).find(s => s.id === cfg.targetId);
            const prof = inst ? (window.db.profiles || []).find(p => p.id === inst.profileId) : null;
            const ch = (prof && prof.channels) ? prof.channels[cfg.channelIdx] : null;
            addr = (inst && ch) ? (parseInt(inst.address) || 1) + (parseInt(inst.offset) || 0) + (parseInt(ch.addrOffset) || cfg.channelIdx) : null;
            
            if (cfg.type === 'slider' && cfg.targetIdX) {
                const instX = (window.db.stage || []).find(s => s.id === cfg.targetIdX);
                const profX = instX ? (window.db.profiles || []).find(p => p.id === instX.profileId) : null;
                const chX = (profX && profX.channels) ? profX.channels[cfg.channelIdxX] : null;
                addrX = (instX && ch) ? (parseInt(instX.address) || 1) + (parseInt(instX.offset) || 0) + (parseInt(chX.addrOffset) || cfg.channelIdxX) : null;
            }
        }

        if (addr === null && cfg.type !== 'preset' && cfg.type !== 'live_feed' && cfg.type !== 'blackout') return;

        const val = addr !== null ? window.latestDmxUniverse[addr] : 0;
        const isOverridden = addr !== null && window.latestOverrides && window.latestOverrides.has(addr);
        
        // 2. Update Visuals based on Type
        if (cfg.type === 'slider') {
            const fill = btn.querySelector('.fill-indicator');
            const labelY = btn.querySelector('.val-indicator-y');
            if (fill) {
                const min = cfg.min !== undefined ? cfg.min : 0;
                const max = cfg.max !== undefined ? cfg.max : 255;
                const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
                fill.style.height = pct + '%';
            }
            if (labelY) {
                labelY.innerText = isOverridden ? val : 'AUTO';
                labelY.style.opacity = isOverridden ? 1 : 0.6;
            }
            if (cfg.targetIdX) {
                const labelX = btn.querySelector('.val-indicator-x');
                if (labelX) {
                    const valX = addrX !== null ? window.latestDmxUniverse[addrX] : 0;
                    const isOverriddenX = addrX !== null && window.latestOverrides && window.latestOverrides.has(addrX);
                    labelX.innerText = isOverriddenX ? valX : 'AUTO';
                    labelX.style.opacity = isOverriddenX ? 1 : 0.6;
                }
            }
            if (isOverridden) btn.classList.add('active');
            else btn.classList.remove('active');

        } else if (cfg.type === 'dmx_slider') {
            const cap = btn.querySelector('.dmx-fader-cap');
            const label = btn.querySelector('.val-indicator-dmx');
            if (cap) {
                const min = cfg.min !== undefined ? cfg.min : 0;
                const max = cfg.max !== undefined ? cfg.max : 255;
                const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
                cap.style.bottom = pct + '%';
            }
            if (label) {
                label.innerText = isOverridden ? val : 'AUTO';
            }
            if (isOverridden) btn.classList.add('active');
            else btn.classList.remove('active');

        } else if (cfg.type === 'knob') {
            const knobBody = btn.querySelector('.knob-body');
            const label = btn.querySelector('.val-indicator-knob');
            if (knobBody) {
                const min = cfg.min !== undefined ? cfg.min : 0;
                const max = cfg.max !== undefined ? cfg.max : 255;
                const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
                const rotation = -135 + (pct * 2.7);
                knobBody.style.transform = "rotate(" + rotation + "deg)";
            }
            if (label) {
                label.innerText = isOverridden ? val : 'AUTO';
            }
            if (isOverridden) btn.classList.add('active');
            else btn.classList.remove('active');

        } else if (cfg.type === 'preset') {
            const isActive = (window.latestAudioState.manual_active_presets || []).some(id => String(id).toLowerCase() === String(cfg.targetId).toLowerCase());
            if (isActive) btn.classList.add('active');
            else btn.classList.remove('active');

        } else if (cfg.type === 'blackout') {
            const isBlackout = window.latestAudioState && window.latestAudioState.blackout;
            if (isBlackout) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });
};
