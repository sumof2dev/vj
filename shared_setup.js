console.log("shared_setup.js loading...");

window.enforceDmxLimit = function(el) {
    let val = el.value.replace(/\D/g, ''); // Digits only
    if (val === '') {
        // Allow empty
    } else {
        if (val.length > 3) val = val.slice(-3); // Rolling 3-digit window
        let num = parseInt(val);
        if (num > 255) num = 255;
        val = num.toString();
    }
    el.value = val;
    return val;
};

window.generateFriendlyId = function(type, existingIds = []) {
    const words = ['rave', 'box', 'cave', 'theone', 'beaver', 'slimy', 'hasty', 'baggage', 'rock', 'toy', 'tease', 'mildly', 'fat', 'twist', 'good', 'miami', 'grab', 'cash', 'money', 'bills', 'yeet', 'nocap', 'uhhuh', 'kiss', 'climb', 'drop', 'grandma', 'love', 'roses', 'cinch', 'knot', 'xray', 'rip', 'tit', 'wish', 'head', 'rash', 'play', 'unload', 'brave', 'daddy'];
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const word = words[Math.floor(Math.random() * words.length)];
    const baseId = `${mm}${dd}.${type}.${word}`;
    
    let finalId = baseId;
    let counter = 1;
    while (existingIds.includes(finalId)) {
        finalId = `${baseId}(${counter})`;
        counter++;
    }
    return finalId;
};

