
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
    if (typeof saveDB === 'function') saveDB();
    
    if (!skipServer) {
        try {
            await fetch(`${window.API_BASE}/live_console.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(liveConfig)
            });
            console.log("✅ [LIVE CONSOLE] Synced to server.");
        } catch (e) {
            console.warn("⚠️ [LIVE CONSOLE] Could not sync to server, saved locally only.");
        }
    }
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
            const isActive = (window.latestAudioState.manual_active_presets || []).includes(cfg.targetId);
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

            label = instY ? instY.id : (profY ? profY.name : 'SLIDER');
            sublabel = chY ? (chY.role || chY.name) : '';

            let xyLabelHtml = `<div style="display:flex; gap:4px; align-items:center; z-index:1;">
                                <span style="color:var(--accent); font-size:9px;">Y:</span>
                                <span class="val-indicator-y" style="font-size:11px; font-weight:900; opacity:${isOverriddenY ? 1 : 0.5}">${isOverriddenY ? valY : 'AUTO'}</span>
                               </div>`;

            if (cfg.targetIdX) {
                const instX = (window.db.stage || []).find(s => s.id === cfg.targetIdX);
                const profX = instX ? (window.db.profiles || []).find(p => p.id === instX.profileId) : null;
                const chX = (profX && profX.channels) ? profX.channels[cfg.channelIdxX] : null;
                const addrX = (instX && chX) ? (parseInt(instX.address) || 1) + (parseInt(instX.offset) || 0) + (parseInt(chX.addrOffset) || cfg.channelIdxX) : null;
                const isOverriddenX = addrX !== null && window.latestOverrides && window.latestOverrides.has(addrX);
                const valX = addrX !== null ? (window.latestDmxUniverse[addrX] || (window.latestAudioState && window.latestAudioState.manual_overrides ? window.latestAudioState.manual_overrides[addrX] : 0) || 0) : 0;
                
                xyLabelHtml += `<div style="display:flex; gap:4px; align-items:center; z-index:1;">
                                    <span style="color:var(--accent-alt); font-size:9px;">X:</span>
                                    <span class="val-indicator-x" style="font-size:11px; font-weight:900; opacity:${isOverriddenX ? 1 : 0.5}">${isOverriddenX ? valX : 'AUTO'}</span>
                                </div>`;
            }

            content = `<div class="fill-indicator" style="position:absolute; bottom:0; left:0; width:100%; height:${pctY}%; pointer-events:none; transition: height 0.05s;"></div>
                       ${xyLabelHtml}`;
            if (isOverriddenY) extraClass = 'active';
        } else if (cfg.type === 'live_feed') {
            const isFeedActive = document.getElementById('live-console-feed-container') && document.getElementById('live-console-feed-container').style.display === 'block';
            label = "LIVE FEED";
            content = `<div style="font-size:24px; z-index:1;">📷 ${isFeedActive ? 'ON' : 'OFF'}</div>`;
            if (isFeedActive) extraClass = 'active';
        } else {
            if (liveEditMode) {
                label = "ADD BUTTON";
                content = `<div style="font-size:24px; opacity:0.3; z-index:1;">+</div>`;
            } else {
                continue; // Hide empty buttons in play mode
            }
        }

        html += `<div class="live-btn ${extraClass}" style="${style} ${draggedBtnIdx === i ? 'opacity:0.5; transform:scale(0.9); z-index:10;' : ''} ${dragTargetIdx === i ? 'box-shadow: 0 0 15px var(--accent);' : ''}; height:100px; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; position:relative; overflow:hidden; touch-action:none; gap:4px;" 
                     onpointerdown="handleLivePointerDown(event, ${i})"
                     onpointermove="handleLivePointerMove(event, ${i})"
                     onpointerup="handleLivePointerUp(event, ${i})"
                     onpointerleave="handleLivePointerUp(event, ${i})"
                     oncontextmenu="return false;">
            <div style="font-size:8px; opacity:0.6; position:absolute; top:5px; left:5px; z-index:2;">#${i + 1}</div>
            <div style="font-size:11px; font-weight:800; text-align:center; padding:0 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; z-index:1;">${label}</div>
            ${content}
            ${sublabel ? `<div style="font-size:8px; opacity:0.6; z-index:1;">${sublabel}</div>` : ''}
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
    presetHoldMoved = false;

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

    if (cfg.type === 'preset' && cfg.targetId) {
        e.target.closest('.live-btn')?.setPointerCapture(e.pointerId);
        presetHoldActive = true;
        presetHoldId = cfg.targetId;
        presetLastMovePos = { x: e.clientX, y: e.clientY };
        presetMoveSpeed = 0;

        // Start hold timer — after 300ms without a pointerup, activate momentary mode
        longPressTimer = setTimeout(() => {
            if (presetHoldActive && !presetHoldMoved) {
                // Momentary hold: activate now, will deactivate on release
                isLongPress = true;
                if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                    window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: presetHoldId, state: true }));
                }
                // Visual feedback
                const btn = document.querySelectorAll('.live-btn')[idx];
                if (btn) btn.classList.add('active');
            }
        }, 300);
    } else if (cfg.type === 'slider') {
        e.target.setPointerCapture(e.pointerId);
    } else if (cfg.type === 'live_feed') {
        toggleLiveConsoleFeed();
    }
}

