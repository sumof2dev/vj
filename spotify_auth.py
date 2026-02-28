#!/usr/bin/env python3
import spotipy
from spotipy.oauth2 import SpotifyOAuth, CacheFileHandler
import os

# Spotify Credentials
SPOT_CLIENT_ID = 'SCRUBBED_ID'
SPOT_CLIENT_SECRET = 'SCRUBBED_SECRET'
SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8888/callback' 

# Explicit Cache Path
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".spotify_cache")

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
        
        # We manually get the code instead of using get_access_token interactively
        # to bypass the hanging input() prompt bug
        code = "SCRUBBED_CODE"
        print(f"Bypassing prompt, using hardcoded auth code: {code[:10]}...")
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
