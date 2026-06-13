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

test('apartment: forces verbose so a revisited room shows the full description', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('east');                 // Living Room
    const back = vm.step('west');    // re-enter Hallway (already visited)
    assert.match(back, /narrow hallway/i, 'full description on return');
    assert.ok(back.trim().length > 40, 'not a brief name-only line');
});

test('apartment: ensureVerbose repairs a brief-lineage snapshot', async () => {
    const a = new IFVM();
    await a.load(apt);
    a.step('brief');
    const briefSnap = a.save();
    const b = new IFVM();
    await b.load(apt);
    b.restore(briefSnap);
    b.ensureVerbose();
    b.step('east');
    const back = b.step('west');
    assert.match(back, /narrow hallway/i);
});

// --- Kitchen cooking simulation (timers + daemon + state machine) ----------
// Standard setup: enter Kitchen, get the pot + spaghetti, fill, load, put on
// the stove. `salt` true also stirs salt in. Leaves the stove OFF.
async function kitchenReady({ salt = false } = {}) {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('north');                 // Hallway -> Kitchen
    vm.step('open cupboard');
    vm.step('take pot');
    vm.step('take spaghetti');
    vm.step('fill pot');
    if (salt) { vm.step('take salt'); vm.step('put salt in pot'); }
    vm.step('put spaghetti in pot');
    vm.step('put pot on stove');
    return vm;
}

test('cooking: spaghetti cooks after exactly 8 turns on the lit stove', async () => {
    const vm = await kitchenReady();
    vm.step('turn on stove');
    for (let i = 0; i < 7; i++) {
        assert.doesNotMatch(vm.step('wait'), /cooks through|cooked and/i, `not cooked yet at turn ${i + 1}`);
    }
    assert.match(vm.step('wait'), /cooks through|cooked/i, 'cooked on the 8th turn');
    assert.match(vm.step('examine pot'), /cooked spaghetti/i);
});

test('cooking: stove refuses to heat an empty (waterless) pot', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('north');
    vm.step('open cupboard');
    vm.step('take pot');
    vm.step('put pot on stove');
    assert.match(vm.step('turn on stove'), /scorch|add water first/i);
    assert.doesNotMatch(vm.step('examine pot'), /cooked spaghetti/i);
});

test('cooking: salt yields a seasoned result', async () => {
    const vm = await kitchenReady({ salt: true });
    assert.match(vm.step('examine pot'), /salted/i);
    vm.step('turn on stove');
    let out = '';
    for (let i = 0; i < 8; i++) out = vm.step('wait');
    assert.match(out, /perfectly seasoned/i);
});

test('cooking: left too long, the spaghetti burns and the pot boils dry', async () => {
    const vm = await kitchenReady();
    vm.step('turn on stove');
    for (let i = 0; i < 8; i++) vm.step('wait');   // cooked
    let burned = '';
    for (let i = 0; i < 5; i++) { const o = vm.step('wait'); if (/charred|boiled dry|burning stink/i.test(o)) { burned = o; break; } }
    assert.match(burned, /charred|boiled dry|burning stink/i, 'burns within a few turns of overcooking');
    assert.match(vm.step('examine spaghetti'), /ruined|charred/i);
});

test('cooking: turning the stove off before 8 turns leaves the pasta uncooked', async () => {
    const vm = await kitchenReady();
    vm.step('turn on stove');
    vm.step('wait'); vm.step('wait');
    vm.step('turn off stove');
    assert.match(vm.step('examine spaghetti'), /dry/i, 'interrupted heat never finishes the cook');
});

// --- Bathroom laundry (wash -> dry -> wear) and Living Room media -----------
function waitUntil(vm, re, max = 14) {
    for (let i = 0; i < max; i++) { const o = vm.step('wait'); if (re.test(o)) return o; }
    return '';
}

// Enter the Bathroom and load the laundry (and detergent unless soap=false).
async function washerLoaded({ soap = true } = {}) {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('south'); vm.step('east');         // Hallway -> Bedroom -> Bathroom
    vm.step('take laundry');
    vm.step('put laundry in washer');
    if (soap) { vm.step('take detergent'); vm.step('put detergent in washer'); }
    return vm;
}

test('laundry: a full cycle leaves the clothes clean and wet', async () => {
    const vm = await washerLoaded();
    vm.step('turn on washer');
    assert.match(waitUntil(vm, /cycle ends/i), /fresh, clean/i, 'detergent gives a fresh result');
    assert.match(vm.step('examine laundry'), /clean.*wet/i);
});

test('laundry: the door is locked while the cycle runs', async () => {
    const vm = await washerLoaded();
    vm.step('turn on washer');
    assert.match(vm.step('take laundry'), /locked/i);
});

test('laundry: without detergent the wash comes out grey', async () => {
    const vm = await washerLoaded({ soap: false });
    vm.step('turn on washer');
    assert.match(waitUntil(vm, /cycle ends/i), /grey|no detergent/i);
});

test('laundry: running an empty machine is refused', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('south'); vm.step('east');         // Bathroom, laundry left on the floor
    assert.match(vm.step('turn on washer'), /nothing in the machine/i);
});

test('laundry: dry the wet wash on the radiator, then wear it', async () => {
    const vm = await washerLoaded();
    vm.step('turn on washer');
    waitUntil(vm, /cycle ends/i);
    vm.step('take laundry');
    assert.match(vm.step('wear laundry'), /wet/i, 'cannot wear sopping clothes');
    vm.step('put laundry on radiator');
    assert.match(waitUntil(vm, /warm and dry/i), /warm and dry/i);
    vm.step('take laundry');
    assert.match(vm.step('wear laundry'), /put on/i);
});

test('media: the TV cycles through its channels', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('east');                           // Living Room
    assert.match(vm.step('turn on tv'), /evening news/i);
    assert.match(vm.step('change channel'), /black-and-white film/i);
    assert.match(vm.step('change channel'), /fuzzy static/i);
    assert.match(vm.step('change channel'), /evening news/i, 'wraps back to the first channel');
});

test('media: changing channel on an off TV is refused', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('east');
    assert.match(vm.step('change channel'), /off/i);
});

test('media: the stereo plays a selected genre', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('east');
    assert.match(vm.step('play rock'), /loud rock/i);
    assert.match(vm.step('examine stereo'), /loud rock/i);
    assert.match(vm.step('play classical'), /classical sonata/i);
});

// --- Fridge tie-in, wardrobe, shower ---------------------------------------
test('fridge: butter the cooked pasta for a richer result', async () => {
    const vm = await kitchenReady();
    vm.step('turn on stove');
    for (let i = 0; i < 8; i++) vm.step('wait');
    vm.step('turn off stove');
    vm.step('open fridge');
    vm.step('take butter');
    assert.match(vm.step('put butter in pot'), /butter through the cooked/i);
    assert.match(vm.step('eat spaghetti'), /buttery|wonderful/i);
});

test('fridge: buttering uncooked pasta is refused', async () => {
    const vm = await kitchenReady();           // spaghetti in pot, still raw
    vm.step('open fridge');
    vm.step('take butter');
    assert.match(vm.step('put butter in pot'), /once it is cooked/i);
});

test('wardrobe: take and wear clothes from the wardrobe', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('south');                          // Bedroom
    vm.step('open wardrobe');
    assert.match(vm.step('wear coat'), /put on/i);
});

test('shower: the shower must be running before you can wash', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('south'); vm.step('east');         // Bathroom
    assert.match(vm.step('bathe'), /turn the shower on/i);
    vm.step('turn on shower');
    assert.match(vm.step('shower'), /refreshed/i);
});
