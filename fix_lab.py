import os

with open('engine_tab.js', 'r') as f:
    js_content = f.read()

start_open = js_content.find('function openBehaviorLab() {')
end_close = js_content.find('function resetLab() {')

if start_open != -1 and end_close != -1:
    js_content = js_content[:start_open] + js_content[end_close:]

with open('engine_tab.js', 'w') as f:
    f.write(js_content)
