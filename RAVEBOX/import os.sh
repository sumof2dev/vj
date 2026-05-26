import os

def serialize_repo(repo_path, ignore_dirs=None):
    if ignore_dirs is None:
        ignore_dirs = {'.git', 'node_modules', '__pycache__', 'dist', 'build', 'venv'}
    
    serialized_output = []
    
    # 1. Generate an initial directory map so the model understands the structural layout
    serialized_output.append("=== REPOSITORY STRUCTURE ===\n")
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        level = root.replace(repo_path, '').count(os.sep)
        indent = ' ' * 4 * level
        serialized_output.append(f"{indent}{os.path.basename(root)}/\n")
        sub_indent = ' ' * 4 * (level + 1)
        for f in files:
            serialized_output.append(f"{sub_indent}{f}\n")
            
    serialized_output.append("\n=== FILE CONTENTS ===\n")
    
    # 2. Append the actual contents inside clear multi-line string buffers
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        for file in files:
            file_path = os.path.join(root, file)
            relative_path = os.path.relpath(file_path, repo_path)
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                serialized_output.append(f"--- START FILE: {relative_path} ---\n")
                serialized_output.append(content)
                serialized_output.append(f"\n--- END FILE: {relative_path} ---\n\n")
            except (UnicodeDecodeError, PermissionError):
                # Safely skip binary files, images, or locked files
                continue
                
    return "".join(serialized_output)

# Example Usage
# codebase_string = serialize_repo("/path/to/my/project")
