import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../turn.js';
import { initState, readState } from '../state.js';

function makeVM() {
    return {
        loaded: true,
        _snap: 'SNAP0',
        steps: [],
        step(cmd) { this.steps.push(cmd); return `did ${cmd}`; },
        save() { return this._snap; },
        restore(s) { this._snap = s; },
        getStatus() { return { location: 'Cave', score: 1, moves: 2 }; },
    };
}

function makeDeps(overrides = {}) {
    const metadata = {};
    initState(metadata, 'tiny.z5', 'SNAP0');
    const calls = { setPrompt: [], clearPrompt: 0, save: 0 };
    return {
        vm: makeVM(),
        metadata,
        translate: async () => ['north'],
        setPrompt: (b) => calls.setPrompt.push(b),
        clearPrompt: () => { calls.clearPrompt++; },
        save: () => { calls.save++; },
        settings: { strictness: 'strict', injectStateOnRp: false },
        _calls: calls,
        ...overrides,
    };
}

test('guard: quiet generations are fully transparent — no step, no prompt CLEAR', async () => {
    // Quiet calls (translator, companion intent, narration, exits extraction) run
    // mid-turn and re-enter the interceptor: they must NOT wipe the canon the main
    // generation is about to use.
    const deps = makeDeps();
    const chat = [{ is_user: true, mes: 'go north' }];
    await runTurn(deps, chat, 'quiet');
    assert.equal(deps._calls.setPrompt.length, 0);
    assert.equal(deps._calls.clearPrompt, 0, 'must not clear the active canon');
    assert.deepEqual(deps.vm.steps, []);
});

test('guard: skips when last message is not from user', async () => {
    const deps = makeDeps();
    const chat = [{ is_user: false, mes: 'narrator text' }];
    await runTurn(deps, chat, 'normal');
    assert.deepEqual(deps.vm.steps, []);
});

test('guard: skips when no game loaded for this chat', async () => {
    const deps = makeDeps({ metadata: {} }); // no ST_IF key
    const chat = [{ is_user: true, mes: 'go north' }];
    await runTurn(deps, chat, 'normal');
    assert.deepEqual(deps.vm.steps, []);
});

test('action turn: steps VM, injects canon, persists, records history', async () => {
    const deps = makeDeps();
    const chat = [{ is_user: true, mes: 'I creep north' }];
    await runTurn(deps, chat, 'normal');
    assert.deepEqual(deps.vm.steps, ['north']);
    assert.equal(deps._calls.setPrompt.length, 1);
    assert.match(deps._calls.setPrompt[0], /did north/);
    assert.match(deps._calls.setPrompt[0], /Cave/);
    assert.equal(deps._calls.save, 1);
    const s = readState(deps.metadata);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].msgIndex, 0);
    assert.equal(s.history[0].snapBefore, 'SNAP0');
});

test('pure-RP turn: no VM step, no canon when injectStateOnRp=false', async () => {
    const deps = makeDeps({ translate: async () => [] });
    const chat = [{ is_user: true, mes: 'I smile warmly' }];
    await runTurn(deps, chat, 'normal');
    assert.deepEqual(deps.vm.steps, []);
    assert.equal(deps._calls.setPrompt.length, 0);
    assert.equal(deps._calls.clearPrompt, 1);
});

test('pure-RP turn: injects status-only canon when injectStateOnRp=true', async () => {
    const deps = makeDeps({ translate: async () => [], settings: { strictness: 'strict', injectStateOnRp: true } });
    const chat = [{ is_user: true, mes: 'I look around idly' }];
    await runTurn(deps, chat, 'normal');
    assert.equal(deps._calls.setPrompt.length, 1);
    assert.match(deps._calls.setPrompt[0], /Cave/);
});

test('debugLog: invoked with raw outputs on an action turn, skipped on pure RP', async () => {
    const logs = [];
    const deps = makeDeps({ debugLog: (d) => logs.push(d) });
    await runTurn(deps, [{ is_user: true, mes: 'go north' }], 'normal');
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0].cmds, ['north']);
    assert.deepEqual(logs[0].outputs, ['did north']);

    const logs2 = [];
    const deps2 = makeDeps({ translate: async () => [], debugLog: (d) => logs2.push(d) });
    await runTurn(deps2, [{ is_user: true, mes: 'I smile' }], 'normal');
    assert.equal(logs2.length, 0, 'no debugLog when no commands ran');
});

