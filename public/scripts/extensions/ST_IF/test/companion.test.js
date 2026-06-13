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

import { buildAgencyPrompt, decideAgency } from '../companion.js';

test('agency prompt includes rooms, player moves, and the clinginess lean', () => {
    const p = buildAgencyPrompt('I sprint off', 'Cave', 'Hall', ['north'], 0.8);
    assert.match(p, /Cave/);
    assert.match(p, /Hall/);
    assert.match(p, /north/);
    assert.match(p, /I sprint off/);
    assert.match(p, /rarely break off/i);
});

test('decideAgency parses follow / stay / move', async () => {
    assert.deepEqual(await decideAgency('x', 'A', 'B', ['north'], 0.7, async () => '{"action":"follow"}'),
        { action: 'follow', direction: null });
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => '{"action":"stay"}'),
        { action: 'stay', direction: null });
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.3, async () => '{"action":"move","direction":"south"}'),
        { action: 'move', direction: 'south' });
});

test('decideAgency downgrades a move with a non-direction to stay', async () => {
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.3, async () => '{"action":"move","direction":"take lamp"}'),
        { action: 'stay', direction: null });
});

test('decideAgency fails open to follow on unknown action, garbage, or throw', async () => {
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => '{"action":"dance"}'),
        { action: 'follow', direction: null });
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => 'no json here'),
        { action: 'follow', direction: null });
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => { throw new Error('down'); }),
        { action: 'follow', direction: null });
});

test('decideAgency extracts JSON wrapped in prose', async () => {
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => 'Sure:\n{"action":"stay"}\nok'),
        { action: 'stay', direction: null });
});

import { detectShout } from '../companion.js';

test('detectShout catches loud actions', () => {
    assert.equal(detectShout('*shout hey, come here!*'), true);
    assert.equal(detectShout('I yell her name into the dark'), true);
    assert.equal(detectShout('he screams for help'), true);
    assert.equal(detectShout('I call out softly'), true);
});

test('detectShout ignores quiet actions', () => {
    assert.equal(detectShout('I whisper her name'), false);
    assert.equal(detectShout('*goes north*'), false);
    assert.equal(detectShout(''), false);
    assert.equal(detectShout(null), false);
});

test('extractMoves normalizes "go/walk/head <dir>" command forms', () => {
    assert.deepEqual(extractMoves(['go east']), ['east']);
    assert.deepEqual(extractMoves(['walk north', 'take lamp']), ['north']);
    assert.deepEqual(extractMoves(['head sw']), ['sw']);
    assert.deepEqual(extractMoves(['climb up']), ['up']);
    assert.deepEqual(extractMoves(['go to the house']), [], 'non-direction stays dropped');
});

import { buildUsePrompt, decideUse, validateAction } from '../companion.js';

test('use prompt includes scene, player message, executed cmds, and initiative wording', () => {
    const p = buildUsePrompt('Nausicaä, light the lamp', 'A dark cellar.', ['south'], 'asked');
    assert.match(p, /light the lamp/);
    assert.match(p, /dark cellar/);
    assert.match(p, /south/);
    assert.match(p, /ONLY if/i);
    const p2 = buildUsePrompt('x', 'scene', [], 'proactive');
    assert.match(p2, /whenever/i);
});

test('decideUse parses a command and null, fails open on garbage/throw', async () => {
    assert.deepEqual(await decideUse('x', 's', [], 'need', async () => '{"command":"light lantern"}'),
        { command: 'light lantern' });
    assert.deepEqual(await decideUse('x', 's', [], 'need', async () => '{"command":null}'),
        { command: null });
    assert.deepEqual(await decideUse('x', 's', [], 'need', async () => 'no json'),
        { command: null });
    assert.deepEqual(await decideUse('x', 's', [], 'need', async () => { throw new Error('down'); }),
        { command: null });
});

test('validateAction: safe level allows allowlisted verbs, rejects others', () => {
    assert.equal(validateAction('light lantern', 'safe'), 'light lantern');
    assert.equal(validateAction('open door', 'safe'), 'open door');
    assert.equal(validateAction('take key', 'safe'), 'take key');
    assert.equal(validateAction('drop lantern', 'safe'), null);
    assert.equal(validateAction('attack troll', 'safe'), null);
    assert.equal(validateAction('give sword to troll', 'safe'), null);
});

test('validateAction: open level allows in-world verbs but never meta-verbs', () => {
    assert.equal(validateAction('attack troll', 'open'), 'attack troll');
    assert.equal(validateAction('drop lantern', 'open'), 'drop lantern');
    assert.equal(validateAction('restart', 'open'), null);
    assert.equal(validateAction('quit', 'open'), null);
    assert.equal(validateAction('save', 'open'), null);
    assert.equal(validateAction('restore game', 'open'), null);
    assert.equal(validateAction('undo', 'open'), null);
});

test('validateAction: rejects multi-command strings and junk', () => {
    assert.equal(validateAction('open door. take key', 'open'), null);
    assert.equal(validateAction('open door then go north', 'open'), null);
    assert.equal(validateAction('open door\ntake key', 'open'), null);
    assert.equal(validateAction(null, 'safe'), null);
    assert.equal(validateAction('   ', 'safe'), null);
    assert.equal(validateAction(42, 'safe'), null);
});
