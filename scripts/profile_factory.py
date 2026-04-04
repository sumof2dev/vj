#!/usr/bin/env python3
"""
RaveBox Profile Factory - Automated Derivative Generation
Transforms a 'Melody' baseline profile into Rhythm and B-Side variants
based on the Hardware Fingerprint Manifest and ShowNET research.
"""
import json, os, copy

FINGERPRINT_PATH = "/home/sumof2/vj/fixtures/hardware_fingerprints.json"
CONFIG_PATH = "/home/sumof2/vj/fixtures/ravebox_config.json"

class ProfileFactory:
    def __init__(self):
        with open(FINGERPRINT_PATH) as f:
            self.manifest = json.load(f)
        self.rules = self.manifest["derivation_rules"]

    def create_rhythm(self, melody_profile):
        """Calculates a punchy, beat-driven version of the melody profile."""
        rhythm = copy.deepcopy(melody_profile)
        rhythm["id"] = melody_profile["id"].replace("_melody", "_rhythm")
        rhythm["name"] = melody_profile["name"].replace("Melody", "Rhythm")
        
        rules = self.rules["melody_to_rhythm"]
        
        for i, mapping in enumerate(rhythm["mappings"]):
            # Rule: Change Zoom (CH 5 role) to Bass-reactive
            if i == 4: # Index 4 is CH 5 - Zoom in ShowNET
                for rule in mapping:
                    if rule.get("behavior") == "lfo":
                        rule["behavior"] = rules["ch_5_behavior"]
                        rule["source"] = rules["ch_5_source"]
            
            # Rule: Change Boundary (CH 2 role) to Jittery
            if i == 1: # Index 1 is CH 2 - Boundary in ShowNET
                rhythm["mappings"][i] = [
                    {"vibe": "chill", "behavior": "static", "value": 0},
                    {"vibe": "mid", "behavior": "direct", "source": "bass", "cal": {"min": 50, "center": 52, "max": 56}},
                    {"vibe": "high", "behavior": "direct", "source": "beat", "cal": {"min": 100, "center": 108, "max": 118}},
                    {"vibe": "any", "behavior": "static", "value": 100}
                ]
        return rhythm

    def create_variant_b(self, melody_profile):
        """Calculates an offset, complementary version of the melody profile."""
        variant = copy.deepcopy(melody_profile)
        variant["id"] = melody_profile["id"] + "_b"
        variant["name"] = melody_profile["name"] + " B"
        
        rules = self.rules["melody_to_variant_b"]
        offset = rules["harmonic_offset"]
        
        for mapping in variant["mappings"]:
            for rule in mapping:
                # Rule: Harmonic Offset (+1 Bin)
                if "bin_idx" in rule:
                    rule["bin_idx"] += offset
                
                # Rule: Speed Multiplier
                if "lfo" in rule:
                    rule["lfo"]["speed"] *= rules["lfo_speed_multiplier"]
                    
        return variant

    def guess_standard(self, user_setup):
        """Attempts to match user entry against known fingerprints via fuzzy role matching."""
        for fp in self.manifest["fingerprints"]:
            aliases = fp["match_criteria"]["primary_aliases"]
            matches = 0
            for ch_num, name in user_setup.items():
                target_key = f"CH {ch_num}"
                if target_key in aliases and aliases[target_key].lower() in name.lower():
                    matches += 1
            if matches >= 2: # High confidence match found
                return fp
        return None

    def create_ensemble(self, base_id, base_name, melody_mappings):
        """Generates the full 3-profile suite from a single melody baseline."""
        melody = {"id": f"prof_{base_id}_melody", "name": f"{base_name} Melody", "mappings": melody_mappings}
        rhythm = self.create_rhythm(melody)
        variant_b = self.create_variant_b(melody)
        return [melody, rhythm, variant_b]

if __name__ == "__main__":
    factory = ProfileFactory()
    print("🚀 Profile Factory initialized. Ready to bridge Manual data to Optimized DNA.")
    
    # Example "Reverse Bridge" test:
    test_setup = {"1": "Laser ON/OFF", "2": "Out of Bounds", "4": "Pattern selections"}
    standard = factory.guess_standard(test_setup)
    if standard:
        print(f"✅ Identified Standard: {standard['name']}")
