console.log("shared_setup.js loading...");

window.addEventListener('error', function(e) {
    console.error("❌ GLOBAL ERROR:", e.message, "at", e.filename, ":", e.lineno);
    const el = document.getElementById('debug-error-overlay');
    if (el) {
        el.style.display = 'block';
        el.innerText = '❌ ' + e.message + ' at ' + e.filename + ':' + e.lineno;
    }
});

// --- 0. IMMEDIATE GLOBAL BINDING ---
var RAVEBOX_READY = false;
var activeTestFixtures = []; 
var activeTestFunctions = new Set();
var current_editing_preset_id = null;
var currentPresetTriggers = [];
var currentPresetOverrides = [];
var simulationLastTime = 0;
var lastDmxUpdate = Date.now();
var db = { profiles: [], stage: [], presets: [], liveConsole: [], savedConsoles: [] };
var activeProfileId = null;
var currentProfileChannels = [];
var currentProfileMappings = [];
var collapsedChannels = new Set();
var pendingAiInstructions = {};
var aiConversationHistory = [];
var isProcessingAi = false;
var hiddenTestChannels = JSON.parse(localStorage.getItem('vj_hidden_test_channels') || '{}');
var currentTab = localStorage.getItem('vj_active_tab') || 'tab-test';
var muteOthersActive = false;
var mutedTestAddresses = new Set();
var tempChannels = [];
var latestOverrides = new Set();
var dmx_connected = false;

// Routing Flags
var isCustomSubdomain = false;
var isCustomTunnel = false;
var isOriginalCloud = false;
var apiHost = "";
var wsHost = "";
var host = "";
var LAUNCHER_API = "";
var BACKEND_ROOT = "";
var API_BASE_ROOT = "";
var API_BASE = "";

window.KNOWN_ROLES = [
    'pos_x', 'pos_y', 'zoom', 'rot_z', 'rot_x', 'rot_y',
    'color_solid', 'color_multi', 'pattern',
    'beam_fx', 'grating', 'drawing', 'drawing_delay',
    'strobe', 'generic', 'unassigned', 'dimmer',
    'mode', 'clip', 'group'
];

window.BEHAVIORS = [
    { id: 'static', label: 'Static' },
    { id: 'direct', label: 'Direct' },
    { id: 'sine', label: 'Sine' },
    { id: 'saw', label: 'Saw' },
    { id: 'square', label: 'Square' },
    { id: 'noise', label: 'Noise' },
    { id: 'beat phase', label: 'Beat Phase' },
    { id: 'bar phase', label: 'Bar Phase' }
];

window.EASY_DESCRIPTORS = [
    {"id": "pulse_beat", "label": "Pulse with Beat", "behavior": "sine", "source": "impact", "speed": 1, "react": 0.45, "hold_type": "none", "rel_center": 0.498},
    {"id": "smooth_drift", "label": "Smooth Drift", "behavior": "noise", "source": "bar phase", "speed": 0.1, "react": 0.65, "hold_type": "none"},
    {"id": "bass_pump", "label": "Bass Pump", "behavior": "direct", "source": "beat phase", "speed": 1, "react": 1, "hold_type": "none"},
    {"id": "snap_phrase", "label": "Snap Phrase", "behavior": "sine", "source": "volume", "speed": 0.7, "react": 0.65, "hold_type": "bar", "rel_center": 0.498},
    {"id": "pause_jitter", "label": "Pause-Jitter Sine", "behavior": "noise", "source": "beat phase", "speed": 0, "react": 0.95, "hold_type": "none"},
    {"id": "rapid_climb", "label": "Rapid Climb", "behavior": "saw", "source": "spectral flux", "speed": 0.5, "react": 0.85, "hold_type": "none", "rel_center": 0.498},
    {"id": "static_hold", "label": "Hold Fixed Value", "behavior": "static", "value": 127, "rel_center": 0.5},
    {"id": "cycle_random", "label": "Random - On Beat", "behavior": "noise", "source": "beat phase", "speed": 0.3, "react": 0.4, "hold_type": "beat", "rel_center": 0.498},
    {"id": "inverse_bass", "label": "Inverse Bass", "behavior": "direct", "source": "bass", "speed": 0.4, "react": 0.8, "hold_type": "none", "rel_center": 0.5},
    {"id": "kick_drum_step", "label": "kick drum step", "behavior": "beat phase", "source": "bin 0", "speed": 0.4, "react": 0.65, "hold_type": "none", "rel_center": 0.208},
    {"id": "hi_hat", "label": "hi hat", "behavior": "beat phase", "source": "highs", "speed": 1, "react": 1, "hold_type": "none", "rel_center": 0.498},
    {"id": "hi_hat", "label": "hi hat", "behavior": "static", "source": "bass", "speed": 1, "react": 1, "hold_type": "none", "rel_center": 0.498, "value": 127},
    // PREMADE_ANCHOR
];

