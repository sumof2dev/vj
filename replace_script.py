import sys

with open("setup.html", "r") as f:
    lines = f.readlines()

new_chunk1 = """        const KNOWN_MODIFIERS = [
            { id: 'dimmer', label: 'Direct: Dimmer' },
            { id: 'mode', label: 'Direct: Mode' },
            { id: 'axis_a', label: 'Lissajous: Slow A' },
            { id: 'axis_d', label: 'Lissajous: Slow D (Offset)' },
            { id: 'axis_b', label: 'Lissajous: Mid B' },
            { id: 'axis_e', label: 'Lissajous: Mid E (Offset)' },
            { id: 'axis_c', label: 'Lissajous: Fast C' },
            { id: 'bass', label: 'Direct: Bass Energy' },
            { id: 'flux', label: 'Direct: Transients (Flux)' },
            { id: 'beat', label: 'Trigger: Beat Envelope' },
            { id: 'pattern_cycle', label: 'Cycle: Shapes (On Beat)' },
            { id: 'color_cycle', label: 'Cycle: Colors (On Beat)' }
        ];

        // ==================== CHANNELS (UNIFIED LFO UI) ====================
        function renderChannelsSection() {
            const ch = currentProfile.channels;
            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:15px">Map physical channels to the LFO Logic Matrix and configure scale.</div>';

            // Init missing schemas to prevent errors
            if (!currentProfile.modifiers) currentProfile.modifiers = {};
            if (!currentProfile.channel_macros) currentProfile.channel_macros = {};
            if (!currentProfile.calibration) currentProfile.calibration = {};

            const sortedChannels = Object.entries(ch).sort((a, b) => a[1] - b[1]);

            sortedChannels.forEach(([role, offset]) => {
                const chNum = offset + 1;
                
                // Get State
                let mod = currentProfile.modifiers[role] || 'static';
                let cal = currentProfile.calibration[role] || {min: 0, center: 127, max: 255};
                let macros = currentProfile.channel_macros[role] || [];

                html += `<div class="card" style="margin-bottom: 10px; padding: 12px; border-left: 4px solid var(--accent); background:rgba(255,255,255,0.01);">`;

                // --- TOP ROW: Channel Name & Modifier ---
                html += `<div class="kv-row" style="margin-bottom: 8px;">`;
                html += `<div style="width:100px; font-weight:bold; color:var(--accent); font-size:14px;">CH ${chNum} <div style="font-size:10px; color:#666; font-weight:normal;">(Offs ${offset})</div></div>`;

                // Subscribing to the LFO Engine
                html += `<select class="kv-wide" onchange="updateProfileModifier('${role}', this.value)" style="flex:1; background:#222; border:1px solid var(--accent); color:white;">`;
                KNOWN_MODIFIERS.forEach(m => {
                    html += `<option value="${m.id}" ${m.id === mod ? 'selected' : ''}>${m.label}</option>`;
                });
                html += `</select>`;
                
                // Role Re-name and Offset Adjust
                html += `<input type="text" value="${role}" style="width:100px; font-size:11px; background:#111; border:none; text-align:right;" onchange="renameProfileChannel('${role}', this.value)" title="Rename Logic Role">`;
                html += `<input type="number" value="${offset}" min="0" max="512" style="width:40px; font-size:11px; margin-left:5px;" onchange="updateProfileChannel('${role}', parseInt(this.value))" title="Offset">`;
                html += `<button class="kv-remove" style="margin-left:8px; width:30px; height:30px;" onclick="removeProfileChannel('${role}')">×</button>`;
                html += `</div>`; 

                // --- BOTTOM ROW: 3-Point Calibration & Macros ---
                html += `<div class="kv-row" style="background: rgba(0,0,0,0.3); padding:8px; border-radius:4px; font-size:11px;">`;
                
                // Scale UI
                html += `<div style="display:flex; gap:10px; align-items:center; flex:1;">
                            <div style="color:var(--text-dim)">Scale:</div>
                            <div style="display:flex; flex-direction:column; align-items:center;">
                                <label style="margin:0; font-size:9px; color:#555;">MIN (-1.0)</label>
                                <input type="number" value="${cal.min ?? 0}" style="width:100px; text-align:center;" onchange="updateCal('${role}', 'min', this.value)">
                            </div>
                            <div style="display:flex; flex-direction:column; align-items:center;">
                                <label style="margin:0; font-size:9px; color:var(--accent);">CENTER (0.0)</label>
                                <input type="number" value="${cal.center ?? 127}" style="width:100px; text-align:center; border-color:var(--accent);" onchange="updateCal('${role}', 'center', this.value)">
                            </div>
                            <div style="display:flex; flex-direction:column; align-items:center;">
                                <label style="margin:0; font-size:9px; color:#555;">MAX (+1.0)</label>
                                <input type="number" value="${cal.max ?? 255}" style="width:100px; text-align:center;" onchange="updateCal('${role}', 'max', this.value)">
                            </div>
                         </div>`;

                // Drop Macro UI
                html += `<div style="display:flex; flex-direction:column; min-width:180px;">
                            <label style="margin:0 0 2px 0; font-size:9px; color:var(--danger);">OVERRIDE MACROS (On Drop)</label>`;
                if (macros.length > 0) {
                    html += `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px;">`;
                    macros.forEach(m => {
                        html += `<span style="background:rgba(255,71,87,0.2); color:var(--danger); border:1px solid var(--danger); padding:2px 6px; border-radius:12px; font-size:10px; cursor:pointer;" onclick="removeChannelMacro('${role}', '${m}')">${m} ×</span>`;
                    });
                    html += `</div>`;
                }
                html += `<select style="background:#111; font-size:10px; padding:2px;" onchange="addChannelMacro('${role}', this.value); this.value='';">
                            <option value="">+ Add Hardware Macro...</option>
                            ${KNOWN_MACROS.map(m => `<option value="${m}">${m}</option>`).join('')}
                         </select>`;
                html += `</div>`;
                
                html += `</div>`; // End Bottom Row
                
                // Shapes dictionary inclusion for patterns
                if (role === 'pattern') html += getShapesHtml(role);

                html += `</div>`; // End Card
            });

            html += `<button class="add-row-btn" style="padding:12px; font-weight:bold;" onclick="appendNewChannel()">+ Append Extra Channel</button>`;
            return html;
        }

        // Logic Updaters for New Schema
        function updateProfileModifier(role, val) {
            if (!currentProfile.modifiers) currentProfile.modifiers = {};
            currentProfile.modifiers[role] = val;
            syncUiToJson();
        }

        function updateCal(role, key, val) {
            if (!currentProfile.calibration) currentProfile.calibration = {};
            if (!currentProfile.calibration[role]) currentProfile.calibration[role] = {min: 0, center: 127, max: 255};
            currentProfile.calibration[role][key] = parseInt(val);
            syncUiToJson();
        }

        function addChannelMacro(role, macro) {
            if (!macro) return;
            if (!currentProfile.channel_macros) currentProfile.channel_macros = {};
            if (!currentProfile.channel_macros[role]) currentProfile.channel_macros[role] = [];
            if (!currentProfile.channel_macros[role].includes(macro)) {
                currentProfile.channel_macros[role].push(macro);
            }
            syncUiToJson();
            renderProfileUi();
        }

        function removeChannelMacro(role, macro) {
            if (currentProfile.channel_macros && currentProfile.channel_macros[role]) {
                currentProfile.channel_macros[role] = currentProfile.channel_macros[role].filter(m => m !== macro);
                syncUiToJson();
                renderProfileUi();
            }
        }
"""

new_chunk2 = """        // Removed legacy Mode and Calibration block code
"""

start1 = 1680 - 1
end1 = 1913 - 1

start2 = 2044 - 1
end2 = 2124 - 1

out_lines = lines[:start1] + [new_chunk1] + lines[end1+1:start2] + [new_chunk2] + lines[end2+1:]

with open("setup.html", "w") as f:
    f.writelines(out_lines)

print("Done replacing chunks!")