function handleLivePointerMove(e, idx) {
    pointerCurrentClientY = e.clientY;
    pointerCurrentClientX = e.clientX;

    if (activePointerIdx !== idx && !isDraggingBtn) return;

    if (longPressTimer && !isLongPress) {
        const dist = Math.sqrt(Math.pow(e.clientX - dragPointerStart.x, 2) + Math.pow(e.clientY - dragPointerStart.y, 2));
        if (dist > 15) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
            if (liveEditMode) {
                isDraggingBtn = true;
                draggedBtnIdx = idx;
            } else if (presetHoldActive) {
                // Movement detected during preset hold — enter cycle mode
                presetHoldMoved = true;
            }
        }
    }

    // --- PRESET CYCLE MODE (hold + move) ---
    if (presetHoldActive && presetHoldMoved && !liveEditMode) {
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
                window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: presetHoldId, state: true }));
            }
            const btn = document.querySelectorAll('.live-btn')[idx];
            if (btn) btn.classList.add('active');
        }

        // Clear and reset interval at new speed
        if (presetCycleInterval) clearInterval(presetCycleInterval);
        presetCycleInterval = setInterval(() => {
            presetCycleState = !presetCycleState;
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: presetHoldId, state: presetCycleState }));
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
    if (!cfg || cfg.type !== 'slider') return;

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
    if (btn) {
        const dy = pointerCurrentClientY - pointerInitialClientY;
        const dx = cfg.targetIdX ? (pointerCurrentClientX - pointerInitialClientX) : 0;
        btn.style.transform = `translate(${dx}px, ${dy}px)`;
        btn.style.zIndex = "1000";
    }

    processOverride(cfg.targetId, cfg.channelIdx, targetValY, isHomeY, btn);
    if (cfg.targetIdX) {
        processOverride(cfg.targetIdX, cfg.channelIdxX, targetValX, isHomeX, btn, 'x');
    }
}

function processOverride(targetId, chIdx, val, isHome, btn, axis = 'y') {
    const inst = (window.db.stage || []).find(s => s.id === targetId);
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
        valDisplay.innerText = label;
        valDisplay.style.opacity = active ? '1' : '0.5';
    }
    if (axis === 'y') {
        const fill = btn.querySelector('.fill-indicator');
        if (fill) fill.style.background = `rgba(255,255,255,${active ? '0.2' : '0.05'})`;
    }
}

