// Integration test for the real ifvms-backed VM wrapper, against a bundled
// Z-machine story (Colossal Cave Adventure, public domain, Z5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IFVM } from '../vm.js';
import { sanitizeRoom, buildMetaCommands } from '../worldgen.js';
import { planReplay } from '../worldmap.js';

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

// --- Mud / coffee / sleep loops --------------------------------------------
test('mud: digging the houseplant dirties you; the shower cleans it', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('east');                           // Living Room
    assert.match(vm.step('dig plant'), /filthy/i);
    assert.match(vm.step('status'), /filthy/i);
    vm.step('west'); vm.step('south'); vm.step('east');   // Bathroom
    vm.step('turn on shower');
    assert.match(vm.step('bathe'), /clean/i);
    assert.doesNotMatch(vm.step('status'), /filthy/i);
});

test('mud: dressing with filthy hands re-soils the clean laundry', async () => {
    const vm = await washerLoaded();
    vm.step('turn on washer');
    waitUntil(vm, /cycle ends/i);
    vm.step('take laundry');
    vm.step('put laundry on radiator');
    waitUntil(vm, /warm and dry/i);
    vm.step('take laundry');
    vm.step('west'); vm.step('north'); vm.step('east');   // Living Room
    vm.step('dig plant');
    assert.match(vm.step('wear laundry'), /grubby again/i);
});

test('coffee: brew a mug and drink it to feel rested', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('north');                          // Kitchen
    vm.step('take mug');
    vm.step('brew coffee');
    assert.match(waitUntil(vm, /ready/i), /ready/i);
    assert.match(vm.step('drink coffee'), /awake|alert/i);
    assert.match(vm.step('status'), /rested/i);
});

test('sleep: napping in the bed leaves you rested; no bed elsewhere', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    assert.match(vm.step('sleep'), /no bed/i);            // Hallway
    vm.step('south');                          // Bedroom
    assert.match(vm.step('sleep'), /rested/i);
    assert.match(vm.step('status'), /rested/i);
});

// --- The cat, Mochi --------------------------------------------------------
test('cat: Mochi follows you from room to room', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('east');                           // Living Room (Mochi starts here)
    assert.match(vm.step('west'), /Mochi pads in/i, 'she follows into the hallway');
    assert.match(vm.step('look'), /Mochi/);
});

test('cat: petting and feeding Mochi milk', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('east');
    assert.match(vm.step('pet cat'), /purr/i);
    vm.step('west'); vm.step('north');         // Kitchen; she follows
    vm.step('open fridge'); vm.step('take milk');
    assert.match(vm.step('give milk to cat'), /laps up the milk/i);
    assert.match(vm.step('examine mochi'), /full/i);
});

// --- Front door + outside (landing, street, shop) --------------------------
test('front door: locked until unlocked with the key, then leads outside', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    assert.match(vm.step('out'), /in the way|locked/i);   // blocked
    vm.step('take key');
    vm.step('unlock door with key');
    vm.step('open door');
    assert.match(vm.step('out'), /Landing/);
});

test('outside: read the mailbox letter, reach the street and the corner shop', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('take key'); vm.step('unlock door with key'); vm.step('open door'); vm.step('out');
    vm.step('open mailbox');
    assert.match(vm.step('read letter'), /welcome/i);
    assert.match(vm.step('down'), /Street/);
    assert.match(vm.step('east'), /Corner Shop/);
    assert.match(vm.step('ask shopkeeper about weather'), /weather|step/i);
});

test('cat: Mochi will not follow you out the front door', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('east'); vm.step('west');          // make sure she is trailing
    vm.step('take key'); vm.step('unlock door with key'); vm.step('open door');
    vm.step('out');                            // Landing
    assert.doesNotMatch(vm.step('look'), /Mochi/, 'she stays inside the flat');
});

// --- Deeper cooking: fry an egg, wash up ------------------------------------
test('cooking: fry an egg on the stove and eat it', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('north');                          // Kitchen
    vm.step('open cupboard'); vm.step('take pot');
    vm.step('open fridge'); vm.step('take egg');
    vm.step('put egg in pot'); vm.step('put pot on stove'); vm.step('turn on stove');
    assert.match(waitUntil(vm, /fried|sets into/i), /fried|sets into/i);
    vm.step('turn off stove');
    assert.match(vm.step('eat egg'), /tasty/i);
});