test('swipe: reuses cached cmds, does NOT re-step or re-translate', async () => {
    const deps = makeDeps();
    const chat = [{ is_user: true, mes: 'I creep north' }];
    await runTurn(deps, chat, 'normal');           // first pass: steps 'north'
    deps.translate = async () => { throw new Error('must not translate on swipe'); };
    await runTurn(deps, chat, 'swipe');            // swipe: reuse
    assert.deepEqual(deps.vm.steps, ['north'], 'VM not stepped again');
    assert.equal(deps._calls.setPrompt.length, 2, 'canon re-injected on swipe');
    assert.match(deps._calls.setPrompt[1], /did north/);
});

function makeCompanionVM(room) {
    return {
        loaded: true, room, steps: [], _snap: 'CSNAP0',
        step(cmd) { this.steps.push(cmd); if (cmd !== 'look') this.room = cmd; return `companion does ${cmd}`; },
        save() { return this._snap; },
        restore(s) { this._snap = s; },
        getStatus() { return { location: this.room, score: 0, moves: 0 }; },
    };
}

test('tracking off: companionVM untouched', async () => {
    const deps = makeDeps();
    deps.companionVM = makeCompanionVM('Cave');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: false, companionBias: 0.7 };
    await runTurn(deps, [{ is_user: true, mes: 'go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, []);
});

test('glued (bias>=0.66): mirrors all room-changing moves, ends together', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'west'], vm: makeMovingVM() });
    deps.companionVM = makeCompanionVM('Start');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north then west' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north', 'west'], 'companion replays both moves');
    const { getFollowQueue, readTogether } = await import('../state.js');
    assert.deepEqual(getFollowQueue(deps.metadata), [], 'glued leaves no lag');
    assert.equal(readTogether(deps.metadata), true, 'both ended in the same room');
});

test('glued: does NOT mirror a move that failed (room unchanged)', async () => {
    // makeVM never changes rooms — a blocked 'north' must not walk the companion away.
    const deps = makeDeps({ translate: async () => ['north'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['look'], 'no move replayed, only the scene look');
});

test('trail (mid bias): queues room-changing moves, consumes one per turn', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'west'], vm: makeMovingVM() });
    deps.companionVM = makeCompanionVM('Start');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.5 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north then west' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north'], 'only the first queued move is consumed');
    const { getFollowQueue } = await import('../state.js');
    assert.deepEqual(getFollowQueue(deps.metadata), ['west'], 'remaining move stays queued');
});

test('wander (bias<=0.33): uses the LLM decideMove, ignores player moves', async () => {
    const deps = makeDeps({ translate: async () => ['north'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionMove = async () => 'south';
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.2 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['south'], 'companion wanders south, not following north');
    const { getFollowQueue } = await import('../state.js');
    assert.deepEqual(getFollowQueue(deps.metadata), [], 'wander does not queue');
});

test('agency follow: mirrors all room-changing moves', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'west'], vm: makeMovingVM() });
    deps.companionVM = makeCompanionVM('Start');
    deps.companionDecide = async () => ({ action: 'follow', direction: null });
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionAgency: true, companionBias: 0.8 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north then west' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north', 'west']);
});

test('agency move: steps the chosen direction', async () => {
    const deps = makeDeps({ translate: async () => ['north'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionDecide = async () => ({ action: 'move', direction: 'south' });
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionAgency: true, companionBias: 0.5 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['south']);
});

test('agency stay: no movement (only a look to describe the room)', async () => {
    const deps = makeDeps({ translate: async () => ['north'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionDecide = async () => ({ action: 'stay', direction: null });
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionAgency: true, companionBias: 0.5 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['look']);
});

test('agency off: zone logic runs, companionDecide is never called', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'west'], vm: makeMovingVM() });
    deps.companionVM = makeCompanionVM('Start');
    deps.companionDecide = async () => { throw new Error('must not call agency when off'); };
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionAgency: false, companionBias: 0.5 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north then west' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north'], 'trail zone consumed one move');
});

function makeMovingVM() {
    const DIRS = ['north', 'south', 'east', 'west', 'up', 'down'];
    return {
        loaded: true, _snap: 'S', room: 'Start', steps: [],
        step(cmd) {
            this.steps.push(cmd);
            if (DIRS.includes(cmd)) { this.room = cmd; return `You go ${cmd}. A new place called ${cmd}.`; }
            if (cmd === 'look') return `You are at ${this.room}. Exits lead away.`;
            return `You ${cmd}.`;
        },
        save() { return this._snap; },
        restore(s) { this._snap = s; },
        getStatus() { return { location: this.room, score: 0, moves: 0 }; },
    };
}

