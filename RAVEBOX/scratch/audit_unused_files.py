import os
import re
import json

WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCLUDE_DIRS = {
    ".git",
    "venv",
    "node_modules",
    "__pycache__",
    ".agent",
    "scratch",
    "tmp",
    "logs",
    "recordings",
}

# Supported text file extensions to scan for references
SCAN_EXTENSIONS = {
    ".html",
    ".js",
    ".css",
    ".py",
    ".sh",
    ".json",
    ".ts",
    ".tsx",
    ".service",
}

def get_all_files(root_dir):
    all_files = []
    for root, dirs, files in os.walk(root_dir):
        # Exclude directories in-place
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith('.')]
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, root_dir)
            all_files.append((full_path, rel_path, file))
    return all_files

def main():
    files_info = get_all_files(WORKSPACE)
    print(f"Total files found to audit: {len(files_info)}")

    # Load contents of all scannable files
    scannable_contents = {}
    for full_path, rel_path, filename in files_info:
        ext = os.path.splitext(filename)[1].lower()
        if ext in SCAN_EXTENSIONS:
            try:
                with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                    scannable_contents[rel_path] = f.read()
            except Exception as e:
                print(f"Error reading {rel_path}: {e}")

    # Track references: key is rel_path, value is list of (referencing_rel_path, snippet/match)
    references = {rel_path: [] for _, rel_path, _ in files_info}

    # Audit each file
    for full_path, rel_path, filename in files_info:
        # Skip checking reference to itself
        # Check if this file is referenced in any other file's content
        basename = filename
        
        # Special matching logic for different types of files:
        # 1. Exact relative path (e.g. 'backend/dmx_engine.py')
        # 2. Basename (e.g. 'dmx_engine.py')
        # 3. Python style imports: for python files, check if imported without extension (e.g., 'import dmx_engine' or 'from backend import dmx_engine')
        # 4. We should also consider common asset / public file mappings
        
        name_no_ext, ext = os.path.splitext(basename)
        
        for ref_rel_path, content in scannable_contents.items():
            if ref_rel_path == rel_path:
                continue
            
            referenced = False
            match_details = []

            # Match criteria:
            # - Basename in quotes or import patterns
            # - Check if basename is present in text as a word/string
            # We want to be careful with short names (e.g. "9.html" is easy, but a file named "a" could have false positives)
            
            # Simple check for basename in content
            if basename in content:
                referenced = True
                match_details.append(f"Contains basename '{basename}'")
            
            # Python import check
            elif ext == '.py' and name_no_ext in content:
                # Let's see if it's imported in python: e.g. "import <name>" or "from ... import <name>"
                import_pattern = r'\b(import|from)\s+([a-zA-Z0-9_\.]*\b)?' + re.escape(name_no_ext) + r'\b'
                if re.search(import_pattern, content):
                    referenced = True
                    match_details.append(f"Python import of '{name_no_ext}'")
            
            # JS import check
            elif ext == '.js' or ext == '.ts' or ext == '.tsx':
                # Check for import without extension
                import_pattern = r'\bfrom\s+[\'"][^\'"]*' + re.escape(name_no_ext) + r'[\'"]'
                if re.search(import_pattern, content):
                    referenced = True
                    match_details.append(f"JS import/require of '{name_no_ext}'")

            # Public/assets directory mapping:
            # Files in /public/ are served at the root URL (e.g., public/favicon.ico -> served as /favicon.ico)
            if rel_path.startswith("public/"):
                served_name = rel_path[len("public/"):]
                if served_name in content:
                    referenced = True
                    match_details.append(f"Served public asset reference '{served_name}'")

            # visualizer_src files might build into dist, check if reference exists
            if rel_path.startswith("visualizer_src/"):
                # if it's a file inside visualizer_src, we should see if it's imported within visualizer_src
                if rel_path.startswith("visualizer_src/src/") and (basename in content or (name_no_ext in content and ext in ('.tsx', '.ts'))):
                    # check if referenced within visualizer_src
                    if ref_rel_path.startswith("visualizer_src/"):
                        referenced = True
                        match_details.append(f"Visualizer src internal reference")

            if referenced:
                references[rel_path].append((ref_rel_path, match_details))

    # Write results to a JSON file for analysis
    results = []
    for full_path, rel_path, filename in files_info:
        refs = references[rel_path]
        results.append({
            "rel_path": rel_path,
            "filename": filename,
            "size_bytes": os.path.getsize(full_path),
            "ref_count": len(refs),
            "referenced_by": [{"file": r[0], "details": r[1]} for r in refs]
        })

    # Sort results: unreferenced files first, then by ref_count
    results.sort(key=lambda x: (x["ref_count"], x["rel_path"]))

    with open(os.path.join(WORKSPACE, "scratch", "audit_results.json"), "w") as f:
        json.dump(results, f, indent=2)

    print("Audit finished. Results written to scratch/audit_results.json")

if __name__ == "__main__":
    main()
