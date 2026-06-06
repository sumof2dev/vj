// AI Profile Architect & Refinement Logic
// Integrates with profile_logic.js globals: currentProfileMappings, currentProfileChannels, db, etc.
var collapsedChannels = window.collapsedChannels || new Set();
var pendingAiInstructions = window.pendingAiInstructions || {};
var aiConversationHistory = window.aiConversationHistory || [];
var isProcessingAi = window.isProcessingAi || false;
var getUniqueProfiles = window.getUniqueProfiles || function () { return []; };
var refreshUI = window.refreshUI || function () { };
var saveDB = window.saveDB || function () { };

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
        if (loadingContainer) loadingContainer.classList.add('hidden');
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

    // 1. Tag Detection & Surgical Filtering
    const userInstructions = pendingAiInstructions["global_instruction"] || "";
    const chMatches = [...userInstructions.matchAll(/\[ch:([^\]]+)\]/g)];
    const targetRoles = chMatches.map(m => m[1].trim());

    const fixtureChannels = currentProfileChannels || [];
    let mappingsToInfect = JSON.parse(JSON.stringify(window.currentProfileMappings || []));

    // Inject roles into mappings for AI clarity
    mappingsToInfect.forEach((rules, idx) => {
        const role = fixtureChannels[idx]?.role || 'unknown';
        if (Array.isArray(rules)) {
            rules.forEach(r => { r._role = role; });
        }
    });

    let mappingsForPrompt = mappingsToInfect;
    let fixtureContextForPrompt = fixtureChannels;

    if (targetRoles.length > 0) {
        // SURGICAL FILTER: Only send the requested channels to the AI
        mappingsForPrompt = mappingsToInfect.filter((rules, idx) => {
            const role = fixtureChannels[idx]?.role;
            return targetRoles.includes(role);
        });
        fixtureContextForPrompt = fixtureChannels.filter(ch => targetRoles.includes(ch.role));
        console.log("✂️ Surgical context enabled for roles:", targetRoles);
    }

    // SNAPSHOT FOR DIFF
    window.preAiMappings = JSON.parse(JSON.stringify(window.currentProfileMappings || []));

    if (loadingContainer) {
        loadingContainer.classList.remove('hidden');
        if (diffBtn) diffBtn.classList.add('hidden');
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
- Available Sources: volume, bass, mids, highs, impact, beat phase, bar phase, 4 bar phase, bin 0, bin 4.
- Available Behaviors: static, direct, sine, saw, square, noise, beat phase, bar phase, stochastic, spike, fuzzy, direct_stepped.
- Available Hold Types: none, beat, bar, 4 bar.
- GLOBAL ACTORS:
  - "target": "system" -> Modifies the entire room's timing and intensity.
    - Functions: "rate" (global speed multiplier), "intensity" (global master dimmer).
    - Scaling: "100" = 100% (Normal), "200" = 200% (Double), "50" = 50% (Slow-Mo).
  - "target": "visualdmx" -> Modifies Visualizer-specific shaders (u_strobe, u_blackout, u_spin, etc).

SURGICAL FOCUS:
- You are provided with a "CURRENT LIVE UI STATE".
- Each channel rule in the state now has a "_role" property (e.g. "zoom", "pos_x").
- You must ONLY return the channels that need modification.

SCHEMA RULES:
1. MODIFIERS: All timing and sensitivity settings MUST live inside the "modifiers" object (speed, react, hold_type).
2. SOURCE: Frequency bins bin 0 (Sub) and bin 4 (Treble/Mid) are available for surgical frequency targeting.
3. RANGE PRESERVATION: Keep changes within the 'cal' object bounds (min, center, max) unless explicitly asked to expand them.
4. NO STATIC FOR RANGES: Never use behavior 'static' if min != max. Use 'sine' or 'step' instead.
5. 3-DIGIT PRECISION: Always return DMX values as 0-255 integers.
6. NO SEQUENCER STRINGS: The "32-96-32" sequencer syntax is EXCLUSIVELY for Presets. DO NOT use these strings in Base Profile rules.
7. ROLE-BASED OUTPUT: The "mappings" key in your response should be an object where keys are CHANNEL ROLES (e.g., "zoom", "dimmer") and values are the rule arrays for those channels.

CHANNEL ROLE DICTIONARY:
- "pan" = role: pos_x
- "tilt" = role: pos_y
- "zoom" = role: zoom
- "strobe" = role: strobe
- "dimmer" = role: dimmer
- "drawing" = role: drawing (Laser/Vector path)
- "clip" = role: clip (Media/Video select)
- "group" = role: group (Master group index)
- GLOBAL "rate" / "global speed" / "time" -> Actor: system, Function: speed
- GLOBAL "master" / "total intensity" -> Actor: system, Function: intensity
- USER TAGS: If the user provides a tag like [ch:role] (e.g. [ch:dimmer]), prioritize it. Match aliases (e.g. "rotation" -> rot_z).

VIBE RULES & SYNC GROUPS:
The "vibe" field controls WHEN a rule activates based on detected audio energy level.
- GOLD STANDARD: Use vibe: "any" as the default. The engine automatically partitions "any" rules into Chill/Mid/High dynamics.
- SYNC GROUPS: Use variants "any 1", "any 2", or "any 3" to create variety across multiple fixtures of the same type. Spreading these variants makes the output feel more organic and less "mirrored".
- SPECIFIC VIBES: Use "chill", "mid", "high", "build", "drop" ONLY if you want a fundamentally different behavior (e.g. static on chill, but direct-mapping on high).
- CRITICAL: DO NOT delete or collapse existing ranges unless explicitly asked. Return all rules for ALL channels in the updated array.

THE PLAYBOOK (Style Macros):
- "B-Side": Shift bin sources (e.g. bin 0 -> bin 4). Invert movement. Swap speeds between Pan/Tilt.
- "Rhythm": Use 'square' or 'saw' behaviors. Source: 'impact' or 'beat phase'. React: 1.0, Speed: 0.8+.
### IMPORTANT: PARTIAL UPDATE MODE
You must ONLY return the channels that are being modified. 
Return a JSON object where the "mappings" key is an object of ROLES.
Example: If modifying zoom, return:
{
  "logic_explanation": "...",
  "mappings": {
     "zoom": [ { "behavior": "square", ... } ]
  }
}

- CURRENT LIVE UI STATE: ${JSON.stringify(mappingsForPrompt)}
- FIXTURE CONTEXT: ${JSON.stringify(fixtureContextForPrompt)}
- NEW INSTRUCTIONS: ${JSON.stringify(pendingAiInstructions)}
- CONVERSATION DIALOGUE: ${JSON.stringify(aiConversationHistory.slice(-5))}

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
            console.log("🤖 AI RAW RESPONSE:", aiResult);
        } catch (e) {
            console.error("AI JSON Parse Error:", responseText);
            throw new Error("AI returned invalid JSON: " + e.message);
        }

        const logicLog = aiResult.logic_explanation || "";
        const aiMappings = aiResult.mappings || aiResult.mapping || aiResult;
        const question = aiResult.question || "";

        // HEALING / MERGE LAYER
        // We now support both full arrays, index objects, AND role objects
        let finalMappings = JSON.parse(JSON.stringify(window.currentProfileMappings));

        if (Array.isArray(aiMappings)) {
            // Full array returned (Legacy/Fallback)
            if (aiMappings.length === fixtureChannels.length) {
                finalMappings = aiMappings;
            } else if (aiMappings.length > 0) {
                aiMappings.forEach((chRules, idx) => {
                    if (idx < finalMappings.length) finalMappings[idx] = chRules;
                });
            }
        } else if (typeof aiMappings === 'object') {
            // Handle Object keys (Could be Indices OR Roles)
            Object.keys(aiMappings).forEach(key => {
                const idx = parseInt(key);
                if (!isNaN(idx) && idx < finalMappings.length) {
                    // Merge by Index
                    console.log(`💉 Merging AI update by Index [${idx}]`);
                    finalMappings[idx] = aiMappings[key];
                } else {
                    // Merge by Role
                    const foundIdx = fixtureChannels.findIndex(ch => ch.role === key);
                    if (foundIdx !== -1) {
                        console.log(`💉 Merging AI update by Role [${key}] -> Index [${foundIdx}]`);
                        finalMappings[foundIdx] = aiMappings[key];
                    }
                }
            });
        }

        // Final Validation & Healing (Nested Modifiers)
        finalMappings.forEach(rules => {
            if (Array.isArray(rules)) {
                rules.forEach(r => {
                    if (!r.modifiers) r.modifiers = { speed: 0.5, react: 0.5, hold_type: 'none' };
                    if (r.speed !== undefined) { r.modifiers.speed = r.speed; delete r.speed; }
                    if (r.react !== undefined) { r.modifiers.react = r.react; delete r.react; }
                    if (r.hold_type !== undefined) { r.modifiers.hold_type = r.hold_type; delete r.hold_type; }
                });
            }
        });

        let newMappings = finalMappings;

        // REMOVE THINKING BUBBLE
        const thinkingBubble = document.getElementById(thinkingId);
        if (thinkingBubble) thinkingBubble.remove();

        // RE-ENABLE UI
        if (masterInput) masterInput.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        if (masterInput) masterInput.focus();

        // Update UI log removed - now contained in chat bubbles
        if (logicLog) {
            addAiChatMessage('ai', logicLog);
        }

        // Show final buttons in chat footer
        const chatDiffBtn = document.getElementById('ai-chat-view-diff-btn');
        const chatApplyBtn = document.getElementById('ai-apply-final-btn');
        if (chatDiffBtn) chatDiffBtn.classList.remove('hidden');
        if (chatApplyBtn) chatApplyBtn.classList.remove('hidden');

        // STAGING: Update the live mappings for preview, but DO NOT save to DB yet.
        window.stagedAiMappings = JSON.parse(JSON.stringify(newMappings));

        const oldZoom = JSON.stringify(window.currentProfileMappings[4]);
        const newZoom = JSON.stringify(newMappings[4]);
        console.log("💎 MERGE VERIFICATION (CH 4):", { changed: oldZoom !== newZoom, old: oldZoom, new: newZoom });

        window.currentProfileMappings = JSON.parse(JSON.stringify(newMappings));

        pendingAiInstructions = {}; // Clear after success

        if (typeof window.renderProfileMappings === 'function') {
            window.renderProfileMappings();
        } else {
            loadProfileChannels();
        }
        updateAiReviewBar();
        if (loadingContainer) {
            clearInterval(window.aiProgressInterval);
            loadingBar.style.width = '100%';
            loadingBar.style.background = 'var(--success)';
            loadingText.innerText = 'Done!';
            loadingText.style.color = 'var(--success)';
            if (diffBtn) diffBtn.classList.remove('hidden');
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
                    loadingContainer.classList.add('hidden');
                    loadingBar.style.width = '0%';
                }
            }
        }, 5000);
    }
}

