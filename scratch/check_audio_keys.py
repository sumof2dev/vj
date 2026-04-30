import sys
import os
import numpy as np

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from audio_analyzer import AudioAnalyzer

def check_consistency():
    analyzer = AudioAnalyzer()
    
    empty_state = analyzer.get_empty_state()
    
    # Create some dummy data for process
    dummy_data = np.zeros((1024, 2))
    process_state = analyzer.process(dummy_data)
    
    empty_keys = set(empty_state.keys())
    process_keys = set(process_state.keys())
    
    print(f"Empty Keys: {sorted(list(empty_keys))}")
    print(f"Process Keys: {sorted(list(process_keys))}")
    
    missing_in_empty = process_keys - empty_keys
    missing_in_process = empty_keys - process_keys
    
    if not missing_in_empty and not missing_in_process:
        print("✅ Keys are perfectly consistent!")
    else:
        if missing_in_empty:
            print(f"❌ Missing in Empty State: {missing_in_empty}")
        if missing_in_process:
            print(f"❌ Missing in Process Output: {missing_in_process}")
        exit(1)

if __name__ == "__main__":
    check_consistency()
