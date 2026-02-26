        // --- STATE ---
        const API_BASE = '/api/fixtures';
        let stageConfig = { devices: {} };
        let rolesConfig = {
            lead: {
                pos_x: [32, 96],
                pos_y: [32, 96],
                zoom: [0, 127],
                rot_z: [0, 127]
            },
            rythm: {
                boots: { shapes: [], colors: [] },
                cats: { shapes: [], colors: [] },
                cha: { shapes: [], colors: [] }
            }
        };
        let currentProfile = null;
        let availableProfiles = [];
        let ws = null;

        // --- INIT ---
        async function init() {
            await Promise.all([
                loadStageConfig(),
                loadProfileList(),
                loadRolesConfig()
            ]);
            initScenes();
            connectWs();
            renderPresetsManager();
        }

        // --- NAVIGATION ---
        function showView(viewId) {
            document.querySelectorAll('.view-panel').forEach(el => el.classList.remove('active'));
            document.getElementById('view-' + viewId).classList.add('active');
            document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
            event.currentTarget.classList.add('active');
        }

        // --- STAGE MANAGER ---
        async function loadStageConfig() {
            try {
                const res = await fetch(`${API_BASE}/stage_config.json`);
                if (!res.ok) throw new Error("No stage config");
                stageConfig = await res.json();

                if (!stageConfig.devices) stageConfig.devices = {};
                if (stageConfig.lasers) {
                    Object.assign(stageConfig.devices, stageConfig.lasers);
                    delete stageConfig.lasers;
                }

                renderDevices();
                populateTestDevices();
            } catch (e) {
                console.error(e);
                stageConfig = { devices: {} };
            }
        }

        async function saveStageConfig() {
            try {
                const res = await fetch(`${API_BASE}/stage_config.json`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(stageConfig, null, 4)
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                alert('Stage Configuration Saved!');
            } catch (e) {
                alert(`Error saving layout: ${e.message}`);
            }
        }

        // --- ROLES CONFIGURATION ---
        async function loadRolesConfig() {
            try {
                const res = await fetch(`/roles.json`);
                if (res.ok) {
                    const data = await res.json();
                    rolesConfig = Object.assign(rolesConfig, data);
                    console.log("Loaded rolesConfig:", rolesConfig);
                }
            } catch (e) {
                console.warn("No roles.json found, using defaults");
            }
            renderRolesUi();
        }

        async function saveRolesConfig() {
            try {
                const res = await fetch(`/roles.json`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(rolesConfig, null, 4)
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                alert('Roles Configuration Saved!');
            } catch (e) {
                alert(`Error saving roles: ${e.message}`);
            }
        }

        function renderRolesUi() {
            renderLeadRanges();
            renderRythmBuckets();
        }

        function renderLeadRanges() {
            const container = document.getElementById('lead-ranges-ui');
            container.innerHTML = '';

            const channels = ['pos_x', 'pos_y', 'zoom', 'rot_z'];
            channels.forEach(ch => {
                const range = rolesConfig.lead[ch] || [0, 255];
                const row = document.createElement('div');
                row.className = 'kv-row';
                row.innerHTML = `
                    <div class="kv-name" style="text-transform:uppercase; font-size:11px; color:var(--accent)">${ch.replace('_', ' ')}</div>
                    <input type="number" class="kv-val" value="${range[0]}" onchange="updateLeadRange('${ch}', 0, this.value)">
                    <span style="color:var(--text-dim)">-</span>
                    <input type="number" class="kv-val" value="${range[1]}" onchange="updateLeadRange('${ch}', 1, this.value)">
                `;
                container.appendChild(row);
            });
        }

        function updateLeadRange(ch, index, val) {
            if (!rolesConfig.lead[ch]) rolesConfig.lead[ch] = [0, 255];
            rolesConfig.lead[ch][index] = parseInt(val);
        }

        function renderRythmBuckets() {
            ['boots', 'cats', 'cha'].forEach(cat => {
                const list = document.getElementById(`rythm-${cat}-list`);
                list.innerHTML = '';

                const items = rolesConfig.rythm[cat];
                items.shapes.forEach(shape => {
                    list.appendChild(createBucketItem(cat, 'shapes', shape, '💠'));
                });
                items.colors.forEach(color => {
                    list.appendChild(createBucketItem(cat, 'colors', color, '🎨'));
                });
            });
        }

        function createBucketItem(category, type, value, icon) {
            const el = document.createElement('div');
            el.style = "display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.05); padding:4px 8px; border-radius:4px; font-size:11px;";
            el.innerHTML = `
                <span style="display:flex; align-items:center; gap:5px;">
                    <span>${icon}</span>
                    <span style="color:var(--text);">${value}</span>
                </span>
                <button onclick="removeFromBucket('${category}', '${type}', '${value}')" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:0 4px;">×</button>
            `;
            return el;
        }

        async function openRythmPicker(category, type) {
            // Get available shapes or colors from the first laser fixture we find
            let options = [];
            const laserDev = Object.values(stageConfig.devices).find(d => d.type === 'ehaho_laser');
            if (!laserDev) {
                alert("No ehaho_laser found in stage config to pull patterns/colors from.");
                return;
            }

            try {
                const res = await fetch(`${API_BASE}/ehaho_laser.json`);
                const profile = await res.json();

                if (type === 'shape') {
                    options = Object.keys(profile.shapes || {});
                } else {
                    options = (profile.modes?.color_solid?.individual?.colors || []).map(c => c.name);
                }

                const choice = prompt(`Select ${type} to add to ${category}:\n\n` + options.join(', '));
                if (choice && options.includes(choice)) {
                    if (!rolesConfig.rythm[category][type + 's'].includes(choice)) {
                        rolesConfig.rythm[category][type + 's'].push(choice);
                        renderRythmBuckets();
                    }
                } else if (choice) {
                    alert("Invalid selection");
                }
            } catch (e) {
                alert("Error loading profile data: " + e.message);
            }
        }

        function removeFromBucket(category, type, value) {
            rolesConfig.rythm[category][type] = rolesConfig.rythm[category][type].filter(v => v !== value);
            renderRythmBuckets();
        }



        function renderDevices() {
            const list = document.getElementById('device-list');
            list.innerHTML = '';

            Object.entries(stageConfig.devices).forEach(([key, dev]) => {
                const row = document.createElement('div');
                row.className = 'device-row';

                let profOptions = availableProfiles.map(p =>
                    `<option value="${p.replace('.json', '')}" ${dev.type === p.replace('.json', '') ? 'selected' : ''}>${p}</option>`
                ).join('');

                row.innerHTML = `
                <input type="text" value="${key}" onchange="updateDeviceKey('${key}', this.value)" style="font-weight:bold" placeholder="Device Name">
                <select onchange="updateDeviceProp('${key}', 'type', this.value)">${profOptions}</select>
                
                <select onchange="updateDeviceProp('${key}', 'category', this.value)" title="Fixture Category">
                    <option value="laser" ${dev.category === 'laser' ? 'selected' : ''}>Laser</option>
                    <option value="light" ${dev.category === 'light' ? 'selected' : ''}>Light</option>
                    <option value="led_strip" ${dev.category === 'led_strip' ? 'selected' : ''}>LED Strip</option>
                    <option value="outlet" ${dev.category === 'outlet' ? 'selected' : ''}>Outlet</option>
                    <option value="generic" ${dev.category === 'generic' ? 'selected' : ''}>Generic</option>
                </select>
                
                <select onchange="updateDeviceProp('${key}', 'location', this.value)" title="Physical Location">
                    <option value="left" ${dev.location === 'left' ? 'selected' : ''}>Left</option>
                    <option value="right" ${dev.location === 'right' ? 'selected' : ''}>Right</option>
                    <option value="bottom" ${dev.location === 'bottom' ? 'selected' : ''}>Bottom</option>
                    <option value="top" ${dev.location === 'top' ? 'selected' : ''}>Top</option>
                    <option value="center" ${dev.location === 'center' ? 'selected' : ''}>Center</option>
                    <option value="n/a" ${dev.location === 'n/a' ? 'selected' : ''}>N/A</option>
                </select>

                <input type="number" value="${dev.address}" onchange="updateDeviceProp('${key}', 'address', parseInt(this.value))" title="DMX Address" placeholder="Addr">
                <input type="number" value="${dev.offset}" onchange="updateDeviceProp('${key}', 'offset', parseInt(this.value))" title="Channel Offset" placeholder="Offs">
                
                <div class="checkbox-group">
                    <label class="custom-checkbox ${dev.invert_x ? 'checked' : ''}">
                        <input type="checkbox" ${dev.invert_x ? 'checked' : ''} onchange="updateDeviceProp('${key}', 'invert_x', this.checked); this.parentElement.classList.toggle('checked', this.checked)"> 
                        ↔ Inv X
                    </label>
                    <label class="custom-checkbox ${dev.invert_y ? 'checked' : ''}">
                        <input type="checkbox" ${dev.invert_y ? 'checked' : ''} onchange="updateDeviceProp('${key}', 'invert_y', this.checked); this.parentElement.classList.toggle('checked', this.checked)"> 
                        ↕ Inv Y
                    </label>
                </div>

                <select onchange="updateDeviceProp('${key}', 'behavior', this.value); renderDevices()" title="Behavior Role">
                    <option value="lead" ${dev.behavior === 'lead' || !dev.behavior ? 'selected' : ''}>Lead (Fluid)</option>
                    <option value="rhythm" ${dev.behavior === 'rhythm' ? 'selected' : ''}>Rhythm</option>

                </select>

                <button class="kv-remove" onclick="deleteDevice('${key}')">×</button>
            `;
                list.appendChild(row);
            });
        }

        function addDevice() {
            const name = prompt("Device Name (e.g. L3):");
            if (name) {
                stageConfig.devices[name] = {
                    type: "ehaho_laser", category: "laser", address: 1, offset: 0,
                    location: "left", behavior: "lead",
                    invert_x: false, invert_y: false
                };
                renderDevices();
            }
        }

        function updateDeviceProp(key, prop, val) {
            stageConfig.devices[key][prop] = val;
        }

        function updateDeviceKey(oldKey, newKey) {
            if (oldKey === newKey) return;
            stageConfig.devices[newKey] = stageConfig.devices[oldKey];
            delete stageConfig.devices[oldKey];
            renderDevices();
        }

        function deleteDevice(key) {
            if (confirm(`Delete ${key}?`)) {
                delete stageConfig.devices[key];
                renderDevices();
            }
        }

        // --- FIXTURE EDITOR ---
        async function loadProfileList() {
            const res = await fetch(API_BASE);
            const files = await res.json();
            availableProfiles = files.filter(f => f !== 'stage_config.json');

            const sel = document.getElementById('profile-select');
            sel.innerHTML = '<option value="">-- Select Profile --</option>';
            availableProfiles.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.innerText = f;
                sel.appendChild(opt);
            });

            // Re-render stage devices to populate dropdowns
            if (stageConfig.devices) renderDevices();
        }

        async function loadFixtureProfile(fname) {
            if (!fname) {
                document.getElementById('editor-container').style.display = 'none';
                document.getElementById('editor-empty-state').style.display = 'block';
                return;
            }

            const res = await fetch(`${API_BASE}/${fname}`);
            currentProfile = await res.json();

            document.getElementById('fix-filename').value = fname.replace('.json', '');
            document.getElementById('fix-type').value = currentProfile.type || '';
            document.getElementById('fix-name').value = currentProfile.name || '';
            syncUiToJson();

            document.getElementById('editor-container').style.display = 'block';
            document.getElementById('editor-empty-state').style.display = 'none';
            renderProfileUi();
        }

        async function saveFixtureProfile() {
            try {
                // Sync basic info fields into currentProfile
                if (currentProfile) {
                    currentProfile.type = document.getElementById('fix-type').value;
                    currentProfile.name = document.getElementById('fix-name').value;
                }
                const data = currentProfile || JSON.parse(document.getElementById('json-editor').value);

                const fname = document.getElementById('fix-filename').value + '.json';

                const res = await fetch(`${API_BASE}/${fname}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data, null, 4)
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                alert(`Saved ${fname}`);
                loadProfileList();
            } catch (e) {
                alert("Error saving JSON: " + e.message);
            }
        }

        function createNewProfile() {
            const name = prompt("Filename (no extension):");
            if (!name) return;

            const countStr = prompt("How many DMX channels does this fixture use?");
            let count = parseInt(countStr) || 1;

            document.getElementById('fix-filename').value = name;
            currentProfile = {
                type: name,
                name: "New Fixture",
                channels: {},
                modes: {},
                defaults: {},
                calibration: {},
                shapes: {},
                ranges: {},
                dynamics: {},
                macros: {}
            };

            // Populate channels sequentially
            for (let i = 0; i < count; i++) {
                let roleName = `generic_ch${i + 1}`;
                currentProfile.channels[roleName] = i;
                currentProfile.defaults[roleName] = 0;
            }

            document.getElementById('fix-type').value = name;
            document.getElementById('fix-name').value = "New Fixture";
            syncUiToJson();

            document.getElementById('editor-container').style.display = 'block';
            document.getElementById('editor-empty-state').style.display = 'none';
            renderProfileUi();
        }

        function parseJsonToUi() {
            try {
                const data = JSON.parse(document.getElementById('json-editor').value);
                currentProfile = data;
                document.getElementById('fix-type').value = data.type || '';
                document.getElementById('fix-name').value = data.name || '';
                renderProfileUi();
            } catch (e) {
                alert("Invalid JSON");
            }
        }

        function syncUiToJson() {
            if (!currentProfile) return;
            document.getElementById('json-editor').value = JSON.stringify(currentProfile, null, 4);
        }

        // ==================== ENGINE SCHEMA ====================
        // Defines what the DMX engine supports per channel role
        const KNOWN_ROLES = [
            'pos_x', 'pos_y', 'zoom', 'rot_z', 'rot_x', 'rot_y',
            'color_solid', 'color_multi', 'pattern',
            'beam_fx', 'grating', 'drawing', 'drawing_delay',
            'strobe', 'generic', 'dimmer',
            'mode', 'clip', 'group'
        ];

        // Role → which modes the engine uses
        const ROLE_MODES = {
            pos_x: ['manual', 'wave'],
            pos_y: ['manual', 'wave'],
            zoom: ['manual', 'oscillation'],
            rot_z: ['manual', 'distortion'],
            color_solid: ['individual', 'cycle']
        };

        // Role → which dynamics group applies
        const ROLE_DYNAMICS = {
            pos_x: 'pan_tilt', pos_y: 'pan_tilt',
            zoom: 'zoom',
            rot_z: 'rotation', rot_x: 'rotation', rot_y: 'rotation',
            beam_fx: 'beam_fx',
            grating: 'grating',
            drawing: 'drawing', drawing_delay: 'drawing'
        };

        // Dynamics group → known parameter names
        const DYNAMICS_PARAMS = {
            pan_tilt: ['base_offset', 'zoom_offset_mult', 'beat_punch', 'flux_boost', 'energy_threshold_high', 'energy_threshold_mid'],
            zoom: ['bass_mult', 'treble_mult', 'flux_mult', 'energy_threshold', 'overdrive_threshold'],
            rotation: ['mod_base', 'mod_mult', 'energy_threshold', 'confidence_threshold'],
            beam_fx: ['high_threshold', 'base', 'mult'],
            grating: ['mid_threshold', 'mid_val', 'high_threshold_a', 'high_val_a', 'high_threshold_b', 'high_base', 'high_mult'],
            drawing: ['energy_threshold', 'delay_base', 'delay_mult', 'val_base', 'val_mult']
        };

        // Known macro names the engine references
        const KNOWN_MACROS = [
            'wave_up', 'wave_down', 'wave_left', 'wave_right',
            'zoom_out_a', 'zoom_out_b', 'zoom_in_out', 'zoom_rot',
            'distort_up', 'distort_down', 'rot_fast', 'rot_frantic'
        ];

        // Role → which calibration params apply
        const ROLE_CALIBRATION = {
            pos_x: ['center', 'left', 'right'],
            pos_y: ['center', 'top', 'bottom'],
            zoom: ['min_dmx', 'max_dmx', 'center']
        };

        // Roles that use shapes
        const ROLES_WITH_SHAPES = ['pattern'];
        // Roles that are static (defaults only)
        const STATIC_ROLES = ['mode', 'clip', 'group', 'dimmer'];

        // ==================== SECTION VISIBILITY ====================
        function profileHasRolesFor(section) {
            const roles = Object.keys(currentProfile.channels || {});
            switch (section) {
                case 'modes': return roles.some(r => ROLE_MODES[r]);
                case 'calibration': return roles.some(r => ROLE_CALIBRATION[r]);
                case 'shapes': return roles.some(r => ROLES_WITH_SHAPES.includes(r));
                case 'dynamics': return roles.some(r => ROLE_DYNAMICS[r]);
                case 'macros': return roles.some(r => ROLE_MODES[r] && ROLE_MODES[r].length > 1);
                case 'defaults': return roles.length > 0;
                case 'ranges': return roles.some(r => ROLE_MODES[r]);
                case 'generics': return roles.some(r => r === 'generic' || r.startsWith('generic'));
                case 'strobes': return roles.some(r => r === 'strobe');
                case 'dimmers': return roles.some(r => r === 'dimmer');
                default: return true;
            }
        }

        // Track which sections are open
        let openSections = { channels: true, modes: false, defaults: false, calibration: false, shapes: false, ranges: false, dynamics: false, macros: false, generics: false, strobes: false, dimmers: false };

        function toggleSection(key) {
            openSections[key] = !openSections[key];
            renderProfileUi();
        }

        function makeSectionCard(key, title, bodyHtml) {
            const isOpen = openSections[key];
            return `<div class="card">
                <div class="section-toggle" onclick="toggleSection('${key}')">
                    <h3>${title}</h3>
                    <span class="arrow ${isOpen ? 'open' : ''}">▶</span>
                </div>
                <div class="section-body ${isOpen ? '' : 'collapsed'}">${bodyHtml}</div>
            </div>`;
        }

        // ==================== MASTER RENDER ====================
        function renderProfileUi() {
            if (!currentProfile) return;
            const container = document.getElementById('profile-sections');
            const p = currentProfile;

            // Ensure all sections exist
            if (!p.channels) p.channels = {};
            if (!p.modes) p.modes = {};
            if (!p.defaults) p.defaults = {};
            if (!p.calibration) p.calibration = {};
            if (!p.shapes) p.shapes = {};
            if (!p.ranges) p.ranges = {};
            if (!p.dynamics) p.dynamics = {};
            if (!p.macros) p.macros = {};

            let html = '';
            html += makeSectionCard('channels', '📡 Channels', renderChannelsSection());

            // Only show sections relevant to current channel roles
            if (profileHasRolesFor('modes'))
                html += makeSectionCard('modes', '🎛 Modes', renderModesSection());
            if (profileHasRolesFor('defaults'))
                html += makeSectionCard('defaults', '⚙️ Defaults', renderDefaultsSection());
            if (profileHasRolesFor('calibration'))
                html += makeSectionCard('calibration', '🎯 Calibration', renderCalibrationSection());
            if (profileHasRolesFor('shapes'))
                html += makeSectionCard('shapes', '🔷 Shapes', renderShapesSection());
            if (profileHasRolesFor('ranges'))
                html += makeSectionCard('ranges', '📏 Ranges', renderRangesSection());
            if (profileHasRolesFor('dynamics'))
                html += makeSectionCard('dynamics', '🎚 Dynamics', renderDynamicsSection());
            if (profileHasRolesFor('macros'))
                html += makeSectionCard('macros', '⚡ Macros', renderMacrosSection());
            if (profileHasRolesFor('generics'))
                html += makeSectionCard('generics', '🎛 Generics', renderGenericsSection());
            if (profileHasRolesFor('strobes'))
                html += makeSectionCard('strobes', '💥 Strobes', renderStrobesSection());
            if (profileHasRolesFor('dimmers'))
                html += makeSectionCard('dimmers', '🌑 Dimmers', renderDimmersSection());

            container.innerHTML = html;
        }

        // ==================== CHANNELS ====================
        function renderChannelsSection() {
            const ch = currentProfile.channels;
            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Map physical DMX channels to logical roles.</div>';

            // Sort by offset so they appear in physical channel order
            const sortedChannels = Object.entries(ch).sort((a, b) => a[1] - b[1]);

            sortedChannels.forEach(([role, offset]) => {
                const chNum = offset + 1; // 1-based display
                html += `<div class="kv-row" style="background:rgba(255,255,255,0.02); padding:8px; border-radius:4px; margin-bottom:4px; flex-wrap:wrap;">`;
                html += `<div style="width:130px; font-weight:bold; color:var(--accent);">CH ${chNum} <span style="font-size:10px; color:#666">(Offs ${offset})</span></div>`;

                const isGeneric = role === 'generic' || role.startsWith('generic_');

                // Get available roles (allow generic to be used infinitely)
                const usedRoles = Object.keys(ch).filter(r => !r.startsWith('generic'));
                const availableRoles = KNOWN_ROLES.filter(r => !usedRoles.includes(r) || r === role || r === 'generic');

                html += `<select class="kv-wide" onchange="handleRoleChange('${role}', this.value)" style="margin-right:10px; min-width:120px;">`;
                if (isGeneric) {
                    html += `<option value="${role}" selected>Generic / Unassigned</option>`;
                }
                availableRoles.forEach(r => {
                    if (r === 'generic') {
                        html += `<option value="generic">Generic...</option>`;
                    } else {
                        html += `<option value="${r}" ${r === role && !isGeneric ? 'selected' : ''}>${r}</option>`;
                    }
                });
                html += `</select>`;

                // Keep offset editable just in case, but de-emphasized
                html += `<input type="number" value="${offset}" min="0" max="512" style="width:55px; font-size:11px;" onchange="updateProfileChannel('${role}', parseInt(this.value))" title="Manual Offset Adjust">`;
                html += `<button class="kv-remove" style="margin-left:8px;" onclick="removeProfileChannel('${role}')">×</button>`;
                html += `</div>`;
            });

            html += `<div style="margin-top:10px;">
                <button class="add-row-btn" onclick="appendNewChannel()">+ Append Extra Channel</button>
            </div>`;
            return html;
        }

        function handleRoleChange(oldRole, newValue) {
            let newRole = newValue;
            if (newValue === 'generic') {
                const suffix = prompt("Enter a suffix for this generic channel (e.g., 'fan', 'macro'):\nLeave blank for standard 'generic'.");
                if (suffix === null) {
                    renderProfileUi(); // Re-render to reset the dropdown visually
                    return;
                }
                newRole = suffix ? `generic_${suffix.replace(/\s+/g, '_')}` : 'generic';
            }
            renameProfileChannel(oldRole, newRole);
        }

        function appendNewChannel() {
            const offsets = Object.values(currentProfile.channels);
            const nextOffset = offsets.length > 0 ? Math.max(...offsets) + 1 : 0;
            const newRole = `generic_ch${nextOffset + 1}`;

            currentProfile.channels[newRole] = nextOffset;
            currentProfile.defaults[newRole] = 0;
            syncUiToJson();
            renderProfileUi();
        }

        function removeProfileChannel(role) {
            if (!confirm(`Remove channel "${role}"?`)) return;
            delete currentProfile.channels[role];
            delete currentProfile.defaults[role];
            delete currentProfile.modes[role];
            if (currentProfile.calibration) delete currentProfile.calibration[role];
            // Clean dynamics if no other channel uses the same group
            if (ROLE_DYNAMICS[role]) {
                const grp = ROLE_DYNAMICS[role];
                const othersUsingGroup = Object.keys(currentProfile.channels).some(r => ROLE_DYNAMICS[r] === grp);
                if (!othersUsingGroup) delete currentProfile.dynamics[grp];
            }
            syncUiToJson();
            renderProfileUi();
        }

        function renameProfileChannel(oldName, newName) {
            if (oldName === newName || !newName) return;
            if (currentProfile.channels[newName] !== undefined) {
                alert("Channel name already exists!");
                // Re-render to revert input
                renderProfileUi();
                return;
            }
            const val = currentProfile.channels[oldName];
            delete currentProfile.channels[oldName];
            currentProfile.channels[newName] = val;
            // Move related entries
            if (currentProfile.defaults && currentProfile.defaults[oldName] !== undefined) {
                currentProfile.defaults[newName] = currentProfile.defaults[oldName];
                delete currentProfile.defaults[oldName];
            }

            // Move Generic config
            if (currentProfile.generic && currentProfile.generic[oldName]) {
                currentProfile.generic[newName] = currentProfile.generic[oldName];
                delete currentProfile.generic[oldName];
            }

            // Move Strobe config
            if (currentProfile.strobe && currentProfile.strobe[oldName]) {
                currentProfile.strobe[newName] = currentProfile.strobe[oldName];
                delete currentProfile.strobe[oldName];
            }
            // Clear old role-specific data, recreate for new role
            delete currentProfile.modes[oldName];
            if (currentProfile.calibration) delete currentProfile.calibration[oldName];

            if (ROLE_MODES[newName] && !currentProfile.modes[newName]) {
                currentProfile.modes[newName] = {};
                ROLE_MODES[newName].forEach(m => {
                    currentProfile.modes[newName][m] = { range: m === 'manual' || m === 'individual' ? [0, 127] : [128, 255] };
                });
            }
            if (ROLE_CALIBRATION[newName] && !currentProfile.calibration[newName]) {
                currentProfile.calibration[newName] = {};
                ROLE_CALIBRATION[newName].forEach(p => {
                    let def = 0;
                    if (p === 'center') def = 64;
                    else if (p === 'max_dmx' || p === 'right' || p === 'bottom') def = 127;
                    else if (p === 'left' || p === 'top' || p === 'min_dmx') def = 0;
                    else if (p === 'range') def = 32;
                    currentProfile.calibration[newName][p] = def;
                });
            }
            syncUiToJson();
            renderProfileUi();
        }

        function updateProfileChannel(role, val) {
            currentProfile.channels[role] = val;
            syncUiToJson();
            renderProfileUi(); // Force re-sort if offset changed manually
        }

        // ==================== MODES ====================
        function renderModesSection() {
            const modes = currentProfile.modes;
            const rolesWithModes = Object.keys(currentProfile.channels).filter(r => ROLE_MODES[r]);
            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Per-channel behavior modes (auto-populated from role)</div>';

            rolesWithModes.forEach(chName => {
                const modeDefs = modes[chName] || {};
                const availableModes = ROLE_MODES[chName] || [];

                html += `<div class="sub-card"><h4>${chName}</h4>`;

                Object.entries(modeDefs).forEach(([modeName, modeData]) => {
                    const rangeMin = modeData.range ? modeData.range[0] : 0;
                    const rangeMax = modeData.range ? modeData.range[1] : 255;

                    // Mode name as dropdown
                    const modeOpts = availableModes.map(m =>
                        `<option value="${m}" ${m === modeName ? 'selected' : ''}>${m}</option>`
                    ).join('');

                    html += `<div class="kv-row" style="flex-wrap:wrap">
                        <select class="kv-name" style="max-width:130px" onchange="renameProfileMode('${chName}', '${modeName}', this.value)">${modeOpts}</select>
                        <span style="color:var(--text-dim); font-size:11px">Range:</span>
                        <input class="kv-val" type="number" value="${rangeMin}" style="width:55px" onchange="updateProfileModeRange('${chName}', '${modeName}', 0, parseInt(this.value))">
                        <span style="color:var(--text-dim)">–</span>
                        <input class="kv-val" type="number" value="${rangeMax}" style="width:55px" onchange="updateProfileModeRange('${chName}', '${modeName}', 1, parseInt(this.value))">
                        <button class="kv-remove" onclick="removeProfileMode('${chName}', '${modeName}')">×</button>`;

                    // Macros as multi-select checkboxes (only for modes that reference macros)
                    if (modeData.macros) {
                        const activeMacros = modeData.macros || [];
                        html += `<div style="flex-basis:100%; margin-top:4px">
                            <span style="font-size:11px; color:var(--text-dim)">Macros:</span>
                            <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px">`;
                        KNOWN_MACROS.forEach(m => {
                            const checked = activeMacros.includes(m);
                            html += `<label class="custom-checkbox small ${checked ? 'checked' : ''}" style="gap:4px">
                                <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleModeMacro('${chName}', '${modeName}', '${m}', this.checked); this.parentElement.classList.toggle('checked', this.checked)"> ${m}
                            </label>`;
                        });
                        html += `</div></div>`;
                    }

                    // Colors (for color_solid individual mode)
                    if (modeData.colors) {
                        const colorsJson = JSON.stringify(modeData.colors);
                        html += `<div style="flex-basis:100%; margin-top:4px">
                            <span style="font-size:11px; color:var(--text-dim)">Colors JSON:</span>
                            <input type="text" value='${colorsJson.replace(/'/g, "&#39;")}' style="flex:1; font-size:11px; font-family:monospace" onchange="updateProfileModeColors('${chName}', '${modeName}', this.value)">
                        </div>`;
                    }

                    html += `</div>`;
                });

                // Add missing modes for this role
                const definedModes = Object.keys(modeDefs);
                const missingModes = availableModes.filter(m => !definedModes.includes(m));
                if (missingModes.length > 0) {
                    html += `<div style="display:flex; gap:8px; margin-top:6px">
                        <select id="add-mode-${chName}" style="width:130px">${missingModes.map(m => `<option value="${m}">${m}</option>`).join('')}</select>
                        <button class="btn" onclick="addProfileMode('${chName}')">+ Add Mode</button>
                    </div>`;
                }
                html += `</div>`;
            });

            return html;
        }

        function addProfileMode(chName) {
            const sel = document.getElementById('add-mode-' + chName);
            if (!sel) return;
            const modeName = sel.value;
            if (!modeName) return;
            if (!currentProfile.modes[chName]) currentProfile.modes[chName] = {};

            const isFirst = modeName === 'manual' || modeName === 'individual';
            currentProfile.modes[chName][modeName] = { range: isFirst ? [0, 127] : [128, 255] };

            // Auto-add macros array for effect modes
            if (modeName !== 'manual' && modeName !== 'individual' && modeName !== 'cycle') {
                currentProfile.modes[chName][modeName].macros = [];
            }
            syncUiToJson();
            renderProfileUi();
        }

        function removeProfileMode(chName, modeName) {
            delete currentProfile.modes[chName][modeName];
            if (Object.keys(currentProfile.modes[chName]).length === 0) {
                delete currentProfile.modes[chName];
            }
            syncUiToJson();
            renderProfileUi();
        }

        function renameProfileMode(chName, oldName, newName) {
            if (oldName === newName || !newName) return;
            currentProfile.modes[chName][newName] = currentProfile.modes[chName][oldName];
            delete currentProfile.modes[chName][oldName];
            syncUiToJson();
            renderProfileUi();
        }

        function updateProfileModeRange(chName, modeName, idx, val) {
            if (!currentProfile.modes[chName][modeName].range) currentProfile.modes[chName][modeName].range = [0, 255];
            currentProfile.modes[chName][modeName].range[idx] = val;
            syncUiToJson();
        }

        function toggleModeMacro(chName, modeName, macroName, checked) {
            const mode = currentProfile.modes[chName][modeName];
            if (!mode.macros) mode.macros = [];
            if (checked && !mode.macros.includes(macroName)) {
                mode.macros.push(macroName);
            } else if (!checked) {
                mode.macros = mode.macros.filter(m => m !== macroName);
            }
            syncUiToJson();
        }

        function updateProfileModeColors(chName, modeName, val) {
            try {
                currentProfile.modes[chName][modeName].colors = JSON.parse(val);
                syncUiToJson();
            } catch (e) {
                alert("Invalid JSON for colors");
            }
        }

        // ==================== DEFAULTS ====================
        function renderDefaultsSection() {
            const defs = currentProfile.defaults;
            const channelNames = Object.keys(currentProfile.channels);
            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Default DMX value (0–255) for each channel at startup</div>';
            channelNames.forEach(role => {
                const val = defs[role] !== undefined ? defs[role] : 0;
                html += `<div class="kv-row">
                    <span class="kv-name" style="font-family:monospace; color:var(--accent)">${role}</span>
                    <input class="kv-val" type="number" value="${val}" min="0" max="255" onchange="updateProfileDefault('${role}', parseInt(this.value))">
                </div>`;
            });
            return html;
        }

        function updateProfileDefault(role, val) {
            currentProfile.defaults[role] = val;
            syncUiToJson();
        }

        // ==================== CALIBRATION ====================
        function renderCalibrationSection() {
            const cal = currentProfile.calibration || {};
            const rolesWithCal = Object.keys(currentProfile.channels).filter(r => ROLE_CALIBRATION[r]);
            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Per-channel calibration (auto-populated from role)</div>';

            rolesWithCal.forEach(chName => {
                const params = cal[chName] || {};
                const knownParams = ROLE_CALIBRATION[chName] || [];

                html += `<div class="sub-card"><h4>${chName}</h4>`;
                knownParams.forEach(paramName => {
                    const paramVal = params[paramName] !== undefined ? params[paramName] : 0;
                    html += `<div class="kv-row">
                        <span class="kv-name" style="font-family:monospace; color:var(--accent)">${paramName}</span>
                        <input class="kv-val" type="number" value="${paramVal}" onchange="updateCalibrationParam('${chName}', '${paramName}', parseFloat(this.value))">
                    </div>`;
                });
                html += `</div>`;
            });
            return html;
        }

        function updateCalibrationParam(chName, paramName, val) {
            if (!currentProfile.calibration[chName]) currentProfile.calibration[chName] = {};
            currentProfile.calibration[chName][paramName] = val;
            syncUiToJson();
        }

        // ==================== SHAPES ====================
        function renderShapesSection() {
            const shapes = currentProfile.shapes || {};
            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Shape name → DMX pattern value</div>';
            Object.entries(shapes).forEach(([name, val]) => {
                html += `<div class="kv-row">
                    <input class="kv-name" type="text" value="${name}" onchange="renameProfileShape('${name}', this.value)">
                    <input class="kv-val" type="number" value="${val}" min="0" max="255" onchange="updateProfileShape('${name}', parseInt(this.value))">
                    <button class="kv-remove" onclick="removeProfileShape('${name}')">×</button>
                </div>`;
            });
            html += `<button class="add-row-btn" onclick="addProfileShape()">+ Add Shape</button>`;
            return html;
        }

        function addProfileShape() {
            const name = prompt("Shape name (e.g. circle, star, dot1):");
            if (!name) return;
            if (!currentProfile.shapes) currentProfile.shapes = {};
            currentProfile.shapes[name] = 0;
            syncUiToJson();
            renderProfileUi();
        }

        function removeProfileShape(name) {
            delete currentProfile.shapes[name];
            syncUiToJson();
            renderProfileUi();
        }

        function renameProfileShape(oldName, newName) {
            if (oldName === newName || !newName) return;
            currentProfile.shapes[newName] = currentProfile.shapes[oldName];
            delete currentProfile.shapes[oldName];
            syncUiToJson();
        }

        function updateProfileShape(name, val) {
            currentProfile.shapes[name] = val;
            syncUiToJson();
        }

        // ==================== RANGES ====================
        function renderRangesSection() {
            const ranges = currentProfile.ranges || {};
            const channels = currentProfile.channels || {};
            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">DMX value ranges [min, max]</div>';

            // Sort roles by their DMX offset
            const sortedRoles = Object.keys(ranges).sort((a, b) => {
                const offsetA = channels[a] !== undefined ? channels[a] : 999;
                const offsetB = channels[b] !== undefined ? channels[b] : 999;
                return offsetA - offsetB;
            });

            sortedRoles.forEach(name => {
                const arr = ranges[name];
                const min = Array.isArray(arr) ? arr[0] : 0;
                const max = Array.isArray(arr) ? arr[1] : 255;
                const offset = channels[name] !== undefined ? channels[name] : '?';
                const chNum = typeof offset === 'number' ? offset + 1 : '?';

                html += `<div class="kv-row">
                    <span class="kv-name" style="font-family:monospace; color:var(--accent); min-width:120px;">
                        <span style="color:var(--text-dim); font-size:10px; margin-right:8px;">CH ${chNum}</span>
                        ${name}
                    </span>
                    <input class="kv-val" type="number" value="${min}" style="width:55px" onchange="updateProfileRange('${name}', 0, parseInt(this.value))">
                    <span style="color:var(--text-dim)">–</span>
                    <input class="kv-val" type="number" value="${max}" style="width:55px" onchange="updateProfileRange('${name}', 1, parseInt(this.value))">
                </div>`;
            });
            return html;
        }

        function updateProfileRange(name, idx, val) {
            if (!Array.isArray(currentProfile.ranges[name])) currentProfile.ranges[name] = [0, 255];
            currentProfile.ranges[name][idx] = val;
            syncUiToJson();
        }

        // ==================== DYNAMICS ====================
        function renderDynamicsSection() {
            const dyn = currentProfile.dynamics || {};
            // Only show groups that are relevant to current roles
            const activeGroups = new Set();
            Object.keys(currentProfile.channels).forEach(r => {
                if (ROLE_DYNAMICS[r]) activeGroups.add(ROLE_DYNAMICS[r]);
            });

            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Audio-reactive engine tuning (auto-populated from roles)</div>';

            activeGroups.forEach(groupName => {
                const params = dyn[groupName] || {};
                const knownParams = DYNAMICS_PARAMS[groupName] || [];

                html += `<div class="sub-card"><h4>${groupName}</h4>`;
                knownParams.forEach(paramName => {
                    const paramVal = params[paramName] !== undefined ? params[paramName] : 0;
                    html += `<div class="kv-row">
                        <span class="kv-name" style="font-family:monospace; color:var(--accent)">${paramName}</span>
                        <input class="kv-val" type="number" value="${paramVal}" step="0.01" onchange="updateDynamicsParam('${groupName}', '${paramName}', parseFloat(this.value))">
                    </div>`;
                });
                html += `</div>`;
            });
            return html;
        }

        function updateDynamicsParam(groupName, paramName, val) {
            if (!currentProfile.dynamics[groupName]) currentProfile.dynamics[groupName] = {};
            currentProfile.dynamics[groupName][paramName] = val;
            syncUiToJson();
        }

        // ==================== MACROS ====================
        function renderMacrosSection() {
            const macros = currentProfile.macros || {};
            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Macro name → DMX trigger value</div>';

            // Show all known macros with current values
            KNOWN_MACROS.forEach(name => {
                const val = macros[name] !== undefined ? macros[name] : '';
                const isActive = macros[name] !== undefined;
                html += `<div class="kv-row">
                    <label class="custom-checkbox small ${isActive ? 'checked' : ''}" style="flex:1">
                        <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleMacro('${name}', this.checked); this.parentElement.classList.toggle('checked', this.checked)">
                        <span class="kv-name" style="font-family:monospace; color:${isActive ? 'var(--accent)' : 'var(--text-dim)'}; margin:0">${name}</span>
                    </label>
                    <input class="kv-val" type="number" value="${val}" min="0" max="255" style="width:60px" onchange="updateProfileMacro('${name}', parseInt(this.value))">
                </div>`;
            });
            return html;
        }

        function toggleMacro(name, checked) {
            if (checked) {
                currentProfile.macros[name] = 128;
            } else {
                delete currentProfile.macros[name];
            }
            syncUiToJson();
            renderProfileUi();
        }

        function updateProfileMacro(name, val) {
            currentProfile.macros[name] = val;
            syncUiToJson();
        }

        // ==================== GENERICS ====================
        function renderGenericsSection() {
            const gen = currentProfile.generic || {};
            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Configure generic linear channels</div>';

            // Find all channels with role 'generic'
            const roles = Object.keys(currentProfile.channels).filter(r => r === 'generic' || r.startsWith('generic'));

            if (roles.length === 0) return html + '<div style="color:var(--text-dim)">No generic channels found. Add a channel with role "generic".</div>';

            roles.forEach(role => {
                const cfg = gen[role] || { min: 0, max: 255, default: 0, modifier: 'intensity' };
                html += `<div class="sub-card"><h4>${role}</h4>
                    <div class="device-row" style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:5px; background:none; padding:0">
                        <div>
                            <label>Min</label>
                            <input type="number" value="${cfg.min}" onchange="updateGenericParam('${role}', 'min', parseInt(this.value))">
                        </div>
                        <div>
                            <label>Max</label>
                            <input type="number" value="${cfg.max}" onchange="updateGenericParam('${role}', 'max', parseInt(this.value))">
                        </div>
                        <div>
                            <label>Default</label>
                            <input type="number" value="${cfg.default}" onchange="updateGenericParam('${role}', 'default', parseInt(this.value))">
                        </div>
                        <div>
                            <label>Modifier</label>
                            <select onchange="updateGenericParam('${role}', 'modifier', this.value)">
                                <option value="intensity" ${cfg.modifier === 'intensity' ? 'selected' : ''}>Intensity</option>
                                <option value="flux" ${cfg.modifier === 'flux' ? 'selected' : ''}>Flux</option>
                                <option value="bass" ${cfg.modifier === 'bass' ? 'selected' : ''}>Bass</option>
                                <option value="treble" ${cfg.modifier === 'treble' ? 'selected' : ''}>Treble</option>
                                <option value="crosstalk" ${cfg.modifier === 'crosstalk' ? 'selected' : ''} title="Inverse of Modifier">Crosstalk</option>
                                <option value="none" ${cfg.modifier === 'none' ? 'selected' : ''}>None</option>
                            </select>
                        </div>
                    </div>
                </div>`;
            });
            return html;
        }

        function updateGenericParam(role, param, val) {
            if (!currentProfile.generic) currentProfile.generic = {};
            if (!currentProfile.generic[role]) currentProfile.generic[role] = { min: 0, max: 255, default: 0, modifier: 'intensity' };
            currentProfile.generic[role][param] = val;
            syncUiToJson();
        }

        // ==================== STROBES ====================
        function renderStrobesSection() {
            const strb = currentProfile.strobe || {};
            const roles = Object.keys(currentProfile.channels).filter(r => r === 'strobe');

            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Configure strobe channel range. Activates on high intensity + treble.</div>';

            if (roles.length === 0) return html + '<div style="color:var(--text-dim)">No strobe channels found. Add a channel with role "strobe".</div>';

            roles.forEach(role => {
                const cfg = strb[role] || { min: 0, max: 255 };
                html += `<div class="sub-card"><h4>${role}</h4>
                     <div class="row">
                        <label>Range:</label>
                        <input class="kv-val" type="number" value="${cfg.min}" style="width:60px" onchange="updateStrobeParam('${role}', 'min', parseInt(this.value))">
                        <span style="color:var(--text-dim)">–</span>
                        <input class="kv-val" type="number" value="${cfg.max}" style="width:60px" onchange="updateStrobeParam('${role}', 'max', parseInt(this.value))">
                    </div>
                </div>`;
            });
            return html;
        }

        function updateStrobeParam(role, param, val) {
            if (!currentProfile.strobe) currentProfile.strobe = {};
            if (!currentProfile.strobe[role]) currentProfile.strobe[role] = { min: 0, max: 255 };
            currentProfile.strobe[role][param] = val;
            syncUiToJson();
        }

        // ==================== DIMMERS ====================
        function renderDimmersSection() {
            const dim = currentProfile.dimmers || {};
            const roles = Object.keys(currentProfile.channels).filter(r => r === 'dimmer');

            let html = '<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px">Configure master intensity or power channels.</div>';

            if (roles.length === 0) return html + '<div style="color:var(--text-dim)">No dimmer channels found. Add a channel with role "dimmer".</div>';

            roles.forEach((role, idx) => {
                // Use unique key if multiple dimmer channels exist
                const key = idx === 0 ? 'dimmer' : `dimmer_${idx}`;
                const cfg = dim[key] || { mode: 'binary', logic: 'normally_off', min: 0, max: 255, on_val: 255, off_val: 0 };

                html += `<div class="sub-card"><h4>${role} (Instance ${idx + 1})</h4>
                    <div class="row">
                        <label>Mode:</label>
                        <select style="width:100px" onchange="updateDimmerParam('${key}', 'mode', this.value)">
                            <option value="binary" ${cfg.mode === 'binary' ? 'selected' : ''}>Binary</option>
                            <option value="range" ${cfg.mode === 'range' ? 'selected' : ''}>Range</option>
                        </select>
                        
                        <label>Logic:</label>
                        <select style="width:120px" onchange="updateDimmerParam('${key}', 'logic', this.value)">
                            <option value="normally_off" ${cfg.logic === 'normally_off' ? 'selected' : ''}>Normally Off</option>
                            <option value="normally_on" ${cfg.logic === 'normally_on' ? 'selected' : ''}>Normally On</option>
                        </select>
                    </div>

                    ${cfg.mode === 'binary' ? `
                    <div class="row" style="margin-top:8px">
                        <label>On Value:</label>
                        <input class="kv-val" type="number" value="${cfg.on_val}" style="width:60px" onchange="updateDimmerParam('${key}', 'on_val', parseInt(this.value))">
                        <label>Off Value:</label>
                        <input class="kv-val" type="number" value="${cfg.off_val}" style="width:60px" onchange="updateDimmerParam('${key}', 'off_val', parseInt(this.value))">
                    </div>
                    ` : `
                    <div class="row" style="margin-top:8px">
                        <label>Range:</label>
                        <input class="kv-val" type="number" value="${cfg.min}" style="width:60px" onchange="updateDimmerParam('${key}', 'min', parseInt(this.value))">
                        <span style="color:var(--text-dim)">–</span>
                        <input class="kv-val" type="number" value="${cfg.max}" style="width:60px" onchange="updateDimmerParam('${key}', 'max', parseInt(this.value))">
                    </div>
                    `}
                </div>`;
            });
            return html;
        }

        function updateDimmerParam(key, param, val) {
            if (!currentProfile.dimmers) currentProfile.dimmers = {};
            if (!currentProfile.dimmers[key]) {
                currentProfile.dimmers[key] = { mode: 'binary', logic: 'normally_off', min: 0, max: 255, on_val: 255, off_val: 0 };
            }
            currentProfile.dimmers[key][param] = val;
            syncUiToJson();
            renderProfileUi(); // Re-render to show binary vs range specific rows
        }


        // --- LIVE TEST ---
        function connectWs() {
            ws = new WebSocket(`ws://${window.location.hostname}:8765`);
            ws.onopen = () => {
                document.getElementById('conn-status').innerText = "🟢 Connected";
                document.getElementById('conn-status').style.color = "var(--success)";
            };
            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === "force_refresh") {
                        window.location.reload();
                    }
                } catch (e) { }
            };
            ws.onclose = () => {
                document.getElementById('conn-status').innerText = "🔴 Disconnected";
                document.getElementById('conn-status').style.color = "var(--danger)";
                setTimeout(connectWs, 2000);
            };
        }

        function populateTestDevices() {
            const sel = document.getElementById('test-dev-select');
            sel.innerHTML = '';

            let allDevices = {};
            if (stageConfig.lasers) Object.assign(allDevices, stageConfig.lasers);
            if (stageConfig.devices) Object.assign(allDevices, stageConfig.devices);

            Object.keys(allDevices).forEach(k => {
                const opt = document.createElement('option');
                opt.value = k;
                opt.innerText = k;
                sel.appendChild(opt);
            });
            if (sel.options.length > 0) renderTestFaders();
        }

        let currentFaderValues = {};
        let saveActiveChannels = {}; // { addr: true/false }

        // --- LOOPER ENGINE ---
        let looperState = {}; // { addr: { mode: 'idle'|'rec'|'play', frames: [], playIdx: 0, lastVal: 0 } }
        let looperInterval = null;
        let isEngineVisualOn = true;

        const SCENE_MAPPINGS = {
            'hold': 'HOLD',
            'scroll': 'SCROLL',
            'chase': 'CHASE',
            'lissajous': 'LISSAJOUS'
        };

        function initScenes() {
            const grid = document.getElementById('scenes-grid');
            if (!grid) return;
            grid.innerHTML = '';

            // Only 4 buttons now
            Object.keys(SCENE_MAPPINGS).forEach((scene) => {
                const btn = document.createElement('div');
                btn.className = 'scene-btn';
                btn.style.height = '60px'; // Make them bigger since there are fewer
                btn.innerHTML = `<div class="led"></div><div style="font-size:10px; font-weight:bold; margin-top:5px;">${scene.toUpperCase()}</div>`;
                btn.onclick = () => {
                    document.querySelectorAll('.scene-btn').forEach(el => el.classList.remove('playing'));
                    btn.classList.add('playing');

                    if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'trigger_scene', scene: scene }));
                    }

                    setTimeout(() => btn.classList.remove('playing'), 500);
                };
                grid.appendChild(btn);
            });
        }

        function applyLocalScene(sceneName) {
            const devName = document.getElementById('test-dev-select').value;
            let allDevices = stageConfig.devices || {};
            const dev = allDevices[devName];
            if (!dev || !currentProfile || !currentProfile.channels) return;

            const mapping = SCENE_MAPPINGS[sceneName];
            if (!mapping) return;

            Object.entries(currentProfile.channels).forEach(([role, val]) => {
                if (mapping[role]) {
                    const offset = typeof val === 'object' ? val.offset : val;
                    const absAddr = dev.address + dev.offset + offset;

                    const minVal = mapping[role][0];
                    const maxVal = mapping[role][1];

                    if (minVal === maxVal) {
                        // Just hold
                        const disp = document.getElementById(`disp-${absAddr}`);
                        if (disp) disp.value = minVal;
                        updateDmxState(absAddr, minVal);
                    } else {
                        // Range sequence
                        const disp = document.getElementById(`disp-${absAddr}`);
                        if (disp) disp.value = `${minVal}-${maxVal}`;
                        generateRangeSequence(absAddr, minVal, maxVal);
                    }
                }
            });
        }

        function toggleEngineVisual() {
            const track = document.getElementById('engine-toggle');
            isEngineVisualOn = !isEngineVisualOn;

            if (isEngineVisualOn) {
                track.classList.add('on');
                // Clear overrides for the currently selected device
                const devName = document.getElementById('test-dev-select').value;
                if (ws && ws.readyState === 1 && devName) {
                    ws.send(JSON.stringify({ type: 'clear_overrides', device: devName }));

                    // Also clear local UI fader values for this device? 
                    // Let's at least reset the currentFaderValues cache for those addresses
                    // but we don't know the exact addresses easily without re-scanning profile
                }
            } else {
                track.classList.remove('on');
            }
        }

        function toggleLooper(addr) {
            if (!looperState[addr]) looperState[addr] = { mode: 'idle', frames: [], playIdx: 0, lastVal: currentFaderValues[addr] || 0 };

            const state = looperState[addr];
            const led = document.getElementById(`led-${addr}`);

            if (state.mode === 'idle') {
                state.mode = 'rec';
                state.frames = [currentFaderValues[addr] || 0];
                led.className = 'led red';
            } else if (state.mode === 'rec') {
                state.mode = 'play';
                state.playIdx = 0;
                led.className = 'led green';
            } else if (state.mode === 'play') {
                state.mode = 'idle';
                led.className = 'led';
                state.frames = [];
            }
        }

        function looperTick() {
            let overridesToSend = {};
            let hasOverrides = false;

            Object.entries(looperState).forEach(([addrStr, state]) => {
                const addr = parseInt(addrStr);

                if (state.mode === 'rec') {
                    state.frames.push(currentFaderValues[addr] || 0);
                } else if (state.mode === 'play' && state.frames.length > 0) {
                    const val = state.frames[state.playIdx];
                    if (val !== undefined && val !== state.lastVal) {
                        currentFaderValues[addr] = val;
                        state.lastVal = val;

                        const input = document.getElementById(`input-${addr}`);
                        const disp = document.getElementById(`disp-${addr}`);
                        if (input) input.value = val;
                        if (disp) {
                            disp.value = val;
                            disp.innerText = val; // fallback
                        }

                        overridesToSend[addr] = val;
                        hasOverrides = true;
                    }

                    state.playIdx++;
                    if (state.playIdx >= state.frames.length) {
                        state.playIdx = 0;
                    }
                }
            });

            if (hasOverrides && ws && ws.readyState === 1) {
                const overridesArray = Object.entries(currentFaderValues).map(([a, v]) => ({
                    address: parseInt(a),
                    value: v
                }));
                ws.send(JSON.stringify({
                    type: 'laser_override',
                    overrides: overridesArray
                }));
            }
        }

        async function renderTestFaders() {
            const devName = document.getElementById('test-dev-select').value;
            // Removed: currentFaderValues = {};
            // Removed: looperState = {};

            let allDevices = stageConfig.devices || {};
            const dev = allDevices[devName];
            if (!dev) return;

            let profile = currentProfile;
            if (!profile || !profile.type || profile.type !== dev.type) {
                try {
                    const res = await fetch(`${API_BASE}/${dev.type}.json`);
                    if (res.ok) profile = await res.json();
                    else return;
                } catch (e) { console.error("Profile load error", e); return; }
            }
            currentProfile = profile;

            const container = document.getElementById('test-faders');
            container.innerHTML = '';

            const sortedChans = Object.entries(profile.channels).sort((a, b) => {
                const offA = typeof a[1] === 'object' ? a[1].offset : a[1];
                const offB = typeof b[1] === 'object' ? b[1].offset : b[1];
                return offA - offB;
            });

            sortedChans.forEach(([role, val]) => {
                const offset = typeof val === 'object' ? val.offset : val;
                const absAddr = dev.address + dev.offset + offset;

                if (!looperState[absAddr]) {
                    looperState[absAddr] = { mode: 'idle', frames: [], playIdx: 0, lastVal: 0 };
                }

                const wrapperOffset = document.createElement('div');
                wrapperOffset.className = 'fader-ch';

                let shortRole = role.replace(/_/g, ' ').toUpperCase();
                if (shortRole.length > 10) shortRole = shortRole.substring(0, 8) + '..';

                wrapperOffset.innerHTML = `
                    <div style="min-height: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
                        <input type="checkbox" id="save-active-${absAddr}" ${saveActiveChannels[absAddr] ? 'checked' : ''} 
                            onchange="saveActiveChannels[${absAddr}] = this.checked"
                            title="Include in Save"
                            style="margin:0; cursor:pointer; accent-color:var(--accent);">
                        <div id="led-${absAddr}" class="led"></div>
                        <button class="looper-btn" onclick="toggleLooper(${absAddr})"></button>
                    </div>
                    
                    <div style="font-size:10px; color:#aaa; margin-bottom:5px">CH ${absAddr}</div>
                    
                    <input type="range" id="input-${absAddr}" min="0" max="255" value="0" 
                        oninput="updateDmxState(${absAddr}, this.value)"
                        style="flex:1;">
                    
                    <input id="disp-${absAddr}" type="text" value="0" class="fader-val" style="background:transparent; border:none; text-align:center; color:var(--text); width:100%; font-family:inherit; outline:none; border-bottom:1px solid #333;" 
                        onkeydown="handleFaderInput(event, ${absAddr}, this)" 
                        onblur="syncFaderInput(${absAddr}, this)"
                        title="Enter value (0-255) or loop range (0-100)">
                    <div style="font-size:9px; margin-top:5px; text-align:center; color:#888; letter-spacing:1px; line-height: 1.1;">${shortRole}</div>
                `;
                container.appendChild(wrapperOffset);
            });

            if (looperInterval) clearInterval(looperInterval);
            looperInterval = setInterval(looperTick, 1000 / 30);
        }

        function handleFaderInput(e, addr, el) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                let v = parseInt(el.value) || 0;
                let newVal = Math.min(255, v + 1);
                el.value = newVal;
                updateDmxState(addr, newVal);
                document.getElementById(`input-${addr}`).value = newVal;
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                let v = parseInt(el.value) || 0;
                let newVal = Math.max(0, v - 1);
                el.value = newVal;
                updateDmxState(addr, newVal);
                document.getElementById(`input-${addr}`).value = newVal;
            } else if (e.key === 'Enter') {
                e.preventDefault();
                syncFaderInput(addr, el);
                el.blur();
            }
        }

        function syncFaderInput(addr, el) {
            const valStr = el.value.trim();
            if (valStr.includes(',') || valStr.includes('-')) {
                generateMultiSequence(addr, valStr);
                return;
            }

            let v = parseInt(valStr);
            if (!isNaN(v)) {
                v = Math.max(0, Math.min(255, v));
                el.value = v;
                document.getElementById(`input-${addr}`).value = v;
                updateDmxState(addr, v);
            } else {
                el.value = currentFaderValues[addr] || 0;
            }
        }

        function generateMultiSequence(addr, input) {
            const segments = input.split(',').map(s => s.trim()).filter(s => s.length > 0);
            let frames = [];
            const stepsPerRange = 45; // ~1.5s per sweep at 30fps
            const holdFrames = 30;    // ~1s hold for discrete values

            segments.forEach(seg => {
                if (seg.includes('-')) {
                    const parts = seg.split('-');
                    let start = parseInt(parts[0]);
                    let end = parseInt(parts[1]);
                    if (!isNaN(start) && !isNaN(end)) {
                        start = Math.max(0, Math.min(255, start));
                        end = Math.max(0, Math.min(255, end));
                        // Ramp Up
                        for (let i = 0; i <= stepsPerRange; i++) {
                            frames.push(Math.round(start + (end - start) * (i / stepsPerRange)));
                        }
                        // Ramp Down
                        for (let i = stepsPerRange - 1; i > 0; i--) {
                            frames.push(Math.round(start + (end - start) * (i / stepsPerRange)));
                        }
                    }
                } else {
                    let v = parseInt(seg);
                    if (!isNaN(v)) {
                        v = Math.max(0, Math.min(255, v));
                        for (let i = 0; i < holdFrames; i++) {
                            frames.push(v);
                        }
                    }
                }
            });

            if (frames.length === 0) return;

            if (!looperState[addr]) {
                looperState[addr] = { mode: 'idle', frames: [], playIdx: 0, lastVal: frames[0] };
            }
            looperState[addr].frames = frames;
            looperState[addr].playIdx = 0;
            looperState[addr].mode = 'play';

            const led = document.getElementById(`led-${addr}`);
            if (led) led.className = 'led green';
        }

        function updateDmxState(addr, val) {
            const intVal = parseInt(val);
            currentFaderValues[addr] = intVal;
            saveActiveChannels[addr] = true; // Auto-activate for save

            const checkbox = document.getElementById(`save-active-${addr}`);
            if (checkbox) checkbox.checked = true;

            const disp = document.getElementById(`disp-${addr}`);
            if (disp) {
                disp.value = intVal;
                disp.innerText = intVal;
            }

            if (looperState[addr] && looperState[addr].mode === 'play') {
                // Optionally interrupt playback? Or let it fight. Let it fight for simplicity.
            }

            // Send ALL active overrides
            const overrides = Object.entries(currentFaderValues).map(([a, v]) => ({
                address: parseInt(a),
                value: v
            }));

            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({
                    type: 'laser_override',
                    overrides: overrides
                }));
            }
        }

        async function saveGlobalPreset() {
            await performPresetSave();
        }

        async function performPresetSave() {
            const devName = document.getElementById('test-dev-select').value;
            let allDevices = stageConfig.devices || {};
            const dev = allDevices[devName];
            if (!dev || !currentProfile || !currentProfile.channels) {
                alert("Please select a valid device and profile first.");
                return;
            }

            let presetPayload = {};
            let hasData = false;
            Object.entries(currentProfile.channels).forEach(([role, val]) => {
                const offset = typeof val === 'object' ? val.offset : val;
                const absAddr = dev.address + dev.offset + offset;

                // ONLY include if specifically active for save
                if (saveActiveChannels[absAddr] && currentFaderValues[absAddr] !== undefined) {
                    presetPayload[role] = currentFaderValues[absAddr];
                    hasData = true;
                }
            });

            if (!hasData) {
                alert("No active fader data found. Move some faders or check the 'Include' boxes first!");
                return;
            }

            const presetName = prompt("Enter a name for this Preset (e.g., 'Red Dot High'):");
            if (!presetName) return;

            let vibe = prompt("Assign a vibe (chill, mid, high, sub, tearout, machine_gun, wonky):", "mid");
            if (!vibe) return;
            vibe = vibe.toLowerCase().trim();

            // Persist to presets.json
            let existingPresets = {};
            try {
                const res = await fetch(`${API_BASE}/presets.json`);
                if (res.ok) existingPresets = await res.json();
            } catch (e) {
                console.log("No existing presets.json found. Creating new one.");
            }

            existingPresets[presetName] = {
                vibe: vibe,
                target_category: dev.category || 'laser',
                profile: dev.type,
                channels: presetPayload
            };

            try {
                const saveRes = await fetch(`${API_BASE}/presets.json`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(existingPresets, null, 4)
                });

                if (saveRes.ok) {
                    alert(`\u2705 Saved Preset: '${presetName}' (${vibe}) successfully!`);
                    renderPresetsManager(true);
                } else {
                    alert("\u274c Failed to save preset. Check server logs.");
                }
            } catch (e) {
                console.error(e);
                alert("\u274c Error saving preset.");
            }
        }

        // --- PRESET MANAGER ---
        let allPresetsData = {};

        async function renderPresetsManager(forceRefresh = false) {
            if (forceRefresh || Object.keys(allPresetsData).length === 0) {
                try {
                    const res = await fetch(`${API_BASE}/presets.json?t=${Date.now()}`, {
                        cache: 'no-store'
                    });
                    if (res.ok) {
                        allPresetsData = await res.json();
                    } else {
                        allPresetsData = {};
                    }
                } catch (e) {
                    console.error("Presets load error", e);
                    allPresetsData = {};
                }
            }

            const container = document.getElementById('presets-list');
            if (!container) return;
            container.innerHTML = '';

            let html = '';
            Object.entries(allPresetsData).forEach(([pName, pData]) => {
                const escapedName = pName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                html += `
                    <div class="device-row" style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 120px 50px; align-items: center;">
                        <input type="text" value="${pName.replace(/"/g, '&quot;')}" readonly style="background:transparent; border:none; outline:none; font-weight:bold; color:var(--text);">
                        <div style="color:var(--text-dim); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${pData.profile || 'Any'}">${pData.profile || 'Any'}</div>
                        <div style="color:var(--text-dim);">${pData.target_category || 'laser'}</div>
                        <select onchange="updatePresetVibe('${escapedName}', this.value)" style="background:#1a1a24; border-color:#333; color:#ccc; width:100%;">
                            <option value="chill" ${pData.vibe === 'chill' ? 'selected' : ''}>chill</option>
                            <option value="mid" ${pData.vibe === 'mid' ? 'selected' : ''}>mid</option>
                            <option value="high" ${pData.vibe === 'high' ? 'selected' : ''}>high</option>
                            <option value="sub" ${pData.vibe === 'sub' ? 'selected' : ''}>sub</option>
                            <option value="tearout" ${pData.vibe === 'tearout' ? 'selected' : ''}>tearout</option>
                            <option value="machine_gun" ${pData.vibe === 'machine_gun' ? 'selected' : ''}>machine_gun</option>
                            <option value="wonky" ${pData.vibe === 'wonky' ? 'selected' : ''}>wonky</option>
                        </select>
                        <button class="btn accent" style="padding:4px 10px; font-size:12px; height:28px;" onclick="playPreset('${escapedName}')">\u25b6 Play</button>
                        <button class="kv-remove" onclick="deletePreset('${escapedName}')">\u2716</button>
                    </div>
                `;
            });

            if (html === '') {
                container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim);">No presets saved yet. Go to Live Test to create some!</div>';
            } else {
                container.innerHTML = html;
            }
        }

        async function updatePresetVibe(pName, newVibe) {
            if (allPresetsData[pName]) {
                console.log(`Updating ${pName} vibe to ${newVibe}`);
                allPresetsData[pName].vibe = newVibe;
                renderPresetsManager(); // Re-render to update grouping if needed
                await savePresetsFile(); // Persist immediately
            }
        }

        function playPreset(pName) {
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'trigger_scene', scene: 'PRESET:' + pName }));
                alert("Triggered " + pName + ". (Will play on associated fixtures until next rhythm change)");
            } else {
                alert("WebSocket not connected!");
            }
        }

        async function deletePreset(pName) {
            if (confirm("Are you sure you want to delete the preset '" + pName + "'?")) {
                console.log("Deleting preset:", pName);
                delete allPresetsData[pName];

                // Immediately update UI for responsiveness
                renderPresetsManager(false);

                // Then persist to server
                await savePresetsFile();
            }
        }

        async function savePresetsFile() {
            try {
                const saveRes = await fetch(`${API_BASE}/presets.json`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(allPresetsData, null, 4)
                });

                if (saveRes.ok) {
                    alert('✅ Presets saved successfully!');
                } else {
                    alert("❌ Failed to save presets. Check server logs.");
                }
            } catch (e) {
                console.error(e);
                alert("❌ Error saving presets.");
            }
        }

        window.onload = init;