window.SOURCES = [
    { id: 'bass', label: 'Bass' },
    { id: 'mids', label: 'Mids' },
    { id: 'highs', label: 'Highs' },
    { id: 'volume', label: 'Volume' },
    { id: 'spectral flux', label: 'Spectral Flux' },
    { id: 'impact', label: 'Impact' },
    { id: 'beat phase', label: 'Beat Phase' },
    { id: 'bar phase', label: 'Bar Phase' },
    { id: '2 bar phase', label: '2 Bar Phase' },
    { id: '4 bar phase', label: '4 Bar Phase' },
    { id: 'bin 0', label: 'Bin 0' },
    { id: 'bin 1', label: 'Bin 1' },
    { id: 'bin 2', label: 'Bin 2' },
    { id: 'bin 3', label: 'Bin 3' },
    { id: 'bin 4', label: 'Bin 4' },
    { id: 'bin 5', label: 'Bin 5' }
];

window.HOLD_TYPES = [
    { id: 'none', label: 'None' },
    { id: 'beat', label: 'Beat' },
    { id: 'bar', label: 'Bar' },
    { id: '2 bar', label: '2 Bar' },
    { id: '4 bar', label: '4 Bar' }
];


// --- 1. CORE ROUTING ENGINE (FLATTENED) ---
console.log("🛠️ Evaluating Routing...");
const setupLocation = window.location;
const setupHostname = setupLocation.hostname;

let savedHost = localStorage.getItem('vj_backend_host');
const onHostedDomain = (setupHostname === 'ravebox.love' || setupHostname === 'api.ravebox.love' || setupHostname.includes('storage.googleapis.com'));

if (!savedHost && onHostedDomain) {
    console.warn("⚠️ No VJ Backend Host found. Use ?host=... or a Secret Code. Skipping prompt to avoid blocking.");
}

var urlParams = new URLSearchParams(setupLocation.search);
var queryHost = urlParams.get('host');
if (queryHost) {
    localStorage.setItem('vj_backend_host', queryHost.trim());
    // 1.5 Clean the URL to avoid re-triggering or cluttered URL bars
    const newUrl = setupLocation.pathname + setupLocation.hash;
    window.history.replaceState({}, '', newUrl);
}

savedHost = localStorage.getItem('vj_backend_host');
host = savedHost || (onHostedDomain ? '' : setupHostname);

window.isCustomSubdomain = setupHostname.endsWith('.ravebox.love') && !onHostedDomain;
window.isOriginalCloud = (host === 'ravebox.love' || host === 'api.ravebox.love' || host === 'ravebox');

var boxName = (host === 'ravebox') ? 'ravebox.love' : ((host && !host.includes('.') && !host.includes(':')) ? host + '.ravebox.love' : host);
window.isCustomTunnel = (boxName || "").endsWith('.ravebox.love') && !window.isOriginalCloud;

var baseHost = (window.isCustomTunnel ? boxName.replace(/^(api-|ws-)/, '') : boxName);
window.apiHost = window.isCustomTunnel ? 'api-' + baseHost : host; // Keep for Launcher direct access if needed
window.wsHost = window.isCustomTunnel ? 'ws-' + baseHost : host;
window.host = host;

var PROTO = (setupLocation.protocol === 'file:') ? 'http:' : setupLocation.protocol;
API_BASE_ROOT = (window.isCustomTunnel || window.isCustomSubdomain) ? (PROTO + '//' + baseHost) : (host ? (PROTO + '//' + (window.isOriginalCloud ? 'api.ravebox.love' : host + ':8000')) : (PROTO + '//' + setupHostname + (setupLocation.port ? ':' + setupLocation.port : '')));
BACKEND_ROOT = (window.isCustomTunnel || window.isCustomSubdomain) ? (PROTO + '//' + window.apiHost) : (host ? (PROTO + '//' + (window.isOriginalCloud ? 'ravebox.love' : baseHost + ':8001')) : (PROTO + '//' + setupHostname + (setupLocation.port ? ':' + '8001' : '')));

window.API_BASE_ROOT = API_BASE_ROOT;
window.BACKEND_ROOT = BACKEND_ROOT;
window.LAUNCHER_API = BACKEND_ROOT;
LAUNCHER_API = BACKEND_ROOT;
window.API_BASE = (API_BASE_ROOT || "").replace(/\/+$/, '') + '/api/fixtures';
window.APP_VERSION = "421260851";

