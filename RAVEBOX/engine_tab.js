        console.log("engine_tab.js loading...");

// --- BEHAVIOR LAB STATE (GLOBAL) ---
window.labRunning = false;
let labLastTick = Date.now();
let labBuffer = [];
let labChart = null;
let labAudioState = {
    vol: 0, bass: 0, mid: 0, high: 0, flux: 0, bpm: 120,
    bins: [0,0,0,0,0,0], beat: false, lastBeatAt: 0,
    beat_phase: 0, beat_count: 0
};
const LAB_FPS = 30;
let labState = {
    pos: 0, vel: 0, phase: 0, t: 0, 
    bucket: 0, step: 0, hold_active: false,
    last_beat: false, held_dmx: null, held_force: null
};

window.openBehaviorLab = function() {
    console.log("🔬 Opening Behavior Laboratory...");
    
    // Prevent multiple loops
    if (window.labRunning) {
        console.log("⚠️ Lab already running, skipping re-init.");
        return;
    }
    
    window.labRunning = true;
    labBuffer = []; // Reset buffer
    
    if (labChart) {
        labChart.destroy();
        labChart = null;
    }
    
    if (typeof initLabChart === 'function') initLabChart();
    if (typeof resetLab === 'function') resetLab();
    
    labLastTick = Date.now();
    requestAnimationFrame(labLoop);
};


        
function initEngineTab() {
    if (!window.RAVEBOX_READY) {
        setTimeout(initEngineTab, 50);
        return;
    }
    if (typeof initLabSelects === 'function') initLabSelects();
}
initEngineTab();

