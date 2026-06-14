// Unit tests for npc.js — pure NPC registry + co-location + addressed detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNpc, removeNpc, bindCard, listNpcs, presentNpcs, npcCanonLine, addressedNpc } from '../npc.js';

test('addNpc adds and replaces by name', () => {
    let l = addNpc([], { name: 'barkeep', room: 'tavern', blurb: 'gruff' });
    assert.equal(l.length, 1);
    l = addNpc(l, { name: 'barkeep', room: 'cellar', blurb: 'gruffer' });   // replace
    assert.equal(l.length, 1);
    assert.equal(l[0].room, 'cellar');
});

test('removeNpc / bindCard / listNpcs', () => {
    let l = addNpc([], { name: 'barkeep', room: 'tavern', blurb: 'gruff' });
    l = bindCard(l, 'barkeep', 'Gruff Innkeeper');
    assert.equal(l[0].card, 'Gruff Innkeeper');
    l = bindCard(l, 'barkeep', '-');                 // unbind
    assert.equal(l[0].card, undefined);
    assert.deepEqual(listNpcs(l).map((n) => n.name), ['barkeep']);
    l = removeNpc(l, 'barkeep');
    assert.equal(l.length, 0);
});

test('presentNpcs filters by room slug (case-insensitive)', () => {
    const l = [
        { name: 'barkeep', room: 'tavern', blurb: 'gruff' },
        { name: 'hazel', room: 'kitchen', blurb: 'shy' },
    ];
    assert.deepEqual(presentNpcs(l, 'Tavern').map((n) => n.name), ['barkeep']);
    assert.deepEqual(presentNpcs(l, 'street'), []);
});

test('npcCanonLine lists present NPCs, or empty', () => {
    assert.equal(npcCanonLine([]), '');
    assert.equal(
        npcCanonLine([{ name: 'barkeep', blurb: 'gruff' }, { name: 'hazel', blurb: 'shy' }]),
        'Present here: barkeep — gruff; hazel — shy.',
    );
});

test('addressedNpc returns a present card-bound NPC by name mention or talk verb', () => {
    const present = [
        { name: 'barkeep', blurb: 'gruff', card: 'Gruff Innkeeper' },
        { name: 'hazel', blurb: 'shy' },   // lightweight (no card)
    ];
    assert.equal(addressedNpc('ask barkeep about the ale', present)?.name, 'barkeep');   // name + verb
    assert.equal(addressedNpc('"Evening, barkeep," I say', present)?.name, 'barkeep');    // name mention
    assert.equal(addressedNpc('I look around the room', present), null);                  // no address
    assert.equal(addressedNpc('talk to hazel', present), null);                           // hazel has no card
    assert.equal(addressedNpc('ask barkeeper', [{ name: 'barkeep', card: 'X' }]), null);  // word boundary, not 'barkeeper'
});
