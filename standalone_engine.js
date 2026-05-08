// standalone_engine.js
window.isStandaloneMode = true;
window.latestAudioState = window.latestAudioState || { vol: 0, bins: [0,0,0,0,0,0], vibe: 'mid', transient: 'steady', beat: false };
window.latestDmxUniverse = new Uint8Array(513);

let audioContext, analyser, dataArray;
let prevEnergy = 0;
let baseIdx = 0;
let fxIdx = 0;
let lastCycleTime = Date.now();
let integratedTime = 0;
let lastFrameTime = 0;

// Reference to the iframe window for broadcasting
let iframeWindow = null;

function registerIframeWindow(win) {
    iframeWindow = win;
    console.log("🔗 Iframe window registered for standalone broadcasting");
}




function broadcastToIframe(data) {
    try {
        const frame = document.getElementById('viz-frame');
        if (frame && frame.contentWindow && frame.contentWindow._broadcastToMocks) {
            frame.contentWindow._broadcastToMocks(data);
        }
    } catch (e) {
        // Cross-origin or iframe not ready
    }
}

async function startStandaloneEngine() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Mobile browsers start AudioContext in "suspended" state.
        // Must resume during a user gesture or analyser returns all zeros.
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        const source = audioContext.createMediaStreamSource(stream);

        // Boost mic input — mobile devices often deliver very low levels
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 2.5;
        source.connect(gainNode);
        gainNode.connect(analyser);

        dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        const btn = document.getElementById('standalone-btn');
        if (btn) btn.style.display = 'none';

        lastFrameTime = performance.now() / 1000;
        requestAnimationFrame(standaloneLoop);
        console.log("🎤 Standalone Engine Active — AudioContext state:", audioContext.state);
    } catch (err) {
        console.error("Audio access denied.", err);
        alert("Microphone access is required for the standalone demo.");
    }
}

function standaloneLoop() {
    analyser.getByteFrequencyData(dataArray);
    
    const now = performance.now() / 1000;
    const dt = now - lastFrameTime;
    lastFrameTime = now;

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

    // Integrate mTime: base speed + audio modulation (matches backend effSpeed=0.6 default)
    const effSpeed = 0.6;
    integratedTime += dt * effSpeed * (1.0 + flux * 2.0 + bins[1] * 0.5);

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

    // BROADCAST BINARY PACKET
    // Layout matches backend pack_binary_state():
    // [0..3]:   mTime (float32)        — integrated audio-modulated time
    // [4..7]:   flux (float32)         — energy flux
    // [8..11]:  bass (float32)         — bass energy
    // [12..15]: mid (float32)          — mid frequency energy
    // [16..19]: high (float32)         — high frequency energy
    // [20..23]: vol (float32)          — overall volume
    // [24..27]: bpm (float32)          — estimated BPM
    // [28..31]: beat_phase (float32)   — 0.0-1.0 sawtooth
    // [32..55]: bins[0..5] (6x float32) — 6-band EQ
    // [56]:     beat (uint8)           — beat flag
    // [59]:     eff_intensity (uint8)  — master intensity (0-255)
    // [80..81]: baseIdx (uint16)       — shader cycle index
    // [82..83]: fxIdx (uint16)         — fx index
    // [86..end]: DMX universe (513 bytes)
    const buffer = new ArrayBuffer(86 + 513);
    const view = new DataView(buffer);

    // Offset 0: mTime — integrated time for u_clock sync
    view.setFloat32(0, integratedTime, true);

    // Offset 4: flux
    view.setFloat32(4, flux, true);

    // Offset 8: bass
    view.setFloat32(8, bins[1], true);

    // Offset 12: mid
    view.setFloat32(12, bins[3], true);

    // Offset 16: high
    view.setFloat32(16, bins[5], true);

    // Offset 20: vol (overall energy)
    view.setFloat32(20, currentEnergy, true);

    // Offset 24: estimated BPM (simple fixed estimate for standalone)
    view.setFloat32(24, 120.0, true);

    // Offset 28: beat_phase (0.0 to 1.0 ramp, approx 120bpm)
    const beatPhase = (Date.now() % 500) / 500.0;
    view.setFloat32(28, beatPhase, true);

    // Offset 32-55: 6-band EQ bins
    for (let i = 0; i < 6; i++) {
        view.setFloat32(32 + (i * 4), bins[i], true);
    }

    // Offset 56: beat flag
    view.setUint8(56, isBeat ? 1 : 0);

    // Offset 59: eff_intensity — full brightness in standalone mode
    view.setUint8(59, 255);

    // Offset 80-83: shader indices
    view.setUint16(80, baseIdx, true);
    view.setUint16(82, fxIdx, true);

    // Fill DMX part
    for (let i = 0; i < 513; i++) view.setUint8(86 + i, window.latestDmxUniverse[i]);

    broadcastToIframe(buffer);

    // Broadcast State JSON periodically for vibe/commands sync
    if (isBeat) {
        broadcastToIframe(JSON.stringify({
            type: 'state',
            vibe: window.latestAudioState.vibe,
            transient: window.latestAudioState.transient,
            beat: true,
            eff_speed: effSpeed,
            eff_intensity: 1.0,
            visual_commands: []
        }));
    }

    requestAnimationFrame(standaloneLoop);
}
