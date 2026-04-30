import os

with open('help.html', 'r') as f:
    help_html = f.read()

# Remove CSS
start_css = help_html.find('/* Calibration Specifics */')
end_css = help_html.find('</style>', start_css)
help_html = help_html[:start_css] + help_html[end_css:]

# Remove Nav item
help_html = help_html.replace('<li class="nav-item" onclick="showSection(\'calibration\', this)">🔬 Sanity Check</li>\n', '')

# Remove HTML Section
start_html = help_html.find('<!-- SECTION: CALIBRATION (Sanity Check) -->')
end_html = help_html.find('</main>', start_html)
cal_html = help_html[start_html:end_html]
help_html = help_html[:start_html] + help_html[end_html:]

# Remove JS
start_js = help_html.find('function startCalibration() {')
end_js = help_html.find('</script>', start_js)
if end_js == -1: end_js = len(help_html)
help_html = help_html[:start_js] + help_html[end_js:]

# Remove Lab Modal
start_modal = help_html.find('<!-- BEHAVIOR LABORATORY MODAL -->')
end_modal = help_html.find('</body>', start_modal)
if end_modal != -1:
    lab_modal = help_html[start_modal:end_modal]
    help_html = help_html[:start_modal] + help_html[end_modal:]

with open('help.html', 'w') as f:
    f.write(help_html)

# Now, let's inject into setup.html
with open('setup.html', 'r') as f:
    setup_html = f.read()

# Add nav-btn
nav_btn = """
        <div class="nav-btn" id="nav-btn-engine" onclick="switchTab('tab-engine')" title="Engine">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
            <span class="nav-text">Engine</span>
        </div>
"""
# insert after tab-presets
presets_nav_pos = setup_html.find('<div class="nav-btn" id="nav-btn-presets"')
presets_nav_end = setup_html.find('</div>', presets_nav_pos) + 6
setup_html = setup_html[:presets_nav_end] + nav_btn + setup_html[presets_nav_end:]

# remove tab-live link
live_nav_pos = setup_html.find('<div class="nav-btn" id="nav-btn-live"')
if live_nav_pos != -1:
    live_nav_end = setup_html.find('</div>', live_nav_pos) + 6
    setup_html = setup_html[:live_nav_pos] + setup_html[live_nav_end:]

# add tab-engine content
train_hub = """
            <!-- TRAINING HUB (Feature Collector) -->
            <div id="trainingHub" class="dash-panel" style="margin-top: 10px; border-color: rgba(249, 202, 36, 0.3);">
                <div class="dash-header">
                    <span style="color:#f9ca24;">🧠 Feature Collector</span>
                    <span style="font-size: 9px; opacity:0.6;">30s BEFORE / 10s AFTER</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <button class="btn" style="background:rgba(42, 90, 138, 0.4); border-color:#2a5a8a;" onclick="captureSnippet('chill')">Chill</button>
                    <button class="btn" style="background:rgba(90, 90, 42, 0.4); border-color:#5a5a2a;" onclick="captureSnippet('mid')">Mid</button>
                    <button class="btn" style="background:rgba(162, 155, 230, 0.4); border-color:#a29be6;" onclick="captureSnippet('building')">Building</button>
                    <button class="btn" style="background:rgba(249, 202, 36, 0.4); border-color:#f9ca24;" onclick="captureSnippet('tension')">Tension</button>
                    <button class="btn" style="background:rgba(235, 77, 75, 0.4); border-color:#eb4d4b; font-weight:900;" onclick="captureSnippet('dropping')">THE DROP</button>
                    <button class="btn" style="background:rgba(138, 42, 90, 0.4); border-color:#8a2a5a;" onclick="captureSnippet('high')">High Vibe</button>
                </div>
                <div id="snippet-feedback" style="font-size:10px; color:#888; text-align:center; margin-top:8px;">Tap when energy transitions occur</div>
            </div>
"""

tab_engine = f"""
    <div id="tab-engine" class="tab-content" style="display:none;">
        <h2>Engine & Analysis</h2>
        <p style="color:var(--text-dim)">Sanity checks, live laboratory, and training data collection.</p>
        {train_hub}
        {cal_html}
    </div>
"""

# insert after tab-presets content
presets_content_pos = setup_html.find('<div id="tab-presets"')
presets_content_end = setup_html.find('<div id="ai-preset-modal"', presets_content_pos)
setup_html = setup_html[:presets_content_end] + tab_engine + setup_html[presets_content_end:]

# add lab modal at end of body
body_end = setup_html.find('</body>')
setup_html = setup_html[:body_end] + lab_modal + setup_html[body_end:]

with open('setup.html', 'w') as f:
    f.write(setup_html)

print("Done refactoring help.html and setup.html")
