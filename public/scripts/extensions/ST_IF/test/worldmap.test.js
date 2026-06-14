// Unit tests for worldmap.js — graph map rendering + replay planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reverseDir, formatMap, planReplay, upconvertV1 } from '../worldmap.js';

// A square loop: Origin -north-> a -east-> b -south-> c, and c -west-> Origin (the loop).
const graph = {
    rooms: [
        { name: 'a', x: 0, y: 1, z: 0, description: 'room a', objects: [{ name: 'key', description: 'brass', takeable: true }] },
        { name: 'b', x: 1, y: 1, z: 0, description: 'room b', objects: [] },
        { name: 'c', x: 1, y: 0, z: 0, description: 'room c', objects: [] },
    ],
    edges: [
        { from: 'Origin', dir: 'north', to: 'a' },
        { from: 'a', dir: 'east', to: 'b' },
        { from: 'b', dir: 'south', to: 'c' },
        { from: 'c', dir: 'west', to: 'Origin' },
    ],
};

test('reverseDir flips compass words', () => {
    assert.equal(reverseDir('north'), 'south');
    assert.equal(reverseDir('up'), 'down');
});

test('formatMap renders the spine tree plus a loops section', () => {
    assert.equal(formatMap(graph), [
        'Origin',
        'north → a',
        '  east → b',
        '    south → c',
        'loops:',
        '  c west → Origin',
    ].join('\n'));
});

test('formatMap on an empty graph is just Origin', () => {
    assert.equal(formatMap({ rooms: [], edges: [] }), 'Origin');
});

test('planReplay creates every room then links every edge (navigation-free)', () => {
    assert.deepEqual(planReplay(graph), [
        'xnew a', 'xdesc room a', 'xobj 1 key', 'xodesc brass',
        'xnew b', 'xdesc room b',
        'xnew c', 'xdesc room c',
        'xlinkn Origin north a',
        'xlinkn a east b',
        'xlinkn b south c',
        'xlinkn c west Origin',
    ]);
});

test('upconvertV1 turns a v1 tree into a graph with coords + edges', () => {
    const v1 = [
        { from: 'Origin', dir: 'north', name: 'a', description: 'room a', objects: [] },
        { from: 'a', dir: 'east', name: 'b', description: 'room b', objects: [] },
    ];
    const g = upconvertV1(v1);
    assert.deepEqual(g.rooms, [
        { name: 'a', x: 0, y: 1, z: 0, description: 'room a', objects: [] },
        { name: 'b', x: 1, y: 1, z: 0, description: 'room b', objects: [] },
    ]);
    assert.deepEqual(g.edges, [
        { from: 'Origin', dir: 'north', to: 'a' },
        { from: 'a', dir: 'east', to: 'b' },
    ]);
});