window.showToast = function(msg, duration = 3000, type = 'info') {
    let el = document.getElementById('toast-container');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast-container';
        el.style.cssText = 'position:fixed; bottom:80px; left:50%; transform:translateX(-50%); z-index:100000; display:flex; flex-direction:column; gap:10px; pointer-events:none;';
        document.body.appendChild(el);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `background:rgba(0,0,0,0.9); color:#fff; padding:12px 24px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); border-left:4px solid var(--accent); backdrop-filter:blur(20px); font-size:13px; font-weight:900; box-shadow:0 15px 45px rgba(0,0,0,0.6); transform:translateY(40px); opacity:0; transition:all 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28); pointer-events:auto; letter-spacing:0.5px; text-transform:uppercase;`;
    
    if (type === 'warning') toast.style.borderLeftColor = '#f1c40f';
    else if (type === 'error') toast.style.borderLeftColor = '#e74c3c';
    else if (type === 'success') toast.style.borderLeftColor = 'var(--success)';
    
    toast.innerText = msg;
    el.appendChild(toast);

    setTimeout(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    }, 10);

    setTimeout(() => {
        toast.style.transform = 'translateY(-20px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, duration);
};

window.addEventListener('error', function(e) {
    console.error("❌ GLOBAL ERROR:", e.message, "at", e.filename, ":", e.lineno);
    const el = document.getElementById('debug-error-overlay');
    if (el) {
        el.classList.remove('hidden');
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
window.db = { profiles: [], stage: [], presets: [], liveConsole: [], savedConsoles: [] };
var db = window.db;
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
    { id: 'stochastic', label: 'Stochastic' },
    { id: 'spike', label: 'Spike' },
    { id: 'hum', label: 'Hum' },
    { id: 'fuzzy', label: 'Fuzzy' },
    { id: 'direct_stepped', label: 'Direct Stepped' }
];

window.EASY_DESCRIPTORS = [
    {"id": "pulse_beat", "label": "Pulse with Beat", "behavior": "direct", "source": "bin 0", "speed": 0.2, "react": 0.8, "hold_type": "none", "rel_center": 0.498},
    {"id": "smooth_drift", "label": "Smooth Drift", "behavior": "sine", "source": "bass", "speed": 0.1, "react": 0.25, "hold_type": "none", "rel_center": 0.498},
    {"id": "bass_pump", "label": "Bass Pump", "behavior": "direct", "source": "bin 1", "speed": 0.05, "react": 0.9, "hold_type": "none", "rel_center": 0.498},
    {"id": "snap_phrase", "label": "Snap Phrase", "behavior": "stochastic", "source": "mids", "speed": 0.5, "react": 0.45, "hold_type": "beat", "rel_center": 0.498},
    {"id": "rapid_climb", "label": "Rapid Climb", "behavior": "direct", "source": "impact", "speed": 1, "react": 1, "hold_type": "none", "rel_center": 0.498},
    {"id": "static_hold", "label": "Hold Fixed Value", "behavior": "static", "value": 127, "rel_center": 0.5},
    {"id": "cycle_random", "label": "Random - On Beat", "behavior": "stochastic", "source": "mids", "speed": 0.3, "react": 0.15, "hold_type": "beat", "rel_center": 0.498},
    {"id": "inverse_bass", "label": "Flux Direct", "behavior": "direct", "source": "spectral flux", "speed": 0.4, "react": 0.8, "hold_type": "none", "rel_center": 0.502},
    {"id": "kick_drum_step", "label": "kick drum step", "behavior": "direct", "source": "bass", "speed": 0, "react": 0.45, "hold_type": "beat", "rel_center": 0.004},
    {"id": "hi_hat", "label": "hi hat", "behavior": "direct", "source": "highs", "speed": 1, "react": 1, "hold_type": "none", "rel_center": 0.498},
    {"id": "random_bar_hold", "label": "Random Bar Hold", "behavior": "stochastic", "source": "volume", "speed": 0.5, "react": 0.5, "hold_type": "bar", "rel_center": 0.5},
    {"id": "random_beat_hold", "label": "Random Beat Hold", "behavior": "stochastic", "source": "volume", "speed": 0.5, "react": 0.5, "hold_type": "beat", "rel_center": 0.5},
    {"id": "beat_jump", "label": "Beat Jump", "behavior": "direct", "source": "beat phase", "speed": 0.2, "react": 0.4, "hold_type": "none", "rel_center": 0.502},
    {"id": "bass_hum", "label": "Bass Line Hum", "behavior": "direct", "source": "bin 1", "speed": 0, "react": 0.6, "hold_type": "none", "rel_center": 0.502},
    {"id": "direct_hold", "label": "Direct and Hold", "behavior": "direct", "source": "volume", "speed": 0.5, "react": 0.2, "hold_type": "beat", "rel_center": 0.502},
    {"id": "hi_hit", "label": "Hi Hit", "behavior": "saw", "source": "highs", "speed": 0.2, "react": 0.65, "hold_type": "none", "rel_center": 0.498},
    {"id": "fuzzy_mids", "label": "Fuzzy Mids", "behavior": "fuzzy", "source": "mids", "speed": 0.1, "react": 0.1, "hold_type": "none", "rel_center": 0.502},
    {"id": "new_trigger_state", "label": "New Trigger State", "behavior": "static", "source": "volume", "speed": 0.5, "react": 0.5, "hold_type": "none", "rel_center": 0.498, "value": 127},
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
    { id: '2 bar phase', label: '2 Bar Phase' },
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
    { id: '2 bar', label: '2 Bar' }
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
window.isCustomSubdomain = setupHostname.endsWith('.ravebox.love') && !onHostedDomain;

// If accessing directly via a custom tunnel (e.g. mybox.ravebox.love), the URL itself is the source of truth.
// We must ignore any old "Secret Codes" from localStorage, otherwise it prompts or misroutes.
if (window.isCustomSubdomain) {
    savedHost = null;
    if (localStorage.getItem('vj_backend_host')) {
            localStorage.removeItem('vj_backend_host');
    }
}

host = savedHost || (onHostedDomain ? '' : setupHostname);

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
window.APP_VERSION = "56261042";

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
            { key: 'savedConsoles', path: 'live_consoles/index.json' },
            { key: 'descriptors', path: '../descriptors.json' } // Premade behaviors
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

        // 3. Collection-based Profile Sync (Since profiles.json doesn't exist)
        console.log("📂 [SYNC] Fetching profile collection...");
        try {
            const listRes = await fetch(`${window.API_BASE_ROOT}/api/fixtures`);
            if (listRes.ok) {
                const allFiles = await listRes.json();
                const profileFiles = allFiles.filter(f => f.startsWith('profiles/') && f.endsWith('.json'));
                
                const profileContents = await Promise.allSettled(
                    profileFiles.map(f => fetch(`${window.API_BASE}/${f}`).then(r => r.json()))
                );

                window.db.profiles = [];
                profileContents.forEach((res, i) => {
                    if (res.status === 'fulfilled' && res.value) {
                        const p = res.value;
                        p._fileName = profileFiles[i];
                        window.db.profiles.push(p);
                    }
                });
                console.log(`✅ [SYNC] Loaded ${window.db.profiles.length} individual profiles.`);
            }
        } catch (profileErr) {
            console.warn("⚠️ [SYNC] Failed to load individual profiles:", profileErr);
        }

        console.log(`✅ [SYNC] Successfully synchronized ${syncCount} core files from server.`);
        
        // 4. Data Normalization & Repair
        repairPresets();
        
        // 5. Merge Descriptors into EASY_DESCRIPTORS
        if (window.db.descriptors && Array.isArray(window.db.descriptors)) {
            const existingIds = new Set(window.EASY_DESCRIPTORS.map(d => d.id));
            window.db.descriptors.forEach(d => {
                if (!existingIds.has(d.id)) {
                    window.EASY_DESCRIPTORS.push(d);
                }
            });
            console.log(`✨ [SYNC] Merged ${window.db.descriptors.length} premade behaviors into library.`);
        }

        // 3. Persist merged state back to localStorage ONLY (never overwrite server during init)
        window.saveDB(true);

        // 4. Trigger UI Refresh if we are on a page that needs it
        if (typeof window.refreshUI === 'function') window.refreshUI();
        if (typeof window.renderLiveTab === 'function') window.renderLiveTab();
        if (typeof window.renderPresets === 'function') window.renderPresets();

    } catch (e) {
        console.warn("⚠️ Database Sync failed, using LocalStorage fallback:", e);
    }
    
    window.RAVEBOX_READY = true;
    window.dispatchEvent(new CustomEvent('RAVEBOX_READY'));
    
    // Hide Loading Overlay
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        setTimeout(() => overlay.classList.add('hidden'), 300); // Small delay for smoothness
    }

    console.log("✅ RaveBox Core Ready (v56261042)");
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
window.vibeHistory = [];
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

window.updateUniversalHUD = function() {
    const hud = document.getElementById('universal-hud');
    if (!hud) return;

    // 1. Presets (Include manual presets + core engine states)
    const presetsCont = document.getElementById('hud-presets');
    if (presetsCont) {
        let activeNames = [];
        let dimNames = [];
        if (window.latestAudioState.lissajous_active > 0.5) activeNames.push("Lissajous");
        if (window.latestAudioState.calibrated_preset_active) activeNames.push("Calibrated");
        
        if (!window.everActivatedPresets) window.everActivatedPresets = new Set();

        const activeIds = window.activePresets || (window.latestAudioState && window.latestAudioState.active_presets) || [];
        activeIds.forEach(id => {
            window.everActivatedPresets.add(id);
            const p = (window.db && window.db.presets) ? window.db.presets.find(x => x.id === id || x.name === id) : null;
            const name = p ? p.name : id;
            if (!activeNames.includes(name)) activeNames.push(name);
        });
        
        window.everActivatedPresets.forEach(id => {
            const p = (window.db && window.db.presets) ? window.db.presets.find(x => x.id === id || x.name === id) : null;
            const name = p ? p.name : id;
            if (!activeNames.includes(name) && !dimNames.includes(name)) dimNames.push(name);
        });
        
        presetsCont.innerHTML = 
            activeNames.map(name => `<span class="hud-preset-badge">${name}</span>`).join('') +
            dimNames.map(name => `<span class="hud-preset-badge dim">${name}</span>`).join('');
    }

    // 2. Vibe Log
    const logCont = document.getElementById('hud-vibe-log');
    if (logCont) {
        logCont.innerHTML = window.vibeHistory.map(entry => `
            <div class="hud-vibe-line">
                <span class="ts">${entry.ts}</span>
                <span class="vibe vibe-${entry.vibe}">${entry.vibe.toUpperCase()}${entry.variant !== undefined && entry.variant !== null ? '·' + entry.variant : ''}</span>
                <span class="vol">${entry.vol}%</span>
            </div>
        `).join('');
    }
};

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
                              options;
        if (current) stageDrop.value = current;
    }
};

