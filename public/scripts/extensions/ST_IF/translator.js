// translator.js — prose → canonical VM commands. No ST imports; `generate` is injected.

const MAX_CMDS = 4;

const STRICTNESS_NOTE = {
    strict: 'Only translate clear physical world-actions (move, take, drop, open, close, use, push, pull, attack, give, read, wear, eat, etc.). If the message is pure conversation, emotion, or description with no concrete world-action, return an empty array.',
    loose: 'Translate any plausible in-world action, including examining and social actions the parser might accept. Still return an empty array if nothing maps to a command.',
};

export function buildTranslatePrompt(playerText, status, strictness) {
    const note = STRICTNESS_NOTE[strictness] ?? STRICTNESS_NOTE.strict;
    return [
        'You convert a player\'s natural-language roleplay into Interactive Fiction parser commands.',
        `Current location: ${status.location}.`,
        note,
        'Respond with ONLY a JSON array of short imperative parser commands (e.g. ["take lantern","north"]). No prose, no explanation. Empty array if no world-action.',
        '',
        `Player message: ${playerText}`,
    ].join('\n');
}

/** Extract the first top-level JSON array from arbitrary model text. */
function extractArray(text) {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return null;
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} playerText
 * @param {{location:string,score:number|null,moves:number|null}} status
 * @param {'strict'|'loose'} strictness
 * @param {(prompt:string)=>Promise<string>} generate
 * @returns {Promise<string[]>}
 */
export async function translate(playerText, status, strictness, generate) {
    let raw;
    try {
        raw = await generate(buildTranslatePrompt(playerText, status, strictness));
    } catch {
        return [];
    }
    const arr = extractArray(String(raw ?? ''));
    if (!arr) return [];
    return arr
        .filter((c) => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim())
        .slice(0, MAX_CMDS);
}
