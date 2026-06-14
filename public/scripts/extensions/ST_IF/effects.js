// effects.js — pure: parse + validate an NPC effect proposal, format the VM verb.
// The LLM proposes; the engine bounds; the VM executes (effects.h). No ST/VM imports.

/** Pull the first {...} JSON object out of LLM prose; null if none/invalid. */
export function parseEffectProposal(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

const isInt = (n) => typeof n === 'number' && Number.isInteger(n);

/**
 * Bound an effect proposal to what may fire this turn, or null.
 * safety: 'off' (nothing) | 'safe' (grant/flag) | 'open' (also take).
 */
export function validateEffect(p, { safety = 'off', maxGrant = 25 } = {}) {
    if (!p || safety === 'off') return null;
    const effect = p.effect;
    if (effect === 'grant' || effect === 'take') {
        if (effect === 'take' && safety !== 'open') return null;
        if (!isInt(p.amount) || p.amount < 1 || p.amount > maxGrant) return null;
        return { effect, amount: p.amount };
    }
    if (effect === 'flag') {
        if (typeof p.flag !== 'string' || !/^[a-z][a-z0-9_]*$/.test(p.flag)) return null;
        return { effect: 'flag', flag: p.flag };
    }
    return null;
}

/** The VM meta-command for a validated effect. */
export function effectVerb(eff) {
    if (eff.effect === 'flag') return `xflag ${eff.flag}`;
    return `${eff.effect === 'take' ? 'xtake' : 'xgrant'} ${eff.amount}`;
}
