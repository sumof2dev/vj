import os
import sys

server_file = 'dev_server.py'
with open(server_file, 'r') as f:
    content = f.read()

if '/api/log_ai' not in content:
    log_endpoint = """
@app.route('/api/log_ai', methods=['POST'])
def log_ai():
    try:
        data = request.get_json()
        with open('scratch/ai_log.json', 'w') as f:
            json.dump(data, f, indent=2)
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
"""
    # Insert it before the last route or somewhere safe
    # Let's just find the first @app.route
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if line.startswith('@app.route'):
            lines.insert(i, log_endpoint)
            break
    
    with open(server_file, 'w') as f:
        f.write('\n'.join(lines))
    print("Added /api/log_ai to dev_server.py")
else:
    print("Endpoint already exists.")