test('captures room description when the player changes rooms', async () => {
    const deps = makeDeps({ translate: async () => ['north'], vm: makeMovingVM() });
    await runTurn(deps, [{ is_user: true, mes: 'go north' }], 'normal');
    const { getRoomDescription } = await import('../state.js');
    assert.match(getRoomDescription(deps.metadata), /A new place called north/);
});

test('captures room description on a look command', async () => {
    const deps = makeDeps({ translate: async () => ['look'], vm: makeMovingVM() });
    await runTurn(deps, [{ is_user: true, mes: 'look' }], 'normal');
    const { getRoomDescription } = await import('../state.js');
    assert.match(getRoomDescription(deps.metadata), /You are at Start/);
});

test('does not overwrite room description on a non-move, non-look action', async () => {
    const deps = makeDeps({ translate: async () => ['north'], vm: makeMovingVM() });
    await runTurn(deps, [{ is_user: true, mes: 'go north' }], 'normal');
    deps.translate = async () => ['take lamp'];
    await runTurn(deps, [{ is_user: true, mes: 'take lamp' }], 'normal');
    const { getRoomDescription } = await import('../state.js');
    assert.match(getRoomDescription(deps.metadata), /A new place called north/, 'kept the room desc through a take');
});

test('together-branch canon includes the companion-present line', async () => {
    const deps = makeDeps({ translate: async () => ['take lamp'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    await runTurn(deps, [{ is_user: true, mes: 'take the lamp' }], 'normal');
    assert.match(deps._calls.setPrompt[0], /here with you/);
});

test('together: companion VM syncs to the player snapshot (shares world)', async () => {
    const deps = makeDeps({ translate: async () => ['take lamp'] });   // action, no movement
    deps.companionVM = makeCompanionVM('Cave');                        // same room as player
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    await runTurn(deps, [{ is_user: true, mes: 'take lamp' }], 'normal');
    const { getCompanionSnapshot, readTogether } = await import('../state.js');
    assert.equal(readTogether(deps.metadata), true);
    assert.equal(getCompanionSnapshot(deps.metadata), deps.vm.save(), 'companion snapshot == player snapshot');
    assert.equal(deps.companionVM._snap, deps.vm.save(), 'companion VM restored to the player world');
});

test('apart: companion keeps its own STORED snapshot lineage (not synced to player)', async () => {
    const deps = makeDeps({ translate: async () => ['take lamp'] });   // no movement
    deps.companionVM = makeCompanionVM('Clearing');                    // different room → apart
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    const { setCompanion, getCompanionSnapshot, readTogether } = await import('../state.js');
    setCompanion(deps.metadata, { snapshot: 'CSNAP-STORED', summary: { location: 'Clearing' } });
    await runTurn(deps, [{ is_user: true, mes: 'take lamp' }], 'normal');
    assert.equal(readTogether(deps.metadata), false);
    assert.equal(getCompanionSnapshot(deps.metadata), 'CSNAP-STORED', 'own stored lineage persists; no player sync');
    assert.notEqual(getCompanionSnapshot(deps.metadata), deps.vm.save(), 'distinct from the player snapshot');
});

test('records map edges per step when moves change rooms', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'east'], vm: makeMovingVM() });
    await runTurn(deps, [{ is_user: true, mes: 'north then east' }], 'normal');
    const { getEdgesForRoom } = await import('../state.js');
    assert.deepEqual(getEdgesForRoom(deps.metadata, 'Start'), { north: 'north' });
    assert.deepEqual(getEdgesForRoom(deps.metadata, 'north'), { east: 'east' });
});

test('captures compacted inventory after an action turn when vm.query exists', async () => {
    const vm = makeMovingVM();
    vm.query = (cmd) => cmd === 'inventory' ? 'You are carrying:\n  a brass lantern\n  a sword' : '';
    const deps = makeDeps({ translate: async () => ['take lamp'], vm });
    await runTurn(deps, [{ is_user: true, mes: 'take lamp' }], 'normal');
    const { getInventoryText } = await import('../state.js');
    assert.equal(getInventoryText(deps.metadata), 'a brass lantern, a sword');
});

