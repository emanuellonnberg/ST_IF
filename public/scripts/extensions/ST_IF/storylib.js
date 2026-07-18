// storylib.js — pure: the uploaded-story library + per-chat story references.
// A chat's game is identified by a storyRef persisted in its metadata:
//   { source: 'bundled', file, name, id? }   — re-fetchable from worlds/<file>
//   { source: 'library', key, name }         — bytes live in settings.storyLibrary[key]
//   { source: 'legacy', name }               — the old single global storyBase64 slot
// The library keeps uploaded games in extension settings (saved rarely) rather than
// per-chat metadata (saved every message), so a 2MB .gblorb is stored once.
// No ST/VM imports.

const keyFor = (name) => String(name ?? 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'story';

/** Add a story to the library (idempotent for identical name+bytes; suffixes on
 *  a name collision with different bytes). Returns the entry's key. Mutates lib. */
export function libAdd(lib, name, base64) {
    let key = keyFor(name);
    let n = 2;
    while (lib[key] && !(lib[key].name === name && lib[key].base64 === base64)) key = `${keyFor(name)}-${n++}`;
    lib[key] = { name, base64 };
    return key;
}

export function libGet(lib, key) {
    return (lib && lib[key]) || null;
}

/** [{key, name, kb}] — kb is the stored base64 size, for display. */
export function libList(lib) {
    return Object.entries(lib ?? {}).map(([key, e]) => ({ key, name: e.name, kb: Math.round((e.base64?.length ?? 0) / 1024) }));
}

/** Remove by key or exact name. Returns true if something was removed. Mutates lib. */
export function libRemove(lib, keyOrName) {
    if (lib[keyOrName]) { delete lib[keyOrName]; return true; }
    for (const [k, e] of Object.entries(lib ?? {})) {
        if (e.name === keyOrName) { delete lib[k]; return true; }
    }
    return false;
}

/**
 * Promote the legacy global story slot to a STABLE ref: bundled worlds by filename,
 * anything else into the library (mutates lib; caller persists settings). Legacy refs
 * must never be stored on a chat — they resolve from a mutable global slot, so a
 * later story switch would feed this chat's snapshot to different bytes.
 * @param {{storyFile?:string, storyName?:string, storyId?:string, storyBase64?:string}} s
 * @param {object} lib settings.storyLibrary
 * @returns {object|null} a bundled/library ref, or null if the slot is empty
 */
export function promoteLegacyRef(s, lib) {
    if (s.storyFile) return { source: 'bundled', file: s.storyFile, name: s.storyName || s.storyFile, id: s.storyId || '' };
    if (s.storyBase64) {
        const name = s.storyName || 'uploaded story';
        const key = libAdd(lib, name, s.storyBase64);
        return { source: 'library', key, name };
    }
    return null;
}

/** Stable identity for "is the VM already running this story?" comparisons. */
export function refIdentity(ref) {
    if (!ref) return null;
    if (ref.source === 'bundled') return `bundled:${ref.file}`;
    if (ref.source === 'library') return `library:${ref.key}`;
    return `legacy:${ref.name ?? ''}`;
}

/**
 * Guard: may this chat's saved snapshot be restored into the story `ref` resolves
 * to? The chat records the story name it was initialised with (state.storyId);
 * restoring a snapshot into different story bytes corrupts the VM, so a mismatch
 * means the chat must be re-initialised instead.
 */
export function snapshotMatchesRef(stateStoryId, ref) {
    if (!stateStoryId || !ref?.name) return false;
    return String(stateStoryId) === String(ref.name);
}
