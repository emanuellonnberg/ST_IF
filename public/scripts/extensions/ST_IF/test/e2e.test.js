// e2e.test.js — full-pipeline end-to-end: the REAL turn orchestrator (turn.js) wired
// to the REAL Z-machine (vm.js + tavern.z5) and the REAL translator, with only the LLM
// stubbed by a deterministic script. Covers the integration seam the layer tests miss:
// translate -> step -> canon assembly, the lantern fix, the repair loop, and NPC bodies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IFVM } from '../vm.js';
import { runTurn } from '../turn.js';
import { initState, readState, setNpcs } from '../state.js';
import { translate, buildRepairPrompt, parseCommand } from '../translator.js';

const STORY = new Uint8Array(readFileSync(new URL('../worlds/tavern.z5', import.meta.url)));

// A deterministic stand-in for the side-LLM. Maps the player's message (in the
// translate prompt) to parser commands, and repairs one known bad verb.
function scriptedGenerate(script) {
    return async (prompt) => {
        if (/rejected a command/i.test(prompt)) {                  // a repair prompt
            if (/illuminate lantern/i.test(prompt)) return 'switch on lantern';
            return 'none';
        }
        const text = prompt.split('Player message:').pop().trim().toLowerCase();
        return JSON.stringify(script[text] ?? []);
    };
}

async function loadTavern() {
    const vm = new IFVM();
    await vm.load(STORY);
    const metadata = {};
    initState(metadata, 'tavern', vm.save());
    return { vm, metadata };
}

function makeDeps(vm, metadata, script, settings = {}) {
    const gen = scriptedGenerate(script);
    let block = '';
    return {
        vm,
        metadata,
        translate: (text, status, strictness) => translate(text, status, strictness, gen),
        repairCommand: (text, status, failedCmd, failureText) =>
            gen(buildRepairPrompt(text, status, failedCmd, failureText)).then(parseCommand),
        setPrompt: (b) => { block = b; },
        clearPrompt: () => { block = ''; },
        save: () => {},
        settings: { strictness: 'loose', injectStateOnRp: false, companionTracking: false, dynamicWorld: false, ...settings },
        getBlock: () => block,
    };
}

// Push a user message and run one real turn; return the canon block that was injected.
async function play(deps, chat, text) {
    chat.push({ is_user: true, mes: text });
    await runTurn(deps, chat, 'normal');
    return deps.getBlock();
}

test('e2e: a lantern playthrough flows prose -> commands -> VM -> canon', async () => {
    const { vm, metadata } = await loadTavern();
    const deps = makeDeps(vm, metadata, {
        'i look around the room': ['look'],
        'i head east into the taproom': ['east'],
        'i pick up the brass lantern': ['take lantern'],
        'i light the lantern': ['light lantern'],
        'i climb down to the cellar': ['down'],
    });
    const chat = [];

    assert.match(await play(deps, chat, 'I look around the room'), /Common Room/);
    assert.match(await play(deps, chat, 'I head east into the taproom'), /Taproom/);
    assert.equal(vm.getStatus().location, 'Taproom');
    assert.match(await play(deps, chat, 'I pick up the brass lantern'), /Taken/);
    // The lantern fix end-to-end: "light" is the Burn synonym, redirected to SwitchOn.
    assert.match(await play(deps, chat, 'I light the lantern'), /flares to life/i);
    // Descend into the dark cellar — lit, because the carried lantern is on.
    const cellar = await play(deps, chat, 'I climb down to the cellar');
    assert.match(cellar, /Cellar/);
    assert.doesNotMatch(cellar, /pitch dark/i);
    assert.equal(vm.getStatus().location, 'Cellar');
});

test('e2e: the repair loop fixes a bad verb against the real parser', async () => {
    const { vm, metadata } = await loadTavern();
    const deps = makeDeps(vm, metadata, {
        'i head east': ['east'],
        'i grab the lantern': ['take lantern'],
        'i illuminate the lantern': ['illuminate lantern'],   // not a verb -> repaired
    });
    const chat = [];
    await play(deps, chat, 'I head east');
    await play(deps, chat, 'I grab the lantern');
    // "illuminate lantern" is rejected by the parser; repairCommand -> "switch on lantern".
    const lit = await play(deps, chat, 'I illuminate the lantern');
    assert.match(lit, /flares to life/i);
});

test('e2e: a present NPC gets a body, is named in canon, and addressing it queues a reply', async () => {
    const { vm, metadata } = await loadTavern();
    // Card-bound NPC standing in the player's start room (Common Room).
    setNpcs(metadata, [{ name: 'maeve', room: 'commonroom', blurb: 'a sly old regular', card: 'Old Maeve' }]);
    const deps = makeDeps(vm, metadata, {
        'i study the old woman': ['examine maeve'],
        'i ask maeve about the cellar': ['ask maeve about cellar'],
    });
    const chat = [];

    // turn.js materializes her body before stepping, so "examine maeve" resolves,
    // and the canon names her as present.
    const examine = await play(deps, chat, 'I study the old woman');
    assert.match(examine, /figure in the scene/i);     // the real Z-machine body
    assert.match(examine, /Present here: maeve/);       // npc canon line

    // Addressing a card-bound, present NPC queues the card-voiced reply for after the turn.
    await play(deps, chat, 'I ask maeve about the cellar');
    assert.equal(readState(metadata).pendingNpcSpeak?.npc?.name, 'maeve');
});

// --- adversarial / edge cases ------------------------------------------------

test('e2e: an unrepairable command fails gracefully — no move, no throw', async () => {
    const { vm, metadata } = await loadTavern();
    // "frobnicate cask" is no verb; the repair stub returns none for it.
    const deps = makeDeps(vm, metadata, { 'i mutter an arcane word': ['frobnicate cask'] });
    const chat = [];
    const before = vm.getStatus().location;
    const block = await play(deps, chat, 'I mutter an arcane word');
    assert.equal(vm.getStatus().location, before);            // did not move
    assert.match(block, /not a verb/i);                       // the failure is honest canon, not a crash
});

test('e2e: multiple present NPCs are all materialized and named in canon', async () => {
    const { vm, metadata } = await loadTavern();
    setNpcs(metadata, [
        { name: 'maeve', room: 'commonroom', blurb: 'a sly regular' },
        { name: 'bram', room: 'commonroom', blurb: 'a hulking sellsword' },
    ]);
    const deps = makeDeps(vm, metadata, { 'i survey the room': ['look'], 'i size up bram': ['examine bram'] });
    const chat = [];
    const look = await play(deps, chat, 'I survey the room');
    assert.match(look, /Present here:[^\n]*maeve/);
    assert.match(look, /Present here:[^\n]*bram/);
    assert.match(await play(deps, chat, 'I size up bram'), /figure in the scene/i);   // second body resolves too
});

test('e2e: a swipe reuses cached outputs and does not re-step the VM', async () => {
    const { vm, metadata } = await loadTavern();
    const deps = makeDeps(vm, metadata, { 'i head east': ['east'] });
    const chat = [{ is_user: true, mes: 'I head east' }];
    await runTurn(deps, chat, 'normal');
    const moves = vm.getStatus().moves;
    assert.equal(vm.getStatus().location, 'Taproom');
    await runTurn(deps, chat, 'swipe');                       // same message, re-roll
    assert.equal(vm.getStatus().moves, moves);               // NOT re-stepped (else 'east' would tick again)
    assert.equal(vm.getStatus().location, 'Taproom');
    assert.match(deps.getBlock(), /Taproom/);                // canon rebuilt from the cache
});
