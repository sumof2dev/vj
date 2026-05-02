
def check_braces(filename):
    with open(filename, 'r') as f:
        content = f.read()
    
    stack = []
    for i, char in enumerate(content):
        if char == '{':
            # Find line number
            line_num = content.count('\n', 0, i) + 1
            stack.append(('{', line_num))
        elif char == '}':
            if not stack:
                line_num = content.count('\n', 0, i) + 1
                print(f"Unexpected '}}' at line {line_num}")
                return
            stack.pop()
    
    if stack:
        for char, line in stack:
            print(f"Unclosed '{{' at line {line}")

if __name__ == "__main__":
    check_braces('/home/sumof2/vj/profile_logic.js')
