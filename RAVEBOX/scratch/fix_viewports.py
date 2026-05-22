import os
import re

def fix_html_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # If viewport meta tag exists, update it to include viewport-fit=cover
    if '<meta name="viewport"' in content:
        # Avoid double adding
        if 'viewport-fit=cover' not in content:
            content = re.sub(r'(<meta name="viewport" content="[^"]*)(")', r'\1, viewport-fit=cover\2', content)
    else:
        # If missing, add it after charset
        if '<meta charset=' in content:
            content = re.sub(r'(<meta charset="[^"]*">)', r'\1\n    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">', content)
        elif '<head>' in content:
            content = re.sub(r'(<head>)', r'\1\n    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">', content)

    with open(filepath, 'w') as f:
        f.write(content)

html_files = [f for f in os.listdir('.') if f.endswith('.html')]
for f in html_files:
    fix_html_file(f)