test('cooking: eating leaves a dirty pot you wash at the tap', async () => {
    const vm = await kitchenReady();
    vm.step('turn on stove');
    for (let i = 0; i < 8; i++) vm.step('wait');
    vm.step('turn off stove');
    vm.step('eat spaghetti');
    assert.match(vm.step('examine pot'), /dried-on food|crusted/i);
    assert.match(vm.step('wash pot'), /clean/i);
    assert.doesNotMatch(vm.step('examine pot'), /crusted|dried-on/i);
});

test('coffee: the mug is stained after use and washes clean', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('north');
    vm.step('take mug'); vm.step('brew coffee');
    waitUntil(vm, /ready/i);
    vm.step('drink coffee');
    assert.match(vm.step('examine mug'), /dregs|stained/i);
    assert.match(vm.step('wash mug'), /clean/i);
});

// --- Dynamic world growth (expanse pool, canned JSON, no LLM) ---------------
const expanse = new Uint8Array(readFileSync(new URL('../worlds/expanse.z5', import.meta.url)));

test('expanse: is detected as expandable; apartment is not', async () => {
    const e = new IFVM(); await e.load(expanse);
    const a = new IFVM(); await a.load(apt);
    assert.equal(e.isExpandable(), true);
    assert.equal(a.isExpandable(), false);
});

