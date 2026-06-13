// Integration test for the real ifvms-backed VM wrapper, against a bundled
// Z-machine story (Colossal Cave Adventure, public domain, Z5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IFVM } from '../vm.js';

const story = new Uint8Array(readFileSync(new URL('./fixtures/Advent.z5', import.meta.url)));

test('loads and produces room text on look', async () => {
    const vm = new IFVM();
    await vm.load(story);
    assert.equal(vm.loaded, true);
    const out = vm.step('look');
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0, 'look should produce text');
    assert.match(out, /road/i, 'Adventure starts at the end of a road');
});

test('status line exposes location, score, and moves', async () => {
    const vm = new IFVM();
    await vm.load(story);
    vm.step('look');
    const status = vm.getStatus();
    assert.equal(typeof status.location, 'string');
    assert.ok(status.location.length > 0);
    assert.match(status.location, /road/i);
    assert.equal(typeof status.score, 'number');
    assert.equal(typeof status.moves, 'number');
});

test('stepping advances the move counter', async () => {
    const vm = new IFVM();
    await vm.load(story);
    const before = vm.getStatus().moves;
    vm.step('north');
    const after = vm.getStatus().moves;
    assert.ok(after > before, `moves should advance (${before} -> ${after})`);
});

test('command echo and prompt are stripped from output', async () => {
    const vm = new IFVM();
    await vm.load(story);
    const out = vm.step('north');
    assert.doesNotMatch(out.split('\n')[0], /^north$/i, 'leading command echo stripped');
    assert.doesNotMatch(out, />\s*$/, 'trailing prompt stripped');
});

test('two VM instances are independent (no shared story buffer)', async () => {
    // The companion feature runs two live VMs of the same story at once. They must
    // not share dynamic memory: moving one must not move the other.
    const a = new IFVM();
    await a.load(story);
    const b = new IFVM();
    await b.load(story);
    const bStart = b.getStatus().location;
    a.step('north');                               // move A only
    assert.notEqual(a.getStatus().location, bStart, 'A moved');
    assert.equal(b.getStatus().location, bStart, 'B unaffected by A moving');
    const bLook = b.step('look');                  // B still in its own room
    assert.match(bLook, new RegExp(bStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.equal(b.getStatus().location, bStart, 'B still in its own room after look');
});

test('save/restore round-trips through base64 JSON and reproduces next-step output', async () => {
    const vm = new IFVM();
    await vm.load(story);
    vm.step('north');
    const snap = vm.save();
    assert.equal(typeof snap, 'string');
    const afterEast1 = vm.step('east');

    const vm2 = new IFVM();
    await vm2.load(story);
    vm2.restore(snap);
    const afterEast2 = vm2.step('east');

    assert.equal(afterEast2, afterEast1, 'restored VM reproduces identical next-step output');
});

// Zork I is a copyrighted Infocom game and is NOT committed to the repo. These
// extra integration cases run only when a local copy is present; on a clean clone
// they skip so the suite stays green without redistributing the game.
let zork = null;
try {
    zork = new Uint8Array(readFileSync(new URL('./fixtures/zork1-r88-s840726.z3', import.meta.url)));
} catch { /* fixture absent — zork tests skip */ }
const zorkOpts = { skip: zork ? false : 'zork1 fixture not present (copyrighted; not committed)' };

test('forces verbose so re-entering a visited room prints the full description', zorkOpts, async () => {
    const vm = new IFVM();
    await vm.load(zork);
    // The house perimeter loops back to West of House (already visited at start).
    vm.step('north'); vm.step('east'); vm.step('south');
    const back = vm.step('west');   // re-enter West of House
    assert.match(back, /open field|white house/i, 'full description on return');
    assert.ok(back.trim().length > 90, 'not the brief name-only form');
});

test('query runs a command with zero net game effect', zorkOpts, async () => {
    const vm = new IFVM();
    await vm.load(zork);
    vm.step('open mailbox'); vm.step('take leaflet');
    const before = vm.getStatus();
    const inv = vm.query('inventory');
    assert.match(inv, /carrying|leaflet/i, 'returns the inventory answer');
    const after = vm.getStatus();
    assert.deepEqual(after, before, 'location/score/moves unchanged by the query');
    const next = vm.step('look');
    assert.match(next, /West of House/i, 'VM still playable after a query');
});

test('ensureVerbose repairs a brief-lineage snapshot after restore', zorkOpts, async () => {
    const a = new IFVM();
    await a.load(zork);
    a.step('brief');                      // simulate an old pre-verbose save lineage
    const briefSnap = a.save();

    const b = new IFVM();
    await b.load(zork);
    b.restore(briefSnap);                 // restore overrides the load-time verbose
    b.ensureVerbose();                    // the repair
    b.step('north'); b.step('east'); b.step('south');
    const back = b.step('west');
    assert.ok(back.trim().length > 90, 'full description after verbose repair');
    assert.match(back, /open field|white house/i);
});

const apt = new Uint8Array(readFileSync(new URL('../worlds/apartment.z5', import.meta.url)));

test('apartment world: starts in the hallway and moves to named rooms', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    assert.equal(vm.getStatus().location, 'Hallway');
    assert.match(vm.step('east'), /Living Room/);
    assert.match(vm.step('west'), /Hallway/);
    assert.match(vm.step('west'), /pitch dark/i, 'closet is dark without a light');
});

test('apartment world: inventory query reflects a taken object', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('take flashlight');
    assert.match(vm.query('inventory'), /flashlight/i);
});
