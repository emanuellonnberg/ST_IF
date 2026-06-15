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

// Item names are stored in the VM as a single text token (effects.h XE_INBUF=20).
const ITEM_RE = /^[a-z][a-z0-9]{0,18}$/;

/**
 * Bound an effect proposal to what may fire this turn, or null.
 * safety: 'off' (nothing) | 'safe' (grant/flag/give) | 'open' (also take/take-item).
 *   grant  — NPC gives gold   |  take      — NPC takes gold   (open only)
 *   flag   — set a named flag  |  give      — NPC hands you an item
 *   take-item — NPC takes a held item back  (open only)
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
    if (effect === 'give' || effect === 'take-item') {
        if (effect === 'take-item' && safety !== 'open') return null;
        if (typeof p.item !== 'string' || !ITEM_RE.test(p.item)) return null;
        return { effect, item: p.item };
    }
    return null;
}

/** The VM meta-command for a validated effect. */
export function effectVerb(eff) {
    if (eff.effect === 'flag') return `xflag ${eff.flag}`;
    if (eff.effect === 'give') return `xgive ${eff.item}`;
    if (eff.effect === 'take-item') return `xtakeitem ${eff.item}`;
    return `${eff.effect === 'take' ? 'xtake' : 'xgrant'} ${eff.amount}`;
}