console.log("🎯 Context:", { isOriginalCloud: window.isOriginalCloud, isCustomTunnel: window.isCustomTunnel, host: window.host });

// --- 2. DATABASE INITIALIZATION & SYNC ---
async function initDatabaseSync() {
    console.log("🔄 Starting Database Sync from Server...");
    try {
        // 1. Initial Load from LocalStorage (Fallback/Speed)
        const stored = localStorage.getItem('ravebox_v2_db');
        if (stored) {
            const parsed = JSON.parse(stored);
            Object.assign(window.db, parsed);
        }

        // 2. Fetch Latest Core Configs from Server (Source of Truth)
        // We fetch these in parallel to speed up initialization
        const filesToSync = [
            { key: 'presets', path: 'presets.json' },
            { key: 'stage', path: 'stage_config.json' },
            { key: 'liveConsole', path: 'live_console.json' },
            { key: 'savedConsoles', path: 'live_consoles/index.json' } // (Optional index)
        ];

        const syncResults = await Promise.allSettled(
            filesToSync.map(f => fetch(`${window.API_BASE}/${f.path}`).then(r => r.ok ? r.json() : null))
        );

        let syncCount = 0;
        syncResults.forEach((res, i) => {
            if (res.status === 'fulfilled' && res.value) {
                const key = filesToSync[i].key;
                window.db[key] = res.value;
                syncCount++;
            }
        });

        console.log(`✅ [SYNC] Successfully synchronized ${syncCount} core files from server.`);
        
        // 3. Persist merged state back to localStorage
        window.saveDB();

        // 4. Trigger UI Refresh if we are on a page that needs it
        if (typeof window.refreshUI === 'function') window.refreshUI();
        if (typeof window.renderLiveTab === 'function') window.renderLiveTab();
        if (typeof window.renderPresets === 'function') window.renderPresets();

    } catch (e) {
        console.warn("⚠️ Database Sync failed, using LocalStorage fallback:", e);
    }
    
    RAVEBOX_READY = true;
    window.dispatchEvent(new CustomEvent('RAVEBOX_READY'));
}

// Kick off sync immediately
initDatabaseSync();

// --- 2.5 CROSS-TAB SYNCHRONIZATION ---
window.addEventListener('storage', (event) => {
    if (event.key === 'ravebox_v2_db' && event.newValue) {
        try {
            const freshDB = JSON.parse(event.newValue);
            Object.assign(window.db, freshDB);
            console.log("🔄 Database updated from another tab.");
            if (typeof refreshUI === 'function') refreshUI();
        } catch (e) {
            console.error("Failed to sync DB from storage event:", e);
        }
    }
});

// Shared Persistence
var saveDB = window.saveDB = async function(skipServer = false) {
    if (window.db.stage && Array.isArray(window.db.stage)) {
        window.db.stage.forEach(s => { if (s.fixtureId) delete s.fixtureId; });
    }
    localStorage.setItem('ravebox_v2_db', JSON.stringify(window.db));

    if (!skipServer) {
        console.log("💾 [DB] Syncing presets, stage, and console to server...");
        const syncPromises = [];
        
        if (window.db.presets) syncPromises.push(fetch(`${window.API_BASE}/presets.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.db.presets) }));
        if (window.db.stage) syncPromises.push(fetch(`${window.API_BASE}/stage_config.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.db.stage) }));
        if (window.db.liveConsole) syncPromises.push(fetch(`${window.API_BASE}/live_console.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.db.liveConsole) }));

        try {
            await Promise.allSettled(syncPromises);
            console.log("✅ [DB] Global sync complete.");
        } catch (e) {
            console.warn("⚠️ [DB] Server sync failed:", e);
        }
    }
};

/**
 * Global Profile Persistence (Core)
 * Saves a single profile object to the server and local storage.
 */
var saveProfileToServer = window.saveProfileToServer = async function(profileData) {
    if (!profileData || !profileData.id) return false;
    const fileName = `profiles/${profileData.id}.json`;
    try {
        const res = await fetch(`${window.API_BASE}/${fileName}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
        });
        if (!res.ok) throw new Error("Failed to save profile to server");

        // Update local DB Reference
        profileData._fileName = fileName;
        const idx = window.db.profiles.findIndex(p => p.id === profileData.id);
        if (idx !== -1) window.db.profiles[idx] = profileData;
        else window.db.profiles.push(profileData);

        // Sync LocalStorage
        window.saveDB();
        return true;
    } catch (err) {
        console.error(`❌ Error saving profile ${profileData.id}:`, err);
        return false;
    }
};

