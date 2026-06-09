// companion.js — decide the companion's movement intent. Pure; `generate` injected.

// Z-machine movement verbs the companion is allowed to use (position-only).
const DIRECTIONS = new Set([
    'north', 'south', 'east', 'west', 'up', 'down', 'in', 'out',
    'ne', 'nw', 'se', 'sw', 'northeast', 'northwest', 'southeast', 'southwest',
    'n', 's', 'e', 'w', 'u', 'd',
]);

export function buildIntentPrompt(playerText, playerRoom, companionRoom, bias) {
    const lean = bias >= 0.66 ? 'You strongly prefer to stay close to them and tend to follow.'
        : bias <= 0.33 ? 'You are independent and often wander on your own.'
            : 'You balance following them against doing your own thing.';
    return [
        'You decide whether a companion character takes ONE step on a map this turn.',
        `The companion is currently at: ${companionRoom}.`,
        `The player ({{user}}) is at: ${playerRoom}.`,
        `Companion disposition (bias ${bias}): ${lean}`,
        `The player just said/did: ${playerText}`,
        'Decide the companion\'s single movement this turn, or none.',
        'Respond with ONLY JSON: {"move":"<direction>"} or {"move":null}. ' +
        'A direction is one compass word (north, south, east, west, up, down, in, out, ne, nw, se, sw). No other verbs.',
    ].join('\n');
}

function extractMove(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    try {
        const obj = JSON.parse(text.slice(start, end + 1));
        return Object.prototype.hasOwnProperty.call(obj, 'move') ? obj.move : null;
    } catch {
        return null;
    }
}

/**
 * @returns {Promise<string|null>} a direction command, or null to stay put
 */
export async function decideMove(playerText, playerRoom, companionRoom, bias, generate) {
    let raw;
    try {
        raw = await generate(buildIntentPrompt(playerText, playerRoom, companionRoom, bias));
    } catch {
        return null;
    }
    const move = extractMove(String(raw ?? ''));
    if (typeof move !== 'string') return null;
    const norm = move.trim().toLowerCase();
    return DIRECTIONS.has(norm) ? norm : null;
}
