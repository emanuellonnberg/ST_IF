// Unit tests for worldmap.js — pure map rendering + replay planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reverseDir, formatMap, pathToRoom, planReplay } from '../worldmap.js';

// A small branching world:  Origin -north-> attic -east-> balcony
//                           Origin -down--> cellar
const records = [
    { from: 'Origin', dir: 'north', name: 'attic', description: 'A dusty attic.', objects: [{ name: 'trunk', description: 'old', takeable: true }] },
    { from: 'attic', dir: 'east', name: 'balcony', description: 'A balcony.', objects: [] },
    { from: 'Origin', dir: 'down', name: 'cellar', description: 'A cellar.', objects: [] },
];

test('reverseDir flips compass words', () => {
    assert.equal(reverseDir('north'), 'south');
    assert.equal(reverseDir('down'), 'up');
    assert.equal(reverseDir('west'), 'east');
});

test('pathToRoom returns the dir sequence from Origin', () => {
    assert.deepEqual(pathToRoom(records, 'Origin'), []);
    assert.deepEqual(pathToRoom(records, 'attic'), ['north']);
    assert.deepEqual(pathToRoom(records, 'balcony'), ['north', 'east']);
    assert.deepEqual(pathToRoom(records, 'cellar'), ['down']);
});

test('formatMap renders an indented tree rooted at Origin', () => {
    assert.equal(formatMap(records), [
        'Origin',
        'north → attic',
        '  east → balcony',
        'down → cellar',
    ].join('\n'));
});

test('formatMap on an empty world is just Origin', () => {
    assert.equal(formatMap([]), 'Origin');
});

test('planReplay emits navigation + edits that rebuild the world in order', () => {
    const cmds = planReplay(records);
    // attic: cursor at Origin already → create directly
    // balcony: navigate Origin→attic (north), create east
    // cellar: navigate attic→Origin (south), create down
    assert.deepEqual(cmds, [
        'xroom north attic', 'xdesc A dusty attic.', 'xobj 1 trunk', 'xodesc old',
        'north',
        'xroom east balcony', 'xdesc A balcony.',
        'south',
        'xroom down cellar', 'xdesc A cellar.',
    ]);
});
