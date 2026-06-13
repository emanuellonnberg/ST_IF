import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripReasoning } from '../clean.js';

test('strips a leading <thought newline marker (degraded quiet form)', () => {
    assert.equal(stripReasoning('<thought\nEmanuel steps into the dim kitchen.'), 'Emanuel steps into the dim kitchen.');
});

test('strips a <thought> bracket marker', () => {
    assert.equal(stripReasoning('<thought> The cavern yawns.'), 'The cavern yawns.');
});

test('strips a closing </thought> marker', () => {
    assert.equal(stripReasoning('</thought>You are here.'), 'You are here.');
});

test('strips the full <|channel>thought<channel|> form and leftover channel name', () => {
    assert.equal(stripReasoning('<|channel>thought\n<channel|>Foo happens.'), 'Foo happens.');
});

test('removes stray channel tokens anywhere', () => {
    assert.equal(stripReasoning('A wall <channel|> blocks the way.'), 'A wall  blocks the way.');
});

test('leaves clean prose untouched', () => {
    assert.equal(stripReasoning('You are in a dark cave.'), 'You are in a dark cave.');
});

test('handles null/undefined', () => {
    assert.equal(stripReasoning(undefined), '');
    assert.equal(stripReasoning(null), '');
});

import { compactInventory } from '../clean.js';

test('compactInventory strips the header and joins items', () => {
    assert.equal(compactInventory('You are carrying:\n  a brass lantern\n  a sword'), 'a brass lantern, a sword');
});

test('compactInventory passes through single-line answers', () => {
    assert.equal(compactInventory('You are empty-handed.'), 'You are empty-handed.');
});

test('compactInventory handles empty/null', () => {
    assert.equal(compactInventory(''), '');
    assert.equal(compactInventory(null), '');
});