test('inventory capture fails open when query throws or is absent', async () => {
    const vm = makeMovingVM();
    vm.query = () => { throw new Error('boom'); };
    const deps = makeDeps({ translate: async () => ['take lamp'], vm });
    await runTurn(deps, [{ is_user: true, mes: 'take lamp' }], 'normal');
    const deps2 = makeDeps({ translate: async () => ['take lamp'] });
    await runTurn(deps2, [{ is_user: true, mes: 'take lamp' }], 'normal');
    assert.ok(true);
});

test('apart turn with a shout passes the audible cue into the canon', async () => {
    const deps = makeDeps({ translate: async () => ['shout'] });
    deps.companionVM = makeCompanionVM('Clearing');     // different room → apart
    deps.companionMove = async () => null;
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.2 };
    await runTurn(deps, [{ is_user: true, mes: '*shout hey, come here!*' }], 'normal');
    assert.match(deps._calls.setPrompt[0], /DO hear/i);
    assert.match(deps._calls.setPrompt[0], /did not say or do/i);
});

test('apart: rewrites the last user message in the prompt copy to out-of-sight', async () => {
    const deps = makeDeps({ translate: async () => ['pull sword'] });
    deps.companionVM = makeCompanionVM('Clearing');
    deps.companionMove = async () => null;
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.2 };
    const chat = [{ is_user: true, mes: '*pull sword*' }];
    await runTurn(deps, chat, 'normal');
    assert.doesNotMatch(chat[0].mes, /pull sword/, 'action hidden from the companion prompt');
    assert.match(chat[0].mes, /somewhere else|out of .*sight/i);
});

test('apart shout: rewrites the message into a heard shout with direction', async () => {
    const deps = makeDeps({ translate: async () => ['shout'] });
    deps.companionVM = makeCompanionVM('Clearing');
    deps.companionMove = async () => null;
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.2 };
    const { recordMapEdge } = await import('../state.js');
    recordMapEdge(deps.metadata, 'Clearing', 'south', 'Cave');   // companion room -> player room edge
    const chat = [{ is_user: true, mes: '*shout* "Hello, can you hear me!"' }];
    await runTurn(deps, chat, 'normal');
    assert.match(chat[0].mes, /hear.*shout/i);
    assert.match(chat[0].mes, /Hello, can you hear me!/, 'the shouted words carry');
    assert.match(chat[0].mes, /south/, 'direction included when known');
});

