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

test('guard: skips quiet generations, clears any stale prompt', async () => {
    const deps = makeDeps();
    const chat = [{ is_user: true, mes: 'go north' }];
    await runTurn(deps, chat, 'quiet');
    assert.equal(deps._calls.setPrompt.length, 0);
    assert.equal(deps._calls.clearPrompt, 1);
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

test('companion tracking off: companionVM never touched, no together computed', async () => {
    const deps = makeDeps();
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionMove = async () => 'north';
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: false };
    await runTurn(deps, [{ is_user: true, mes: 'go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, []);
});

test('together: companion in same room -> shared canon, together=true persisted', async () => {
    const deps = makeDeps();
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionMove = async () => null;
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true };
    await runTurn(deps, [{ is_user: true, mes: 'I wait' }], 'normal');
    assert.match(deps._calls.setPrompt[0], /Cave/);
    assert.doesNotMatch(deps._calls.setPrompt[0], /apart/i);
    const { readTogether } = await import('../state.js');
    assert.equal(readTogether(deps.metadata), true);
});

test('apart: companion moves to a different room -> apart canon, together=false', async () => {
    const deps = makeDeps();
    deps.companionVM = makeCompanionVM('Clearing');
    deps.companionMove = async () => 'north';
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true };
    await runTurn(deps, [{ is_user: true, mes: 'I dig' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north']);
    assert.match(deps._calls.setPrompt[0], /apart/i);
    const { readTogether, getCompanionSnapshot } = await import('../state.js');
    assert.equal(readTogether(deps.metadata), false);
    assert.equal(getCompanionSnapshot(deps.metadata), 'CSNAP0');
});

test('apart with no move: companion looks to describe its room', async () => {
    const deps = makeDeps();
    deps.companionVM = makeCompanionVM('Clearing');
    deps.companionMove = async () => null;
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true };
    await runTurn(deps, [{ is_user: true, mes: 'I dig' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['look']);
    assert.match(deps._calls.setPrompt[0], /Clearing/);
});
