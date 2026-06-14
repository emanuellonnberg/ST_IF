// Unit tests for scenario.js — pure manifest parse + seed planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest, planSeed } from '../scenario.js';

const MANIFEST = {
    cards: [{ name: 'Tomas the Barkeep', file: 'cards/tomas.png' }, { name: 'Old Maeve', file: 'cards/maeve.png' }],
    npcs: [
        { name: 'tomas', room: 'taproom', blurb: 'gruff', card: 'Tomas the Barkeep' },
        { name: 'maeve', room: 'commonroom', blurb: 'sly', card: 'Old Maeve' },
        { name: 'sweep', room: 'commonroom', blurb: 'a quiet sweeper' },          // lightweight
        { name: 'ghost', room: 'cellar', blurb: 'a wraith', card: 'Spectre' },     // referenced, unshipped
    ],
    quests: [{ id: 'rats', giver: 'tomas', goal: 'clear rats', reward: { effect: 'grant', amount: 10 }, condition: 'rats_done' }],
    effectSafety: 'safe',
};

test('parseManifest reads JSON, null on junk', () => {
    assert.equal(parseManifest('{"npcs":[]}').npcs.length, 0);
    assert.equal(parseManifest('not json'), null);
    assert.equal(parseManifest(''), null);
});

test('planSeed imports only absent cards', () => {
    const plan = planSeed(MANIFEST, ['Old Maeve']);   // Maeve already present
    assert.deepEqual(plan.cardsToImport.map((c) => c.name), ['Tomas the Barkeep']);
});

test('planSeed passes npcs/quests/effectSafety through', () => {
    const plan = planSeed(MANIFEST, []);
    assert.equal(plan.npcs.length, 4);
    assert.equal(plan.quests[0].id, 'rats');
    assert.equal(plan.effectSafety, 'safe');
});

test('planSeed flags referenced-but-unshipped cards as missing', () => {
    const plan = planSeed(MANIFEST, []);
    // ghost references "Spectre" which is neither present nor shipped → missing.
    // tomas/maeve are shipped (in cardsToImport) → not missing; sweep has no card.
    assert.deepEqual(plan.missing, [{ npc: 'ghost', card: 'Spectre' }]);
});

test('planSeed tolerates an empty manifest', () => {
    const plan = planSeed({}, []);
    assert.deepEqual(plan, { cardsToImport: [], npcs: [], quests: [], effectSafety: null, missing: [] });
});
