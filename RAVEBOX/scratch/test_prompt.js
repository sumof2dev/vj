const currentProfileMappings = [[{
    vibe: 'any',
    description: 'Dimmer control',
    behavior: 'static',
    source: 'volume',
    cal: { min: 0, center: 127, max: 255 },
    modifiers: { speed: 0.5, react: 0.5, hold_type: 'none' },
    value: 0
}]];
const fixtureChannels = [{ name: 'Master Dimmer', role: 'dimmer', default: 0 }];
const pendingAiInstructions = { global_instruction: 'make the dimmer react faster to impact' };
const aiConversationHistory = [];

const systemPrompt = `Role: Expert Stage Lighting Designer for RaveBox.
Task: Update a behavior profile based on specific user feedback for channels and rules.
Context: 
- Input: Current Mappings (2D array) and a Map of Instructions.
- Available Sources: volume, bass, mids, highs, impact, beat phase, bar phase, 4 bar phase, bin 0, bin 4.
- Available Behaviors: static, direct, sine, saw, square, noise, beat phase, bar phase, stochastic, spike, fuzzy, direct_stepped.
- Available Hold Types: none, beat, bar, 4 bar.

SCHEMA RULES:
1. MODIFIERS: All timing and sensitivity settings MUST live inside the "modifiers" object (speed, react, hold_type).
2. SOURCE: Frequency bins bin 0 (Sub) and bin 4 (Treble/Mid) are available for surgical frequency targeting.
3. RANGE PRESERVATION: Keep changes within the 'cal' object bounds (min, center, max) unless explicitly asked to expand them.

Output: Return a JSON object with:
- "logic_explanation": (compact summary of what you did)
- "mappings": (the updated 2D array)

- CURRENT LIVE UI STATE: ${JSON.stringify(currentProfileMappings)}
- FIXTURE CONTEXT: ${JSON.stringify(fixtureChannels)}
- NEW INSTRUCTIONS: ${JSON.stringify(pendingAiInstructions)}
- CONVERSATION DIALOGUE: ${JSON.stringify(aiConversationHistory.slice(-5))}

Output: Valid raw JSON object only.
`;

console.log("Prompt generated.");
