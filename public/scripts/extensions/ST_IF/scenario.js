// scenario.js — pure: parse a world's manifest + plan what to seed. No ST/VM imports.
// A manifest: { cards:[{name,file}], npcs:[{name,room,blurb,card?,patrol?}], quests:[...],
//              effectSafety?, narrator?:{name,file?}, brief? }.
// `brief` is a paragraph of shared world facts every NPC knows — injected into each
// NPC reply so they answer from a consistent truth (the scenario's background).

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
    const narrator = manifest?.narrator?.name ? manifest.narrator : null;

    // The narrator card is imported like any other (if shipped and absent), and its
    // name is surfaced so the host can suggest loading it as the active character.
    const allCards = narrator?.file ? [...cards, narrator] : cards;
    const cardsToImport = allCards.filter((c) => c?.name && !present.has(c.name));
    const willHave = new Set([...present, ...cardsToImport.map((c) => c.name)]);

    // NPCs that name a card which is neither present nor shipped → still missing.
    const missing = npcs
        .filter((n) => n?.card && !willHave.has(n.card))
        .map((n) => ({ npc: n.name, card: n.card }));

    return { cardsToImport, npcs, quests, effectSafety: manifest?.effectSafety ?? null, narrator: narrator?.name ?? null, brief: manifest?.brief ?? null, missing };
}
