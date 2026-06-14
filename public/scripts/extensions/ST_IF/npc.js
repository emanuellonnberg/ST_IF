// npc.js — pure NPC registry + co-location + addressed detection. No ST/VM imports.
// An NPC is { name, room, blurb, card? }: name = single-token id, room = world room slug,
// blurb = lightweight persona text, card = optional bound ST character reference.

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Add or update an NPC by name (preserves an existing card binding). */
export function addNpc(list, npc) {
    const existing = (list ?? []).find((n) => n.name === npc.name);
    const rest = (list ?? []).filter((n) => n.name !== npc.name);
    const merged = { name: npc.name, room: npc.room, blurb: npc.blurb ?? '' };
    if (existing?.card) merged.card = existing.card;
    return [...rest, merged];
}

export function removeNpc(list, name) {
    return (list ?? []).filter((n) => n.name !== name);
}

/** Bind a character card to an NPC; `card` of '-' or '' unbinds. */
export function bindCard(list, name, card) {
    return (list ?? []).map((n) => {
        if (n.name !== name) return n;
        const copy = { ...n };
        if (!card || card === '-') delete copy.card;
        else copy.card = card;
        return copy;
    });
}

export function listNpcs(list) {
    return [...(list ?? [])];
}

/** Normalize a room name/slug for matching: lowercase, drop non-alphanumerics, so
 *  a manifest slug ("commonroom") matches the VM's display name ("Common Room"). */
const roomKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** NPCs whose room matches the player's current room (slug/display-name-insensitive). */
export function presentNpcs(list, roomSlug) {
    const r = roomKey(roomSlug);
    return (list ?? []).filter((n) => roomKey(n.room) === r);
}

/** Canon line naming the NPCs present in the room, or '' if none. */
export function npcCanonLine(present) {
    if (!present || !present.length) return '';
    return 'Present here: ' + present.map((n) => `${n.name} — ${n.blurb}`).join('; ') + '.';
}

/** The present, card-bound NPC the player's message addresses (whole-word name), or null. */
export function addressedNpc(text, present) {
    const t = String(text ?? '');
    for (const n of present ?? []) {
        if (!n.card) continue;
        if (new RegExp(`\\b${escapeRe(n.name)}\\b`, 'i').test(t)) return n;
    }
    return null;
}
