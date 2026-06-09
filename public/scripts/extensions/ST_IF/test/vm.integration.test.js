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