/**
 * Full Rig Synchronization
 * Pushes all profiles in memory to the server.
 */
var syncAllProfiles = window.syncAllProfiles = async function() {
    console.log("🔄 Global Sync: Pushing all profiles to server...");
    let success = true;
    // Sequential to avoid slamming the RPi server with simultaneous file writes
    for (const profile of (window.db.profiles || [])) {
        const ok = await window.saveProfileToServer(profile);
        if (!ok) success = false;
    }
    return success;
};

// --- GLOBALS (Legacy Bindings) ---
// Note: These are now primarily managed via the window object at the top of this file.

// --- DMX & AUDIO STATE ---
window.latestDmxUniverse = new Uint8Array(513);
window.latestAudioState = { vol: 0.1, bins: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], vibe: 'mid', transient: 'steady', beat: false };
window.latestOverrides = new Set();
window.ws = null;
window.dmx_connected = false;

// --- UI UTILITIES ---
window.cycleTheme = function() {
    const themes = ['', 'theme-glass', 'theme-cyber', 'theme-industrial'];
    let currentIdx = 0;
    const bodyClass = document.body.className;
    themes.forEach((t, i) => {
        if (t === '' && (bodyClass === '' || !themes.some(th => th && bodyClass.includes(th)))) currentIdx = i;
        else if (t !== '' && bodyClass.includes(t)) currentIdx = i;
    });
    const nextIdx = (currentIdx + 1) % themes.length;
    themes.forEach(t => { if(t) document.body.classList.remove(t); });
    const nextTheme = themes[nextIdx];
    if (nextTheme) { document.body.classList.add(nextTheme); localStorage.setItem('ravebox_setup_theme', nextTheme); }
    else localStorage.removeItem('ravebox_setup_theme');
};

const savedTheme = localStorage.getItem('ravebox_setup_theme');
if (savedTheme) document.body.classList.add(savedTheme);

window.toggleSidebar = () => document.getElementById('sidebar')?.classList.toggle('collapsed');

var updateUniqueFunctions = window.updateUniqueFunctions = function() {
    ['pres-add-global-func', 'test-function-picker'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
            const current = sel.value;
            const stageDrop = document.getElementById('pres-add-stage-fix');
            const isSpecialized = (id === 'pres-add-global-func') && stageDrop && ['system', 'visualdmx', 'calibrated'].includes(stageDrop.value);
            
            if (isSpecialized) return; // Don't wipe specialized lists (Rate, Intensity, etc)

            sel.innerHTML = (id === 'test-function-picker' ? '<option value="">-- All Channels --</option>' : '<option value="">-- Select Function --</option>') +
                window.KNOWN_ROLES.slice().sort().map(f => `<option value="${f}">${f}</option>`).join('');
            if (current) sel.value = current;
        }
    });

    const stageDrop = document.getElementById('pres-add-stage-fix');
    if (stageDrop) {
        const current = stageDrop.value;
        const options = (window.db.stage || []).map(inst => `<option value="${inst.id}">FIXTURE: ${inst.id}</option>`).join('');
        stageDrop.innerHTML = '<option value="global">ALL FIXTURES (Global)</option>' + 
                              '<option value="visualdmx">VISUALIZER (VisualDMX)</option>' +
                              '<option value="system">ENGINE (System)</option>' +
                              options;
        if (current) stageDrop.value = current;
    }
};

// --- NAVIGATION & UI REFRESH ---
var switchTab = window.switchTab = function(tabId, noHistory = false) {
    const isProfilePage = window.location.pathname.includes('profile.html');
    if (isProfilePage && tabId !== 'tab-profile') { window.location.href = 'setup.html?tab=' + tabId.replace('tab-', ''); return; }

    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    const tabEl = document.getElementById(tabId);
    if (tabEl) tabEl.classList.add('active');
    
    const btn = document.getElementById('nav-btn-' + tabId.replace('tab-', ''));
    if (btn) btn.classList.add('active');
    
    if (tabId === 'tab-live') { if (typeof loadLiveConfig === 'function') loadLiveConfig(); if (typeof renderLiveTab === 'function') renderLiveTab(); }
    if (tabId === 'tab-test') { if (typeof renderTestTab === 'function') renderTestTab(); }

    // Persist for state-aware components
    localStorage.setItem('vj_active_tab', tabId);
    window.currentTab = tabId;

    if (!noHistory) {
        const url = new URL(window.location);
        url.searchParams.set('tab', tabId.replace('tab-', ''));
        window.history.pushState({}, '', url);
    }
};

