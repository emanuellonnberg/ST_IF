import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExitsPrompt, extractExits, mergeExits, formatExitsLine } from '../exits.js';

const DESC = 'West of House\nYou are standing in an open field west of a white house. A path leads north, and the forest lies to the west.';

test('prompt includes the room prose and asks for JSON', () => {
    const p = buildExitsPrompt(DESC);
    assert.match(p, /open field/);
    assert.match(p, /JSON/i);
});

test('extractExits parses a clean JSON array', async () => {
    const gen = async () => '[{"dir":"north","label":"path"},{"dir":"west","label":"forest"}]';
    assert.deepEqual(await extractExits(DESC, gen), [
        { dir: 'north', label: 'path' },
        { dir: 'west', label: 'forest' },
    ]);
});

test('extractExits accepts entries without labels and normalizes dirs', async () => {
    const gen = async () => '[{"dir":"N"},{"dir":"South","label":""}]';
    assert.deepEqual(await extractExits(DESC, gen), [
        { dir: 'n', label: null },
        { dir: 'south', label: null },
    ]);
});

test('extractExits drops non-direction entries but keeps the rest', async () => {
    const gen = async () => '[{"dir":"north"},{"dir":"banana","label":"x"}]';
    assert.deepEqual(await extractExits(DESC, gen), [{ dir: 'north', label: null }]);
});

test('extractExits returns null (do not cache) on garbage or throw', async () => {
    assert.equal(await extractExits(DESC, async () => 'no json'), null);
    assert.equal(await extractExits(DESC, async () => { throw new Error('down'); }), null);
});

test('extractExits returns [] (cacheable) for a legitimate empty array', async () => {
    assert.deepEqual(await extractExits(DESC, async () => '[]'), []);
});

test('mergeExits enriches with learned destinations and appends unknown learned dirs', () => {
    const extracted = [{ dir: 'north', label: 'path' }, { dir: 'west', label: 'forest' }];
    const edges = { north: 'North of House', up: 'Attic' };
    assert.deepEqual(mergeExits(extracted, edges), [
        { dir: 'north', label: 'path', dest: 'North of House' },
        { dir: 'west', label: 'forest', dest: null },
        { dir: 'up', label: null, dest: 'Attic' },
    ]);
});

test('formatExitsLine renders labels, destinations, and visited marks', () => {
    const line = formatExitsLine([
        { dir: 'north', label: 'path', dest: 'North of House' },
        { dir: 'west', label: 'forest', dest: null },
        { dir: 'up', label: null, dest: 'Attic' },
    ]);
    assert.equal(line, 'north → North of House ✓, west (forest), up → Attic ✓');
});

test('formatExitsLine handles empty', () => {
    assert.equal(formatExitsLine([]), '');
});

test('prompt forbids inferring exits from scenery mentions', () => {
    const p = buildExitsPrompt(DESC);
    assert.match(p, /do not infer/i);
    assert.match(p, /scenery|landscape/i);
});
