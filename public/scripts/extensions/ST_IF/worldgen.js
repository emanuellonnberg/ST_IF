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
    // Room names are a single lowercase token: the VM stores one word and they are the
    // identity key for xlinkn, so collapse multi-word names rather than truncate them.
    const name = ascii(raw?.name).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, nameMax) || 'somewhere';
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

// Grid geometry: a step in each compass direction as a coordinate delta.
const CELL = {
    north: { dx: 0, dy: 1, dz: 0 }, south: { dx: 0, dy: -1, dz: 0 },
    east: { dx: 1, dy: 0, dz: 0 }, west: { dx: -1, dy: 0, dz: 0 },
    up: { dx: 0, dy: 0, dz: 1 }, down: { dx: 0, dy: 0, dz: -1 },
};
const fullDir = (dir) => DIR_FULL[String(dir).toLowerCase()] ?? String(dir).toLowerCase();

export function cellDelta(dir) {
    return CELL[fullDir(dir)] ?? null;
}

export function addCell(cell, dir) {
    const d = cellDelta(dir);
    if (!d) return cell;
    return { x: (cell?.x ?? 0) + d.dx, y: (cell?.y ?? 0) + d.dy, z: (cell?.z ?? 0) + d.dz };
}

/**
 * Keep only the LLM-named connections that are safe to apply: a real compass dir not
 * already taken, and `to` an exact existing room name (drops hallucinations + dup dirs).
 */
export function validateConnections(conns, existingNames, takenDirs = []) {
    if (!Array.isArray(conns)) return [];
    const exist = new Set(existingNames ?? []);
    const taken = new Set((takenDirs ?? []).map(fullDir));
    const used = new Set();
    const out = [];
    for (const c of conns) {
        const dir = fullDir(c?.dir);
        const to = String(c?.to ?? '');
        if (!CELL[dir] || !exist.has(to) || taken.has(dir) || used.has(dir)) continue;
        used.add(dir);
        out.push({ dir, to });
    }
    return out;
}

const NORM = { ...DIR_FULL };
for (const d of Object.values(DIR_FULL)) NORM[d] = d;
/**
 * In "guided" growth mode, only grow a direction the room's prose hints at.
 * `exits` is the cached extraction ([{dir,label}, ...]); `dir` is a full word.
 */
export function directionSuggested(exits, dir) {
    if (!Array.isArray(exits)) return false;
    const want = NORM[String(dir).toLowerCase()] ?? dir;
    return exits.some((e) => (NORM[String(e?.dir).toLowerCase()] ?? e?.dir) === want);
}
