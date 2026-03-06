import re

with open('visualdmx.html', 'r', encoding='utf-8') as f:
    master_html = f.read()

with open('vjweb/visualdmxweb.html', 'r', encoding='utf-8') as f:
    web_html = f.read()

# Extract shaders block
shader_start = master_html.find('<script id="vertexShader"')
shader_end = master_html.find('</script>', master_html.find('<script id="blackPointFragment"')) + 9

shaders_block = master_html[shader_start:shader_end]

# Extract materials block
mat_start_regex = re.compile(r'const\s+bgModes\s*=\s*\[')
mat_match = mat_start_regex.search(master_html)
mat_start = mat_match.start()

mat_end_regex = re.compile(r'let\s+currentBg\s*=\s*0;')
mat_end_match = mat_end_regex.search(master_html)
mat_end = mat_end_match.start()

mats_block = master_html[mat_start:mat_end]

# Now replace in web_html
web_shader_start = web_html.find('<script id="sharedBasicVertex"')
web_shader_end = web_html.find('</script>', web_html.find('id="elasticFragmentShader"')) + 9

web_html = web_html[:web_shader_start] + shaders_block + "\n\n" + web_html[web_shader_end:]

w_mat_start_regex = re.compile(r'const\s+bgModes\s*=\s*\[')
w_mat_match = w_mat_start_regex.search(web_html)
w_mat_start = w_mat_match.start()

w_mat_end_regex = re.compile(r'let\s+currentBg\s*=\s*0;')
w_mat_end_match = w_mat_end_regex.search(web_html)
w_mat_end = w_mat_end_match.start()

web_html = web_html[:w_mat_start] + mats_block + web_html[w_mat_end:]

with open('vjweb/visualdmxweb.html', 'w', encoding='utf-8') as f:
    f.write(web_html)

print("Patch successful!")
