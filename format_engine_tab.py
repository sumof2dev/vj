import os

with open('setup.html', 'r') as f:
    html = f.read()

# 1. Extract the Lab Modal
lab_modal_start = html.find('<!-- BEHAVIOR LABORATORY MODAL -->')
lab_modal_end = html.find('</body>', lab_modal_start)
lab_modal_html = html[lab_modal_start:lab_modal_end]

# Remove Lab Modal from end of body
html = html[:lab_modal_start] + html[lab_modal_end:]

# Strip out the fixed position / background wrapper classes from Lab Modal HTML
# Originally it was <div id="behaviorLabModal"> <div class="lab-modal-content"> ... </div> </div>
# And we want to replace the outer layers with just the <div class="lab-body"> basically, or keep lab-modal-content styling minus the wrapper
# We will just replace <div id="behaviorLabModal"> and <div class="lab-modal-content"> with a clean div
lab_html = lab_modal_html
lab_html = lab_html.replace('<div id="behaviorLabModal">', '')
lab_html = lab_html.replace('<div class="lab-modal-content">', '<div class="lab-modal-content" style="box-shadow:none; border:none; height:auto; background:transparent;">')
# Remove the closing div for behaviorLabModal (the last </div> before the end)
last_div = lab_html.rfind('</div>')
if last_div != -1:
    lab_html = lab_html[:last_div] + lab_html[last_div+6:]
# Remove the close button
close_btn_start = lab_html.find('<button class="close-lab"')
close_btn_end = lab_html.find('</button>', close_btn_start) + 9
if close_btn_start != -1:
    lab_html = lab_html[:close_btn_start] + lab_html[close_btn_end:]


# 2. Extract tab-engine content
tab_engine_start = html.find('<div id="tab-engine" class="tab-content">')
tab_engine_end = html.find('<div id="ai-preset-modal"', tab_engine_start)
# Back up to the actual end of tab-engine (which is the closing </div> of tab-engine)
# The tag before ai-preset-modal is exactly the closing tag of tab-engine? Let's assume so, or find the last </div> before it
end_div = html.rfind('</div>', tab_engine_start, tab_engine_end)
# Actually, ai-preset-modal is a sibling, so tab_engine_end - some spaces is the closing div.
tab_engine_content = html[tab_engine_start:tab_engine_end]

# Extract feature collector
fc_start = tab_engine_content.find('<!-- TRAINING HUB')
fc_end = tab_engine_content.find('<!-- SECTION: CALIBRATION')
feature_collector = tab_engine_content[fc_start:fc_end]

# Extract calibration
cal_start = fc_end
# The end of calibration is the end of tab_engine_content minus the closing </div>
cal_end = tab_engine_content.rfind('</div>')
calibration = tab_engine_content[cal_start:cal_end]

# 3. Rebuild tab-engine
new_tab_engine = f"""<div id="tab-engine" class="tab-content">
        <h2>Engine & Analysis</h2>
        <p style="color:var(--text-dim)">Sanity checks, live laboratory, and training data collection.</p>
        
        <details class="engine-accordion">
            <summary>🔬 Live Behavior Laboratory</summary>
            <div class="accordion-content">
                {lab_html}
            </div>
        </details>

        <details class="engine-accordion">
            <summary>🧠 The Collector</summary>
            <div class="accordion-content">
                {feature_collector}
            </div>
        </details>

        <details class="engine-accordion">
            <summary>⚖️ The Sanity Check</summary>
            <div class="accordion-content">
                {calibration}
            </div>
        </details>
    </div>
"""

# Replace the old tab-engine with the new one
html = html[:tab_engine_start] + new_tab_engine + html[tab_engine_end:]

with open('setup.html', 'w') as f:
    f.write(html)
print("Done formatting tab-engine")
