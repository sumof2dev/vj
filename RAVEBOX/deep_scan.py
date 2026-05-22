import os
import glob
import requests
import json

# Setup local Ollama API details
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "qwen2.5-coder:7b"

# Audit criteria we are looking for
SYSTEM_PROMPT = """You are a strict, automated code audit tool. Analyze the provided code for security issues, bugs, and structural flaws.

CRITICAL INSTRUCTIONS:
1. DO NOT explain what the file does. DO NOT provide a high-level summary of the file's functionality.
2. If the file has no bugs, no broken references, and no bad error handling, you MUST output EXACTLY the single word 'CLEAN' and absolutely nothing else.
3. If and only if there are issues, list them as concise bullet points:
   - Broken or dead references (variables/imports used but never defined).
   - Outdated legacy structures (e.g., synchronous blocks where async should be used, old loops).
   - Bad error handling (bare 'except:', unhandled promise rejections, missing try/catch).
   For any issue, provide the short line context or line number. Keep explanations under one sentence."""

def scan_file(file_path):
    print(f"🔍 Auditing: {file_path}...")
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        code_content = f.read()

    prompt = f"File: {file_path}\n\nCode:\n{code_content}"
    
    payload = {
        "model": MODEL_NAME,
        "prompt": f"{SYSTEM_PROMPT}\n\n{prompt}",
        "stream": False
    }

    try:
        response = requests.post(OLLAMA_URL, json=payload)
        return response.json().get("response", "")
    except Exception as e:
        return f"Error scanning file: {str(e)}"

def main():
    # Gather all Python and JS files, ignoring virtual environments, scratch, temp and build files
    files = glob.glob("**/*.py", recursive=True) + glob.glob("**/*.js", recursive=True)
    ignore_paths = [
        "venv", "venv_local", "node_modules", "deep_scan.py", 
        "tmp", "backup-unused", "scratch", "dist", ".agent", ".antigravity", "assets"
    ]

    filtered_files = [f for f in files if not any(x in f for x in ignore_paths)]
    
    print(f"Found {len(filtered_files)} files to audit locally. Starting engine...")
    print("-" * 60)

    report_content = "# RAVEBOX Local Codebase Audit Report\n\n"
    # Write initial header to clear previous report
    with open("local_audit_report.md", "w") as f:
        f.write(report_content)

    for file_path in filtered_files:
        result = scan_file(file_path)
        stripped = result.strip()
        if stripped == "CLEAN" or "clean" in stripped.lower()[:15]:
            continue
        
        file_report = f"## File: {file_path}\n{result}\n\n"
        print(f"📝 Logging findings for {file_path}...")
        with open("local_audit_report.md", "a") as f:
            f.write(file_report)
        
    print("-" * 60)
    print("✅ Deep scan complete! Report updated progressively in: local_audit_report.md")

if __name__ == "__main__":
    main()
