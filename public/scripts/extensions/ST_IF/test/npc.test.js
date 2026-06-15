// Unit tests for npc.js — pure NPC registry + co-location + addressed detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNpc, removeNpc, bindCard, listNpcs, presentNpcs, npcCanonLine, addressedNpc, moveNpc, setFollow, advanceFollowers, deriveNpcName } from '../npc.js';

test('deriveNpcName takes the first word, lowercased + alnum', () => {
    assert.equal(deriveNpcName('Tomas the Barkeep'), 'tomas');
    assert.equal(deriveNpcName('Old Maeve'), 'old');
    assert.equal(deriveNpcName("D'Artagnan, Guard"), 'dartagnan');
    assert.equal(deriveNpcName(''), '');
});

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

test('presentNpcs matches a manifest slug against the VM display name (spaces/case)', () => {
    // manifest binds maeve to "commonroom"; the VM reports the room as "Common Room".
    const l = [{ name: 'maeve', room: 'commonroom', blurb: 'sly' }];
    assert.deepEqual(presentNpcs(l, 'Common Room').map((n) => n.name), ['maeve']);
    assert.deepEqual(presentNpcs([{ name: 'tomas', room: 'taproom' }], 'Taproom').map((n) => n.name), ['tomas']);
    assert.deepEqual(presentNpcs(l, 'Taproom'), []);   // different room → not present
});

test('moveNpc relocates one NPC; "away" hides them from every room', () => {
    let l = [{ name: 'maeve', room: 'commonroom', blurb: 'sly' }, { name: 'tomas', room: 'taproom' }];
    l = moveNpc(l, 'maeve', 'taproom');
    assert.deepEqual(presentNpcs(l, 'Taproom').map((n) => n.name), ['maeve', 'tomas']);
    l = moveNpc(l, 'maeve', 'away');
    assert.deepEqual(presentNpcs(l, 'Common Room'), []);   // away matches no real room
    assert.deepEqual(presentNpcs(l, 'Taproom').map((n) => n.name), ['tomas']);
});

test('setFollow + advanceFollowers: a follower travels to the player room, off stops it', () => {
    let l = [{ name: 'maeve', room: 'commonroom', blurb: 'sly' }, { name: 'tomas', room: 'taproom' }];
    l = setFollow(l, 'maeve', true);
    assert.equal(l.find((n) => n.name === 'maeve').follows, true);
    l = advanceFollowers(l, 'Cellar');                     // player moved to the Cellar
    assert.equal(l.find((n) => n.name === 'maeve').room, 'Cellar');
    assert.equal(l.find((n) => n.name === 'tomas').room, 'taproom');   // non-follower stays
    l = setFollow(l, 'maeve', false);
    assert.equal(l.find((n) => n.name === 'maeve').follows, undefined);
    l = advanceFollowers(l, 'Kitchen');
    assert.equal(l.find((n) => n.name === 'maeve').room, 'Cellar');    // no longer follows
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
