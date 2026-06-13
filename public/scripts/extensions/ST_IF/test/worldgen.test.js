// Unit tests for worldgen.js — pure room-JSON sanitiser + meta-command builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoomJson, sanitizeRoom, buildMetaCommands, blockedMove, directionSuggested } from '../worldgen.js';

test('parseRoomJson extracts JSON embedded in prose / fences', () => {
    const r = parseRoomJson('Sure! ```json\n{"name":"Attic","description":"Dusty.","objects":[]}\n``` done');
    assert.equal(r.name, 'Attic');
});

test('parseRoomJson returns null on junk', () => {
    assert.equal(parseRoomJson('no json here'), null);
    assert.equal(parseRoomJson(''), null);
    assert.equal(parseRoomJson(null), null);
});

test('sanitizeRoom caps name and description lengths', () => {
    const r = sanitizeRoom({ name: 'X'.repeat(80), description: 'D'.repeat(400), objects: [] });
    assert.ok(r.name.length <= 31, `name ${r.name.length}`);
    assert.ok(r.description.length <= 199, `desc ${r.description.length}`);
});

test('sanitizeRoom strips non-ASCII and collapses whitespace', () => {
    const r = sanitizeRoom({ name: '  Café\tNook ', description: 'a\n\nb   c', objects: [] });
    assert.doesNotMatch(r.name, /[^\x20-\x7e]/);
    assert.equal(r.description, 'a b c');
});

test('sanitizeRoom normalises object names to <=2 lowercase letter-words', () => {
    const r = sanitizeRoom({ name: 'Attic', description: 'd', objects: [
        { name: 'Old Brass Lantern!', description: 'shiny', takeable: true },
    ] });
    assert.equal(r.objects[0].name, 'old brass');
    assert.equal(r.objects[0].takeable, true);
});

test('sanitizeRoom caps object count and supplies fallbacks', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `o${i}`, description: '', takeable: false }));
    const r = sanitizeRoom({ name: '', description: '', objects: many });
    assert.ok(r.objects.length <= 8);
    assert.equal(r.name, 'somewhere');
    assert.equal(r.description, 'An undefined space.');
});

test('buildMetaCommands emits xroom + xdesc + xobj/xodesc per object', () => {
    const cmds = buildMetaCommands('north', {
        name: 'attic', description: 'dusty room',
        objects: [
            { name: 'trunk', description: 'old', takeable: true },
            { name: 'cobwebs', description: 'grey', takeable: false },
        ],
    });
    assert.deepEqual(cmds, [
        'xroom north attic',
        'xdesc dusty room',
        'xobj 1 trunk',
        'xodesc old',
        'xobj 0 cobwebs',
        'xodesc grey',
    ]);
});

test('blockedMove returns the normalised direction only on a blocked compass move', () => {
    assert.equal(blockedMove('n', 'You can\'t go that way.'), 'north');
    assert.equal(blockedMove('NORTH', 'You can\'t go that way.'), 'north');
    assert.equal(blockedMove('north', 'Kitchen\nA small kitchen.'), null);
    assert.equal(blockedMove('take lamp', 'You can\'t go that way.'), null);
    assert.equal(blockedMove('up', 'There is no way up.'), null); // pattern miss → null
});

test('directionSuggested matches normalised compass dirs (guided growth)', () => {
    assert.equal(directionSuggested([{ dir: 'north', label: 'a door' }], 'north'), true);
    assert.equal(directionSuggested([{ dir: 'n' }], 'north'), true);   // abbrev hint
    assert.equal(directionSuggested([{ dir: 'east' }], 'north'), false);
    assert.equal(directionSuggested(undefined, 'north'), false);       // not yet extracted
    assert.equal(directionSuggested([], 'north'), false);              // no hinted exits
});
