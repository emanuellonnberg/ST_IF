// state.js — per-chat game state in chatMetadata. Pure: operates on a plain metadata object.

export const KEY = 'ST_IF';
export const HISTORY_CAP = 50;

export function readState(metadata) {
    return metadata[KEY] ?? null;
}

export function initState(metadata, storyId, snapshot) {
    metadata[KEY] = { storyId, snapshot, summary: null, history: [] };
    return metadata[KEY];
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
