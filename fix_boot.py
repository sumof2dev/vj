import os

with open('engine_tab.js', 'r') as f:
    js_content = f.read()

start_logs = js_content.find('// --- LOG LOGIC ---')
end_boot = js_content.find('boot();\n', start_logs) + 8

logs_and_boot = js_content[start_logs:end_boot]

# Remove from engine_tab.js
js_content = js_content[:start_logs] + js_content[end_boot:]

# Add initEngineTab to engine_tab.js
init_engine_code = """
function initEngineTab() {
    if (!window.RAVEBOX_READY) {
        setTimeout(initEngineTab, 50);
        return;
    }
    if (typeof initLabSelects === 'function') initLabSelects();
}
initEngineTab();
"""
js_content = js_content.replace('// --- LIVE BEHAVIOR LABORATORY', init_engine_code + '\n// --- LIVE BEHAVIOR LABORATORY')

with open('engine_tab.js', 'w') as f:
    f.write(js_content)

# Prepare code to inject back into help.html
help_boot_code = logs_and_boot.replace('initLabSelects();', '')

with open('help.html', 'r') as f:
    help_html = f.read()

script_end = help_html.rfind('</script>')
help_html = help_html[:script_end] + help_boot_code + '\n' + help_html[script_end:]

with open('help.html', 'w') as f:
    f.write(help_html)
