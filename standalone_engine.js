// standalone_engine.js
window.isStandaloneMode = true;
window.latestAudioState = window.latestAudioState || { vol: 0, bins: [0,0,0,0,0,0], vibe: 'mid', transient: 'steady', beat: false };
window.latestDmxUniverse = new Uint8Array(513);

let audioContext, analyser, dataArray;
let prevEnergy = 0;
let baseIdx = 0;
let fxIdx = 0;
let lastCycleTime = Date.now();

// --- MOCK WEBSOCKET SYSTEM ---
const mockSockets = new Set();
class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 0; // CONNECTING
        this.binaryType = 'blob';
        mockSockets.add(this);
        setTimeout(() => {
            this.readyState = 1; // OPEN
            if (this.onopen) this.onopen();
        }, 50);
    }
    send(data) { console.debug("MockWS Send:", data); }
    close() { mockSockets.delete(this); this.readyState = 3; }
}
window.MockWebSocket = MockWebSocket;

function broadcastToMocks(data) {
    mockSockets.forEach(ws => {
        if (ws.onmessage) ws.onmessage({ data });
    });
}

// --- MOCK API (Fetch Interceptor) ---
const originalFetch = window.fetch;
window.fetch = async function(url, options) {
    const urlStr = url.toString();
    if (urlStr.includes('/api/images/list')) {
        return new Response(JSON.stringify([
            { file: 'demo_bg_1.jpg', name: 'demo_bg_1.jpg', mtime: Date.now() }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/api/usergen2/list') || urlStr.includes('/api/usergen/list')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // Fallback for real assets if they exist, or just return mock 200 for things we don't care about
    if (urlStr.endsWith('.jpg') || urlStr.endsWith('.png')) {
        // Return a transparent pixel or similar if file not found? 
        // For a demo, the user might want to see SOMETHING.
        // But for now, just let it fail or return original if it's a relative path.
    }
    return originalFetch.apply(this, arguments);
};

async function startStandaloneEngine() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        const btn = document.getElementById('standalone-btn');
        if (btn) btn.style.display = 'none';

        requestAnimationFrame(standaloneLoop);
        console.log("🎤 Standalone Engine Active");
    } catch (err) {
        console.error("Audio access denied.", err);
        alert("Microphone access is required for the standalone demo.");
    }
}

function standaloneLoop() {
    analyser.getByteFrequencyData(dataArray);
    
    let bins = [0, 0, 0, 0, 0, 0];
    // Group FFT into 6 bins for the visualizer
    for (let i = 0; i < 4; i++) bins[0] += dataArray[i]; // Sub
    for (let i = 4; i < 12; i++) bins[1] += dataArray[i]; // Bass
    for (let i = 12; i < 30; i++) bins[2] += dataArray[i]; // Low-Mid
    for (let i = 30; i < 60; i++) bins[3] += dataArray[i]; // Mid
    for (let i = 60; i < 100; i++) bins[4] += dataArray[i]; // High-Mid
    for (let i = 100; i < 128; i++) bins[5] += dataArray[i]; // High

    bins = bins.map((v, i) => {
        const counts = [4, 8, 18, 30, 40, 28];
        return (v / (counts[i] * 255));
    });

    const currentEnergy = (bins[0] * 0.4) + (bins[1] * 0.3) + (bins[2] * 0.3);
    const flux = Math.max(0, currentEnergy - prevEnergy);
    prevEnergy = currentEnergy;
    const isBeat = flux > 0.12;

    // Update global state
    window.latestAudioState.vol = currentEnergy;
    window.latestAudioState.bins = bins;
    window.latestAudioState.flux = flux;
    window.latestAudioState.beat = isBeat;
    window.latestAudioState.vibe = currentEnergy > 0.6 ? 'high' : (currentEnergy > 0.3 ? 'mid' : 'chill');
    window.latestAudioState.transient = isBeat ? 'dropping' : (flux > 0.05 ? 'building' : 'steady');

    // Auto-Cycle Logic (Every 15 seconds)
    if (Date.now() - lastCycleTime > 15000) {
        baseIdx++;
        fxIdx = Math.floor(Math.random() * 10);
        lastCycleTime = Date.now();
        console.log("🔄 Auto-Cycling Shaders:", { baseIdx, fxIdx });
    }

    // BROADCAST BINARY PACKET (SPOOFED)
    // Structure: [0..3: magic?] [4..7: flux] [8..11: bass] [12..15: mid?] [16..19: high] [20..23: vol] ... [76..77: baseIdx] [78..79: fxIdx] [82..end: DMX]
    const buffer = new ArrayBuffer(82 + 513);
    const view = new DataView(buffer);
    view.setFloat32(4, flux, true);
    view.setFloat32(8, bins[1], true);
    view.setFloat32(16, bins[5], true);
    view.setFloat32(20, currentEnergy, true);
    view.setUint16(76, baseIdx, true);
    view.setUint16(78, fxIdx, true);
    // Fill DMX part (optional, but keep it for consistency)
    for (let i = 0; i < 513; i++) view.setUint8(82 + i, window.latestDmxUniverse[i]);

    broadcastToMocks(buffer);

    // Also broadcast State JSON occasionally or on change
    if (isBeat) {
        broadcastToMocks(JSON.stringify({
            type: 'state',
            vibe: window.latestAudioState.vibe,
            transient: window.latestAudioState.transient,
            beat: true
        }));
    }

    requestAnimationFrame(standaloneLoop);
}
