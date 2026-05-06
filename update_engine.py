import re

with open("/home/sumof2/vj/backend/vibe_engine.py", "r") as f:
    content = f.read()

new_logic = """        chill_threshold = self.vibe_splits.get("chillMid", 33) / 100.0
        high_threshold = self.vibe_splits.get("midHigh", 66) / 100.0
        
        # Map boundaries directly to audio signal ranges so the UI sliders
        # have full authority over the vibe buckets.
        
        # HIGH:
        # Vol ranges from ~0.2 (easy) to 1.0+ (impossible)
        high_vol = 0.2 + (high_threshold * 0.8)
        high_density = high_threshold * 12.0
        high_spectral = high_threshold * 0.8 
        
        # CHILL:
        # Vol ranges from 0.0 (impossible) to 1.2+ (always chill)
        chill_vol = chill_threshold * 1.2
        chill_density = chill_threshold * 10.0"""

content = re.sub(
    r'chill_easiness = self\.vibe_splits\.get\("chillMid", 33\).*?chill_density = 3\.5 \* chill_easiness',
    new_logic,
    content,
    flags=re.DOTALL
)

with open("/home/sumof2/vj/backend/vibe_engine.py", "w") as f:
    f.write(content)

print("Updated vibe_engine.py logic")
