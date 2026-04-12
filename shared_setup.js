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

// Routing Flags
window.isCustomSubdomain = false;
window.isCustomTunnel = false;
window.isOriginalCloud = false;
window.apiHost = "";
window.wsHost = "";
window.host = "";

window.KNOWN_ROLES = [
    'pos_x', 'pos_y', 'zoom', 'rot_z', 'rot_x', 'rot_y',
    'color_solid', 'color_multi', 'pattern',
    'beam_fx', 'grating', 'drawing', 'drawing_delay',
    'strobe', 'generic', 'unassigned', 'dimmer',
    'mode', 'clip', 'group'
];

window.BEHAVIORS = [
    { id: 'static', label: 'Static Value' },
    { id: 'push', label: 'Push (Kinetic)' },
    { id: 'pull', label: 'Pull (Kinetic)' },
    { id: 'sine', label: 'Sine' },
    { id: 'saw', label: 'Saw' },
    { id: 'square', label: 'Square' },
    { id: 'noise', label: 'Noise (Smooth)' },
    { id: 'random', label: 'Random (Step)' },
    { id: 'step', label: 'Step Forward' }
];

window.EASY_DESCRIPTORS = [
    {"id": "pulse_beat", "label": "Pulse with Beat", "behavior": "square", "source": "impact", "speed": 0, "react": 0.6, "hold_type": "none"},
    {"id": "smooth_drift", "label": "Smooth Drift", "behavior": "noise", "source": "bar", "speed": 0.1, "react": 0.65, "hold_type": "none"},
    {"id": "bass_pump", "label": "Bass Pump", "behavior": "pull", "source": "beat", "speed": 1, "react": 1, "hold_type": "floorfreeze"},
    {"id": "snap_phrase", "label": "Snap Phrase", "behavior": "step", "source": "flux", "speed": 0.1, "react": 0.3, "hold_type": "beat"},
    {"id": "pause_jitter", "label": "Pause-Jitter Sine", "behavior": "noise", "source": "beat", "speed": 0, "react": 0.95, "hold_type": "none"},
    {"id": "rapid_climb", "label": "Rapid Climb", "behavior": "square", "source": "vol", "speed": 0.5, "react": 0.85, "hold_type": "none"},
    {"id": "static_hold", "label": "Hold Fixed Value", "behavior": "static", "value": 127, "rel_center": 0.5},
    {"id": "cycle_random", "label": "Random - On Beat", "behavior": "noise", "source": "flux", "speed": 0.95, "react": 0.8, "hold_type": "beat"},
    {"id": "inverse_bass", "label": "Inverse Bass", "behavior": "pull", "source": "bass", "speed": 0.4, "react": 0.8, "hold_type": "none", "rel_center": 0.5}
    // PREMADE_ANCHOR
];

window.SOURCES = [
    { id: 'bass', label: 'Bass' },
    { id: 'mid', label: 'Mid' },
    { id: 'high', label: 'High' },
    { id: 'vol', label: 'Volume' },
    { id: 'flux', label: 'Spectral Flux' },
    { id: 'impact', label: 'Impact (Attack)' },
    { id: 'beat', label: 'Beat Phase' },
    { id: 'bar', label: 'Bar Phase' },
    { id: 'bin_0', label: 'Bin 0 (Sub)' },
    { id: 'bin_1', label: 'Bin 1 (Bass)' },
    { id: 'bin_2', label: 'Bin 2 (Low-Mid)' },
    { id: 'bin_3', label: 'Bin 3 (Mid)' },
    { id: 'bin_4', label: 'Bin 4 (High-Mid)' },
    { id: 'bin_5', label: 'Bin 5 (Treble)' }
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
}

savedHost = localStorage.getItem('vj_backend_host');
var host = savedHost || (onHostedDomain ? '' : setupHostname);

window.isCustomSubdomain = setupHostname.endsWith('.ravebox.love') && !onHostedDomain;
window.isOriginalCloud = (host === 'ravebox.love' || host === 'api.ravebox.love' || host === 'ravebox');

var boxName = (host === 'ravebox') ? 'ravebox.love' : ((host && !host.includes('.') && !host.includes(':')) ? host + '.ravebox.love' : host);
window.isCustomTunnel = (boxName || "").endsWith('.ravebox.love') && !window.isOriginalCloud;

var baseHost = (window.isCustomTunnel ? boxName.replace(/^(api-|ws-)/, '') : boxName);
window.apiHost = window.isCustomTunnel ? 'api-' + baseHost : host; // Keep for Launcher direct access if needed
window.wsHost = window.isCustomTunnel ? 'ws-' + baseHost : host;
window.host = host;

var PROTO = (setupLocation.protocol === 'file:') ? 'http:' : setupLocation.protocol;
var API_BASE_ROOT = window.isCustomSubdomain ? (PROTO + '//' + setupLocation.host) : (window.isCustomTunnel ? (PROTO + '//' + window.apiHost) : (host ? (PROTO + '//' + (window.isOriginalCloud ? 'api.ravebox.love' : host + ':8000')) : (PROTO + '//' + setupHostname + (setupLocation.port ? ':' + setupLocation.port : ''))));
var BACKEND_ROOT = window.isCustomSubdomain ? (PROTO + '//' + baseHost) : (window.isCustomTunnel ? (PROTO + '//' + baseHost) : (host ? (PROTO + '//' + (window.isOriginalCloud ? 'ravebox.love' : baseHost + ':8001')) : (PROTO + '//' + setupHostname + (setupLocation.port ? ':' + '8001' : ''))));

window.API_BASE_ROOT = API_BASE_ROOT;
window.BACKEND_ROOT = BACKEND_ROOT;
window.API_BASE = (API_BASE_ROOT || "").replace(/\/+$/, '') + '/api/fixtures';
window.APP_VERSION = "412261449";

console.log("🎯 Context:", { isOriginalCloud: window.isOriginalCloud, isCustomTunnel: window.isCustomTunnel, host: window.host });

// --- 2. DATABASE LOADING ---
try {
    const stored = localStorage.getItem('ravebox_v2_db');
    if (stored) {
        const parsed = JSON.parse(stored);
        Object.assign(window.db, parsed);
    }
} catch (e) {
    console.warn("DB Load failed:", e);
}
if (!window.db.liveConsole) window.db.liveConsole = [];
if (!window.db.savedConsoles) window.db.savedConsoles = [];

// Shared Persistence
var saveDB = window.saveDB = function() {
    if (window.db.stage && Array.isArray(window.db.stage)) {
        window.db.stage.forEach(s => { if (s.fixtureId) delete s.fixtureId; });
    }
    localStorage.setItem('ravebox_v2_db', JSON.stringify(window.db));
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
            sel.innerHTML = (id === 'test-function-picker' ? '<option value="">-- All Channels --</option>' : '<option value="">-- Select Function --</option>') +
                window.KNOWN_ROLES.slice().sort().map(f => `<option value="${f}">${f}</option>`).join('');
            if (current) sel.value = current;
        }
    });

    const stageDrop = document.getElementById('pres-add-stage-fix');
    if (stageDrop) {
        const current = stageDrop.value;
        const options = (window.db.stage || []).map(inst => `<option value="${inst.id}">FIXTURE: ${inst.id}</option>`).join('');
        stageDrop.innerHTML = '<option value="global">ALL FIXTURES (Global)</option>' + options;
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
console.log("✅ RaveBox Core Ready (v420)");
