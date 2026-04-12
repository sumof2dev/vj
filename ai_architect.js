// --- SAFETY GLOBALS ---
var db = window.db || { profiles: [], stage: [], presets: [], liveConsole: [], savedConsoles: [] };
var activeProfileId = window.activeProfileId || null;
var currentProfileChannels = window.currentProfileChannels || [];
var currentProfileMappings = window.currentProfileMappings || [];
var collapsedChannels = window.collapsedChannels || new Set();
var pendingAiInstructions = window.pendingAiInstructions || {};
var aiConversationHistory = window.aiConversationHistory || [];
var isProcessingAi = window.isProcessingAi || false;
var getUniqueProfiles = window.getUniqueProfiles || function() { return []; };
var refreshUI = window.refreshUI || function() { };
var saveDB = window.saveDB || function() { };

// --- AI TUNING LOGIC ---
        function toggleAiComment(chIdx, ruleIdx = null) {
            const id = ruleIdx === null ? chIdx : `${chIdx}_${ruleIdx}`;
            const box = document.getElementById(`ai-comment-${id}`);
            if (box) {
                box.classList.toggle('active');
                if (box.classList.contains('active')) {
                    box.querySelector('textarea').focus();
                }
            }
        }

        function updateAiInstruction(id, val) {
            if (val.trim()) {
                pendingAiInstructions[id] = val;
            } else {
                delete pendingAiInstructions[id];
            }
            updateAiReviewBar();
        }

        function updateAiReviewBar() {
            const count = Object.keys(pendingAiInstructions).length;
            const bar = document.getElementById('ai-review-bar');
            const countLabel = document.getElementById('ai-pending-count');

            if (count > 0) {
                bar.classList.add('active');
                countLabel.innerText = `${count} pending instruction${count > 1 ? 's' : ''}`;
            } else {
                bar.classList.remove('active');
            }
        }

        function clearAiInstructions() {
            if (!confirm("Clear all AI instructions?")) return;
            pendingAiInstructions = {};
            loadProfileChannels();
            updateAiReviewBar();
        }

        async function processBatchAiInstructions() {
            // CHECK FOR LOCAL B-SIDE OVERRIDE (No API required)
            const globalInstr = (pendingAiInstructions["global_instruction"] || "").toUpperCase();
            if (globalInstr.includes("LOCAL_BSIDE") || globalInstr.includes("[LOCAL_BSIDE]")) {
                applyInstantTransformation('bside');
                isProcessingAi = false;
                const btn = document.getElementById('ai-process-btn');
                if (btn) {
                    btn.innerText = "📝 Process AI";
                    btn.disabled = false;
                }
                const loadingContainer = document.getElementById('ai-loading-container');
                if (loadingContainer) loadingContainer.style.display = 'none';
                if (window.aiProgressInterval) clearInterval(window.aiProgressInterval);
                pendingAiInstructions = {};
                updateAiReviewBar();
                return;
            }

            const apiKey = localStorage.getItem('vj_gemini_api_key');
            if (!apiKey) {
                alert("Gemini API Key missing! Set it in AI settings.");
                openAiSettings();
                return;
            }

            const fixEl = document.getElementById('prof-base-fixture');
            const fixId = fixEl ? fixEl.value : null;
            const fixtureChannels = currentProfileChannels;
            const btn = document.getElementById('ai-process-btn');

            if (isProcessingAi) return;

            isProcessingAi = true;
            if (btn) {
                btn.innerText = "📝 Processing...";
                btn.disabled = true;
            }

            const loadingContainer = document.getElementById('ai-loading-container');
            const loadingBar = document.getElementById('ai-loading-bar');
            const loadingText = document.getElementById('ai-loading-text');
            const diffBtn = document.getElementById('ai-view-diff-btn');

            // SNAPSHOT FOR DIFF
            window.preAiMappings = JSON.parse(JSON.stringify(currentProfileMappings));

            if (loadingContainer) {
                loadingContainer.style.display = 'block';
                if (diffBtn) diffBtn.style.display = 'none';
                loadingBar.style.width = '10%';
                loadingBar.style.background = 'var(--accent)';
                loadingText.innerText = 'Consulting Architect...';
                loadingText.style.color = 'var(--accent)';

                let progress = 10;
                window.aiProgressInterval = setInterval(() => {
                    progress += (95 - progress) * 0.15;
                    loadingBar.style.width = progress + '%';
                }, 500);
            }

            // ADD THINKING BUBBLE
            const chatHistory = document.getElementById('ai-chat-history');
            const thinkingId = 'thinking-' + Date.now();
            if (chatHistory) {
                const bubble = document.createElement('div');
                bubble.id = thinkingId;
                bubble.className = 'chat-bubble thinking';
                bubble.innerHTML = `<span>Thinking</span> <div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div>`;
                chatHistory.appendChild(bubble);
                const body = document.querySelector('.ai-modal-body.chat-body');
                if (body) body.scrollTop = body.scrollHeight;
            }

            // DISABLE UI
            const masterInput = document.getElementById('ai-master-textarea');
            const sendBtn = document.getElementById('ai-chat-send-btn');
            if (masterInput) masterInput.disabled = true;
            if (sendBtn) sendBtn.disabled = true;

            const systemPrompt = `Role: Expert Stage Lighting Designer for RaveBox.
Task: Update a behavior profile based on specific user feedback for channels and rules.
Context: 
- Input: Current Mappings (2D array) and a Map of Instructions.
- Available Sources: vol, bass, mid, high, flux, beat, bar, impact, bin_0, bin_1, bin_2, bin_3, bin_4, bin_5.
- Available Behaviors: static, push, pull, sine, saw, square, noise, random, step.
- Available Hold Types: none, floorfreeze, peakpause, beat, bar.

SCHEMA RULES:
1. MODIFIERS: All timing and sensitivity settings MUST live inside the "modifiers" object:
   - "speed": 0.0 to 1.0 (frequency of movement)
   - "react": 0.0 to 1.0 (audio sensitivity/smoothing)
   - "hold_type": one of the Available Hold Types above.
2. SOURCE: Frequency bins bin_0 (Sub) through bin_5 (Treble) are available for targeted reactivity.
3. RANGE PRESERVATION: Keep changes within the 'cal' object bounds (min/center/max) unless explicitly asked to expand them.
4. PHYSICAL GUARDRAIL: Never alter 'cal.min' or 'cal.max' unless requested, as these control hardware macros.
5. NO STATIC FOR RANGES: Never use behavior 'static' if min != max. Use 'sine' or 'step' instead.
6. CLEANUP: Do NOT include legacy keys like "lfo", "audio", or "bin_idx" at the root level of a rule.

THE PLAYBOOK (Style Macros):
- "B-Side": Shift bin sources (e.g. bin_0 -> bin_1). Invert movement directions. Swap speeds between related axes (Pan/Tilt).
- "Rhythm": Use 'square' or 'saw' behaviors. Set source to 'impact' or 'beat'. Set 'react' to 1.0 (high sensitivity) and 'speed' to 0.8+. 
- "Liquid": Use 'sine' or 'noise' behaviors. Set source to 'flux' or 'vol'. Set 'react' to 0.2 (high smoothing) and 'speed' to 0.1-.

Output: Return a JSON object with "logic_explanation" (compact summary of what you did) and "mappings" (the updated 2D array).
Input Profile Mappings: ${JSON.stringify(currentProfileMappings)}
Fixture Context: ${JSON.stringify(fixtureChannels)}
User Instructions: ${JSON.stringify(pendingAiInstructions)}
Instruction History: ${JSON.stringify(aiConversationHistory.slice(-5))}

Output: Valid raw JSON object only.
`;

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${localStorage.getItem('vj_gemini_model') || 'gemini-3-flash'}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: systemPrompt }] }]
                    })
                });

                const data = await response.json();
                if (data.error) throw new Error(data.error.message);

                const responseText = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/^```json|```$/g, "").trim();
                let aiResult = null;
                try {
                    aiResult = JSON.parse(responseText);
                } catch (e) {
                    // Try stripping any wrapping text
                    const match = responseText.match(/\{.*\}/s);
                    if (match) aiResult = JSON.parse(match[0]);
                }

                if (!aiResult) throw new Error("AI returned invalid JSON.");

                let newMappings = aiResult.mappings || aiResult;
                const logicLog = aiResult.logic_explanation || "";

                if (!Array.isArray(newMappings)) {
                    // Fallback search for array
                    const matchArr = responseText.match(/\[.*\]/s);
                    if (matchArr) newMappings = JSON.parse(matchArr[0]);
                }

                if (!Array.isArray(newMappings)) throw new Error("AI returned invalid mapping format (expected array).");

                // REMOVE THINKING BUBBLE
                const thinkingBubble = document.getElementById(thinkingId);
                if (thinkingBubble) thinkingBubble.remove();
                
                // RE-ENABLE UI
                if (masterInput) masterInput.disabled = false;
                if (sendBtn) sendBtn.disabled = false;
                if (masterInput) masterInput.focus();

                // Update UI log
                const logEl = document.getElementById('ai-response-log');
                if (logEl) {
                    logEl.innerText = logicLog;
                    logEl.style.display = 'block';
                }

                // Append to chat history
                if (logicLog) {
                    addAiChatMessage('ai', logicLog);
                }

                // Show final buttons in chat footer
                const chatDiffBtn = document.getElementById('ai-chat-view-diff-btn');
                const chatApplyBtn = document.getElementById('ai-apply-final-btn');
                if (chatDiffBtn) chatDiffBtn.style.display = 'block';
                if (chatApplyBtn) chatApplyBtn.style.display = 'block';

                // Auto-sync back to the actual profile object
                currentProfileMappings = newMappings;
                if (activeProfileId) {
                    const existing = db.profiles.find(p => p.id === activeProfileId);
                    if (existing) {
                        existing.mappings = JSON.parse(JSON.stringify(currentProfileMappings));
                        saveDB();
                    }
                }

                pendingAiInstructions = {}; // Clear after success
                loadProfileChannels();
                updateAiReviewBar();
                if (loadingContainer) {
                    clearInterval(window.aiProgressInterval);
                    loadingBar.style.width = '100%';
                    loadingBar.style.background = 'var(--success)';
                    loadingText.innerText = 'Done!';
                    loadingText.style.color = 'var(--success)';
                    if (diffBtn) diffBtn.style.display = 'block';
                }
            } catch (err) {
                console.error(err);
                const thinkingBubble = document.getElementById(thinkingId);
                if (thinkingBubble) thinkingBubble.remove();
                
                addAiChatMessage('ai', "🚨 Error: " + err.message);

                if (loadingContainer) {
                    clearInterval(window.aiProgressInterval);
                    loadingBar.style.width = '100%';
                    loadingBar.style.background = 'var(--danger)';
                    loadingText.innerText = 'Failed: ' + err.message;
                    loadingText.style.color = 'var(--danger)';
                }
            } finally {
                isProcessingAi = false;
                if (masterInput) masterInput.disabled = false;
                if (sendBtn) sendBtn.disabled = false;
                
                const processBtn = document.getElementById('ai-process-btn');
                if (processBtn) {
                    processBtn.innerText = "Review & Apply";
                    processBtn.disabled = false;
                }
                setTimeout(() => {
                    if (loadingContainer) {
                        if (loadingText.innerText !== 'Done!') {
                            loadingContainer.style.display = 'none';
                            loadingBar.style.width = '0%';
                        }
                    }
                }, 5000);
            }
        }

        function showAiDiff() {
            const oldMap = window.preAiMappings;
            const newMap = currentProfileMappings;
            const modal = document.getElementById('ai-diff-modal');
            const body = document.getElementById('ai-diff-body');
            body.innerHTML = "";

            const fixtureChannels = currentProfileChannels || [];

            newMap.forEach((newRules, chIdx) => {
                const oldRules = oldMap[chIdx] || [];
                const chName = fixtureChannels[chIdx]?.role || `CH ${chIdx + 1}`;

                let chChanges = [];
                newRules.forEach((nr, rIdx) => {
                    const or = oldRules[rIdx];
                    if (!or) {
                        chChanges.push(`<div class="diff-item"><span class="diff-new">[NEW RULE]</span> ${nr.behavior} - ${nr.source}</div>`);
                        return;
                    }

                    // Compare keys
                    const keys = ['source', 'behavior', 'vibe', 'value'];
                    keys.forEach(k => {
                        if (nr[k] !== or[k]) {
                            chChanges.push(`<div class="diff-item"><b>${k}:</b> <span class="diff-old">${or[k]}</span> → <span class="diff-new">${nr[k]}</span></div>`);
                        }
                    });

                    // Compare Modifiers (The new Source of Truth)
                    if (JSON.stringify(nr.modifiers) !== JSON.stringify(or.modifiers)) {
                        const nm = nr.modifiers || {};
                        const om = or.modifiers || {};
                        if (nm.speed !== om.speed) chChanges.push(`<div class="diff-item"><b>speed:</b> <span class="diff-old">${om.speed}</span> → <span class="diff-new">${nm.speed}</span></div>`);
                        if (nm.react !== om.react) chChanges.push(`<div class="diff-item"><b>react:</b> <span class="diff-old">${om.react}</span> → <span class="diff-new">${nm.react}</span></div>`);
                        if (nm.hold_type !== om.hold_type) chChanges.push(`<div class="diff-item"><b>hold:</b> <span class="diff-old">${om.hold_type}</span> → <span class="diff-new">${nm.hold_type}</span></div>`);
                    }
                });

                if (chChanges.length > 0) {
                    const row = document.createElement('div');
                    row.className = 'diff-row';
                    row.innerHTML = `
                        <div class="diff-ch-label">${chName}</div>
                        <div class="diff-content">
                            ${chChanges.join('')}
                        </div>
                    `;
                    body.appendChild(row);
                }
            });

            if (body.innerHTML === "") {
                body.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-dim);">No significant changes detected in the behavior structure.</div>`;
            }

            modal.style.display = 'flex';
        }

        function closeAiDiff() {
            document.getElementById('ai-diff-modal').style.display = 'none';
            document.getElementById('ai-loading-container').style.display = 'none';
        }

        function toggleChannelAiInput(chIdx) {
            const commentBox = document.getElementById(`ai-comment-${chIdx}`);
            if (commentBox) {
                commentBox.classList.toggle('active');
                if (commentBox.classList.contains('active')) {
                    commentBox.querySelector('textarea')?.focus();
                }
            }
        }

        function closeAiModal() {
            document.getElementById('ai-refine-modal').classList.remove('active');
            document.body.classList.remove('ai-modal-open');
            // Hide the extra UI buttons if they were visible
            const diffBtn = document.getElementById('ai-chat-view-diff-btn');
            const applyBtn = document.getElementById('ai-apply-final-btn');
            if (diffBtn) diffBtn.style.display = 'none';
            if (applyBtn) applyBtn.style.display = 'none';
        }

        function addAiChatMessage(role, text) {
            if (!text) return;
            aiConversationHistory.push({ role, text, timestamp: Date.now() });
            renderAiChat();
        }

        function renderAiChat() {
            const container = document.getElementById('ai-chat-history');
            if (!container) return;

            container.innerHTML = aiConversationHistory.map(msg => `
                <div class="chat-bubble ${msg.role}">
                    ${msg.role === 'system' ? '💡 ' : ''}${msg.text}
                </div>
            `).join('');

            // Auto-scroll
            const body = document.querySelector('.ai-modal-body.chat-body');
            if (body) {
                setTimeout(() => body.scrollTop = body.scrollHeight, 50);
            }
        }

        function openAiSettings() {
            const modal = document.getElementById('ai-settings-modal');
            document.getElementById('gemini-key-input').value = localStorage.getItem('vj_gemini_api_key') || "";
            document.getElementById('ai-model-select-settings').value = localStorage.getItem('vj_gemini_model') || "gemini-3-flash";

            // Sync with backend host if input exists
            const hostInput = document.getElementById('backend-host-input');
            if (hostInput) hostInput.value = localStorage.getItem('vj_backend_host') || "";

            modal.classList.add('active');
            updateModelLabelDisplay();
        }

        function updateModelLabelDisplay() {
            const sel = document.getElementById('ai-model-select-settings');
            const nameEls = document.querySelectorAll('.active-model-name');
            if (sel) {
                const modelName = sel.options[sel.selectedIndex]?.text || "Gemini 3 Flash";
                nameEls.forEach(el => el.innerText = modelName);
            }
        }

        function closeAiSettings() {
            document.getElementById('ai-settings-modal').classList.remove('active');
        }

        function saveAiSettings() {
            const key = document.getElementById('gemini-key-input').value;
            const model = document.getElementById('ai-model-select-settings').value;
            localStorage.setItem('vj_gemini_api_key', key);
            localStorage.setItem('vj_gemini_model', model);

            // Sync any global model labels
            document.querySelectorAll('.active-model-name').forEach(el => {
                const select = document.getElementById('ai-model-select-settings');
                el.innerText = select.options[select.selectedIndex].text;
            });

            closeAiSettings();
            alert("AI Settings Saved!");
        }

        async function refineProfileGlobal() {
            const modal = document.getElementById('ai-refine-modal');
            const textarea = document.getElementById('ai-master-textarea');
            const logEl = document.getElementById('ai-response-log');
            if (logEl) logEl.style.display = 'none';
            document.body.classList.add('ai-modal-open');

            // Build the aggregated prompt (for conversion from review bar)
            let aggregatedPrompt = "";

            // Global instruction at top
            if (pendingAiInstructions["global_instruction"]) {
                aggregatedPrompt += pendingAiInstructions["global_instruction"] + "\n";
            }

            // Find all channels
            const activeProfile = activeProfileId ? db.profiles.find(p => p.id === activeProfileId) : null;
            const fixId = document.getElementById('prof-base-fixture') ? document.getElementById('prof-base-fixture').value : null;
            const legacyFix = (db.fixtures && fixId) ? db.fixtures.find(f => f.id === fixId) : null;
            const channelsList = (activeProfile && activeProfile.channels) ? activeProfile.channels : (legacyFix ? legacyFix.channels : []);

            let hasChannelPrompts = false;
            channelsList.forEach((ch, idx) => {
                if (pendingAiInstructions[idx]) {
                    aggregatedPrompt += `----------------------------------\n`;
                    aggregatedPrompt += `ch${idx + 1}: ${pendingAiInstructions[idx]}\n`;
                    hasChannelPrompts = true;
                }
            });

            if (!aggregatedPrompt.trim()) {
                aggregatedPrompt = "----------------------------------\n";
            } else if (!aggregatedPrompt.includes("----------------------------------")) {
                aggregatedPrompt += "\n----------------------------------\n";
            }

            textarea.value = aggregatedPrompt;
            modal.classList.add('active');
            textarea.focus();
        }

        function applyLocalMutation(type) {
            if (isProcessingAi) return;
            isProcessingAi = true;
            
            // SNAPSHOT FOR UNDO
            window.preAiMappings = JSON.parse(JSON.stringify(currentProfileMappings));

            const loadingContainer = document.getElementById('ai-loading-container');
            const loadingBar = document.getElementById('ai-loading-bar');
            const loadingText = document.getElementById('ai-loading-text');
            const diffBtn = document.getElementById('ai-view-diff-btn');

            if (loadingContainer) {
                loadingContainer.style.display = 'block';
                if (diffBtn) diffBtn.style.display = 'none';
                loadingBar.style.width = '10%';
                loadingBar.style.background = 'var(--accent)';
                loadingText.innerText = 'Applying Mutation...';
                loadingText.style.color = 'var(--accent)';

                let progress = 10;
                const interval = setInterval(() => {
                    progress += (95 - progress) * 0.2;
                    loadingBar.style.width = progress + '%';
                }, 200);

                // Run mutation after a short delay for visual effect
                setTimeout(() => {
                    applyInstantTransformation(type);

                    clearInterval(interval);
                    loadingBar.style.width = '100%';
                    loadingBar.style.background = 'var(--success)';
                    loadingText.innerText = 'Mutation Applied!';
                    loadingText.style.color = 'var(--success)';
                    if (diffBtn) diffBtn.style.display = 'block';

                    // Show in chat too
                    const desc = type === 'bside' ? "Applied B-Side alternate variation." : 
                                 type === 'rhythm' ? "Injected Rhythmic playmaker logic." : "Morphed into Liquid ambient variation.";
                    addAiChatMessage('ai', desc);
                    
                    // Show final buttons in chat footer
                    const chatDiffBtn = document.getElementById('ai-chat-view-diff-btn');
                    const chatApplyBtn = document.getElementById('ai-apply-final-btn');
                    if (chatDiffBtn) chatDiffBtn.style.display = 'block';
                    if (chatApplyBtn) chatApplyBtn.style.display = 'block';

                    // Clear review bar instructions
                    pendingAiInstructions = {};
                    updateAiReviewBar();
                    isProcessingAi = false;
                }, 800);
            } else {
                isProcessingAi = false;
            }
        }

        function applyInstantTransformation(type) {
            const channels = currentProfileChannels || [];
            const mappings = currentProfileMappings || [];

            // Track X/Y for bside speed swap
            let lfoXIdxs = [];
            let lfoYIdxs = [];

            mappings.forEach((rules, idx) => {
                if (!rules) return;
                const ch = channels[idx] || {};
                const role = (ch.role || "").toLowerCase();

                rules.forEach(rule => {
                    if (!rule.modifiers) rule.modifiers = { speed: 0.5, react: 0.5, hold_type: 'none' };
                    
                    if (type === 'bside') {
                        // 1. Zoom/Rotation/Roll: Slight shifts
                        if (['zoom', 'rot_z', 'rot_x', 'rot_y', 'roll'].includes(role)) {
                            if (rule.behavior === 'static') {
                                const min = rule.cal?.min ?? 0;
                                const max = rule.cal?.max ?? 255;
                                const range = max - min;
                                const shift = (Math.random() * 0.3 - 0.15) * range;
                                rule.value = Math.max(min, Math.min(max, Math.floor((rule.value || 127) + shift)));
                            } else {
                                // Shift speed slightly
                                rule.modifiers.speed = Math.max(0.01, Math.min(1.0, rule.modifiers.speed + (Math.random() * 0.2 - 0.1)));
                            }
                        }

                        // 2. Position Tracking (for speed swap later)
                        if (role === 'pos_x' || role === 'pan') lfoXIdxs.push(idx);
                        if (role === 'pos_y' || role === 'tilt') lfoYIdxs.push(idx);

                        // 3. Patterns: Randomize within category range
                        if (role === 'pattern' || role === 'gobo') {
                            const min = rule.cal?.min ?? 0;
                            const max = rule.cal?.max ?? 255;
                            rule.value = Math.floor(Math.random() * (max - min + 1)) + min;
                        }
                    }

                    if (type === 'rhythm') {
                        // 1. GLOBAL SNAP RULES
                        rule.modifiers.react = 0.95; // High sensitivity (low smoothing)
                        rule.behavior = (['sine', 'noise'].includes(rule.behavior)) ? 'square' : rule.behavior;

                        // 2. ROLE-SPECIFIC SURGERY
                        if (role === 'zoom' || role === 'beam_fx') {
                            rule.behavior = 'push';
                            rule.source = 'bass';
                            rule.modifiers.speed = 1.0;
                        }
                        
                        if (role === 'pattern' || role === 'gobo') {
                            rule.behavior = 'step';
                            rule.source = (Math.random() > 0.7) ? 'beat' : 'bar';
                        }

                        if (role.startsWith('pos_') || role.includes('pan') || role.includes('tilt')) {
                            rule.behavior = 'step';
                            rule.source = 'beat';
                            // Tighten range towards center
                            if (rule.cal) {
                                const center = rule.cal.center || 127;
                                rule.cal.min = Math.max(0, center - 40);
                                rule.cal.max = Math.min(255, center + 40);
                            }
                        }
                        
                        if (role.includes('color') || role === 'shutter' || role === 'rot_z') {
                            rule.source = 'attack';
                            rule.modifiers.speed = 1.0; 
                        }
                    }

                    if (type === 'liquid') {
                        // 1. GLOBAL FLOW RULES
                        rule.modifiers.react = 0.15; // High smoothing
                        if (rule.behavior !== 'static') {
                            rule.behavior = 'sine';
                            rule.modifiers.speed = Math.max(0.01, rule.modifiers.speed * 0.3);
                        }

                        // 2. ROLE-SPECIFIC SURGERY
                        if (role === 'zoom' || role === 'beam_fx') {
                            rule.source = 'vol'; 
                            rule.modifiers.speed = 0.05;
                        }
                        
                        if (role === 'pattern' || role === 'gobo') {
                            rule.behavior = 'step';
                            rule.source = 'bar';
                        }

                        if (role.startsWith('pos_') || role.includes('pan') || role.includes('tilt')) {
                            rule.behavior = 'sine';
                            rule.source = (Math.random() > 0.5) ? 'flux' : 'vol';
                            rule.modifiers.speed = 0.03;
                            if (rule.cal) {
                                rule.cal.min = 0;
                                rule.cal.max = 255;
                                rule.cal.center = 127;
                            }
                        }
                        
                        if (role.includes('color')) {
                            rule.source = 'vol';
                            rule.modifiers.speed = 0.05;
                        }
                    }
                });
            });

            if (type === 'bside') {
                // 4. SWAP POSITION SPEEDS
                lfoXIdxs.forEach(xIdx => {
                    lfoYIdxs.forEach(yIdx => {
                        const rulesX = mappings[xIdx] || [];
                        const rulesY = mappings[yIdx] || [];
                        rulesX.forEach(rx => {
                            rulesY.forEach(ry => {
                                const temp = rx.modifiers.speed;
                                rx.modifiers.speed = ry.modifiers.speed;
                                ry.modifiers.speed = temp;
                            });
                        });
                    });
                });
            }

            // Finalize and Sync
            loadProfileChannels();
            if (activeProfileId) {
                const existing = db.profiles.find(p => p.id === activeProfileId);
                if (existing) {
                    existing.mappings = JSON.parse(JSON.stringify(currentProfileMappings));
                    saveDB();
                }
            }
        }

        function undoAiTransformation() {
            if (window.preAiMappings) {
                currentProfileMappings = JSON.parse(JSON.stringify(window.preAiMappings));
                if (activeProfileId) {
                    const existing = db.profiles.find(p => p.id === activeProfileId);
                    if (existing) {
                        existing.mappings = JSON.parse(JSON.stringify(currentProfileMappings));
                        saveDB();
                    }
                }
                loadProfileChannels();
                closeAiDiff();

                // Hide loading bar if it's there
                const loadingContainer = document.getElementById('ai-loading-container');
                if (loadingContainer) loadingContainer.style.display = 'none';
            }
        }

        function acceptAiTransformation() {
            closeAiDiff();
            // Clear review bar instructions just in case
            pendingAiInstructions = {};
            updateAiReviewBar();

            // Optional: Hide loading bar immediately on accept
            const loadingContainer = document.getElementById('ai-loading-container');
            if (loadingContainer) loadingContainer.style.display = 'none';
        }

        function appendAiSuggestion(type) {
            let text = "";
            let instr = "";

            if (type === 'bside') {
                text = "Apply B-Side variance.";
                instr = "[LOCAL_BSIDE]: Create a alternate variant.";
            } else if (type === 'rhythm') {
                text = "Make it punchy and rhythmic.";
                instr = "[GLOBAL REFINEMENT]: Switch to snap behaviors and attack/beat sources.";
            } else if (type === 'liquid') {
                text = "Smooth it out into a liquid state.";
                instr = "[GLOBAL REFINEMENT]: Use sine waves and heavy smoothing.";
            } else {
                text = type;
                instr = type;
            }

            addAiChatMessage('user', text);
            pendingAiInstructions["global_instruction"] = instr;
            processBatchAiInstructions();
        }


        async function sendAiRefinement() {
            const textarea = document.getElementById('ai-master-textarea');
            const text = textarea.value.trim();
            if (!text || isProcessingAi) return;

            addAiChatMessage('user', text);
            textarea.value = "";
            
            pendingAiInstructions["global_instruction"] = text;
            await processBatchAiInstructions();
        }

        async function refineProfileRule(chIdx, ruleIdx) {
            // Deprecated, rule level sparkles are removed. 
            // We use refineProfileChannel or refineProfileGlobal now.
        }

        async function refineProfileChannel(chIdx) {
            // Deprecated, sparkle button now toggles the inline input via toggleChannelAiInput.
        }
