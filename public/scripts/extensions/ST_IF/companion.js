// companion.js — decide the companion's movement intent. Pure; `generate` injected.

// Z-machine movement verbs the companion is allowed to use (position-only).
const DIRECTIONS = new Set([
    'north', 'south', 'east', 'west', 'up', 'down', 'in', 'out',
    'ne', 'nw', 'se', 'sw', 'northeast', 'northwest', 'southeast', 'southwest',
    'n', 's', 'e', 'w', 'u', 'd',
]);

/** Pull the compass-direction commands out of a translated command list, in order. */
export function extractMoves(cmds) {
    return (cmds || [])
        .map((c) => String(c).trim().toLowerCase())
        .filter((c) => DIRECTIONS.has(c));
}

/** Map the bias slider to a deterministic behavior zone. */
export function zone(bias) {
    const b = Number(bias);
    if (b >= 0.66) return 'glued';
    if (b <= 0.33) return 'wander';
    return 'trail';
}

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

const ACTIONS = new Set(['follow', 'stay', 'move']);

export function buildAgencyPrompt(playerText, playerRoom, companionRoom, playerMoves, bias) {
    const lean = bias >= 0.66 ? 'You strongly prefer to stay with {{user}} and rarely break off.'
        : bias <= 0.33 ? 'You are independent and often go your own way.'
            : 'You balance staying with them against doing your own thing.';
    const movesNote = playerMoves.length
        ? `{{user}} just moved: ${playerMoves.join(', ')}.`
        : '{{user}} did not move this turn.';
    return [
        'You control a companion character on a map. Decide what they do THIS turn.',
        `The companion is at: ${companionRoom}. {{user}} is at: ${playerRoom}.`,
        movesNote,
        `{{user}} said/did: ${playerText}`,
        `Disposition: ${lean}`,
        'Choose ONE: follow {{user}} (go where they went), stay (hang back here), or move (go your own way).',
        'Respond with ONLY JSON: {"action":"follow"|"stay"|"move","direction":"<compass word or null>"}.',
    ].join('\n');
}

function extractObject(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

/**
 * @returns {Promise<{action:'follow'|'stay'|'move', direction:string|null}>}
 */
export async function decideAgency(playerText, playerRoom, companionRoom, playerMoves, bias, generate) {
    let raw;
    try {
        raw = await generate(buildAgencyPrompt(playerText, playerRoom, companionRoom, playerMoves, bias));
    } catch {
        return { action: 'follow', direction: null };
    }
    const obj = extractObject(String(raw ?? ''));
    if (!obj || !ACTIONS.has(obj.action)) return { action: 'follow', direction: null };
    if (obj.action === 'move') {
        const d = typeof obj.direction === 'string' ? obj.direction.trim().toLowerCase() : '';
        if (!DIRECTIONS.has(d)) return { action: 'stay', direction: null };
        return { action: 'move', direction: d };
    }
    return { action: obj.action, direction: null };
}