test('together: the user message is left untouched', async () => {
    const deps = makeDeps({ translate: async () => ['take lamp'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    const chat = [{ is_user: true, mes: '*take lamp*' }];
    await runTurn(deps, chat, 'normal');
    assert.equal(chat[0].mes, '*take lamp*');
});

test('apart swipe: the user message is rewritten on the swipe pass too', async () => {
    const deps = makeDeps({ translate: async () => ['pull sword'] });
    deps.companionVM = makeCompanionVM('Clearing');
    deps.companionMove = async () => null;
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.2 };
    const chat = [{ is_user: true, mes: '*pull sword*' }];
    await runTurn(deps, chat, 'normal');               // real pass, records the turn
    const chat2 = [{ is_user: true, mes: '*pull sword*' }];   // fresh prompt copies on swipe
    await runTurn(deps, chat2, 'swipe');
    assert.doesNotMatch(chat2[0].mes, /pull sword/, 'swipe prompt also hides the action');
});

test('companion VM is re-synced from the stored snapshot before acting (reload safety)', async () => {
    const deps = makeDeps({ translate: async () => [] });
    const vmC = makeCompanionVM('FreshBootRoom');       // live VM diverged (e.g. page reload skipped restore)
    vmC.restores = [];
    vmC.restore = function (s) { this.restores.push(s); this._snap = s; };
    deps.companionVM = vmC;
    deps.companionMove = async () => null;
    deps.settings = { strictness: 'strict', injectStateOnRp: true, companionTracking: true, companionBias: 0.2 };
    await runTurn(deps, [{ is_user: true, mes: 'I wait' }], 'normal');
    assert.ok(vmC.restores.includes('SNAP0'), 'restored from the persisted companion snapshot (seeded as SNAP0)');
    assert.ok(vmC.restores.indexOf('SNAP0') === 0, 'stored-snapshot restore happens first, before any stepping');
});

function makeEnterVM() {
    // changes rooms on a NON-compass command, like Zork's "enter window"
    return {
        loaded: true, room: 'Behind House', steps: [], _snap: 'S',
        step(cmd) {
            this.steps.push(cmd);
            if (cmd === 'enter window') { this.room = 'Kitchen'; return 'Kitchen\nYou are in the kitchen.'; }
            if (cmd === 'look') return `You are at ${this.room}.`;
            return `You ${cmd}.`;
        },
        save() { return this._snap; },
        restore(s) { this._snap = s; },
        getStatus() { return { location: this.room, score: 0, moves: 0 }; },
    };
}

test('glued: follows non-compass moves that changed the room (enter window)', async () => {
    const deps = makeDeps({ translate: async () => ['enter window'], vm: makeEnterVM() });
    const companion = makeEnterVM();         // same starting room, same world
    deps.companionVM = companion;
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    await runTurn(deps, [{ is_user: true, mes: '*climbs through the window*' }], 'normal');
    assert.ok(companion.steps.includes('enter window'), 'companion replayed the room-changing command');
    const { readTogether } = await import('../state.js');
    assert.equal(readTogether(deps.metadata), true, 'still together in the Kitchen');
});

test('trail: queues non-compass room-changing commands', async () => {
    const deps = makeDeps({ translate: async () => ['enter window'], vm: makeEnterVM() });
    deps.companionVM = makeEnterVM();
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.5 };
    await runTurn(deps, [{ is_user: true, mes: '*climbs through the window*' }], 'normal');
    assert.ok(deps.companionVM.steps.includes('enter window'), 'trail consumed the queued command');
});

function makeDarkVM(startRoom) {
    // 'north' leads into darkness: the move "succeeds" but the output is the grue warning.
    return {
        loaded: true, room: startRoom, steps: [], restores: [],
        step(cmd) {
            this.steps.push(cmd);
            if (cmd === 'north') { this.room = 'Pitch Dark Place'; return 'It is pitch black. You are likely to be eaten by a grue.'; }
            if (cmd === 'east') { this.room = 'Deadly Dark'; return '\n    **** You have died ****\n'; }
            if (cmd === 'look') return `You are at ${this.room}.`;
            return `You ${cmd}.`;
        },
        save() { return this.room; },
        restore(r) { this.restores.push(r); this.room = r; },
        getStatus() { return { location: this.room, score: 0, moves: 0 }; },
    };
}

test('glued: companion refuses to follow into darkness (step rolled back)', async () => {
    const deps = makeDeps({ translate: async () => ['north'], vm: makeMovingVM() });   // player moves fine
    deps.companionVM = makeDarkVM('Start');                                            // her world is dark up north
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    const { setCompanion } = await import('../state.js');
    setCompanion(deps.metadata, { snapshot: 'Start', summary: { location: 'Start' } });   // fake snapshots are room names
    await runTurn(deps, [{ is_user: true, mes: 'I go north' }], 'normal');
    assert.equal(deps.companionVM.room, 'Start', 'she stayed put');
    assert.ok(deps.companionVM.restores.includes('Start'), 'the dark step was rolled back');
    assert.match(deps._calls.setPrompt[0], /pitch dark|without a light/i, 'canon explains the refusal');
});

test('wander: companion move into a deadly room is rolled back', async () => {
    const deps = makeDeps({ translate: async () => [] });
    deps.companionVM = makeDarkVM('Clearing');
    deps.companionMove = async () => 'east';     // wander brain picks the deadly way
    deps.settings = { strictness: 'strict', injectStateOnRp: true, companionTracking: true, companionBias: 0.2 };
    const { setCompanion } = await import('../state.js');
    setCompanion(deps.metadata, { snapshot: 'Clearing', summary: { location: 'Clearing' } });
    await runTurn(deps, [{ is_user: true, mes: 'I wait' }], 'normal');
    assert.equal(deps.companionVM.room, 'Clearing', 'death step rolled back; she lives');
});

function makeActVM() {
    // a player-VM fake: 'light lantern' works, 'pull lever' kills you
    return {
        loaded: true, room: 'Cellar', steps: [], restores: [], _state: 'PSNAP',
        step(cmd) {
            this.steps.push(cmd);
            if (cmd === 'light lantern') { this._state = 'PSNAP+lit'; return 'The brass lantern is now on.'; }
            if (cmd === 'pull lever') { this._state = 'DEAD'; return '\n    **** You have died ****\n'; }
            if (cmd === 'look') return 'Cellar\nA dark and damp cellar.';
            return `You ${cmd}.`;
        },
        save() { return this._state; },
        restore(s) { this.restores.push(s); this._state = s; },
        getStatus() { return { location: this.room, score: 25, moves: 10 }; },
    };
}

function actDeps(useCmd, vm) {
    const deps = makeDeps({ translate: async () => ['look'], vm });
    deps.companionVM = makeCompanionVM('Cellar');                 // same room → together
    deps.companionUse = async () => ({ command: useCmd });
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8, companionActs: true, companionActionSafety: 'safe' };
    return deps;
}