test('expanse: a generated room is reachable, named, populated, and back-linked', async () => {
    const vm = new IFVM(); await vm.load(expanse);
    assert.equal(vm.getStatus().location, 'Origin');
    assert.match(vm.step('north'), /can't go that way/i);          // blocked first
    const room = sanitizeRoom({
        name: 'attic', description: 'A dusty attic with a round window.',
        objects: [
            { name: 'trunk', description: 'A battered travelling trunk.', takeable: true },
            { name: 'cobwebs', description: 'Grey and sticky.', takeable: false },
        ],
    });
    vm.applyWorldEdits(buildMetaCommands('north', room));
    assert.match(vm.step('north'), /attic/i);                      // now reachable + named
    assert.match(vm.step('examine trunk'), /battered travelling trunk/i); // parse_name resolves it
    assert.match(vm.step('take trunk'), /taken/i);
    assert.match(vm.step('take cobwebs'), /fixed in place/i);      // non-takeable guard
    assert.match(vm.step('south'), /Origin/);                      // reverse exit linked
    assert.match(vm.step('north'), /attic/i);                      // stable on revisit
});

test('expanse: a generated room survives a save/restore round-trip', async () => {
    const vm = new IFVM(); await vm.load(expanse);
    vm.step('north');
    vm.applyWorldEdits(buildMetaCommands('north', sanitizeRoom({ name: 'vault', description: 'A cold stone vault.', objects: [] })));
    vm.step('north');
    const snap = vm.save();
    const vm2 = new IFVM(); await vm2.load(expanse);
    vm2.restore(snap);
    assert.match(vm2.step('look'), /vault/i);                      // persisted through the snapshot
    assert.match(vm2.step('south'), /Origin/);                     // and its link
});

test('expanse: an unmaterialised direction stays a normal blocked move', async () => {
    const vm = new IFVM(); await vm.load(expanse);
    assert.match(vm.step('east'), /can't go that way/i);           // graceful: no room, no crash
});

test('expanse: a square path links back to Origin (grid loop)', async () => {
    const vm = new IFVM(); await vm.load(expanse);
    // Build a ring: Origin -N-> a -E-> b -S-> c, then close c -W-> Origin.
    vm.applyWorldEdits([
        'xnew a', 'xnew b', 'xnew c',
        'xlinkn origin north a', 'xlinkn a east b', 'xlinkn b south c', 'xlinkn c west origin',
    ]);
    assert.match(vm.step('north'), /\ba\b/i);
    assert.match(vm.step('east'), /\bb\b/i);
    assert.match(vm.step('south'), /\bc\b/i);
    assert.match(vm.step('west'), /Origin/i);     // closed the loop, back home
});

test('expanse: an LLM-style cross-link connects two rooms both ways', async () => {
    const vm = new IFVM(); await vm.load(expanse);
    vm.applyWorldEdits(['xnew vault', 'xnew tunnel', 'xlinkn origin north vault', 'xlinkn vault down tunnel']);
    assert.match(vm.step('north'), /vault/i);
    assert.match(vm.step('down'), /tunnel/i);
    assert.match(vm.step('up'), /vault/i);        // both-ways
});

// --- NPC effects on the tavern (effects.h) ---------------------------------
const tavern = new Uint8Array(readFileSync(new URL('../worlds/tavern.z5', import.meta.url)));

test('effects: xgrant/xtake adjust the tavern gold (clamped); xflag round-trips', async () => {
    const vm = new IFVM(); await vm.load(tavern);
    assert.equal(vm.query('xgold').trim(), '20');           // tavern starts with 20 gold
    vm.step('xgrant 10');
    assert.equal(vm.query('xgold').trim(), '30');           // reward is real ground truth
    vm.step('xtake 5');
    assert.equal(vm.query('xgold').trim(), '25');
    vm.step('xtake 1000');
    assert.equal(vm.query('xgold').trim(), '0');            // clamped at 0
    assert.equal(vm.query('xflagq rats_done').trim(), '0'); // arbitrary flag, unset
    vm.step('xflag rats_done');
    assert.equal(vm.query('xflagq rats_done').trim(), '1'); // set, by text (not in dictionary)
});

test('tavern: "light lantern" lights it (translator emits light/use, never switch-on)', async () => {
    const vm = new IFVM(); await vm.load(tavern);
    vm.step('east');                                        // Common Room -> Taproom
    vm.step('take lantern');
    // The prose translator emits "light lantern" for switch-on intent. 'light' is
    // a library Burn synonym; the world's BurnSub override routes it to SwitchOn.
    const lit = vm.step('light lantern');
    assert.match(lit, /flares to life/i);                  // not "dangerous act would achieve little"
    assert.match(vm.query('examine lantern'), /switched on/i); // ground truth: on attribute set
    const cellar = vm.step('down');                        // dark room, lit only by carried lantern
    assert.match(cellar, /Cellar/);
    assert.doesNotMatch(cellar, /pitch dark/i);            // visible because the lantern is lit
    vm.step('extinguish lantern');
    assert.match(vm.step('look'), /pitch dark/i);          // off -> dark again
    assert.match(vm.step('use lantern'), /flares to life/i); // "use X" also switches a switchable on
});

test('effects: xgive mints a real held item; xtakeitem removes it (effects.h item pool)', async () => {
    const vm = new IFVM(); await vm.load(tavern);
    assert.match(vm.step('xgive key'), /xgive ok/);
    assert.match(vm.step('examine key'), /ordinary key/i);    // real, examinable Z-machine object
    assert.match(vm.query('inventory'), /key/);               // actually carried
    assert.match(vm.step('drop key'), /Dropped/i);            // behaves like any object
    assert.match(vm.step('take key'), /Taken/i);
    assert.match(vm.step('xtakeitem key'), /xtakeitem ok/);
    assert.doesNotMatch(vm.query('inventory'), /key/);        // removed
    assert.match(vm.step('xtakeitem key'), /xtakeitem none/); // slot freed, nothing left to take
});

test('effects: NPC bodies — materialize, give an item (transfers + persists off-stage)', async () => {
    const vm = new IFVM(); await vm.load(tavern);
    assert.match(vm.step('xnpc maeve'), /xnpc ok/);
    assert.match(vm.step('look'), /Maeve/);                       // a real object now in the room
    vm.step('xgive key');
    assert.match(vm.step('give key to maeve'), /hand the key to Maeve/i);
    assert.doesNotMatch(vm.query('inventory'), /key/);            // really transferred off the player
    assert.match(vm.step('xnpcaway maeve'), /xnpcaway ok/);
    assert.doesNotMatch(vm.step('look'), /Maeve/);                // sent off-stage
    assert.match(vm.step('xnpc maeve'), /xnpc ok/);               // and back
    assert.match(vm.step('take key'), /can't see any such thing/i); // key is held by Maeve, not loose in the room
});

// --- Expandable authored world (apartment frontier) ------------------------
const apartmentExp = new Uint8Array(readFileSync(new URL('../worlds/apartment-expanse.z5', import.meta.url)));

test('apartment frontier: interior sealed, the Street grows after the door', async () => {
    const vm = new IFVM(); await vm.load(apartmentExp);
    assert.equal(vm.xCanGrow(), 'no');                 // Hallway — interior
    vm.step('north'); assert.equal(vm.xCanGrow(), 'no'); vm.step('south');   // Kitchen sealed
    vm.step('take key'); vm.step('unlock door with key'); vm.step('open door'); vm.step('out'); vm.step('down');
    assert.match(vm.getStatus().location, /Street/);
    assert.equal(vm.xCanGrow(), 'street');             // the frontier
    vm.applyWorldEdits(['xroom north alley', 'xdesc a narrow alley']);
    assert.match(vm.step('north'), /alley/i);
    assert.match(vm.step('south'), /Street/);          // links back
});

// --- Expandable authored world (garden frontier) ---------------------------
const gardenExp = new Uint8Array(readFileSync(new URL('../worlds/garden-expanse.z5', import.meta.url)));

test('authored frontier: interior rooms are sealed, the Lawn is growable', async () => {
    const vm = new IFVM(); await vm.load(gardenExp);
    assert.equal(vm.xCanGrow(), 'no');                // Porch — interior, sealed
    vm.step('north');                                 // Lawn — the frontier
    assert.equal(vm.xCanGrow(), 'lawn');
    vm.step('east');                                  // Pond — interior, sealed
    assert.equal(vm.xCanGrow(), 'no');
});

test('authored frontier: a room grown off the Lawn links back and stays growable', async () => {
    const vm = new IFVM(); await vm.load(gardenExp);
    vm.step('north');                                 // Lawn
    vm.applyWorldEdits(['xroom north meadow', 'xdesc a wildflower meadow']);
    assert.match(vm.step('north'), /meadow/i);
    assert.equal(vm.xCanGrow(), 'meadow');            // generated rooms keep growing
    assert.match(vm.step('south'), /Lawn/i);          // links back to the frontier
});

test('authored frontier: a grown graph replays onto the same authored base', async () => {
    const graph = {
        rooms: [{ name: 'meadow', x: 100001, y: 0, z: 0, description: 'a meadow', objects: [] }],
        edges: [{ from: 'lawn', dir: 'north', to: 'meadow' }],
    };
    const vm = new IFVM(); await vm.load(gardenExp);
    vm.applyWorldEdits(planReplay(graph));            // xnew meadow; xlinkn lawn north meadow
    vm.step('north');                                 // Porch -> Lawn
    assert.match(vm.step('north'), /meadow/i);        // the frontier link replayed
});

test('expanse: planReplay rebuilds a looped graph (import round-trip)', async () => {
    const graph = {
        rooms: [
            { name: 'a', x: 0, y: 1, z: 0, description: 'room a', objects: [{ name: 'key', description: 'a brass key', takeable: true }] },
            { name: 'b', x: 1, y: 1, z: 0, description: 'room b', objects: [] },
            { name: 'c', x: 1, y: 0, z: 0, description: 'room c', objects: [] },
        ],
        edges: [
            { from: 'Origin', dir: 'north', to: 'a' },
            { from: 'a', dir: 'east', to: 'b' },
            { from: 'b', dir: 'south', to: 'c' },
            { from: 'c', dir: 'west', to: 'Origin' },   // the loop
        ],
    };
    const vm = new IFVM(); await vm.load(expanse);
    vm.applyWorldEdits(planReplay(graph));            // xnew/xlinkn leave the player at Origin
    assert.match(vm.step('north'), /\ba\b/i);
    assert.match(vm.step('examine key'), /brass key/i);   // object + parse_name
    assert.match(vm.step('east'), /\bb\b/i);
    assert.match(vm.step('south'), /\bc\b/i);
    assert.match(vm.step('west'), /Origin/i);             // loop edge reconstructed
});
