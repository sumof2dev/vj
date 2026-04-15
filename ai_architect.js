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

CHANNEL FUNCTION DICTIONARY (use when interpreting user prompts):
- "pan" / "x position" = role: pos_x
- "tilt" / "y position" = role: pos_y
- "zoom" / "size" = role: zoom
- "x rotation" / "rotate x" / "tilt roll" = role: rot_x
- "y rotation" / "rotate y" / "pan roll" = role: rot_y  
- "z rotation" / "rotation" / "roll" / "spin" = role: rot_z
- "color" / "color wheel" = role: color_solid or color_multi
- "pattern" / "gobo" = role: pattern
- "strobe" / "shutter" = role: strobe
- "dimmer" / "brightness" = role: dimmer
When the user says "rotation" without axis, interpret as rot_z. Match these aliases to the correct channel by checking the Fixture Context roles.

RELATIONAL PROMPTS: Understand cross-channel relationships.
- "if zoom is at 127, rotation should be below 127" = find channel with role zoom, note its cal.center (127), then find rotation channel and set its cal.max below that value.
- "pan faster than tilt" = pos_x speed should be higher than pos_y speed.
- Apply the user's intent across the correct channels by matching role names from the dictionary above.

VIBE RULES & SYNC GROUPS:
The "vibe" field controls WHEN a rule activates based on detected audio energy level.
Valid values: "any", "chill", "chill 1", "chill 2", "chill 3", "mid", "mid 1", "mid 2", "mid 3", "high", "high 1", "high 2", "high 3", "build", "drop", "never".
- The base vibe (any/chill/mid/high) controls activation threshold.
- The number suffix (1, 2, 3) is a sync group for multi-fixture coordination.
- "any" = active at all times. First range should always be "any" with no number.
- The last range of a multi-range channel can be "high", "high 1", "high 2", or "high 3".
- When modifying vibes, RANDOMIZE the sync group numbers across different channels to prevent all channels from landing in the same group (which makes output "too busy"). Spread 1, 2, 3 across channels.

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
                        contents: [{ parts: [{ text: systemPrompt }] }],
                        generationConfig: { responseMimeType: "application/json" }
                    })
                });

                const data = await response.json();
                if (data.error) throw new Error(data.error.message);

                const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                let aiResult = null;
                try {
                    aiResult = JSON.parse(responseText.replace(/^```json|```$/g, "").trim());
                } catch (e) {
                    throw new Error("AI returned invalid JSON: " + e.message);
                }

                let newMappings = aiResult.mappings || aiResult;
                const logicLog = aiResult.logic_explanation || "";

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

                // STAGING: Update the live mappings for preview, but DO NOT save to DB yet.
                window.stagedAiMappings = JSON.parse(JSON.stringify(newMappings));
                currentProfileMappings = JSON.parse(JSON.stringify(newMappings));

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
                    if (nr._is_deleted) return; // Skip if already marked for deletion during this session

                    const or = oldRules[rIdx];
                    if (!or) {
                        const isReverted = nr._is_reverted;
                        chChanges.push(`
                            <div class="diff-item ${isReverted ? 'reverted' : ''}">
                                <input type="checkbox" ${isReverted ? '' : 'checked'} class="diff-check" 
                                    onchange="previewRevert(this)"
                                    data-ch="${chIdx}" data-rule="${rIdx}" data-type="new-rule">
                                <span class="diff-new">[NEW RULE]</span> ${nr.behavior} - ${nr.source}
                            </div>`);
                        return;
                    }

                    // Compare keys
                    const keys = ['source', 'behavior', 'vibe', 'value', 'invert', 'offset'];
                    keys.forEach(k => {
                        const isReverted = nr._reverted_fields && nr._reverted_fields.has(k);
                        if (nr[k] !== or[k] || isReverted) {
                            chChanges.push(`
                                <div class="diff-item ${isReverted ? 'reverted' : ''}">
                                    <input type="checkbox" ${isReverted ? '' : 'checked'} class="diff-check" 
                                        onchange="previewRevert(this)"
                                        data-ch="${chIdx}" data-rule="${rIdx}" data-key="${k}" data-old="${or[k]}" data-type="field">
                                    <b>${k}:</b> <span class="diff-old">${or[k] ?? '—'}</span> → <span class="diff-new">${nr[k] ?? '—'}</span>
                                </div>`);
                        }
                    });

                    // Compare Modifiers
                    const nm = nr.modifiers || {};
                    const om = or.modifiers || {};
                    const modKeys = ['speed', 'react', 'hold_type'];
                    modKeys.forEach(mk => {
                        const isReverted = nr._reverted_fields && nr._reverted_fields.has('modifiers.' + mk);
                        if (nm[mk] !== om[mk] || isReverted) {
                            chChanges.push(`
                                <div class="diff-item ${isReverted ? 'reverted' : ''}">
                                    <input type="checkbox" ${isReverted ? '' : 'checked'} class="diff-check" 
                                        onchange="previewRevert(this)"
                                        data-ch="${chIdx}" data-rule="${rIdx}" data-key="modifiers.${mk}" data-old="${om[mk]}" data-type="field">
                                    <b>${mk}:</b> <span class="diff-old">${om[mk] ?? '—'}</span> → <span class="diff-new">${nm[mk] ?? '—'}</span>
                                </div>`);
                        }
                    });

                    // Compare Calibration (CRITICAL: Often modified by AI for range tuning)
                    const ncal = nr.cal || {};
                    const ocal = or.cal || {};
                    const calKeys = ['min', 'max', 'center'];
                    calKeys.forEach(ck => {
                        const isReverted = nr._reverted_fields && nr._reverted_fields.has('cal.' + ck);
                        if (ncal[ck] !== ocal[ck] || isReverted) {
                            chChanges.push(`
                                <div class="diff-item ${isReverted ? 'reverted' : ''}">
                                    <input type="checkbox" ${isReverted ? '' : 'checked'} class="diff-check" 
                                        onchange="previewRevert(this)"
                                        data-ch="${chIdx}" data-rule="${rIdx}" data-key="cal.${ck}" data-old="${ocal[ck]}" data-type="field">
                                    <b>cal ${ck}:</b> <span class="diff-old">${ocal[ck] ?? '—'}</span> → <span class="diff-new">${ncal[ck] ?? '—'}</span>
                                </div>`);
                        }
                    });
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

            modal.classList.add('active');
        }

        function previewRevert(cb) {
            const chIdx = parseInt(cb.dataset.ch);
            const rIdx = parseInt(cb.dataset.rule);
            const type = cb.dataset.type;
            const checked = cb.checked;

            if (!window.preAiMappings || !window.stagedAiMappings) return;

            const rule = currentProfileMappings[chIdx][rIdx];
            if (!rule) return;

            if (type === 'new-rule') {
                if (!checked) {
                    rule._is_reverted = true;
                } else {
                    rule._is_reverted = false;
                }
            } else if (type === 'field') {
                const key = cb.dataset.key;
                const path = key.split('.');
                
                // Source of truth for the value
                const source = checked ? window.stagedAiMappings : window.preAiMappings;
                
                // Navigate to the value in the source
                let newVal = source[chIdx] && source[chIdx][rIdx];
                for (let i = 0; i < path.length; i++) {
                    if (newVal === undefined) break;
                    newVal = newVal[path[i]];
                }

                // Apply to currentProfileMappings
                let target = currentProfileMappings[chIdx][rIdx];
                for (let i = 0; i < path.length - 1; i++) {
                    if (!target[path[i]]) target[path[i]] = {};
                    target = target[path[i]];
                }
                target[path[path.length - 1]] = newVal;

                // Track rejections
                if (!rule._reverted_fields) rule._reverted_fields = new Set();
                if (!checked) rule._reverted_fields.add(key);
                else rule._reverted_fields.delete(key);
            }

            // Visual feedback on the row
            cb.closest('.diff-item').classList.toggle('reverted', !checked);

            // Live Profile refresh (visualizer preview)
            loadProfileChannels();
        }

        function closeAiDiff() {
            document.getElementById('ai-diff-modal').classList.remove('active');
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
                            rule.source = 'impact';
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
            
            // Sync with staged mappings so the Diff UI works correctly
            window.stagedAiMappings = JSON.parse(JSON.stringify(currentProfileMappings));
        }

        function undoAiTransformation() {
            if (window.preAiMappings) {
                // Restore original state to both memory and active profile (without saving to DB file)
                currentProfileMappings = JSON.parse(JSON.stringify(window.preAiMappings));
                
                if (activeProfileId) {
                    const existing = db.profiles.find(p => p.id === activeProfileId);
                    if (existing) {
                        existing.mappings = JSON.parse(JSON.stringify(currentProfileMappings));
                        // DO NOT call saveDB() here - we are undoing a transformation that was never saved
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
            
            // Finalize currentProfileMappings by filtering out reverted rules and cleaning metadata
            currentProfileMappings = currentProfileMappings.map((rules) => {
                return rules.filter(r => !r._is_reverted).map(r => {
                    const cleaned = { ...r };
                    delete cleaned._reverted_fields;
                    delete cleaned._original_values;
                    delete cleaned._is_reverted;
                    return cleaned;
                });
            });

            // Update DB with the final filtered state
            if (activeProfileId) {
                const existing = db.profiles.find(p => p.id === activeProfileId);
                if (existing) {
                    existing.mappings = JSON.parse(JSON.stringify(currentProfileMappings));
                    saveDB();
                }
            }

            // Add confirmation to chat history
            addAiChatMessage('system', "✅ Selective changes have been accepted and applied to the profile.");
            
            // Clear review bar instructions
            pendingAiInstructions = {};
            updateAiReviewBar();

            // Close the main modal too, as the user is done with this refinement cycle
            setTimeout(() => {
                closeAiModal();
                
                // Optional: Hide loading bar immediately on accept
                const loadingContainer = document.getElementById('ai-loading-container');
                if (loadingContainer) loadingContainer.style.display = 'none';
                
                loadProfileChannels();
            }, 500);
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

        // ============================================================
        // === AI PRESET GENERATION SYSTEM ===
        // ============================================================

        var presetConversationHistory = [];
        var isProcessingPresetAi = false;

        function openPresetAiChat() {
            const modal = document.getElementById('ai-preset-modal');
            if (!modal) return;

            // Reset footer buttons
            const diffBtn = document.getElementById('ai-preset-view-diff-btn');
            const applyBtn = document.getElementById('ai-preset-apply-btn');
            if (diffBtn) diffBtn.style.display = 'none';
            if (applyBtn) applyBtn.style.display = 'none';

            // Snapshot current state for diff/undo
            window.preAiPresetTriggers = JSON.parse(JSON.stringify(currentPresetTriggers || []));
            window.preAiPresetOverrides = JSON.parse(JSON.stringify(currentPresetOverrides || []));
            window.preAiPresetName = document.getElementById('pres-name')?.value || '';

            document.body.classList.add('ai-modal-open');
            modal.classList.add('active');

            const textarea = document.getElementById('ai-preset-textarea');
            if (textarea) {
                textarea.value = '';
                textarea.focus();
            }

            // Update model label
            if (typeof updateModelLabelDisplay === 'function') updateModelLabelDisplay();
        }

        function closePresetAiModal() {
            const modal = document.getElementById('ai-preset-modal');
            if (modal) modal.classList.remove('active');
            document.body.classList.remove('ai-modal-open');

            const diffBtn = document.getElementById('ai-preset-view-diff-btn');
            const applyBtn = document.getElementById('ai-preset-apply-btn');
            if (diffBtn) diffBtn.style.display = 'none';
            if (applyBtn) applyBtn.style.display = 'none';
        }

        function addPresetAiChatMessage(role, text) {
            if (!text) return;
            presetConversationHistory.push({ role, text, timestamp: Date.now() });
            renderPresetAiChat();
        }

        function renderPresetAiChat() {
            const container = document.getElementById('ai-preset-chat-history');
            if (!container) return;

            container.innerHTML = presetConversationHistory.map(msg => `
                <div class="chat-bubble ${msg.role}">
                    ${msg.role === 'system' ? '💡 ' : ''}${msg.text}
                </div>
            `).join('');

            const body = container.closest('.chat-body');
            if (body) setTimeout(() => body.scrollTop = body.scrollHeight, 50);
        }

        function clearPresetAiChatHistory() {
            if (!confirm("Clear preset AI chat history?")) return;
            presetConversationHistory = [];
            const container = document.getElementById('ai-preset-chat-history');
            if (container) {
                container.innerHTML = `<div class="chat-bubble ai">
                    Describe the preset you want to create. For example: "blackout all fixtures when volume drops below 5%" or "when vibe goes high, crank dimmers to max on the rhythm fixtures."
                </div>`;
            }
            const diffBtn = document.getElementById('ai-preset-view-diff-btn');
            const applyBtn = document.getElementById('ai-preset-apply-btn');
            if (diffBtn) diffBtn.style.display = 'none';
            if (applyBtn) applyBtn.style.display = 'none';
        }

        function _buildStageContext() {
            const stageInstances = db.stage || [];
            const profiles = db.profiles || [];

            return stageInstances.map(inst => {
                const prof = profiles.find(p => p.id === inst.profileId);
                const channels = prof ? (prof.channels || []) : [];
                return {
                    id: inst.id,
                    address: inst.address,
                    zone: inst.zone || 'center',
                    profileName: prof ? prof.name : 'Unknown',
                    roles: channels.map(ch => ch.role || ch.name || 'unknown')
                };
            });
        }

        async function sendPresetAiPrompt() {
            const textarea = document.getElementById('ai-preset-textarea');
            const text = (textarea?.value || '').trim();
            if (!text || isProcessingPresetAi) return;

            addPresetAiChatMessage('user', text);
            textarea.value = '';

            const apiKey = localStorage.getItem('vj_gemini_api_key');
            if (!apiKey) {
                alert("Gemini API Key missing! Set it in AI settings.");
                if (typeof openAiSettings === 'function') openAiSettings();
                return;
            }

            isProcessingPresetAi = true;
            const sendBtn = document.getElementById('ai-preset-send-btn');
            if (textarea) textarea.disabled = true;
            if (sendBtn) sendBtn.disabled = true;

            // Snapshot for diff
            window.preAiPresetTriggers = JSON.parse(JSON.stringify(currentPresetTriggers || []));
            window.preAiPresetOverrides = JSON.parse(JSON.stringify(currentPresetOverrides || []));
            window.preAiPresetName = document.getElementById('pres-name')?.value || '';

            // Thinking bubble
            const chatHistory = document.getElementById('ai-preset-chat-history');
            const thinkingId = 'preset-thinking-' + Date.now();
            if (chatHistory) {
                const bubble = document.createElement('div');
                bubble.id = thinkingId;
                bubble.className = 'chat-bubble thinking';
                bubble.innerHTML = `<span>Thinking</span> <div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div>`;
                chatHistory.appendChild(bubble);
                const body = chatHistory.closest('.chat-body');
                if (body) body.scrollTop = body.scrollHeight;
            }

            const stageContext = _buildStageContext();

            // Build the current preset context (for editing existing presets)
            let currentPresetContext = null;
            if (current_editing_preset_id) {
                const existing = (db.presets || []).find(p => p.id === current_editing_preset_id);
                if (existing) currentPresetContext = existing;
            }

            const systemPrompt = `Role: Expert Stage Lighting Designer for RaveBox Preset System.
Task: Generate or refine a preset based on the user's natural language description.

Context:
- A Preset consists of TRIGGERS (when it activates) and OVERRIDES (what it does when active).
- Triggers define conditions. ALL triggers must be true simultaneously (AND logic).
- If user describes "X OR Y", return MULTIPLE presets with different triggers but same overrides.
- Overrides target specific stage fixtures by ID, or "global" for all.

TRIGGER SCHEMA:
- {type: "vibe", value: "<value>"} — values: chill, mid, high
- {type: "state", value: "<value>"} — values: building, tension, dropping
- {type: "volume", greater_than: N, less_than: N} — 0-100 scale. ALWAYS provide both.
- {type: "bin", target: "<name>", greater_than: N, less_than: N} — names: SUB..BRILLIANCE. ALWAYS provide both.
- {type: "channel", target: <addr>, greater_than: N, less_than: N} — raw DMX. ALWAYS provide both.
- {type: "manual"} — activated only by user click.
- For all numeric triggers (volume, bin, channel), you MUST specify both "greater_than" and "less_than" to define a clear range.

OVERRIDE SCHEMA:
Each override targets one fixture + one channel role:
- Instance: {id: "<fixture_id>", target: "<fixture_id>", type: "instance", name: "<role>", role: "<role>", value: <0-255>, smoothing: 0, channels: [{name: "<role>", value: <0-255>}]}
- Global: {id: "global", target: "global", type: "global", name: "<role>", role: "<role>", value: <0-255>, smoothing: 0, channels: [{name: "<role>", value: <0-255>}]}

BEHAVIOR OVERRIDES (for movement/strobe/sweep):
When the user describes dynamic behavior (strobe, sweep, oscillate, pulse), use mode:"behavior" on the channel:
- {name: "<role>", mode: "behavior", behavior: "<type>", source: "<driver>", modifiers: {speed: 0.5, react: 0.5, hold_type: "none"}, cal: {min: 0, center: 127, max: 255}}
- behavior types: sine, saw, square, triangle, push, pull, noise, step, forward, pingpong, random, adjacent, erratic, direct, static
- source drivers: volume, bass, flux, beat, bar, axis_a, axis_b, axis_c, axis_d, axis_e
- speed: 0.0-1.0 (oscillation speed), react: 0.0-1.0 (audio reactivity)
- hold_type: none, beat, bar, peakpause, floorfreeze
- Example strobe: {name: "dimmer", mode: "behavior", behavior: "square", source: "volume", modifiers: {speed: 0.8, react: 0.7}, cal: {min: 0, center: 127, max: 215}}
- Example sweep: {name: "pos_x", mode: "behavior", behavior: "sine", source: "bass", modifiers: {speed: 0.3, react: 0.5}, cal: {min: 0, center: 64, max: 127}}
- For phase offset between channels (e.g. Y 50% ahead of X), use different speed values or add a phase note in modifiers

AVAILABLE ROLES: pos_x, pos_y, zoom, rot_z, rot_x, rot_y, color_solid, color_multi, pattern, beam_fx, grating, drawing, drawing_delay, strobe, generic, dimmer, mode, clip, group

FIXTURE ALIAS HINTS:
- "all fixtures" / "everything" = use type "global"
- Match user references to fixture IDs by name similarity (e.g. "rhythm fixtures" matches IDs containing "Ryth")
- "blackout" = set dimmer to 0
- "full brightness" / "max" = set dimmer to 255

Stage Instances (fixture IDs and their roles): ${JSON.stringify(stageContext)}
${currentPresetContext ? 'Current Preset Being Edited: ' + JSON.stringify(currentPresetContext) : 'Creating new preset.'}
User Prompt: ${text}
Conversation History: ${JSON.stringify(presetConversationHistory.slice(-5))}

Output: Return a valid JSON object with:
- "presets": array of objects, each with {name: string, triggers: array, overrides: array}
- "logic_explanation": compact summary of what was generated

Return raw JSON only, no markdown.`;

            try {
                const model = localStorage.getItem('vj_gemini_model') || 'gemini-2.5-flash';
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
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
                    const match = responseText.match(/\{.*\}/s);
                    if (match) aiResult = JSON.parse(match[0]);
                }

                if (!aiResult) throw new Error("AI returned invalid JSON.");

                const presets = aiResult.presets || [aiResult];
                const logicLog = aiResult.logic_explanation || "";

                if (!Array.isArray(presets) || presets.length === 0) throw new Error("No presets in AI response.");

                // Remove thinking bubble
                const thinkingBubble = document.getElementById(thinkingId);
                if (thinkingBubble) thinkingBubble.remove();

                // Log AI explanation
                if (logicLog) addPresetAiChatMessage('ai', logicLog);

                // Hydrate and sanitize all presets before applying
                const sanitizedPresets = presets.map(p => {
                    return {
                        name: p.name || "Untitled Preset",
                        triggers: (p.triggers || []).map(t => ({
                            type: t.type || 'manual',
                            value: t.value || '',
                            target: t.target || '',
                            greater_than: t.greater_than ?? 0,
                            less_than: t.less_than ?? 100
                        })),
                        overrides: (p.overrides || []).map(o => {
                            const role = o.role || o.name || 'dimmer';
                            const val = o.value ?? 0;
                            return {
                                id: o.id || 'global',
                                target: o.target || 'global',
                                type: o.type || (o.id === 'global' ? 'global' : 'instance'),
                                name: role,
                                role: role,
                                value: val,
                                smoothing: o.smoothing ?? 0,
                                channels: (o.channels && o.channels.length > 0) ? o.channels.map(ch => ({
                                    name: ch.name || role,
                                    value: ch.value ?? val,
                                    mode: ch.mode || 'value'
                                })) : [{ name: role, value: val }]
                            };
                        })
                    };
                });

                // Use the first preset to populate the form
                const primary = sanitizedPresets[0];

                // Store generated result for diff
                window.generatedPresetResult = primary;
                window.generatedAllPresets = sanitizedPresets;

                // Apply to form state
                currentPresetTriggers = JSON.parse(JSON.stringify(primary.triggers || []));
                currentPresetOverrides = JSON.parse(JSON.stringify(primary.overrides || []));
                if (primary.name) {
                    const nameField = document.getElementById('pres-name');
                    if (nameField && !nameField.value.trim()) nameField.value = primary.name;
                }

                // Render the form
                if (typeof renderPresetTriggers === 'function') renderPresetTriggers();
                if (typeof renderPresetOverrides === 'function') renderPresetOverrides();

                // Show diff/apply buttons
                const diffBtn = document.getElementById('ai-preset-view-diff-btn');
                const applyBtn = document.getElementById('ai-preset-apply-btn');
                if (diffBtn) diffBtn.style.display = 'block';
                if (applyBtn) applyBtn.style.display = 'block';

                // If multiple presets were generated (OR logic), notify user
                if (presets.length > 1) {
                    addPresetAiChatMessage('system', `Generated ${presets.length} presets (OR conditions split). The first is loaded in the form. Apply to save all ${presets.length}.`);
                }

            } catch (err) {
                console.error("Preset AI Error:", err);
                const thinkingBubble = document.getElementById(thinkingId);
                if (thinkingBubble) thinkingBubble.remove();
                addPresetAiChatMessage('ai', "🚨 Error: " + err.message);
            } finally {
                isProcessingPresetAi = false;
                if (textarea) textarea.disabled = false;
                if (sendBtn) sendBtn.disabled = false;
                if (textarea) textarea.focus();
            }
        }

        function showPresetAiDiff() {
            const oldTriggers = window.preAiPresetTriggers || [];
            const oldOverrides = window.preAiPresetOverrides || [];
            const newTriggers = currentPresetTriggers || [];
            const newOverrides = currentPresetOverrides || [];

            const modal = document.getElementById('ai-preset-diff-modal');
            const body = document.getElementById('ai-preset-diff-body');
            if (!modal || !body) return;
            body.innerHTML = "";

            // --- TRIGGER DIFF ---
            let triggerChanges = [];

            newTriggers.forEach((nt, idx) => {
                const ot = oldTriggers[idx];
                if (!ot) {
                    triggerChanges.push(`<div class="diff-item">
                        <span class="diff-new">[NEW]</span> ${nt.type}: ${nt.value || nt.target || ''} ${nt.greater_than !== undefined ? '>' + nt.greater_than : ''} ${nt.less_than !== undefined ? '<' + nt.less_than : ''}
                    </div>`);
                } else {
                    const ntSorted = JSON.stringify(Object.keys(nt).sort().reduce((obj, key) => { obj[key] = nt[key]; return obj; }, {}));
                    const otSorted = JSON.stringify(Object.keys(ot).sort().reduce((obj, key) => { obj[key] = ot[key]; return obj; }, {}));
                    if (ntSorted !== otSorted) {
                        triggerChanges.push(`<div class="diff-item">
                            <b>Trigger ${idx + 1}:</b> <span class="diff-old">${ot.type}:${ot.value || ot.target || ''}</span> → <span class="diff-new">${nt.type}:${nt.value || nt.target || ''}</span>
                        </div>`);
                    }
                }
            });

            // Removed triggers
            oldTriggers.forEach((ot, idx) => {
                if (idx >= newTriggers.length) {
                    triggerChanges.push(`<div class="diff-item">
                        <span class="diff-old">[REMOVED]</span> ${ot.type}: ${ot.value || ot.target || ''}
                    </div>`);
                }
            });

            if (triggerChanges.length > 0) {
                const row = document.createElement('div');
                row.className = 'diff-row';
                row.innerHTML = `<div class="diff-ch-label">TRIGGERS</div><div class="diff-content">${triggerChanges.join('')}</div>`;
                body.appendChild(row);
            }

            // --- OVERRIDE DIFF ---
            let overrideChanges = [];

            newOverrides.forEach((no, idx) => {
                const oo = oldOverrides[idx];
                const label = `${no.target || 'global'} → ${no.role || no.name || '?'}`;
                if (!oo) {
                    overrideChanges.push(`<div class="diff-item">
                        <span class="diff-new">[NEW]</span> ${label} = ${no.value}
                    </div>`);
                } else {
                    if (no.value !== oo.value || no.target !== oo.target || no.role !== oo.role) {
                        const oldLabel = `${oo.target || 'global'} → ${oo.role || oo.name || '?'}`;
                        overrideChanges.push(`<div class="diff-item">
                            <span class="diff-old">${oldLabel} = ${oo.value}</span> → <span class="diff-new">${label} = ${no.value}</span>
                        </div>`);
                    }
                }
            });

            oldOverrides.forEach((oo, idx) => {
                if (idx >= newOverrides.length) {
                    overrideChanges.push(`<div class="diff-item">
                        <span class="diff-old">[REMOVED]</span> ${oo.target || 'global'} → ${oo.role || oo.name || '?'} = ${oo.value}
                    </div>`);
                }
            });

            if (overrideChanges.length > 0) {
                const row = document.createElement('div');
                row.className = 'diff-row';
                row.innerHTML = `<div class="diff-ch-label">OVERRIDES</div><div class="diff-content">${overrideChanges.join('')}</div>`;
                body.appendChild(row);
            }

            if (body.innerHTML === "") {
                body.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-dim);">No changes detected — this is a fresh preset.</div>`;
            }

            modal.classList.add('active');
        }

        function closePresetAiDiff() {
            const modal = document.getElementById('ai-preset-diff-modal');
            if (modal) modal.classList.remove('active');
        }

        function undoPresetAi() {
            currentPresetTriggers = JSON.parse(JSON.stringify(window.preAiPresetTriggers || []));
            currentPresetOverrides = JSON.parse(JSON.stringify(window.preAiPresetOverrides || []));

            const nameField = document.getElementById('pres-name');
            if (nameField && window.preAiPresetName !== undefined) {
                nameField.value = window.preAiPresetName;
            }

            if (typeof renderPresetTriggers === 'function') renderPresetTriggers();
            if (typeof renderPresetOverrides === 'function') renderPresetOverrides();

            closePresetAiDiff();
            addPresetAiChatMessage('system', '↩️ Reverted to previous state.');
        }

        function acceptPresetAi() {
            closePresetAiDiff();

            // Avoid silent database writes for multi-presets
            const allPresets = window.generatedAllPresets || [];

            if (allPresets.length > 1) {
                // Store extras in a review queue instead of writing directly to DB
                window.stagedGeneratedPresets = allPresets.slice(1);
                addPresetAiChatMessage('system', `⚠️ ${allPresets.length - 1} additional presets have been staged for review. Click "Review Extras" in the chat to see them.`);
                
                // Add a button to the chat to review them
                const chatHistory = document.getElementById('ai-preset-chat-history');
                if (chatHistory) {
                    const btnWrap = document.createElement('div');
                    btnWrap.style.padding = '10px';
                    btnWrap.style.textAlign = 'center';
                    btnWrap.innerHTML = `<button class="btn btn-accent btn-sm" onclick="showStagedPresetsReview()">Review ${allPresets.length - 1} Extras</button>`;
                    chatHistory.appendChild(btnWrap);
                }
            }

            addPresetAiChatMessage('system', '✅ Primary preset applied to form. Click "Save Preset" to finalize.');

            // Close modal
            setTimeout(() => {
                closePresetAiModal();
            }, 500);
        }

        function showStagedPresetsReview() {
            const presets = window.stagedGeneratedPresets || [];
            if (presets.length === 0) return;

            const modal = document.getElementById('ai-preset-staged-modal');
            const body = document.getElementById('ai-preset-staged-body');
            if (!modal || !body) return;

            body.innerHTML = presets.map((p, i) => `
                <div class="card" style="padding:15px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:bold; color:var(--accent);">${p.name}</div>
                        <div style="font-size:10px; color:var(--text-dim);">${p.triggers.length} Triggers, ${p.overrides.length} Overrides</div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-sm" onclick="loadStagedPreset(${i})">Load to Form</button>
                        <button class="btn btn-success btn-sm" onclick="saveStagedPresetToDb(${i})">Quick Save</button>
                    </div>
                </div>
            `).join('');

            modal.style.display = 'flex';
        }

        function closeStagedPresetsReview() {
            const modal = document.getElementById('ai-preset-staged-modal');
            if (modal) modal.style.display = 'none';
        }

        function loadStagedPreset(idx) {
            const p = window.stagedGeneratedPresets[idx];
            if (!p) return;

            // Apply to form state
            currentPresetTriggers = JSON.parse(JSON.stringify(p.triggers || []));
            currentPresetOverrides = JSON.parse(JSON.stringify(p.overrides || []));
            const nameField = document.getElementById('pres-name');
            if (nameField) nameField.value = p.name || '';

            // Render
            if (typeof renderPresetTriggers === 'function') renderPresetTriggers();
            if (typeof renderPresetOverrides === 'function') renderPresetOverrides();

            closeStagedPresetsReview();
            addPresetAiChatMessage('system', `Loaded "${p.name}" into the editor.`);
        }

        function saveStagedPresetToDb(idx) {
            const p = window.stagedGeneratedPresets[idx];
            if (!p) return;

            db.presets.push({
                id: 'pre_' + (Date.now() + idx),
                name: p.name || "Untitled Preset",
                triggers: JSON.parse(JSON.stringify(p.triggers || [])),
                overrides: JSON.parse(JSON.stringify(p.overrides || []))
            });
            saveDB();
            if (typeof refreshUI === 'function') refreshUI();

            addPresetAiChatMessage('system', `✅ Saved "${p.name}" to library.`);
            
            // Remove from staging
            window.stagedGeneratedPresets.splice(idx, 1);
            if (window.stagedGeneratedPresets.length === 0) {
                closeStagedPresetsReview();
            } else {
                showStagedPresetsReview();
            }
        }

        function saveAllStagedPresets() {
            const presets = window.stagedGeneratedPresets || [];
            if (presets.length === 0) return;

            presets.forEach((p, i) => {
                db.presets.push({
                    id: 'pre_' + (Date.now() + i + 100),
                    name: p.name || "Untitled Preset",
                    triggers: JSON.parse(JSON.stringify(p.triggers || [])),
                    overrides: JSON.parse(JSON.stringify(p.overrides || []))
                });
            });
            saveDB();
            if (typeof refreshUI === 'function') refreshUI();

            addPresetAiChatMessage('system', `✅ Saved ${presets.length} presets to library.`);
            window.stagedGeneratedPresets = [];
            closeStagedPresetsReview();
        }

        function appendPresetAiSuggestion(type) {
            const stageContext = _buildStageContext();
            const fixtureIds = stageContext.map(s => s.id);
            let text = "";
            let prompt = "";

            if (type === 'blackout') {
                text = "Blackout when quiet.";

                // Local instant generation — no API needed
                currentPresetTriggers = [{ type: 'volume', greater_than: 0, less_than: 5 }];
                currentPresetOverrides = [];

                // Add dimmer=0 for every stage fixture
                fixtureIds.forEach(id => {
                    currentPresetOverrides.push({
                        id: id, target: id, type: 'instance',
                        name: 'dimmer', role: 'dimmer', value: 0, smoothing: 0,
                        channels: [{ name: 'dimmer', value: 0 }]
                    });
                });

                // If no stage fixtures, use global
                if (fixtureIds.length === 0) {
                    currentPresetOverrides.push({
                        id: 'global', target: 'global', type: 'global',
                        name: 'dimmer', role: 'dimmer', value: 0, smoothing: 0,
                        channels: [{ name: 'dimmer', value: 0 }]
                    });
                }

                const nameField = document.getElementById('pres-name');
                if (nameField && !nameField.value.trim()) nameField.value = "Blackout";

                if (typeof renderPresetTriggers === 'function') renderPresetTriggers();
                if (typeof renderPresetOverrides === 'function') renderPresetOverrides();

                addPresetAiChatMessage('user', text);
                addPresetAiChatMessage('ai', `Generated blackout preset: dims all ${fixtureIds.length || 'global'} fixtures when volume < 5%.`);

                window.generatedAllPresets = [{ name: "Blackout", triggers: currentPresetTriggers, overrides: currentPresetOverrides }];

                const diffBtn = document.getElementById('ai-preset-view-diff-btn');
                const applyBtn = document.getElementById('ai-preset-apply-btn');
                if (diffBtn) diffBtn.style.display = 'block';
                if (applyBtn) applyBtn.style.display = 'block';
                return;

            } else if (type === 'drop_punch') {
                text = "Max brightness on all fixtures during a drop.";
                prompt = "When the transient state is 'dropping', set all fixture dimmers to 255 (max brightness). Name it 'Drop Punch'.";

            } else if (type === 'breakdown') {
                text = "Dim everything during builds/tension.";
                prompt = "When the transient state is 'tension', set all fixture dimmers to 25 (very dim). Also set any rotation to 0. Name it 'Breakdown'.";
            }

            if (prompt) {
                addPresetAiChatMessage('user', text);
                const textarea = document.getElementById('ai-preset-textarea');
                if (textarea) textarea.value = '';
                // Use AI for these
                const fakeTextarea = document.getElementById('ai-preset-textarea');
                if (fakeTextarea) fakeTextarea.value = prompt;
                sendPresetAiPrompt();
            }
        }

        // Global exports for preset AI
        window.openPresetAiChat = openPresetAiChat;
        window.closePresetAiModal = closePresetAiModal;
        window.sendPresetAiPrompt = sendPresetAiPrompt;
        window.showPresetAiDiff = showPresetAiDiff;
        window.closePresetAiDiff = closePresetAiDiff;
        window.undoPresetAi = undoPresetAi;
        window.acceptPresetAi = acceptPresetAi;
        window.appendPresetAiSuggestion = appendPresetAiSuggestion;
        window.clearPresetAiChatHistory = clearPresetAiChatHistory;
        window.showStagedPresetsReview = showStagedPresetsReview;
        window.closeStagedPresetsReview = closeStagedPresetsReview;
        window.loadStagedPreset = loadStagedPreset;
        window.saveStagedPresetToDb = saveStagedPresetToDb;
        window.saveAllStagedPresets = saveAllStagedPresets;
