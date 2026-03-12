#!/usr/bin/env python3
import spotipy
from spotipy.oauth2 import SpotifyOAuth, CacheFileHandler
import os
import json

# Default Spotify Credentials
SPOT_CLIENT_ID = 'SCRUBBED_ID'
SPOT_CLIENT_SECRET = 'SCRUBBED_SECRET'
SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8888/callback' 

# Load from file if exists
SPOT_CREDS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spotify_creds.json")
if os.path.exists(SPOT_CREDS_FILE):
    try:
        with open(SPOT_CREDS_FILE, 'r') as f:
            creds = json.load(f)
            if creds.get("SPOT_CLIENT_ID"): SPOT_CLIENT_ID = creds["SPOT_CLIENT_ID"]
            if creds.get("SPOT_CLIENT_SECRET"): SPOT_CLIENT_SECRET = creds["SPOT_CLIENT_SECRET"]
            if creds.get("SPOTIFY_REDIRECT_URI"): SPOTIFY_REDIRECT_URI = creds["SPOTIFY_REDIRECT_URI"]
            print(f"🎵 Using credentials from {SPOT_CREDS_FILE}")
    except Exception as e:
        print(f"⚠️ Failed to load credentials from file: {e}")

# Explicit Cache Path
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".spotify_cache")

import sys

def main():
    print("🎵 Initializing Standalone Spotify Authentication...")
    print(f"🔒 Cache file will be saved to: {CACHE_PATH}")
    
    # Use explicit CacheFileHandler
    handler = CacheFileHandler(cache_path=CACHE_PATH)
    
    try:
        auth_manager = SpotifyOAuth(
            client_id=SPOT_CLIENT_ID,
            client_secret=SPOT_CLIENT_SECRET,
            redirect_uri=SPOTIFY_REDIRECT_URI,
            scope="user-read-currently-playing",
            cache_handler=handler,
            open_browser=False
        )
        
        # Priority 1: Command line argument
        code = sys.argv[1] if len(sys.argv) > 1 else None
        
        if not code:
            # Priority 2: Hardcoded fallback (unlikely to work for long)
            code = "SCRUBBED_CODE"
            print(f"⚠️ No code provided via CLI. Using fallback: {code[:10]}...")
        else:
            # If the user pasted the whole URL, extract the code
            if 'code=' in code:
                import urllib.parse
                parsed = urllib.parse.urlparse(code)
                query = urllib.parse.parse_qs(parsed.query)
                code = query.get('code', [code])[0]
            
            print(f"📦 Using provided auth code: {code[:10]}...")

        token_info = auth_manager.get_access_token(code=code, as_dict=False)
        
        if token_info:
            print("\n✅ Authentication Successful!")
            print(f"✅ Token cached at: {CACHE_PATH}")
            print("\nYou can now restart the DMX engine:")
            print("sudo systemctl restart vj-engine.service")
        else:
            print("\n❌ Failed to get access token.")
            
    except Exception as e:
        print(f"\n❌ Authentication Error: {e}")

if __name__ == "__main__":
    main()
