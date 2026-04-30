import requests
import json
import time

profile_id = f"test_profile_{int(time.time())}"
data = {
    "id": profile_id,
    "name": "Test Splits Profile",
    "channels": [],
    "mappings": [],
    "vibeSplits": {"0": {"chillMid": 20, "midHigh": 80}}
}

url = f"http://localhost:8085/api/fixtures/profiles/{profile_id}.json"
print(f"Sending PUT to {url}")
try:
    r = requests.put(url, json=data)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text}")
    
    # Verify the file was created and contains vibeSplits
    import os
    fpath = f"fixtures/profiles/{profile_id}.json"
    if os.path.exists(fpath):
        with open(fpath, 'r') as f:
            saved_data = json.load(f)
            print(f"Saved vibeSplits: {saved_data.get('vibeSplits')}")
    else:
        print("File not found on disk!")
except Exception as e:
    print(f"Error: {e}")
