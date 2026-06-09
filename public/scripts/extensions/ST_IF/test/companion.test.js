import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntentPrompt, decideMove } from '../companion.js';

test('prompt includes both rooms, the player message, and the bias', () => {
    const p = buildIntentPrompt('I storm off north', 'Forest', 'Clearing', 0.8);
    assert.match(p, /I storm off north/);
    assert.match(p, /Forest/);
    assert.match(p, /Clearing/);
    assert.match(p, /0\.8|stay close|near/i);
});

test('parses a move direction', async () => {
    const gen = async () => '{"move":"north"}';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), 'north');
});

test('null move means stay put', async () => {
    const gen = async () => '{"move":null}';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), null);
});

test('extracts move from prose-wrapped JSON', async () => {
    const gen = async () => 'Sure:\n```json\n{"move":"se"}\n```';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), 'se');
});

test('fails open to null on garbage', async () => {
    const gen = async () => 'the companion thinks about it';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), null);
});

test('rejects a non-direction token (fails open to null)', async () => {
    const gen = async () => '{"move":"take lantern"}';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), null);
});

test('fails open to null when the generator throws', async () => {
    const gen = async () => { throw new Error('llm down'); };
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), null);
});

import { extractMoves, zone } from '../companion.js';

test('extractMoves keeps compass directions and drops other verbs', () => {
    assert.deepEqual(extractMoves(['take lantern', 'north']), ['north']);
    assert.deepEqual(extractMoves(['look']), []);
    assert.deepEqual(extractMoves([]), []);
    assert.deepEqual(extractMoves(['N', 'south', 'GET key']), ['n', 'south']);
});

test('zone maps bias to glued / trail / wander', () => {
    assert.equal(zone(0.8), 'glued');
    assert.equal(zone(0.66), 'glued');
    assert.equal(zone(0.5), 'trail');
    assert.equal(zone(0.34), 'trail');
    assert.equal(zone(0.33), 'wander');
    assert.equal(zone(0.2), 'wander');
    assert.equal(zone(undefined), 'trail');
});
