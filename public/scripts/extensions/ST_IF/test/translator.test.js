import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranslatePrompt, translate, isParserFailure, buildRepairPrompt, parseCommand, answerForPendingPrompt } from '../translator.js';

const status = { location: 'Forest Path', score: 0, moves: 3 };

test('prompt includes player text, status, strictness, and canonical-verb examples', () => {
    const p = buildTranslatePrompt('I grab the lantern and creep north', status, 'strict');
    assert.match(p, /I grab the lantern and creep north/);
    assert.match(p, /Forest Path/);
    assert.match(p, /JSON array/i);
    assert.match(p, /switch on lamp/);          // few-shot biases canonical verbs
    assert.match(p, /Examples:/);
});

test('isParserFailure flags parse rejections, not legitimate failures', () => {
    assert.ok(isParserFailure("You can't see any such thing."));
    assert.ok(isParserFailure('I don\'t know the word "frobnicate".'));
    assert.ok(isParserFailure("That's not a verb I recognise."));
    assert.ok(isParserFailure("That's not something you can open."));
    assert.ok(!isParserFailure("You can't go that way."));     // real blocked exit
    assert.ok(!isParserFailure('Taken.'));
    assert.ok(!isParserFailure(''));
});

test('buildRepairPrompt carries the intent, failed command, and parser reply', () => {
    const p = buildRepairPrompt('I light the lantern', status, 'light lantern', "You can't see any such thing.");
    assert.match(p, /I light the lantern/);
    assert.match(p, /light lantern/);
    assert.match(p, /any such thing/);
    assert.match(p, /ONLY the command/);
});

test('answerForPendingPrompt passes a literal yes/no through when the game is asking', () => {
    const q = 'Are you really sure you want to give up studying just yet? >';
    assert.equal(answerForPendingPrompt(q, 'no'), 'no');
    assert.equal(answerForPendingPrompt(q, '*answer no*'), 'no');
    assert.equal(answerForPendingPrompt(q, 'Yes, absolutely.'), 'yes');
    assert.equal(answerForPendingPrompt('Please answer yes or no.  >', 'yeah ok'), 'yes');
    assert.equal(answerForPendingPrompt(q, 'no wait... yes!'), 'no');     // first answer wins
    assert.equal(answerForPendingPrompt(q, 'I ponder for a while'), null); // no clear answer
    assert.equal(answerForPendingPrompt('Taken.', 'no'), null);            // no pending question
    assert.equal(answerForPendingPrompt('', 'yes'), null);
});

test('parseCommand extracts one command; none/empty -> null; tolerates quotes/array', () => {
    assert.equal(parseCommand('switch on lantern'), 'switch on lantern');
    assert.equal(parseCommand('"take key"'), 'take key');
    assert.equal(parseCommand('["examine sign"]'), 'examine sign');
    assert.equal(parseCommand('none'), null);
    assert.equal(parseCommand(''), null);
    assert.equal(parseCommand('take lantern\nthen go north'), 'take lantern');   // first line only
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
