#!/bin/bash
# RaveBox - Factory Reset (Data Wipe)
# WARNING: This removes all user-entered configurations.

read -p "⚠️  Are you sure you want to clear ALL VJ user data? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

echo "🧹 Wiping Spotify credentials and cache..."
rm -f spotify_creds.json .spotify_cache

echo "🧹 Wiping custom fixture profiles..."
rm -f fixtures/profiles/prof_*.json

echo "🧹 Wiping stage configurations..."
rm -f fixtures/stages/*.json
rm -f fixtures/stage_config.json

echo "🧹 Wiping remote and local settings..."
rm -f vj_remote_settings.json
rm -f ravebox_config*.json

echo "🧹 Clearing logs..."
rm -rf logs/*
rm -f *.log

echo "✅ Data wipe complete. System is now clean."
