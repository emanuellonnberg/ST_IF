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
