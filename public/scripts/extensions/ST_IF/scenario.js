// scenario.js — pure: parse a world's manifest + plan what to seed. No ST/VM imports.
// A manifest: { cards:[{name,file}], npcs:[{name,room,blurb,card?}], quests:[...], effectSafety? }.

export function parseManifest(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Plan the seed for a freshly-loaded scenario.
 * @param manifest parsed manifest
 * @param existingCardNames names of cards already in the character list
 * @returns { cardsToImport, npcs, quests, effectSafety, missing:[{npc,card}] }
 */
export function planSeed(manifest, existingCardNames) {
    const present = new Set(existingCardNames ?? []);
    const cards = Array.isArray(manifest?.cards) ? manifest.cards : [];
    const npcs = Array.isArray(manifest?.npcs) ? manifest.npcs : [];
    const quests = Array.isArray(manifest?.quests) ? manifest.quests : [];

    const cardsToImport = cards.filter((c) => c?.name && !present.has(c.name));
    const willHave = new Set([...present, ...cardsToImport.map((c) => c.name)]);

    // NPCs that name a card which is neither present nor shipped → still missing.
    const missing = npcs
        .filter((n) => n?.card && !willHave.has(n.card))
        .map((n) => ({ npc: n.name, card: n.card }));

    return { cardsToImport, npcs, quests, effectSafety: manifest?.effectSafety ?? null, missing };
}
