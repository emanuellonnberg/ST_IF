// companion.js — decide the companion's movement intent. Pure; `generate` injected.

// Z-machine movement verbs the companion is allowed to use (position-only).
const DIRECTIONS = new Set([
    'north', 'south', 'east', 'west', 'up', 'down', 'in', 'out',
    'ne', 'nw', 'se', 'sw', 'northeast', 'northwest', 'southeast', 'southwest',
    'n', 's', 'e', 'w', 'u', 'd',
]);

/** True when the player's prose contains a loud action that would carry between rooms. */
export function detectShout(text) {
    return /\b(shout|yell|scream|holler|bellow|call(s|ed|ing)? out|cr(y|ies|ied) out)/i.test(String(text ?? ''));
}

/** Pull the compass-direction commands out of a translated command list, in order.
 *  Accepts bare directions and "go/walk/run/head/move/climb <dir>" forms. */
export function extractMoves(cmds) {
    return (cmds || [])
        .map((c) => String(c).trim().toLowerCase().replace(/^(?:go|walk|run|head|move|climb)\s+/, ''))
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

// --- Companion world-actions (run on the canonical player VM while together) ---

const META_VERBS = new Set(['save', 'restore', 'restart', 'quit', 'undo', 'script']);
const SAFE_VERBS = new Set([
    'light', 'extinguish', 'open', 'close', 'read', 'take', 'get', 'push', 'pull',
    'turn', 'ring', 'knock', 'touch', 'examine', 'look', 'search', 'unlock', 'wear',
    'tie', 'untie',
]);

const INITIATIVE_NOTE = {
    asked: 'Act ONLY if {{user}}\'s message explicitly asks {{char}} to do something. Otherwise respond with null.',
    need: 'Act if {{user}} asks {{char}} to do something, or if the scene has an obvious immediate need {{char}} would naturally handle. Otherwise respond with null.',
    proactive: 'Act whenever a useful action presents itself; respond with null only if nothing is worth doing.',
};

export function buildUsePrompt(playerText, sceneDesc, playerCmds, initiative) {
    const note = INITIATIVE_NOTE[initiative] ?? INITIATIVE_NOTE.need;
    const done = playerCmds.length ? `Already done this turn by {{user}} (do NOT repeat): ${playerCmds.join('; ')}.` : '';
    return [
        'You decide whether a companion character ({{char}}) performs ONE Interactive Fiction parser action this turn.',
        `Scene: ${sceneDesc}`,
        `{{user}} said/did: ${playerText}`,
        done,
        note,
        'Respond with ONLY JSON: {"command":"<short imperative parser command>"} or {"command":null}.',
    ].filter(Boolean).join('\n');
}

/**
 * @returns {Promise<{command: string|null}>} fail-open to null on garbage/error.
 */
export async function decideUse(playerText, sceneDesc, playerCmds, initiative, generate) {
    let raw;
    try {
        raw = await generate(buildUsePrompt(playerText, sceneDesc, playerCmds, initiative));
    } catch {
        return { command: null };
    }
    const text = String(raw ?? '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return { command: null };
    try {
        const obj = JSON.parse(text.slice(start, end + 1));
        return { command: typeof obj.command === 'string' && obj.command.trim() ? obj.command.trim() : null };
    } catch {
        return { command: null };
    }
}

/**
 * Validate a companion action command against the safety level.
 * @returns {string|null} the cleaned command, or null if rejected.
 */
export function validateAction(command, safety) {
    if (typeof command !== 'string') return null;
    const cmd = command.trim();
    if (!cmd) return null;
    if (/[\n.;]|\bthen\b/i.test(cmd)) return null;            // one command max
    const verb = cmd.split(/\s+/)[0].toLowerCase();
    if (META_VERBS.has(verb)) return null;                    // never touch the session
    if (safety === 'safe' && !SAFE_VERBS.has(verb)) return null;
    return cmd;
}
