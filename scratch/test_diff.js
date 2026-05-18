const oldMap = [[{ source: 'volume', behavior: 'static', vibe: 'any', modifiers: { speed: 0.5, react: 0.5, hold_type: 'none' }, cal: { min: 0, center: 127, max: 255 }, value: 0 }]];
const newMap = [[{ source: 'bass', behavior: 'sine', vibe: 'any', modifiers: { speed: 1.0, react: 0.8, hold_type: 'none' }, cal: { min: 0, center: 127, max: 255 }, value: 0 }]];

let chChanges = [];
newMap.forEach((newRules, chIdx) => {
    const oldRules = oldMap[chIdx] || [];
    newRules.forEach((nr, rIdx) => {
        const or = oldRules[rIdx];
        const keys = ['source', 'behavior', 'vibe', 'value', 'invert', 'offset'];
        keys.forEach(k => {
            if (nr[k] !== or[k]) {
                chChanges.push(`${k}: ${or[k]} -> ${nr[k]}`);
            }
        });
        const nm = nr.modifiers || {};
        const om = or.modifiers || {};
        const modKeys = ['speed', 'react', 'hold_type'];
        modKeys.forEach(mk => {
            if (nm[mk] !== om[mk]) {
                chChanges.push(`modifiers.${mk}: ${om[mk]} -> ${nm[mk]}`);
            }
        });
    });
});
console.log(chChanges);
