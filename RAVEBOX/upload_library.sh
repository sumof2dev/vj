#!/bin/bash
# One-time upload of active library files (base shaders + textures) to GCS
# These become the default visuals for standalone mode (no backend required)

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

BUCKET="gs://ravebox"
LIB_DIR="library"

echo "📦 Uploading active library to GCS..."
echo "   Source: $DIR/$LIB_DIR"
echo "   Destination: $BUCKET/$LIB_DIR/"
echo ""

# Count files
BASE_COUNT=$(find "$LIB_DIR/base" -name "*.frag" 2>/dev/null | wc -l)
IMG_COUNT=$(find "$LIB_DIR/images" -type f 2>/dev/null | wc -l)
echo "   Base shaders: $BASE_COUNT"
echo "   Textures/media: $IMG_COUNT"
echo ""

# Upload base shaders (.frag + .frag.json + .frag.jpg thumbnails)
echo "🎨 Uploading base shaders..."
gsutil -m cp "$LIB_DIR/base/"*.frag "$BUCKET/$LIB_DIR/base/" 2>/dev/null
gsutil -m cp "$LIB_DIR/base/"*.frag.json "$BUCKET/$LIB_DIR/base/" 2>/dev/null
gsutil -m cp "$LIB_DIR/base/"*.frag.jpg "$BUCKET/$LIB_DIR/base/" 2>/dev/null

# Upload texture images and videos
echo "🖼️  Uploading textures..."
gsutil -m cp "$LIB_DIR/images/"* "$BUCKET/$LIB_DIR/images/" 2>/dev/null

# Generate a manifest JSON listing all uploaded files
# This avoids needing directory listing APIs from GCS
echo "📋 Generating library manifest..."

MANIFEST_FILE="$DIR/library_manifest.json"

python3 -c "
import os, json, time

lib_root = '$DIR/$LIB_DIR'
manifest = {'base': [], 'tex': []}

# Base shaders
base_dir = os.path.join(lib_root, 'base')
if os.path.isdir(base_dir):
    for f in sorted(os.listdir(base_dir)):
        if not f.endswith('.frag'): continue
        fpath = os.path.join(base_dir, f)
        meta_path = fpath + '.json'
        prompt = f.replace('.frag', '')
        has_thumb = os.path.exists(fpath + '.jpg')
        if os.path.exists(meta_path):
            try:
                with open(meta_path) as mf:
                    meta = json.load(mf)
                    prompt = meta.get('prompt', prompt)
            except: pass
        manifest['base'].append({
            'file': 'base/' + f,
            'prompt': prompt,
            'type': 'base',
            'has_thumb': has_thumb,
            'mtime': os.path.getmtime(fpath)
        })

# Texture images
img_dir = os.path.join(lib_root, 'images')
if os.path.isdir(img_dir):
    for f in sorted(os.listdir(img_dir)):
        if not f.endswith(('.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm')): continue
        fpath = os.path.join(img_dir, f)
        manifest['tex'].append({
            'file': 'library/images/' + f,
            'name': f,
            'category': 'tex',
            'mtime': os.path.getmtime(fpath)
        })

# Sort by mtime descending
manifest['base'].sort(key=lambda x: x['mtime'], reverse=True)
manifest['tex'].sort(key=lambda x: x['mtime'], reverse=True)

with open('$MANIFEST_FILE', 'w') as out:
    json.dump(manifest, out, indent=2)

print(f'   {len(manifest[\"base\"])} base shaders')
print(f'   {len(manifest[\"tex\"])} textures')
"

# Upload manifest
gsutil cp "$MANIFEST_FILE" "$BUCKET/library_manifest.json"

echo ""
echo "✅ Library uploaded to GCS successfully!"
echo "   Manifest: $BUCKET/library_manifest.json"