async function handleLivePointerUp(e, idx) {
    if (isDraggingBtn && draggedBtnIdx !== null && dragTargetIdx !== null) {
        while (liveConfig.length <= Math.max(draggedBtnIdx, dragTargetIdx)) {
            liveConfig.push({ type: 'none', color: '#333' });
        }
        const temp = liveConfig[draggedBtnIdx];
        liveConfig[draggedBtnIdx] = liveConfig[dragTargetIdx] || { type: 'none', color: '#333' };
        liveConfig[dragTargetIdx] = temp || { type: 'none', color: '#333' };
        await saveLiveConfig();
    }

    // --- PRESET RELEASE LOGIC ---
    const wasPresetHold = presetHoldActive;
    const wasPresetMoved = presetHoldMoved;
    const wasLongPress = isLongPress;

    // Clean up cycle interval
    if (presetCycleInterval) {
        clearInterval(presetCycleInterval);
        presetCycleInterval = null;
    }

    if (wasPresetHold && presetHoldId) {
        const cfg = liveConfig[idx];
        const dist = Math.sqrt(Math.pow(pointerCurrentClientX - pointerInitialClientX, 2) + Math.pow(pointerCurrentClientY - pointerInitialClientY, 2));

        if (wasPresetMoved) {
            // MODE 3: Hold + Move (Cycle) → turn OFF on release
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: presetHoldId, state: false }));
            }
        } else if (wasLongPress) {
            // MODE 2: Hold without move (Momentary) → turn OFF on release
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: presetHoldId, state: false }));
            }
        } else if (dist < 10) {
            // MODE 1: Quick tap → Toggle (stays on/off)
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'toggle_preset', preset_id: presetHoldId }));
            }
        }

        // Reset preset state
        presetHoldActive = false;
        presetHoldId = null;
        presetHoldMoved = false;
        presetCycleState = false;
        presetMoveSpeed = 0;
    }

    activePointerIdx = null;
    draggedBtnIdx = null;
    dragTargetIdx = null;
    isDraggingBtn = false;
    
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }

    if (isLongPress && !wasPresetHold) {
        isLongPress = false;
        renderLiveTab();
        return;
    }
    isLongPress = false;

    // Non-preset interactions
    if (!wasPresetHold) {
        const cfg = liveConfig[idx];
        const dist = Math.sqrt(Math.pow(pointerCurrentClientX - pointerInitialClientX, 2) + Math.pow(pointerCurrentClientY - pointerInitialClientY, 2));

        if (dist < 10) {
            if (!liveEditMode) {
                if (cfg && cfg.type === 'slider') {
                    await clearSliderOverrides(cfg);
                }
            } else {
                openAssignment(idx);
            }
        }
    }

    const btn = e.target.closest('.live-btn');
    if (btn) {
        btn.style.transform = 'translate(0,0)';
        btn.style.zIndex = "";
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
function toggleLiveConsoleFeed(forceState) {
    const container = document.getElementById('live-console-feed-container');
    const img = document.getElementById('live-console-feed-img');
    if (!container || !img) return;

    const isCurrentlyActive = container.style.display === 'block';
    const activate = (forceState !== undefined) ? forceState : !isCurrentlyActive;

    if (activate) {
        container.style.display = 'block';
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
    } else if (cfg.type === 'slider') {
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
    document.getElementById('assign-slider-wrap').style.display = type === 'slider' ? 'block' : 'none';

    const fixtureList = (window.db.stage || []).map(inst => {
        const prof = window.db.profiles.find(p => p.id === inst.profileId);
        const profName = prof ? prof.name : (inst.profileName || 'Unknown');
        return `<option value="${inst.id}">${inst.id} (${profName})</option>`;
    }).join('');

    if (type === 'preset') {
        const sel = document.getElementById('assign-preset-id');
        sel.innerHTML = (window.db.presets || []).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    } else if (type === 'slider') {
        const selY = document.getElementById('assign-profile-id');
        selY.innerHTML = fixtureList;
        updateAssignmentChannels('assign-channel-idx', selY.value);

        const selX = document.getElementById('assign-profile-id-x');
        selX.innerHTML = '<option value="">-- None (Single Axis) --</option>' + fixtureList;
        updateAssignmentChannels('assign-channel-idx-x', selX.value);
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
    } else if (type === 'slider') {
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