var getUniqueProfiles = window.getUniqueProfiles = () => {
    const seen = new Set();
    return (window.db.profiles || []).filter(p => { if (!p.id || seen.has(p.id)) return false; seen.add(p.id); return true; });
};

var refreshUI = window.refreshUI = function() {
    if (typeof updateUniqueFunctions === 'function') updateUniqueFunctions();
    if (typeof renderProfileList === 'function') renderProfileList();
    if (typeof renderStageList === 'function') renderStageList();
    if (typeof updateStageProfileList === 'function') updateStageProfileList();
};

var sendIt = window.sendIt = async function(event) {
    const btn = event ? event.currentTarget : null;
    let originalText = btn ? (btn.innerText || "Send It") : "Send It";
    if (btn) { btn.innerText = "⏳ Saving..."; btn.disabled = true; }

    try {
        // --- Refactored: Global Sync ---
        if (typeof window.saveProfile === 'function') {
            // CASE A: We are in the Profile Editor. 
            // Save the current UI state regardless of whether it's in db.profiles yet.
            const editorView = document.getElementById('profile-editor-view');
            if (editorView && editorView.style.display !== 'none') {
                const profileSuccess = await window.saveProfile(true);
                if (!profileSuccess) {
                    if (btn) { btn.innerText = originalText; btn.disabled = false; }
                    return; // Stop if profile save failed (e.g. missing name)
                }
            }
            // Also sync any other profiles that might have been tweaked
            await window.syncAllProfiles();
        } else {
            // CASE B: We are on Stage/Live/Test tab. 
            // Sync all profiles in memory to the server.
            await window.syncAllProfiles();
        }

        const API_BASE = window.API_BASE;
        await fetch(`${API_BASE}/stage_config.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.db.stage) });
        await fetch(`${API_BASE}/presets.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.db.presets) });

        if (btn) btn.innerText = "🔄 Restarting...";
        try { await fetch(`${window.API_BASE_ROOT}/restart`, { method: 'POST' }); } catch (e) {}

        if (btn) {
            btn.innerText = "✅ Saved!"; btn.style.background = "var(--success)";
            setTimeout(() => { btn.innerText = originalText; btn.style.background = ""; btn.disabled = false; }, 2000);
        }
    } catch (err) {
        console.error("Save error:", err);
        if (btn) { btn.innerText = "❌ Error"; btn.disabled = false; setTimeout(() => btn.innerText = originalText, 3000); }
    }
};

// --- BOOT COMPLETE ---
window.RAVEBOX_READY = true;
console.log("✅ RaveBox Core Ready (v426)");


// --- CORE ROUTING (BULLETPROOF) ---
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    const profileId = urlParams.get('id');
    const path = window.location.pathname;
    const isSetup = path.includes('setup.html');
    const isProfile = path.includes('profile.html');

    const initializeRouting = () => {
        if (isSetup) {
            // Priority 1: Direct Redirect if no tab or explicit profile tab
            if (!tabParam || tabParam === 'profiles' || tabParam === 'profile') {
                window.location.href = 'profile.html' + (profileId ? '?id=' + profileId : '');
                return;
            }

            // Priority 2: Map Parameter to Tab ID
            let targetTab = null;
            if (tabParam === 'stage') targetTab = 'tab-stage';
            else if (tabParam === 'live' || tabParam === 'sim') targetTab = 'tab-live';
            else if (tabParam === 'presets') targetTab = 'tab-presets';
            else if (tabParam === 'test') targetTab = 'tab-test';
            else if (tabParam && tabParam.startsWith('tab-')) targetTab = tabParam;

            // Priority 3: localStorage Fallback (Only if valid setup tab)
            if (!targetTab) {
                targetTab = localStorage.getItem('vj_active_tab') || 'tab-stage';
            }

            // Priority 4: Final Validation and Trigger
            if (typeof window.switchTab === 'function') {
                // Ensure switchTab runs AFTER a tiny stabilization pause (Avoids race with render logic)
                setTimeout(() => {
                    window.currentTab = targetTab;
                    window.switchTab(targetTab, true);
                }, 50);
            }
        } else if (isProfile && profileId) {
            if (typeof editProfile === 'function') editProfile(profileId);
        }
    };

    // Trigger on DOM ready OR immediate if parsed
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initializeRouting();
    } else {
        window.addEventListener('DOMContentLoaded', initializeRouting);
    }
})();