test('together + acts: her validated action runs on the player VM and is attributed', async () => {
    const vm = makeActVM();
    const deps = actDeps('light lantern', vm);
    await runTurn(deps, [{ is_user: true, mes: 'Nausicaä, light the lamp' }], 'normal');
    assert.ok(vm.steps.includes('light lantern'), 'her command executed on the canonical VM');
    assert.match(deps._calls.setPrompt[0], /light lantern/, 'canon attributes the action');
    assert.match(deps._calls.setPrompt[0], /brass lantern is now on/i, 'her result joined the outputs');
    const s = readState(deps.metadata);
    assert.equal(s.snapshot, 'PSNAP+lit', 'canonical snapshot re-persisted with her change');
    assert.equal(s.history[s.history.length - 1].companionCmd, 'light lantern', 'recorded for swipe reuse');
});

test('together + acts: a mirrored action output is not doubled in canon', async () => {
    const vm = makeActVM();
    const deps = actDeps('look', vm);                            // companion mirrors the player's 'look'
    await runTurn(deps, [{ is_user: true, mes: 'I look around' }], 'normal');
    const block = deps._calls.setPrompt[0];
    const hits = (block.match(/A dark and damp cellar/g) || []).length;
    assert.equal(hits, 1, 'identical companion output is deduped, not doubled');
});

test('death outcome rolls her action back', async () => {
    const vm = makeActVM();
    const deps = actDeps('pull lever', vm);
    deps.settings.companionActionSafety = 'open';
    await runTurn(deps, [{ is_user: true, mes: 'try the lever' }], 'normal');
    assert.ok(vm.restores.includes('PSNAP'), 'rolled back to the pre-action snapshot');
    assert.equal(readState(deps.metadata).snapshot, 'PSNAP', 'canonical snapshot unchanged');
    assert.doesNotMatch(deps._calls.setPrompt[0] ?? '', /performed by \{\{char\}\}/, 'no attribution');
});

test('blocked verb never executes', async () => {
    const vm = makeActVM();
    const deps = actDeps('drop lantern', vm);
    await runTurn(deps, [{ is_user: true, mes: 'hold this' }], 'normal');
    assert.ok(!vm.steps.includes('drop lantern'));
});

test('acts toggle off / apart: companionUse never called', async () => {
    const vm = makeActVM();
    const depsOff = actDeps('light lantern', vm);
    depsOff.settings.companionActs = false;
    depsOff.companionUse = async () => { throw new Error('must not be called'); };
    await runTurn(depsOff, [{ is_user: true, mes: 'x' }], 'normal');

    const depsApart = actDeps('light lantern', makeActVM());
    depsApart.companionVM = makeCompanionVM('Elsewhere');
    depsApart.companionUse = async () => { throw new Error('must not be called'); };
    await runTurn(depsApart, [{ is_user: true, mes: 'x' }], 'normal');
    assert.ok(true);
});

function makeI6DarkVM(startRoom) {
    return {
        loaded: true, room: startRoom, steps: [], restores: [],
        step(cmd) {
            this.steps.push(cmd);
            if (cmd === 'west') { this.room = 'Darkness'; return 'Darkness\nIt is pitch dark, and you can\'t see a thing.'; }
            if (cmd === 'look') return `You are at ${this.room}.`;
            return `You ${cmd}.`;
        },
        save() { return this.room; },
        restore(r) { this.restores.push(r); this.room = r; },
        getStatus() { return { location: this.room, score: 0, moves: 0 }; },
    };
}

test('dark-guard fires on the standard Inform-6 "pitch dark" wording', async () => {
    const deps = makeDeps({ translate: async () => ['west'], vm: makeMovingVM() });
    deps.companionVM = makeI6DarkVM('Start');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    const { setCompanion } = await import('../state.js');
    setCompanion(deps.metadata, { snapshot: 'Start', summary: { location: 'Start' } });
    await runTurn(deps, [{ is_user: true, mes: 'I go west' }], 'normal');
    assert.equal(deps.companionVM.room, 'Start', 'refused to follow into I6 darkness');
    assert.ok(deps.companionVM.restores.includes('Start'));
});