function showAiDiff() {
    const oldMap = window.preAiMappings;
    const newMap = window.currentProfileMappings; // Use explicit window reference
    console.log("🔍 AI DIFF: Comparing maps", { oldLen: oldMap?.length, newLen: newMap?.length });

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

            // Compare root keys dynamically (catch all hallucinated or unexpected keys)
            Object.keys(nr).forEach(k => {
                if (k === 'modifiers' || k === 'cal' || k.startsWith('_')) return; // handled separately
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

            // Compare Modifiers dynamically
            const nm = nr.modifiers || {};
            const om = or.modifiers || {};
            Object.keys(nm).forEach(mk => {
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
        console.warn("⚠️ AI DIFF: No significant changes found between old and new map.");
        console.log("OLD MAP:", JSON.stringify(oldMap));
        console.log("NEW MAP:", JSON.stringify(newMap));
        body.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-dim);">
                    No significant changes detected in the behavior structure.
                    <div style="font-size:10px; margin-top:10px; opacity:0.5;">
                        (Old: ${oldMap?.length} ch, New: ${newMap?.length} ch)
                    </div>
                </div>`;
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
    document.getElementById('ai-loading-container').classList.add('hidden');
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
    // Hide the channel picker if open
    const picker = document.getElementById('ai-channel-picker');
    if (picker) picker.classList.add('hidden');
    // Hide the extra UI buttons if they were visible
    const diffBtn = document.getElementById('ai-chat-view-diff-btn');
    const applyBtn = document.getElementById('ai-apply-final-btn');
    if (diffBtn) diffBtn.classList.add('hidden');
    if (applyBtn) applyBtn.classList.add('hidden');
}

function clearAiChatHistory() {
    if (!confirm("Clear AI chat history and reset?")) return;
    window.aiConversationHistory = [];
    window.pendingAiInstructions = {};

    // Add initial greeting back
    addAiChatMessage('ai', "Hello! I've cleared the slate. How can I help you refine this profile now?");

    updateAiReviewBar();

    // Hide diff buttons if they were open
    const diffBtn = document.getElementById('ai-chat-view-diff-btn');
    const applyBtn = document.getElementById('ai-apply-final-btn');
    if (diffBtn) diffBtn.classList.add('hidden');
    if (applyBtn) applyBtn.classList.add('hidden');
}

function toggleChannelPicker() {
    const picker = document.getElementById('ai-channel-picker');
    if (!picker) return;

    if (!picker.classList.contains('hidden')) {
        picker.classList.add('hidden');
    } else {
        populateChannelPicker();
        picker.classList.remove('hidden');
    }
}

function populateChannelPicker() {
    const picker = document.getElementById('ai-channel-picker');
    if (!picker) return;

    const channels = currentProfileChannels || [];
    if (channels.length === 0) {
        picker.innerHTML = `<div style="padding:15px; text-align:center; color:var(--text-dim); font-size:12px;">No channels found for this profile.</div>`;
        return;
    }

    // Get unique roles from channels, filtering out 'none' and 'unknown'
    const usedRoles = [...new Set(channels.map(ch => ch.role))].filter(r => r && r !== 'none' && r !== 'unknown');

    if (usedRoles.length === 0) {
        picker.innerHTML = `<div style="padding:15px; text-align:center; color:var(--text-dim); font-size:12px;">Assign roles to your channels first to use the picker.</div>`;
        return;
    }

    picker.innerHTML = usedRoles.map((role) => {
        return `
                    <div class="channel-picker-item" onclick="insertChannelTag('${role}')"
                        style="padding:10px 15px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; transition:background 0.2s;">
                        <div style="font-weight:bold; color:var(--accent); text-transform:uppercase; font-size:12px;">${role}</div>
                        <div style="font-size:9px; color:var(--text-dim);">Function Role</div>
                    </div>
                `;
    }).join('');

    // Add hover effect style dynamically if not present
    if (!document.getElementById('picker-hover-style')) {
        const style = document.createElement('style');
        style.id = 'picker-hover-style';
        style.innerHTML = `.channel-picker-item:hover { background: rgba(255,255,255,0.1); }`;
        document.head.appendChild(style);
    }
}

function insertChannelTag(role) {
    const textarea = document.getElementById('ai-master-textarea');
    if (!textarea) return;

    const tag = `[ch:${role}]`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + tag + text.substring(end);

    // Put cursor after the tag
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    textarea.focus();

    // Close picker
    document.getElementById('ai-channel-picker').classList.add('hidden');
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
    alert("Settings Saved!");
}

async function refineProfileGlobal() {
    const modal = document.getElementById('ai-refine-modal');
    const textarea = document.getElementById('ai-master-textarea');
    const logEl = document.getElementById('ai-response-log');
    if (logEl) logEl.classList.add('hidden');
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
            aggregatedPrompt += `ch${idx + 1}: ${pendingAiInstructions[idx]}\n`;
            hasChannelPrompts = true;
        }
    });

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
        loadingContainer.classList.remove('hidden');
        if (diffBtn) diffBtn.classList.add('hidden');
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
            if (diffBtn) diffBtn.classList.remove('hidden');

            // Show in chat too
            const desc = type === 'bside' ? "Applied B-Side alternate variation." :
                type === 'rhythm' ? "Injected Rhythmic playmaker logic." : "Morphed into Liquid ambient variation.";
            addAiChatMessage('ai', desc);

            // Show final buttons in chat footer
            const chatDiffBtn = document.getElementById('ai-chat-view-diff-btn');
            const chatApplyBtn = document.getElementById('ai-apply-final-btn');
            if (chatDiffBtn) chatDiffBtn.classList.remove('hidden');
            if (chatApplyBtn) chatApplyBtn.classList.remove('hidden');

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
                    rule.behavior = 'direct';
                    rule.source = 'bass';
                    rule.modifiers.speed = 1.0;
                }

                if (role === 'pattern' || role === 'gobo') {
                    rule.behavior = 'noise';
                    rule.source = (Math.random() > 0.7) ? 'beat phase' : 'bar phase';
                }

                if (role.startsWith('pos_') || role.includes('pan') || role.includes('tilt')) {
                    rule.behavior = 'noise';
                    rule.source = 'beat phase';
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
        window.currentProfileMappings = JSON.parse(JSON.stringify(window.preAiMappings));

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
        if (loadingContainer) loadingContainer.classList.add('hidden');
    }
}

function acceptAiTransformation() {
    closeAiDiff();

    // Finalize currentProfileMappings by filtering out reverted rules and cleaning metadata
    window.currentProfileMappings = currentProfileMappings.map((rules) => {
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
        if (loadingContainer) loadingContainer.classList.add('hidden');

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


let lastSentAiRefinementText = "";

async function sendAiRefinement() {
    const textarea = document.getElementById('ai-master-textarea');
    let text = textarea.value.trim();
    if (!text) {
        if (lastSentAiRefinementText && !isProcessingAi) {
            text = lastSentAiRefinementText;
        } else {
            return;
        }
    } else {
        lastSentAiRefinementText = text;
    }

    if (isProcessingAi) return;

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
    // IF IN SETUP.HTML OR SIMILAR, NAVIGATE TO STANDALONE PAGE
    if (window.location.pathname.includes('setup.html') || window.location.pathname.includes('profile.html')) {
        const presetId = window.current_editing_preset_id || "";
        window.location.href = `preset_ai.html${presetId ? '?id=' + presetId : ''}`;
        return;
    }

    const modal = document.getElementById('ai-preset-modal');
    if (!modal) return;

    const textarea = document.getElementById('ai-preset-textarea');
    if (textarea) {
        textarea.value = '';
        textarea.focus();
    }

    // Update model label
    if (typeof updateModelLabelDisplay === 'function') updateModelLabelDisplay();

    // Set mode back to chat
    const history = document.getElementById('ai-preset-chat-history');
    const xyPanel = document.getElementById('ai-preset-xy-panel');
    const xyBtn = document.getElementById('ai-xy-picker-btn');
    const fixBtn = document.getElementById('ai-fix-picker-btn');
    const zoneBtn = document.getElementById('ai-zone-picker-btn');
    const fixPicker = document.getElementById('ai-fixture-picker');
    const zonePicker = document.getElementById('ai-zone-picker');

    if (history) history.classList.remove('hidden');
    if (xyPanel) xyPanel.classList.add('hidden');
    if (fixPicker) fixPicker.classList.add('hidden');
    if (zonePicker) zonePicker.classList.add('hidden');

    if (xyBtn) xyBtn.classList.remove('active');
    if (fixBtn) fixBtn.classList.remove('active');
    if (zoneBtn) zoneBtn.classList.remove('active');
}

function toggleAiXyMode() {
    const history = document.getElementById('ai-preset-chat-history');
    const xyPanel = document.getElementById('ai-preset-xy-panel');
    const xyBtn = document.getElementById('ai-xy-picker-btn');
    const fixBtn = document.getElementById('ai-fix-picker-btn');
    const zoneBtn = document.getElementById('ai-zone-picker-btn');
    const pathBtn = document.getElementById('ai-path-picker-btn');
    if (!history || !xyPanel || !xyBtn) return;

    // Close other pickers
    const fixPicker = document.getElementById('ai-fixture-picker');
    const zonePicker = document.getElementById('ai-zone-picker');
    const pathPicker = document.getElementById('ai-path-picker');
    if (fixPicker) fixPicker.classList.add('hidden');
    if (zonePicker) zonePicker.classList.add('hidden');
    if (pathPicker) pathPicker.classList.add('hidden');
    if (fixBtn) fixBtn.classList.remove('active');
    if (zoneBtn) zoneBtn.classList.remove('active');
    if (pathBtn) pathBtn.classList.remove('active');

    const isHidden = xyPanel.classList.contains('hidden');

    if (isHidden) {
        history.classList.add('hidden');
        xyPanel.classList.remove('hidden');
        xyBtn.classList.add('active');
        renderAiXyPanel();
    } else {
        history.classList.remove('hidden');
        xyPanel.classList.add('hidden');
        xyBtn.classList.remove('active');
    }
}

function renderAiXyPanel() {
    const panel = document.getElementById('ai-preset-xy-panel');
    if (!panel) return;

    // Get fixtures on stage
    const stageInstances = db.stage || [];
    const profiles = db.profiles || [];

    // Filter for fixtures that have X/Y or Zoom roles in their current profile
    const calFixtures = stageInstances.filter(inst => {
        const p = profiles.find(prof => prof.id === inst.profileId);
        if (!p) return false;
        const roles = (p.channels || []).map(ch => ch.role);
        return roles.some(r => ['pos_x', 'pos_y', 'zoom', 'pan', 'tilt'].includes(String(r).toLowerCase()));
    });

    if (calFixtures.length === 0) {
        panel.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-dim);">No active fixtures with X/Y or Zoom functions found on stage.</div>`;
        return;
    }

    if (!db.positional_data) db.positional_data = [];

    panel.innerHTML = `
                <div style="font-size:0.8rem; font-weight:bold; color:var(--accent-alt); margin-bottom:10px; text-transform:uppercase;">Fixture Calibration (by Address)</div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    ${calFixtures.map(inst => {
        const p = profiles.find(prof => prof.id === inst.profileId);
        const roles = (p.channels || []).map(ch => String(ch.role || ch.name).toLowerCase());
        const hasXY = roles.some(r => ['pos_x', 'pos_y', 'pan', 'tilt'].includes(r));
        const hasZoom = roles.some(r => r.includes('zoom'));

        // Find matching calibration by ADDRESS
        const set = (db.positional_data || []).find(s => String(s.address) === String(inst.address)) || { x: { left: 0, right: 255 }, y: { top: 0, bottom: 255 }, zoom: { smallest: 0, largest: 255 } };

        return `
                            <div style="background:rgba(255,255,255,0.03); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                    <div style="font-weight:900; font-size:11px; color:var(--accent);">${inst.id}</div>
                                    <div style="font-size:9px; color:var(--text-dim);">ADDR: ${inst.address}</div>
                                </div>
                                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                                    ${hasXY ? `
                                    <div>
                                        <label style="font-size:8px; color:var(--text-dim);">X RANGE (LEFT - RIGHT)</label>
                                        <div style="display:flex; align-items:center; gap:5px;">
                                            <input type="number" value="${set.x?.left ?? 0}" placeholder="Left" 
                                                oninput="saveAddressCalibration('${inst.address}', 'x', 'left', this.value)"
                                                style="height:24px; font-size:10px; padding:0 5px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#fff;">
                                            <span style="opacity:0.3">-</span>
                                            <input type="number" value="${set.x?.right ?? 255}" placeholder="Right" 
                                                oninput="saveAddressCalibration('${inst.address}', 'x', 'right', this.value)"
                                                style="height:24px; font-size:10px; padding:0 5px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#fff;">
                                        </div>
                                    </div>
                                    <div>
                                        <label style="font-size:8px; color:var(--text-dim);">Y RANGE (TOP - BOTTOM)</label>
                                        <div style="display:flex; align-items:center; gap:5px;">
                                            <input type="number" value="${set.y?.top ?? 0}" placeholder="Top" 
                                                oninput="saveAddressCalibration('${inst.address}', 'y', 'top', this.value)"
                                                style="height:24px; font-size:10px; padding:0 5px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#fff;">
                                            <span style="opacity:0.3">-</span>
                                            <input type="number" value="${set.y?.bottom ?? 255}" placeholder="Bottom" 
                                                oninput="saveAddressCalibration('${inst.address}', 'y', 'bottom', this.value)"
                                                style="height:24px; font-size:10px; padding:0 5px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#fff;">
                                        </div>
                                    </div>
                                    ` : '<div style="grid-column: span 2; font-size:9px; color:var(--text-dim); opacity:0.5; text-align:center; padding:5px;">No X/Y roles detected for this fixture.</div>'}
                                </div>
                                ${hasZoom ? `
                                <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.05);">
                                    <label style="font-size:8px; color:var(--text-dim);">ZOOM RANGE (SMALLEST - LARGEST)</label>
                                    <div style="display:flex; align-items:center; gap:5px; margin-top:4px;">
                                        <input type="number" value="${set.zoom?.smallest ?? 0}" placeholder="Smallest" 
                                            oninput="saveAddressCalibration('${inst.address}', 'zoom', 'smallest', this.value)"
                                            style="height:24px; font-size:10px; padding:0 5px; width:70px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#fff;">
                                        <span style="opacity:0.3">-</span>
                                        <input type="number" value="${set.zoom?.largest ?? 255}" placeholder="Largest" 
                                            oninput="saveAddressCalibration('${inst.address}', 'zoom', 'largest', this.value)"
                                            style="height:24px; font-size:10px; padding:0 5px; width:70px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#fff;">
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                        `;
    }).join('')}
                </div>
            `;
}

window.saveAddressCalibration = function (address, axis, side, val) {
    if (!db.positional_data) db.positional_data = [];

    let set = db.positional_data.find(s => String(s.address) === String(address));
    if (!set) {
        set = {
            address: address,
            x: { left: 0, right: 255 },
            y: { top: 0, bottom: 255 },
            zoom: { smallest: 0, largest: 255 }
        };
        db.positional_data.push(set);
    }

    if (!set[axis]) set[axis] = {};
    let num = parseInt(val, 10);
    set[axis][side] = isNaN(num) ? 0 : num;

    // Persist
    if (typeof saveDB === 'function') saveDB();
}

function closePresetAiModal() {
    const modal = document.getElementById('ai-preset-modal');
    if (modal) modal.classList.remove('active');
    document.body.classList.remove('ai-modal-open');

    const diffBtn = document.getElementById('ai-preset-view-diff-btn');
    const applyBtn = document.getElementById('ai-preset-apply-btn');
    if (diffBtn) diffBtn.classList.add('hidden');
    if (applyBtn) applyBtn.classList.add('hidden');
    const saveBtn = document.getElementById('ai-preset-save-btn');
    if (saveBtn) saveBtn.classList.add('hidden');

    // Hide the fixture picker if open
    const picker = document.getElementById('ai-fixture-picker');
    if (picker) picker.classList.add('hidden');
}

function toggleFixturePicker() {
    const history = document.getElementById('ai-preset-chat-history');
    const picker = document.getElementById('ai-fixture-picker');
    const zonePicker = document.getElementById('ai-zone-picker');
    const pathPicker = document.getElementById('ai-path-picker');
    const xyPanel = document.getElementById('ai-preset-xy-panel');

    const fixBtn = document.getElementById('ai-fix-picker-btn');
    const zoneBtn = document.getElementById('ai-zone-picker-btn');
    const pathBtn = document.getElementById('ai-path-picker-btn');
    const xyBtn = document.getElementById('ai-xy-picker-btn');

    if (!picker) return;

    // Close other pickers
    if (zonePicker) zonePicker.classList.add('hidden');
    if (xyPanel) xyPanel.classList.add('hidden');
    if (pathPicker) pathPicker.classList.add('hidden');
    if (zoneBtn) zoneBtn.classList.remove('active');
    if (pathBtn) pathBtn.classList.remove('active');
    if (xyBtn) xyBtn.classList.remove('active');

    if (!picker.classList.contains('hidden')) {
        picker.classList.add('hidden');
        if (fixBtn) fixBtn.classList.remove('active');
        if (history) history.classList.remove('hidden');
    } else {
        populateFixturePicker();
        picker.classList.remove('hidden');
        if (fixBtn) fixBtn.classList.add('active');
        if (history) history.classList.add('hidden');
    }
}

function toggleZonePicker() {
    const history = document.getElementById('ai-preset-chat-history');
    const picker = document.getElementById('ai-zone-picker');
    const fixPicker = document.getElementById('ai-fixture-picker');
    const pathPicker = document.getElementById('ai-path-picker');
    const xyPanel = document.getElementById('ai-preset-xy-panel');

    const fixBtn = document.getElementById('ai-fix-picker-btn');
    const zoneBtn = document.getElementById('ai-zone-picker-btn');
    const pathBtn = document.getElementById('ai-path-picker-btn');
    const xyBtn = document.getElementById('ai-xy-picker-btn');

    if (!picker) return;

    // Close other pickers
    if (fixPicker) fixPicker.classList.add('hidden');
    if (xyPanel) xyPanel.classList.add('hidden');
    if (pathPicker) pathPicker.classList.add('hidden');
    if (fixBtn) fixBtn.classList.remove('active');
    if (pathBtn) pathBtn.classList.remove('active');
    if (xyBtn) xyBtn.classList.remove('active');

    if (!picker.classList.contains('hidden')) {
        picker.classList.add('hidden');
        if (zoneBtn) zoneBtn.classList.remove('active');
        if (history) history.classList.remove('hidden');
    } else {
        populateZonePicker();
        picker.classList.remove('hidden');
        if (zoneBtn) zoneBtn.classList.add('active');
        if (history) history.classList.add('hidden');
    }
}

function togglePathPicker() {
    const history = document.getElementById('ai-preset-chat-history');
    const picker = document.getElementById('ai-fixture-picker');
    const zonePicker = document.getElementById('ai-zone-picker');
    const pathPicker = document.getElementById('ai-path-picker');
    const xyPanel = document.getElementById('ai-preset-xy-panel');

    const fixBtn = document.getElementById('ai-fix-picker-btn');
    const zoneBtn = document.getElementById('ai-zone-picker-btn');
    const pathBtn = document.getElementById('ai-path-picker-btn');
    const xyBtn = document.getElementById('ai-xy-picker-btn');

    if (!pathPicker) return;

    // Close other pickers
    if (picker) picker.classList.add('hidden');
    if (zonePicker) zonePicker.classList.add('hidden');
    if (xyPanel) xyPanel.classList.add('hidden');
    if (fixBtn) fixBtn.classList.remove('active');
    if (zoneBtn) zoneBtn.classList.remove('active');
    if (xyBtn) xyBtn.classList.remove('active');

    if (!pathPicker.classList.contains('hidden')) {
        pathPicker.classList.add('hidden');
        if (pathBtn) pathBtn.classList.remove('active');
        if (history) history.classList.remove('hidden');
    } else {
        populatePathPicker();
        pathPicker.classList.remove('hidden');
        if (pathBtn) pathBtn.classList.add('active');
        if (history) history.classList.add('hidden');
    }
}

function populateZonePicker() {
    console.log("📂 Populating AI Zone Picker...");
    const picker = document.getElementById('ai-zone-picker');
    if (!picker) return;

    const stage = db.stage || [];
    // Get unique zones, excluding empty ones
    const zones = [...new Set(stage.map(inst => (inst.zone || '').trim()).filter(z => z !== ''))];

    if (zones.length === 0) {
        picker.innerHTML = `<div style="padding:15px; text-align:center; color:var(--text-dim); font-size:12px;">No zones found. Add locations to your fixtures in the Stage tab!</div>`;
        return;
    }

    picker.innerHTML = zones.map((zone) => {
        const count = stage.filter(inst => (inst.zone || '').trim() === zone).length;
        return `
                    <div class="fixture-picker-item" onclick="insertZoneTag('${zone}')"
                        style="padding:10px 15px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; transition:background 0.2s;">
                        <div>
                            <div style="font-weight:bold; color:var(--accent-alt); text-transform:uppercase; font-size:12px;">${zone}</div>
                            <div style="font-size:9px; color:var(--text-dim);">${count} fixtures</div>
                        </div>
                        <div style="font-size:9px; color:var(--text-dim);">Zone</div>
                    </div>
                `;
    }).join('');
}

function populateFixturePicker() {
    console.log("📂 Populating AI Fixture Picker...");
    const picker = document.getElementById('ai-fixture-picker');
    if (!picker) return;

    const fixtures = _buildStageContext();
    if (fixtures.length === 0) {
        picker.innerHTML = `<div style="padding:15px; text-align:center; color:var(--text-dim); font-size:12px;">No fixtures found on stage. Patch some lights first!</div>`;
        return;
    }

    picker.innerHTML = fixtures.map((fix) => {
        return `
                    <div class="fixture-picker-item" onclick="insertFixtureTag('${fix.id}')"
                        style="padding:10px 15px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; transition:background 0.2s;">
                        <div>
                            <div style="font-weight:bold; color:var(--accent); text-transform:uppercase; font-size:12px;">${fix.id}</div>
                            <div style="font-size:9px; color:var(--text-dim);">${fix.profileName} [${fix.zone}]</div>
                        </div>
                        <div style="font-size:9px; color:var(--text-dim);">Fixture</div>
                    </div>
                `;
    }).join('');

    // Add hover effect style dynamically if not present
    if (!document.getElementById('fix-picker-hover-style')) {
        const style = document.createElement('style');
        style.id = 'fix-picker-hover-style';
        style.innerHTML = `.fixture-picker-item:hover { background: rgba(255,255,255,0.1); }`;
        document.head.appendChild(style);
    }
}

function insertFixtureTag(fixId) {
    const textarea = document.getElementById('ai-preset-textarea');
    if (!textarea) return;

    const tag = `[fix:${fixId}]`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + tag + text.substring(end);

    // Put cursor after the tag
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    textarea.focus();

    // Close picker
    const picker = document.getElementById('ai-fixture-picker');
    if (picker) picker.classList.add('hidden');
    const fixBtn = document.getElementById('ai-fix-picker-btn');
    if (fixBtn) fixBtn.classList.remove('active');

    const history = document.getElementById('ai-preset-chat-history');
    if (history) history.classList.remove('hidden');
}

function insertZoneTag(zoneName) {
    const textarea = document.getElementById('ai-preset-textarea');
    if (!textarea) return;

    const tag = ` [zone:${zoneName}]`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + tag + text.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    textarea.focus();

    // Close picker
    const picker = document.getElementById('ai-zone-picker');
    if (picker) picker.classList.add('hidden');
    const zoneBtn = document.getElementById('ai-zone-picker-btn');
    if (zoneBtn) zoneBtn.classList.remove('active');

    const history = document.getElementById('ai-preset-chat-history');
    if (history) history.classList.remove('hidden');
}

function populatePathPicker() {
    const picker = document.getElementById('ai-path-picker');
    if (!picker) return;

    const paths = [
        { id: 'circle', name: 'Circle', desc: 'Smooth orbital motion' },
        { id: 'lissajous', name: 'Lissajous', desc: 'Basic weaving pattern' },
        { id: 'lissajous_complex', name: 'Complex Lissajous', desc: 'Asymmetric intricate weave' },
        { id: 'diagonal_tl_br', name: 'Diagonal (TL to BR)', desc: 'Top-Left to Bottom-Right' },
        { id: 'diagonal_tr_bl', name: 'Diagonal (TR to BL)', desc: 'Top-Right to Bottom-Left' },
        { id: 'horiz_sweep', name: 'Horizontal Sweep', desc: 'Full width side-to-side' },
        { id: 'vert_sweep', name: 'Vertical Sweep', desc: 'Full height up-and-down' }
    ];

    picker.innerHTML = paths.map((path) => {
        return `
                    <div class="path-picker-item" onclick="insertPathTag('${path.id}')"
                        style="padding:10px 15px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; transition:background 0.2s;">
                        <div>
                            <div style="font-weight:bold; color:var(--accent); text-transform:uppercase; font-size:12px;">${path.name}</div>
                            <div style="font-size:9px; color:var(--text-dim);">${path.desc}</div>
                        </div>
                        <div style="font-size:9px; color:var(--text-dim);">[path:${path.id}]</div>
                    </div>
                `;
    }).join('');

    if (!document.getElementById('path-picker-hover-style')) {
        const style = document.createElement('style');
        style.id = 'path-picker-hover-style';
        style.innerHTML = `.path-picker-item:hover { background: rgba(255,255,255,0.1); }`;
        document.head.appendChild(style);
    }
}

function insertPathTag(pathId) {
    const textarea = document.getElementById('ai-preset-textarea');
    if (!textarea) return;

    const tag = ` [path:${pathId}]`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + tag + text.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    textarea.focus();

    const picker = document.getElementById('ai-path-picker');
    if (picker) picker.classList.add('hidden');
    const pathBtn = document.getElementById('ai-path-picker-btn');
    if (pathBtn) pathBtn.classList.remove('active');

    const history = document.getElementById('ai-preset-chat-history');
    if (history) history.classList.remove('hidden');
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
    if (diffBtn) diffBtn.classList.add('hidden');
    if (applyBtn) applyBtn.classList.add('hidden');
}

function _buildStageContext() {
    const stageInstances = db.stage || [];
    const profiles = db.profiles || [];
    const posData = db.positional_data || [];

    return stageInstances.map(inst => {
        const prof = profiles.find(p => p.id === inst.profileId);
        const channels = prof ? (prof.channels || []) : [];

        // Find matching calibration set by ADDRESS
        const calibration = posData.find(set => String(set.address) === String(inst.address));

        return {
            id: inst.id,
            address: inst.address,
            zone: inst.zone || 'center',
            profileName: prof ? prof.name : 'Unknown',
            roles: channels.map(ch => ch.role || ch.name || 'unknown'),
            calibration: calibration ? {
                x: calibration.x,
                y: calibration.y,
                zoom: calibration.zoom
            } : null
        };
    });
}

let lastSentPresetAiText = "";

async function sendPresetAiPrompt() {
    const textarea = document.getElementById('ai-preset-textarea');
    let text = (textarea?.value || '').trim();
    if (!text) {
        if (lastSentPresetAiText && !isProcessingPresetAi) {
            text = lastSentPresetAiText;
        } else {
            return;
        }
    } else {
        lastSentPresetAiText = text;
    }

    if (isProcessingPresetAi) return;

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
    const calibrated = stageContext.filter(f => f.calibration);
    const uncalibrated = stageContext.filter(f => !f.calibration);
    let spatialDescription = "";

    if (calibrated.length > 0) {
        spatialDescription += "CALIBRATED FIXTURES (STRICT LIMITS):\n";
        spatialDescription += calibrated.map(f => {
            const c = f.calibration;
            let d = `- Fixture ${f.id} [Zone: ${f.zone}]: `;
            if (c.x && c.y) d += `X(Left:${c.x.left}, Right:${c.x.right}), Y(Top:${c.y.top}, Bottom:${c.y.bottom})`;
            if (c.zoom) d += `, Zoom(Smallest:${c.zoom.smallest}, Largest:${c.zoom.largest})`;
            return d;
        }).join('\n');
        spatialDescription += "\n- INSTRUCTION: When moving these, STAY WITHIN the boundaries above.";
    }
    if (uncalibrated.length > 0) {
        spatialDescription += "\n\nUNCALIBRATED FIXTURES (USE GENERIC 0-255):\n";
        spatialDescription += uncalibrated.map(f => `- Fixture ${f.id} [Zone: ${f.zone}] (Generic 0-255)`).join('\n');
    }

    const systemPrompt = `Role: Expert Stage Lighting Designer for RaveBox Preset System.
Task: ${current_editing_preset_id ? 'Refine an existing' : 'Generate a new'} preset based on the user's description.

FIXTURE SPATIAL CONTEXT (CRITICAL):
${spatialDescription || "NOTICE: No stage fixtures found. Use global mode."}

ZONES & TARGETING:
- Fixtures are assigned to zones (e.g., "top", "bottom", "left", "right", "center").
- If the user specifies a zone (e.g., "[zone:top]"), you MUST only target fixtures belonging to that zone.
- If a fixture is NOT in the requested zone, do NOT include it in the overrides.

ROLE MAPPING:
KNOWN_ROLES: ${window.KNOWN_ROLES ? window.KNOWN_ROLES.join(', ') : 'pos_x, pos_y, pos_x fine, pos_y fine, zoom, rot_z, rot_x, rot_y, color_solid, color_multi, pattern, beam_fx, grating, drawing, drawing_delay, strobe, generic, dimmer, mode, clip, group, background, tex, shader, speed, gobo, effect'}

SPATIAL FORMULA COOKBOOK (Templates for X/Y):
1. CIRCLE: pos_x: "[Left]-[Right]-[Left]", pos_y: "[Top]-[Bottom]-[Top] + 16"
2. LISSAJOUS: pos_x: "[Left]-[Right]-[Left]-[Right]-[Left]", pos_y: "[Top]-[Bottom]-[Top] + 16"
3. COMPLEX LISSAJOUS: pos_x: "[Left]-[Right]-[Left]-[Right]-[Left]-[Right]-[Left]", pos_y: "[Top]-[Bottom]-[Top]-[Bottom]-[Top] + 16"
4. DIAGONAL (TL to BR): pos_x: "[Left]-[Right]-[Left]", pos_y: "[Top]-[Bottom]-[Top]"
5. DIAGONAL (TR to BL): pos_x: "[Right]-[Left]-[Right]", pos_y: "[Top]-[Bottom]-[Top]"
6. HORIZ SWEEP: pos_x: "[Left]-[Right]-[Left]", pos_y: "[Center]"
7. VERT SWEEP: pos_x: "[Center]", pos_y: "[Top]-[Bottom]-[Top]"

[PATH] TAGS:
- If the user provides a tag like [path:circle], [path:lissajous], etc., you MUST replace it with the EXACT sequence formulas from the cookbook above.
- Replace "[Left]", "[Right]", "[Top]", "[Bottom]", and "[Center]" with the actual numeric values from the FIXTURE SPATIAL CONTEXT provided below.
- Example: If s1 is Left:32, Right:96, then [path:horiz_sweep] for s1 is pos_x: "32-96-32", pos_y: "64" (center).

TRIGGER LOGIC:
- Multiple triggers within a single preset are evaluated with AND logic. 
- All conditions (e.g. Vibe is High AND Volume > 50%) must be met for the preset to activate.

OVERRIDE SCHEMA:
- ALL VALUES MUST BE NUMERIC OR NUMERIC SEQUENCES/SWEEPS (e.g. "128" or "10-90-10").
- To offset/phase shift a sequence, append '+ [offset]' (e.g., "10-90-10 + 16" to start 16 frames out-of-phase). Use different offsets for different fixtures to create out-of-phase movements.
- To speed up or slow down a sequence/sweep, append 'x[multiplier]' to the sequence part (e.g. "10-90-10x2" to run at double speed, or "10-90-10x0.5" to run at half speed).
- You can combine speed and phase offset, e.g. "10-90-10x2 + 16" or "10-90-10 + 16".
- "mode": "value" is the standard for all functions.
- NEVER use behavioral strings like "sine", "saw", "pulse", or "sparkle" for spatial movement (X, Y, Zoom).
- Calculate movement sequences based on the REAL-WORLD CALIBRATION boundaries provided above.
- Instance JSON: {id: "<target>", target: "<target>", type: "instance", role: "<role>", value: <val>, channels: [{name: "<role>", value: <val>, mode: "value"}]}

- CURRENT LIVE UI STATE:
- Preset Label: "${document.getElementById('pres-name')?.value || 'Unnamed Preset'}"
- Active Triggers: ${JSON.stringify(currentPresetTriggers)}
- Active Overrides: ${JSON.stringify(currentPresetOverrides)}

- NEW INSTRUCTION: ${text}
- CONVERSATION DIALOGUE: ${JSON.stringify(presetConversationHistory.slice(-5))}

Output: Return a JSON object with EXACTLY this structure:
{
  "presets": [
    {
      "name": "Descriptive Name",
      "triggers": [
         { "type": "channel", "fixture": "fixture_id", "role": "dimmer", "greater_than": 200 },
         { "type": "volume", "greater_than": 80 }
      ],
      "overrides": [
         { "type": "instance", "fixture": "fixture_id", "role": "dimmer", "value": 255 },
         { "type": "global", "role": "color_solid", "value": "10-250-10", "channels": [{ "name": "color_solid", "value": "10-250-10", "mode": "value", "source": "volume" }] }
      ]
    }
  ],
  "logic_explanation": "Compact summary of the strategy"
}
CRITICAL: Do NOT return an empty presets array. If you describe a lighting plan in 'logic_explanation', you MUST provide the corresponding JSON data in the 'presets' array.
Output: Valid raw JSON object only.`;


    try {
        let retries = 0;
        const maxRetries = 3;
        let response, data;

        while (retries < maxRetries) {
            try {
                const model = localStorage.getItem('vj_gemini_model') || 'gemini-2.5-flash';
                response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: systemPrompt }] }]
                    })
                });

                data = await response.json();

                if (response.status === 503) {
                    retries++;
                    console.warn(`⚠️ Gemini 503 (High Demand). Retrying (${retries}/${maxRetries})...`);
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries))); // Exponential backoff
                    continue;
                }

                if (data.error) {
                    if (data.error.code === 503 || data.error.message.includes('overloaded')) {
                        retries++;
                        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries)));
                        continue;
                    }
                    throw new Error(data.error.message);
                }
                break; // Success
            } catch (e) {
                if (retries >= maxRetries - 1) throw e;
                retries++;
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries)));
            }
        }

        if (!response || !response.ok) {
            throw new Error(`AI Service Error: ${response?.status || 'Unknown'}. The model may be experiencing high demand. Try switching models in AI Settings.`);
        }

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
                triggers: (p.triggers || []).map(t => {
                    const fixtureId = t.fixture || t.target || t.id || '';
                    const role = t.role || t.name || '';
                    return {
                        type: t.type || 'manual',
                        value: t.value || '',
                        fixture: fixtureId,
                        target: fixtureId,
                        role: role,
                        greater_than: t.greater_than ?? 0,
                        less_than: t.less_than ?? 100
                    };
                }),
                overrides: (p.overrides || []).map(o => {
                    const fixtureId = o.fixture || o.target || o.id || 'global';
                    const role = o.role || o.name || 'dimmer';
                    const val = o.value ?? 0;
                    const type = o.type || (fixtureId === 'global' ? 'global' : 'instance');

                    const channels = (o.channels && o.channels.length > 0) ? o.channels.map(ch => {
                        let chVal = ch.value ?? val;
                        let chMode = ch.mode || 'value';

                        // AUTO-CORRECT: Sequences, offsets, and speed-multipliers must be in 'value' mode
                        if (typeof chVal === 'string' && (chVal.includes('-') || chVal.includes(',') || chVal.includes('+') || chVal.toLowerCase().includes('x')) && chMode === 'behavior') {
                            chMode = 'value';
                        }

                        return {
                            name: ch.name || role,
                            value: chVal,
                            mode: chMode,
                            source: ch.source || 'volume'
                        };
                    }) : [{
                        name: role,
                        value: val,
                        mode: 'value'
                    }];

                    return {
                        id: fixtureId,
                        target: fixtureId,
                        fixture: fixtureId,
                        type: type,
                        name: role,
                        role: role,
                        value: val,
                        channels: channels
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
        const saveBtn = document.getElementById('ai-preset-save-btn');
        if (diffBtn) diffBtn.classList.remove('hidden');
        if (applyBtn) applyBtn.classList.remove('hidden');
        if (saveBtn) saveBtn.classList.remove('hidden');

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

    const modal = document.getElementById('ai-preset-diff-container');
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

    modal.classList.remove('hidden');
}

function closePresetAiDiff() {
    const modal = document.getElementById('ai-preset-diff-container');
    if (modal) modal.classList.add('hidden');
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

    modal.classList.remove('hidden');
}

function closeStagedPresetsReview() {
    const modal = document.getElementById('ai-preset-staged-modal');
    if (modal) modal.classList.add('hidden');
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
                name: 'dimmer', role: 'dimmer', value: 0,
                channels: [{ name: 'dimmer', value: 0 }]
            });
        });

        // If no stage fixtures, use global
        if (fixtureIds.length === 0) {
            currentPresetOverrides.push({
                id: 'global', target: 'global', type: 'global',
                name: 'dimmer', role: 'dimmer', value: 0,
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
        if (diffBtn) diffBtn.classList.remove('hidden');
        if (applyBtn) applyBtn.classList.remove('hidden');
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
window.toggleFixturePicker = toggleFixturePicker;
window.toggleZonePicker = toggleZonePicker;
window.toggleAiXyMode = toggleAiXyMode;
window.populateFixturePicker = populateFixturePicker;
window.insertFixtureTag = insertFixtureTag;
window.insertZoneTag = insertZoneTag;

// Settings & Model management
window.openAiSettings = openAiSettings;
window.closeAiSettings = closeAiSettings;
window.saveAiSettings = saveAiSettings;
window.updateModelLabelDisplay = updateModelLabelDisplay;
