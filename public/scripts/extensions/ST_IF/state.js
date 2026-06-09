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
