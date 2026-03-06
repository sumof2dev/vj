import re

with open('visualdmx.html', 'r', encoding='utf-8') as f:
    master = f.read()

with open('vjweb/visualdmxweb.html', 'r', encoding='utf-8') as f:
    web = f.read()

# 1. SHADER SCRIPTS
s_start = master.find('<script id="vertexShader"')
s_end = master.find('</script>', master.find('<script id="blackPointFragment"')) + 9
shaders = master[s_start:s_end]

w_s_start = web.find('<script id="sharedBasicVertex"')
w_s_end = web.find('</script>', web.find('<script id="elasticFragmentShader"')) + 9

web = web[:w_s_start] + shaders + web[w_s_end:]

# 2. UNIFORMS & MESHES
var_start = master.find('// --- UNIFORMS ---')
var_end = master.find('// ========== WEBSOCKET ==========')
meshes = master[var_start:var_end]

w_var_start = web.find('// --- UNIFYING THEME (CYBERPUNK / SYNTHWAVE) ---')
# Wait, let's just find where THREE.js starts in web
w_var_start_actual = web.find('// --- THREE.JS SETUP ---')
if w_var_start_actual == -1: w_var_start_actual = web.find('const scene = new THREE.Scene();')
w_var_end = web.find('// --- AUDIO PROCESSING ---')

# Actually, the user wants the exact shaders. So replace from `const scene = new THREE.Scene();` to before the `// --- AUDIO PROCESSING ---` block? 
# In visualdmxweb.html, we have `const scene = new THREE.Scene();` and many meshes.