// --- NAVIGATION & UI REFRESH ---
var switchTab = window.switchTab = function(tabId, noHistory = false) {
    const isProfilePage = window.location.pathname.endsWith('/profile.html') || window.location.pathname === 'profile.html';
    if (isProfilePage && tabId !== 'tab-profile') { window.location.href = 'setup.html?tab=' + tabId.replace('tab-', ''); return; }

    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    const tabEl = document.getElementById(tabId);
    if (tabEl) tabEl.classList.add('active');
    
    const btn = document.getElementById('nav-btn-' + tabId.replace('tab-', ''));
    if (btn) btn.classList.add('active');
    
    if (tabId === 'tab-live') { if (typeof loadLiveConfig === 'function') loadLiveConfig(); if (typeof renderLiveTab === 'function') renderLiveTab(); }
    if (tabId === 'tab-test') { if (typeof renderTestTab === 'function') renderTestTab(); }
    if (tabId === 'tab-presets') { if (typeof renderSliderSetup === 'function') renderSliderSetup(); }

    // Persist for state-aware components
    localStorage.setItem('vj_active_tab', tabId);
    window.currentTab = tabId;

    // Cycle backgrounds
    document.body.classList.remove('bg-stage', 'bg-presets', 'bg-engine', 'bg-test', 'setup-bg', 'engine-test-bg', 'bg-profile');
    if (tabId === 'tab-stage' || tabId === 'tab-profile') document.body.classList.add('bg-stage');
    else if (tabId === 'tab-presets') document.body.classList.add('bg-presets');
    else if (tabId === 'tab-engine') document.body.classList.add('bg-engine');
    else if (tabId === 'tab-test') document.body.classList.add('bg-test');

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
    if (window.currentTab === 'tab-presets' && typeof window.renderSliderSetup === 'function') window.renderSliderSetup();
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
window.togglePresetEditor = function(show) {
    const content = document.getElementById('preset-editor-content');
    const actionsTop = document.getElementById('preset-editor-actions-top');
    const addBtn = document.getElementById('preset-add-btn');
    const genBtn = document.getElementById('preset-gen-btn-top');
    const arrow = document.getElementById('preset-editor-arrow');
    const header = document.getElementById('preset-editor-header');

    if (show === undefined) show = content.classList.contains('hidden');

    if (show) {
        content.classList.remove('hidden');
        actionsTop.classList.remove('hidden');
        addBtn.classList.add('hidden');
        genBtn.classList.add('hidden');
        if (arrow) arrow.style.transform = 'rotate(180deg)';
        if (header) header.style.background = 'rgba(255,255,255,0.05)';
    } else {
        content.classList.add('hidden');
        actionsTop.classList.add('hidden');
        addBtn.classList.remove('hidden');
        genBtn.classList.remove('hidden');
        if (arrow) arrow.style.transform = 'rotate(0deg)';
        if (header) header.style.background = 'rgba(255,255,255,0.02)';
        
        // Deactivate test mode if active
        if (window.presetTestActive) {
            if (typeof window.testPreset === 'function') window.testPreset(false);
        }
    }
};

window.APP_VERSION = "56261042";


// --- CORE ROUTING (BULLETPROOF) ---
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    const profileId = urlParams.get('id');
    const path = window.location.pathname;
    const isSetup = path.includes('setup.html');
    const isProfile = path.includes('profile.html');

    const initializeRouting = () => {
        loadNodeIp();
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

function loadNodeIp() {
    const input = document.getElementById('dmx-node-ip-input');
    if (!input) return;
    fetch('/api/remote_settings')
        .then(r => r.ok ? r.json() : Promise.reject("Status " + r.status))
        .then(data => {
            const ip = data.master?.node_ip || "";
            const active = data.master?.node_active !== false; // Default true
            input.value = ip;
            input.dataset.active = active;
            updateNodeUiState(input, active);
        })
        .catch(e => console.warn("Failed to load node IP:", e));
}

function updateNodeUiState(input, active) {
    if (!input.value) {
        input.style.borderColor = "rgba(255,255,255,0.1)";
        input.style.background = "rgba(255,255,255,0.03)";
        input.style.boxShadow = "none";
        input.style.color = "var(--text-dim)";
        return;
    }
    if (active) {
        input.style.borderColor = "var(--accent)";
        input.style.background = "rgba(0, 242, 255, 0.05)";
        input.style.boxShadow = "0 0 10px rgba(0, 242, 255, 0.2)";
        input.style.color = "var(--accent)";
    } else {
        input.style.borderColor = "rgba(255,255,255,0.1)";
        input.style.background = "rgba(255,255,255,0.02)";
        input.style.boxShadow = "none";
        input.style.color = "rgba(255,255,255,0.3)";
    }
}

window.toggleNodeMode = function() {
    const input = document.getElementById('dmx-node-ip-input');
    if (!input || !input.value || !input.readOnly) return;
    
    const wasActive = input.dataset.active === 'true';
    const nowActive = !wasActive;
    input.dataset.active = nowActive;
    
    updateNodeUiState(input, nowActive);
    saveNodeIp(input.value, nowActive);
};

window.editNodeIp = function() {
    const input = document.getElementById('dmx-node-ip-input');
    if (!input) return;
    input.readOnly = false;
    input.style.background = "rgba(255,255,255,0.1)";
    input.style.color = "#fff";
    input.focus();
    input.select();
};

window.lockNodeIp = function() {
    const input = document.getElementById('dmx-node-ip-input');
    if (!input || input.readOnly) return;
    input.readOnly = true;
    const active = input.dataset.active === 'true';
    updateNodeUiState(input, active);
    saveNodeIp(input.value, active);
};

function saveNodeIp(nodeIp, active = true) {
    fetch('/api/remote_settings')
        .then(r => r.ok ? r.json() : Promise.reject("Status " + r.status))
        .then(data => {
            if (!data.master) data.master = {};
            data.master.node_ip = nodeIp;
            data.master.node_active = active;
            return fetch('/vj_remote_settings.json', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        })
        .then(() => {
            console.log("📡 Node settings saved:", nodeIp, active);
            fetch('/api/restart', { method: 'POST' }).catch(() => {});
        })
        .catch(e => console.error("Failed to save node IP:", e));
}

// --- 3. UI STATE MANAGEMENT & EVENT DELEGATION ---
// Following 00_architecture_router.md standards
/**
 * Normalizes preset data structures to ensure compatibility between UI and Engine.
 * Fixes "broken" references where fixture/target IDs might be inconsistent.
 */
function repairPresets() {
    if (!window.db.presets || !Array.isArray(window.db.presets)) return;
    
    console.log("🛠️ Repairing preset references...");
    let repairedCount = 0;

    window.db.presets.forEach(p => {
        // Repair Triggers
        if (p.triggers) {
            p.triggers.forEach(t => {
                if (t.type === 'channel') {
                    const fixId = t.fixture || t.target || t.id;
                    if (fixId && (!t.fixture || !t.target)) {
                        t.fixture = fixId;
                        t.target = fixId;
                        repairedCount++;
                    }
                    if (!t.role && t.name) {
                        t.role = t.name;
                        repairedCount++;
                    }
                }
            });
        }
        // Repair Overrides
        if (p.overrides) {
            p.overrides.forEach(o => {
                const fixId = o.fixture || o.target || o.id;
                if (fixId && (!o.fixture || !o.target)) {
                    o.fixture = fixId;
                    o.target = fixId;
                    o.id = fixId;
                    repairedCount++;
                }
                if (!o.role && o.name) {
                    o.role = o.name;
                    repairedCount++;
                }
            });
        }
    });

    if (repairedCount > 0) {
        console.log(`✅ Repaired ${repairedCount} field inconsistencies in presets.`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', (e) => {
        const target = e.target.closest('[data-target]');
        if (target) {
            const tabId = target.getAttribute('data-target');
            if (tabId) {
                if (typeof window.switchTab === 'function') {
                    window.switchTab(tabId);
                }
            }
        }
    });
});