// --- LIVE BEHAVIOR LABORATORY (DIAGNOSTIC VISUALIZATION) ---

        // Simple 1D Noise for Laboratory Simulation
        const _noise_state = { last_t: 0, v0: Math.random(), v1: Math.random() };
        function _labNoise(t) {
            const i = Math.floor(t);
            const f = t - i;
            const u = f * f * f * (f * (f * 6 - 15) + 10);
            if (i !== Math.floor(_noise_state.last_t)) {
                _noise_state.v0 = _noise_state.v1;
                _noise_state.v1 = Math.random();
            }
            _noise_state.last_t = t;
            return _noise_state.v0 + (_noise_state.v1 - _noise_state.v0) * u;
        }

        function calculateRuleSimulation(dt, st, rule, audio) {
            if (isNaN(dt)) dt = 0.033;
            
            const behavior = (rule.behavior || 'static').toLowerCase();
            const source = (rule.source || 'volume').toLowerCase();
            
            const c_min = parseInt(rule.cal?.min ?? rule.min ?? 0) || 0;
            const c_max = parseInt(rule.cal?.max ?? rule.max ?? 255) || 255;
            
            // Fixed operator precedence for center calculation
            let c_center = 127;
            if (rule.cal?.center !== undefined) c_center = parseInt(rule.cal.center);
            else if (rule.rel_center !== undefined) c_center = Math.round(c_min + (rule.rel_center * (c_max - c_min)));
            else if (rule.center !== undefined) c_center = parseInt(rule.center);
            
            if (isNaN(c_center)) c_center = 127;

            const range_span = c_max - c_min;
            const scale_factor = range_span > 0 ? (range_span / 255.0) : 1.0;

            // Support both flat and nested (modifiers) formats with strict NaN protection
            const speed = (parseFloat(rule.modifiers?.speed ?? rule.speed ?? 0.5) || 0) * scale_factor;
            const react = (parseFloat(rule.modifiers?.react ?? rule.react ?? 0.8) || 0) * scale_factor;
            const hold_type = (rule.modifiers?.hold_type ?? rule.hold_type ?? 'none').toLowerCase();

            // 1. Resolve Driver Magnitude (E)
            let E = 0;
            if (source === 'volume') E = audio.vol || 0;
            else if (source === 'bass') E = audio.bass || 0;
            else if (source === 'mids') E = audio.mid || 0;
            else if (source === 'highs') E = audio.high || 0;
            else if (source === 'spectral flux' || source === 'impact') E = audio.flux || 0;
            else if (source === 'beat phase') E = audio.beat_phase || 0;
            else if (source.startsWith('bin ')) {
                const idx = parseInt(source.split(' ')[1]);
                E = (audio.bins && audio.bins[idx] !== undefined) ? audio.bins[idx] : 0;
            } else if (source === 'kick') E = audio.kick || 0;
            else if (source === 'snare') E = audio.snare || 0;
            else if (source === 'cymbal') E = audio.cymbal || 0;
            else if (source === 'beat') {
                if (st.beat_env === undefined) st.beat_env = 0.0;
                if (audio.beat) {
                    st.beat_env = 1.0;
                }
                const decayRate = 1.0 + (speed * 20.0);
                st.beat_env = Math.max(0, st.beat_env - dt * decayRate * st.beat_env);
                E = st.beat_env;
            } else if (source === 'static') E = 1.0;
            
            if (isNaN(E)) E = 0;

            // 2. Hold Logic
            let trigger_hold = false;
            if (hold_type === 'beat' && audio.beat) trigger_hold = true;
            else if (hold_type === 'bar' && audio.beat && audio.beat_count % 4 === 0) trigger_hold = true;

            if (trigger_hold) {
                st.hold_active = true;
                delete st.held_dmx;
            } else if (hold_type === 'none') {
                st.hold_active = false;
            }

            // 3. Behavior Logic (Normalized -1 to 1)
            let y = 0;
            if (behavior === 'static') {
                return rule.value !== undefined ? rule.value : c_center;
            } else if (behavior === 'direct') {
                y = (E * react * 2.0) - 1.0;
            } else if (['sine', 'saw', 'square'].includes(behavior)) {
                const freq = (speed * 0.1) + (E * 5.0 * react);
                st.phase = (st.phase + dt * freq) % 1.0;
                const p = st.phase;
                if (behavior === 'sine') y = react * Math.sin(p * 2 * Math.PI);
                else if (behavior === 'saw') y = react * ((p * 2.0) - 1.0);
                else if (behavior === 'square') y = p < 0.5 ? react : -react;
            } else if (behavior === 'noise') {
                st.t += dt * (speed * 0.5 + E * react * 2.0);
                y = (_labNoise(st.t) * 2.0) - 1.0;
            } else if (behavior === 'stochastic') {
                if (trigger_hold || !st.hold_active) st._rand = (Math.random() * 2.0) - 1.0;
                y = st._rand || 0;
            } else if (behavior === 'spike') {
                if (st.spike_val === undefined) st.spike_val = 0;
                const threshold = (1.0 - react) * 0.35;
                if (E > (st.last_E || 0) + threshold) st.spike_val = E;
                st.spike_val *= Math.max(0.0, 1.0 - dt * speed * 1.2);
                st.last_E = E;
                y = (st.spike_val * 2.0) - 1.0;
            } else if (behavior === 'hum') {
                st.t += dt * speed * 2.5;
                const osc = Math.sin(st.t) * react * 0.2;
                y = ((E + osc) * 2.0) - 1.0;
            } else if (behavior === 'fuzzy') {
                st.t += dt * speed * 1.8;
                const noise = (_labNoise(st.t) * 2.0 - 1.0) * react * 0.25;
                y = ((E + noise) * 2.0) - 1.0;
            } else if (behavior === 'direct_stepped') {
                const steps = 8;
                y = (Math.floor(E * steps) / steps * 2.0) - 1.0;
            } else if (behavior === 'beat phase') {
                y = (audio.beat_phase * 2.0 * E) - 1.0;
            } else if (behavior === 'bar phase') {
                const p = ((audio.beat_count % 4) + audio.beat_phase) / 4.0;
                y = (p * 2.0 * E) - 1.0;
            }

            // 4. Map to DMX
            let final_dmx = 0;
            if (y >= 0) final_dmx = c_center + (y * (c_max - c_center));
            else final_dmx = c_center + (y * (c_center - c_min));

            if (st.hold_active) {
                if (st.held_dmx === undefined) st.held_dmx = final_dmx;
                return st.held_dmx;
            }
            return final_dmx;
        }

        window.parseBinaryState = function(buffer) {
            const dv = new DataView(buffer);
            
            // Layout (Total 599 bytes): m_time(f32), flux..bpm(6x f32), beat_phase(f32), bins(6x f32), beat..pad(4x u8), axis..
            labAudioState.flux = dv.getFloat32(4, true);
            labAudioState.bass = dv.getFloat32(8, true);
            labAudioState.mid = dv.getFloat32(12, true);
            labAudioState.high = dv.getFloat32(16, true);
            labAudioState.vol = dv.getFloat32(20, true);
            labAudioState.bpm = dv.getFloat32(24, true);
            labAudioState.beat_phase = dv.getFloat32(28, true);
            
            labAudioState.bins = [];
            for (let i = 0; i < 6; i++) labAudioState.bins.push(dv.getFloat32(32 + i * 4, true));

            if (dv.byteLength >= 635) {
                labAudioState.kick = dv.getFloat32(623, true);
                labAudioState.snare = dv.getFloat32(627, true);
                labAudioState.cymbal = dv.getFloat32(631, true);
            }

            const beat = dv.getUint8(56) === 1;
            if (beat && !labAudioState._lastBeat) {
                labAudioState.lastBeatAt = Date.now();
                labAudioState.beat_count++;
            }
            labAudioState._lastBeat = beat;
            labAudioState.beat = beat;

            // Debug Heartbeat for Lab Data
            if (!window._labDebugCounter) window._labDebugCounter = 0;
            window._labDebugCounter++;
            if (window._labDebugCounter % 60 === 0) {
                console.log("📈 Lab Data Heartbeat:", { vol: labAudioState.vol.toFixed(3), bins: labAudioState.bins.map(b => b.toFixed(2)) });
            }
        }



        function resetLab() {
            labBuffer = [];
            labState = {
                pos: 0, vel: 0, phase: 0, t: 0, 
                bucket: 0, step: 0, hold_active: false,
                last_beat: false, held_dmx: null, held_force: null
            };
            const id = document.getElementById('labBehaviorSelect').value;
            const d = window.EASY_DESCRIPTORS.find(x => x.id === id);
            if (d) {
                // Set dropdown values
                const srcSelect = document.getElementById('labSourceSelect');
                const behSelect = document.getElementById('labBehaviorSelectSpecific');
                const holdSelect = document.getElementById('labHoldSelect');
                
                if (srcSelect && d.source) srcSelect.value = d.source;
                if (behSelect && d.behavior) behSelect.value = d.behavior;
                if (holdSelect) {
                    holdSelect.value = (d.modifiers ? d.modifiers.hold_type : d.hold_type) || 'none';
                }

                // Sync sliders
                const sSlider = document.getElementById('labSpeed');
                const rSlider = document.getElementById('labReact');
                if (sSlider) {
                    sSlider.value = d.modifiers ? d.modifiers.speed : (d.speed || 0.5);
                    document.getElementById('labSpeedVal').textContent = parseFloat(sSlider.value).toFixed(2);
                }
                if (rSlider) {
                    rSlider.value = d.modifiers ? d.modifiers.react : (d.react || 0.8);
                    document.getElementById('labReactVal').textContent = parseFloat(rSlider.value).toFixed(2);
                }

                // Special case for Static Value
                if (d.behavior === 'static' && d.value !== undefined) {
                    document.getElementById('labCenter').value = d.value;
                }

                // Sync UI Center to Relative Midpoint
                if (d.rel_center !== undefined) {
                    const c_min = parseInt(document.getElementById('labMin').value) || 0;
                    const c_max = parseInt(document.getElementById('labMax').value) || 255;
                    const c_center = Math.round(c_min + (d.rel_center * (c_max - c_min)));
                    const centerInput = document.getElementById('labCenter');
                    if (centerInput) centerInput.value = c_center;
                }

                // Clear the chart but keep labels
                if (labChart) {
                    labChart.data.datasets[0].data = [];
                    labChart.update('none');
                }
            }
            syncLabProbe();
        }

        function initLabChart() {
            if (labChart) labChart.destroy();
            const ctx = document.getElementById('behaviorChart').getContext('2d');
            
            // Set chart point count (5 seconds @ 30fps)
            const count = 30 * 5;
            const emptyData = Array(count).fill(null);
            
            labChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: Array(count).fill(''),
                    datasets: [{
                        label: 'DMX Signal (0-255)',
                        data: emptyData,
                        borderColor: '#00f2ff',
                        borderWidth: 2,
                        fill: true,
                        backgroundColor: function(context) {
                            const chart = context.chart;
                            const {ctx, chartArea} = chart;
                            if (!chartArea) return null;
                            const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                            gradient.addColorStop(0, 'rgba(0, 242, 255, 0)');
                            gradient.addColorStop(1, 'rgba(0, 242, 255, 0.2)');
                            return gradient;
                        },
                        tension: 0.2, // Smooth interpolation
                        pointRadius: 0
                    },
                    {
                        label: 'Max',
                        data: Array(count).fill(255),
                        borderColor: 'rgba(255, 50, 50, 0.4)',
                        borderWidth: 1,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0
                    },
                    {
                        label: 'Min',
                        data: Array(count).fill(0),
                        borderColor: 'rgba(255, 50, 50, 0.4)',
                        borderWidth: 1,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0
                    },
                    {
                        label: 'Mid',
                        data: Array(count).fill(127),
                        borderColor: 'rgba(255, 255, 255, 0.2)',
                        borderWidth: 1,
                        borderDash: [2, 2],
                        fill: false,
                        pointRadius: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    scales: {
                        y: { 
                            min: 0, max: 255, 
                            grid: { color: 'rgba(255,255,255,0.05)' }, 
                            ticks: { 
                                stepSize: 64, color: '#666',
                                font: { size: 10 }
                            } 
                        },
                        x: { display: false }
                    },
                    plugins: { 
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
        }

        function labLoop() {
            if (!window.labRunning) return;
            
            const now = Date.now();
            const dt = (now - labLastTick) / 1000;
            labLastTick = now;

            // 1. Calculate Local Probe Value (The Logic Simulation)
            let val = 0;
            try {
                const id = document.getElementById('labBehaviorSelect').value;
                const rule = {
                    behavior: document.getElementById('labBehaviorSelectSpecific').value,
                    source: document.getElementById('labSourceSelect').value,
                    modifiers: {
                        speed: parseFloat(document.getElementById('labSpeed').value),
                        react: parseFloat(document.getElementById('labReact').value),
                        hold_type: document.getElementById('labHoldSelect').value
                    },
                    cal: {
                        min: parseInt(document.getElementById('labMin').value) || 0,
                        center: parseInt(document.getElementById('labCenter').value) || 127,
                        max: parseInt(document.getElementById('labMax').value) || 255
                    }
                };
                val = calculateRuleSimulation(dt, labState, rule, labAudioState);
                
                // Update Energy Indicator
                const energyStatus = document.getElementById('labEnergyStatus');
                if (energyStatus) {
                    const e_pct = Math.round((labAudioState.vol || 0) * 100);
                    energyStatus.textContent = `SIGNAL: ${e_pct}%`;
                    energyStatus.style.color = e_pct > 5 ? 'var(--accent)' : '#666';
                }
            } catch(e) { 
                console.warn("Lab Simulation Error:", e);
                val = window.latestProbeValue || 0; 
            }

            labBuffer.push(val);
            if (labBuffer.length > (30 * 5)) labBuffer.shift();
            
            if (labChart) {
                labChart.data.datasets[0].data = labBuffer;
                
                // Update reference lines
                const c_min = parseInt(document.getElementById('labMin')?.value) || 0;
                const c_max = parseInt(document.getElementById('labMax')?.value) || 255;
                const c_center = parseInt(document.getElementById('labCenter')?.value) || 127;
                
                if (labChart.data.datasets[1]) labChart.data.datasets[1].data = Array(labBuffer.length).fill(c_max);
                if (labChart.data.datasets[2]) labChart.data.datasets[2].data = Array(labBuffer.length).fill(c_min);
                if (labChart.data.datasets[3]) labChart.data.datasets[3].data = Array(labBuffer.length).fill(c_center);
                
                labChart.update('none');
                
                // Final Diagnostic: If we have data but no line, it's a Chart.js issue
                if (!window._labLoopCount) window._labLoopCount = 0;
                window._labLoopCount++;
                if (window._labLoopCount % 90 === 0) {
                    console.log(`📊 Lab Rendering Check: ${labBuffer.length} points | Latest: ${Math.round(val)}`);
                }
            }
            requestAnimationFrame(labLoop);
        }

        function syncLabProbe() {
            if (!window.ws || window.ws.readyState !== WebSocket.OPEN) return;

            const id = document.getElementById('labBehaviorSelect').value;
            const premade = window.EASY_DESCRIPTORS.find(x => x.id === id) || { modifiers: {} };
            
            const rule = {
                easy_id: id,
                behavior: document.getElementById('labBehaviorSelectSpecific').value,
                source: document.getElementById('labSourceSelect').value,
                modifiers: {
                    speed: parseFloat(document.getElementById('labSpeed').value),
                    react: parseFloat(document.getElementById('labReact').value),
                    hold_type: document.getElementById('labHoldSelect').value
                },
                cal: {
                    min: parseInt(document.getElementById('labMin').value) || 0,
                    center: parseInt(document.getElementById('labCenter').value) || 127,
                    max: parseInt(document.getElementById('labMax').value) || 255
                }
            };

            window.ws.send(JSON.stringify({ type: 'set_lab_rule', rule: rule }));
        }

        async function addNewBehaviorFromLab() {
            const label = prompt("Enter a label for this new behavior:", "Custom Laboratory Flow");
            if (!label) return;

            const id = document.getElementById('labBehaviorSelect').value;
            const premade = window.EASY_DESCRIPTORS.find(x => x.id === id) || { modifiers: {} };

            const c_min_now = parseInt(document.getElementById('labMin').value) || 0;
            const c_max_now = parseInt(document.getElementById('labMax').value) || 255;
            const c_center_now = parseInt(document.getElementById('labCenter').value) || 127;
            const rel_center = (c_center_now - c_min_now) / Math.max(1, (c_max_now - c_min_now));

            const payload = {
                label: label,
                source: document.getElementById('labSourceSelect').value,
                behavior: document.getElementById('labBehaviorSelectSpecific').value,
                speed: parseFloat(document.getElementById('labSpeed').value),
                react: parseFloat(document.getElementById('labReact').value),
                hold_type: document.getElementById('labHoldSelect').value,
                rel_center: parseFloat(rel_center.toFixed(3))
            };

            try {
                const res = await fetch(`${window.API_BASE_ROOT}/api/descriptors`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await res.json();
                if (data.status === 'ok') {
                    if (window.EASY_DESCRIPTORS) window.EASY_DESCRIPTORS.push(data.descriptor);
                    populateLabSelects();
                    document.getElementById('labBehaviorSelect').value = data.descriptor.id;
                    alert(`Saved "${label}" to library!`);
                }
            } catch (e) {
                alert("Failed to save behavior.");
            }
        }

        async function saveLabAsDefault() {
            const id = document.getElementById('labBehaviorSelect').value;
            const premade = window.EASY_DESCRIPTORS.find(x => x.id === id);
            if (!premade) return;

            const btn = event.currentTarget;
            const originalText = btn.innerHTML;
            btn.innerHTML = "Saving...";
            btn.disabled = true;

            const c_min_now = parseInt(document.getElementById('labMin').value) || 0;
            const c_max_now = parseInt(document.getElementById('labMax').value) || 255;
            const c_center_now = parseInt(document.getElementById('labCenter').value) || 127;
            const rel_center = (c_center_now - c_min_now) / Math.max(1, (c_max_now - c_min_now));

            const updatedData = {
                id: id,
                label: premade.label,
                source: document.getElementById('labSourceSelect').value,
                behavior: document.getElementById('labBehaviorSelectSpecific').value,
                speed: parseFloat(document.getElementById('labSpeed').value),
                react: parseFloat(document.getElementById('labReact').value),
                hold_type: document.getElementById('labHoldSelect').value,
                rel_center: parseFloat(rel_center.toFixed(3))
            };

            try {
                const response = await fetch(`${window.API_BASE_ROOT}/api/descriptors/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedData)
                });

                if (response.ok) {
                    btn.innerHTML = "SAVED";
                    btn.style.background = "var(--success)";
                    Object.assign(premade, updatedData);
                    syncLabProbe();
                } else {
                    btn.innerHTML = "ERROR";
                }
            } catch (e) {
                console.error(e);
                btn.innerHTML = "FAILED";
            } finally {
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    btn.style.background = "";
                }, 2000);
            }
        }

        function populateLabSelects() {
            const labSelect = document.getElementById('labBehaviorSelect');
            const srcSelect = document.getElementById('labSourceSelect');
            const behSelect = document.getElementById('labBehaviorSelectSpecific');
            const holdSelect = document.getElementById('labHoldSelect');
            
            if (labSelect && window.EASY_DESCRIPTORS) {
                labSelect.innerHTML = window.EASY_DESCRIPTORS.map(d => `<option value="${d.id}">${d.label}</option>`).join('');
            }
            if (srcSelect && window.SOURCES) {
                srcSelect.innerHTML = window.SOURCES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
            }
            if (behSelect && window.BEHAVIORS) {
                behSelect.innerHTML = window.BEHAVIORS.map(b => `<option value="${b.id}">${b.label}</option>`).join('');
            }
            if (holdSelect && window.HOLD_TYPES) {
                holdSelect.innerHTML = window.HOLD_TYPES.map(h => `<option value="${h.id}">${h.label.toUpperCase()}</option>`).join('');
            }
        }

        // Initialize selects on script load (or when window.SOURCES is ready)
        function initLabSelects() {
            if (window.SOURCES && window.BEHAVIORS && window.EASY_DESCRIPTORS) {
                populateLabSelects();
            } else {
                setTimeout(initLabSelects, 100);
            }
        }
        // boot() handles this now
        // initLabSelects();



    

