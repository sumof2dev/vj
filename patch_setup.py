with open('setup.html', 'r') as f:
    setup_html = f.read()

head_end = setup_html.find('</head>')
setup_html = setup_html[:head_end] + '<link rel="stylesheet" href="engine_tab.css?v=1">\n' + setup_html[head_end:]

body_end = setup_html.find('</body>')
scripts = '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\n<script src="engine_tab.js?v=1"></script>\n'
setup_html = setup_html[:body_end] + scripts + setup_html[body_end:]

with open('setup.html', 'w') as f:
    f.write(setup_html)
