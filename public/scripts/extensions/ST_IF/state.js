// state.js — per-chat game state in chatMetadata. Pure: operates on a plain metadata object.

export const KEY = 'ST_IF';
export const HISTORY_CAP = 50;

export function readState(metadata) {
    return metadata[KEY] ?? null;
}

export function initState(metadata, storyId, snapshot) {
    metadata[KEY] = {
        storyId, snapshot, summary: null, history: [],
        companion: { snapshot, summary: null, followQueue: [] },
        together: true,
        grownRooms: { rooms: [], edges: [], anchors: {} },
    };
    return metadata[KEY];
}

export function getCompanionSnapshot(metadata) {
    const s = metadata[KEY];
    if (!s) return null;
    return s.companion?.snapshot ?? s.snapshot ?? null;   // legacy fallback: player snapshot
}

export function setCompanion(metadata, { snapshot, summary }) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.companion = { snapshot, summary: summary ?? null, followQueue: s.companion?.followQueue ?? [] };
}

export function getRoomDescription(metadata) {
    return metadata[KEY]?.roomDescription ?? '';
}

export function setRoomDescription(metadata, text) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.roomDescription = String(text ?? '');
}

export function getFollowQueue(metadata) {
    return metadata[KEY]?.companion?.followQueue ?? [];
}

export function setFollowQueue(metadata, queue) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.companion = s.companion ?? { snapshot: s.snapshot, summary: null };
    s.companion.followQueue = Array.isArray(queue) ? queue : [];
}

export function setTogether(metadata, value) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.together = !!value;
}

export function readTogether(metadata) {
    const s = metadata[KEY];
    if (!s) return true;
    return s.together ?? true;   // legacy default: together
}

/**
 * @param {object} metadata
 * @param {{msgIndex:number, snapBefore:string, snapshot:string, summary:object, cmds:string[]}} turn
 */
export function recordTurn(metadata, turn) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.snapshot = turn.snapshot;
    s.summary = turn.summary;
    s.history.push({
        msgIndex: turn.msgIndex,
        snapBefore: turn.snapBefore,
        cmds: turn.cmds,
    });
    if (s.history.length > HISTORY_CAP) {
        s.history.splice(0, s.history.length - HISTORY_CAP);
    }
}

export function getActiveSnapshot(metadata) {
    return metadata[KEY]?.snapshot ?? null;
}

/**
 * Restore to the state *before* the turn at msgIndex; drop that turn and all later ones.
 * @returns {string|null} the restored snapshot, or null if msgIndex unknown.
 */
export function rewindTo(metadata, msgIndex) {
    const s = metadata[KEY];
    if (!s) return null;
    const idx = s.history.findIndex((h) => h.msgIndex === msgIndex);
    if (idx === -1) return null;
    const snap = s.history[idx].snapBefore;
    s.history.splice(idx);
    s.snapshot = snap;
    return snap;
}

export function getInventoryText(metadata) {
    return metadata[KEY]?.inventoryText ?? '';
}

export function setInventoryText(metadata, text) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.inventoryText = String(text ?? '');
}

/**
 * Read cached exits for a room. Entries store the description they were extracted
 * from; passing `desc` makes a mismatch read as uncached (stale → re-extract).
 * Legacy array-shaped entries (pre-desc cache) also read as uncached.
 * Omit `desc` for display reads (returns whatever is cached).
 */
export function getExitsForRoom(metadata, room, desc) {
    const e = metadata[KEY]?.exitsCache?.[room];
    if (!e || Array.isArray(e)) return undefined;
    if (desc !== undefined && e.desc !== desc) return undefined;
    return e.exits;
}

export function setExitsForRoom(metadata, room, exits, desc) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.exitsCache = s.exitsCache ?? {};
    s.exitsCache[room] = { exits, desc: desc ?? '' };
}

export function getEdgesForRoom(metadata, room) {
    return metadata[KEY]?.mapEdges?.[room] ?? {};
}

const ANCHOR_SPAN = 100000;   // frontier clusters sit this far apart on the grid

/** The grown world as a graph: { rooms, edges, anchors:{slug:cell} }. */
export function getWorldGraph(metadata) {
    const g = metadata[KEY]?.grownRooms;
    if (g && Array.isArray(g.rooms) && Array.isArray(g.edges)) return { anchors: {}, ...g };
    return { rooms: [], edges: [], anchors: {} };
}

/** Just the grown rooms (back-compat for callers that only want the room list). */
export function getGrownRooms(metadata) {
    return getWorldGraph(metadata).rooms;
}

function ensureGraph(metadata) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    if (!s.grownRooms || !Array.isArray(s.grownRooms.rooms)) s.grownRooms = { rooms: [], edges: [], anchors: {} };
    if (!s.grownRooms.anchors) s.grownRooms.anchors = {};
    return s.grownRooms;
}

/** Append a grown-room record: { name, x, y, z, description, objects }. */
export function recordRoom(metadata, rec) {
    ensureGraph(metadata).rooms.push(rec);
}

/** Append a connection edge: { from, dir, to } (deduped on the directed triple). */
export function recordEdge(metadata, edge) {
    const g = ensureGraph(metadata);
    if (!g.edges.some((e) => e.from === edge.from && e.dir === edge.dir && e.to === edge.to)) {
        g.edges.push(edge);
    }
}

/** Frontier anchors: { slug: cell }. */
export function getAnchors(metadata) {
    return getWorldGraph(metadata).anchors ?? {};
}

export function setAnchor(metadata, slug, cell) {
    ensureGraph(metadata).anchors[slug] = cell;
}

/** Next free cluster anchor, spaced far from existing ones. */
export function nextAnchorCell(metadata) {
    const n = Object.keys(getAnchors(metadata)).length;
    return { x: ANCHOR_SPAN * (n + 1), y: 0, z: 0 };
}

/** Cell of a room/frontier by slug ('origin' = 0,0,0); null if unknown. */
export function cellOfRoom(metadata, slug) {
    if (slug === 'origin' || slug === 'Origin') return { x: 0, y: 0, z: 0 };
    const g = getWorldGraph(metadata);
    const r = g.rooms.find((x) => x.name === slug);
    if (r) return { x: r.x, y: r.y, z: r.z };
    return g.anchors?.[slug] ?? null;
}

/** Slug of the room occupying a cell ('origin' for 0,0,0); null if empty. */
export function roomAtCell(metadata, cell) {
    if (cell && cell.x === 0 && cell.y === 0 && cell.z === 0) return 'origin';
    const g = getWorldGraph(metadata);
    const r = g.rooms.find((x) => x.x === cell?.x && x.y === cell?.y && x.z === cell?.z);
    if (r) return r.name;
    for (const [slug, c] of Object.entries(g.anchors ?? {})) {
        if (c.x === cell?.x && c.y === cell?.y && c.z === cell?.z) return slug;
    }
    return null;
}

export function recordMapEdge(metadata, fromRoom, dir, toRoom) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.mapEdges = s.mapEdges ?? {};
    s.mapEdges[fromRoom] = s.mapEdges[fromRoom] ?? {};
    s.mapEdges[fromRoom][dir] = toRoom;
}
