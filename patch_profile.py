with open('/home/sumof2/vj/profile_logic.js', 'r') as f:
    lines = f.readlines()

# 1. Remove window.compileProfileMappings();
for i, line in enumerate(lines):
    if 'window.compileProfileMappings();' in line and 'Force refresh of partitioning mappings before save' in line:
        lines[i] = '' # Remove the line
        break

# 2. Add renderProfileCalibration() at the end of loadProfileChannels
for i, line in enumerate(lines):
    if "    }).join('');" in line:
        # Check if we are inside loadProfileChannels by looking backwards
        for j in range(i, -1, -1):
            if 'function loadProfileChannels()' in lines[j]:
                # Found it
                lines.insert(i + 1, "    if (typeof renderProfileCalibration === 'function') renderProfileCalibration();\n")
                break
        break

# 3. Delete lines 1259-1825 (0-indexed: 1258 to 1824)
# We must find the indices dynamically in case lines shifted
start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if 'window.channelConfig = window.channelConfig || {};' in line:
        start_idx = i
        break

for i in range(start_idx, len(lines)):
    if 'setTimeout(() => window.renderProfileMappings(), 50);' in lines[i] and '};' in lines[i+1]:
        end_idx = i + 1
        break

if start_idx != -1 and end_idx != -1:
    print(f"Deleting legacy block from {start_idx} to {end_idx}")
    del lines[start_idx:end_idx+1]
else:
    print(f"Error finding block: {start_idx} to {end_idx}")

with open('/home/sumof2/vj/profile_logic.js', 'w') as f:
    f.writelines(lines)
