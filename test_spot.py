import sys, os, time, json
with open('spotify_creds.json') as f:
    creds = json.load(f)

import spotipy
from spotipy.oauth2 import SpotifyOAuth, CacheFileHandler

handler = CacheFileHandler(cache_path='.spotify_cache')
sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
    client_id=creds["SPOT_CLIENT_ID"],
    client_secret=creds["SPOT_CLIENT_SECRET"],
    redirect_uri=creds["SPOTIFY_REDIRECT_URI"],
    scope="user-read-currently-playing",
    cache_handler=handler,
    open_browser=False
))

print("Fetching current track...")
res = sp.current_user_playing_track()
print("Result:", res)
