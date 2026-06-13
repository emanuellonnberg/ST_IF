// worldgen.js — pure helpers for runtime world growth.
// LLM room JSON -> sanitised model -> Z-machine meta-commands (xroom/xdesc/xobj/xodesc),
// plus blocked-move detection. No ST/VM/LLM imports; unit-tested in isolation.

const ascii = (s) => String(s ?? '').replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();

// Object names must be parser-friendly: lowercase, letters only, at most two words
// (parse_name matches them word-by-word against a stored buffer).
const objName = (s) => ascii(s).toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ')
    .trim().split(' ').filter(Boolean).slice(0, 2).join(' ');

/** Pull the first {...} block out of arbitrary LLM prose; null if none/invalid. */
export function parseRoomJson(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Clamp an LLM room object to what the pool buffers can hold.
 * Caps default to the expanse.h buffer sizes minus one (length byte).
 */
export function sanitizeRoom(raw, { nameMax = 31, descMax = 199, objDescMax = 119, maxObjects = 8 } = {}) {
    const name = ascii(raw?.name).slice(0, nameMax) || 'somewhere';
    const description = ascii(raw?.description).slice(0, descMax) || 'An undefined space.';
    const objects = Array.isArray(raw?.objects)
        ? raw.objects.slice(0, maxObjects).map((o) => ({
            name: objName(o?.name) || 'thing',
            description: ascii(o?.description).slice(0, objDescMax) || 'Nothing special.',
            takeable: !!o?.takeable,
        }))
        : [];
    return { name, description, objects };
}

/** Build the ordered meta-commands that materialise a room and its objects. */
export function buildMetaCommands(dir, room) {
    const cmds = [`xroom ${dir} ${room.name}`, `xdesc ${room.description}`];
    for (const o of room.objects) {
        cmds.push(`xobj ${o.takeable ? 1 : 0} ${o.name}`);
        cmds.push(`xodesc ${o.description}`);
    }
    return cmds;
}

// Movement commands we recognise (full words + single-letter abbreviations).
const DIR_FULL = { n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down' };
const DIRS = new Set([...Object.keys(DIR_FULL), ...Object.values(DIR_FULL)]);
// Conservative: only the phrasings our seed/Inform library actually emit.
const BLOCKED = /can't go that way|can't go in that direction/i;

/**
 * If `cmd` was a compass move and `output` is a "blocked" response, return the
 * normalised direction; otherwise null. Used to decide whether to grow a room.
 */
export function blockedMove(cmd, output) {
    const c = String(cmd ?? '').trim().toLowerCase();
    if (!DIRS.has(c)) return null;
    if (!BLOCKED.test(String(output ?? ''))) return null;
    return DIR_FULL[c] ?? c;
}
