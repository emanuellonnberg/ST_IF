import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranslatePrompt, translate } from '../translator.js';

const status = { location: 'Forest Path', score: 0, moves: 3 };

test('prompt includes player text, status, and strictness instruction', () => {
    const p = buildTranslatePrompt('I grab the lantern and creep north', status, 'strict');
    assert.match(p, /I grab the lantern and creep north/);
    assert.match(p, /Forest Path/);
    assert.match(p, /JSON array/i);
});

test('parses a clean JSON array of commands', async () => {
    const fakeGenerate = async () => '["take lantern", "north"]';
    const cmds = await translate('whatever', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, ['take lantern', 'north']);
});

test('returns [] for pure-RP (model emits empty array)', async () => {
    const fakeGenerate = async () => '[]';
    const cmds = await translate('I smile and ask for rumors', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, []);
});

test('fails open to [] on non-JSON garbage', async () => {
    const fakeGenerate = async () => 'Sure! Here are the commands: take lantern';
    const cmds = await translate('x', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, []);
});

test('extracts array even when wrapped in prose/code fence', async () => {
    const fakeGenerate = async () => 'Here you go:\n```json\n["look"]\n```';
    const cmds = await translate('x', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, ['look']);
});

test('caps command list at 4', async () => {
    const fakeGenerate = async () => '["a","b","c","d","e","f"]';
    const cmds = await translate('x', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, ['a', 'b', 'c', 'd']);
});

test('drops non-string / empty entries', async () => {
    const fakeGenerate = async () => '["take lantern", 42, "", "  ", "north"]';
    const cmds = await translate('x', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, ['take lantern', 'north']);
});
