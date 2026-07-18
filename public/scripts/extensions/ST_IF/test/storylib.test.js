// Unit tests for storylib.js — the uploaded-story library + per-chat story refs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libAdd, libGet, libList, libRemove, refIdentity, snapshotMatchesRef, promoteLegacyRef } from '../storylib.js';
import { initState, getStoryRef, setStoryRef } from '../state.js';

test('libAdd stores by a name-derived key; identical re-add is idempotent', () => {
    const lib = {};
    const k1 = libAdd(lib, 'Trinity.z4', 'AAAA');
    assert.equal(k1, 'trinity-z4');
    assert.equal(libGet(lib, k1).base64, 'AAAA');
    assert.equal(libAdd(lib, 'Trinity.z4', 'AAAA'), k1);          // same name+bytes → same key
    assert.equal(Object.keys(lib).length, 1);
});

test('libAdd suffixes on a name collision with different bytes', () => {
    const lib = {};
    const k1 = libAdd(lib, 'game.ulx', 'AAAA');
    const k2 = libAdd(lib, 'game.ulx', 'BBBB');                   // same name, new bytes
    assert.notEqual(k1, k2);
    assert.equal(libGet(lib, k1).base64, 'AAAA');
    assert.equal(libGet(lib, k2).base64, 'BBBB');
});

test('libList reports entries with sizes; libRemove works by key or name', () => {
    const lib = {};
    libAdd(lib, 'A Beauty.gblorb', 'x'.repeat(2048));
    assert.deepEqual(libList(lib).map((r) => [r.name, r.kb]), [['A Beauty.gblorb', 2]]);
    assert.ok(libRemove(lib, 'A Beauty.gblorb'));                 // by name
    assert.deepEqual(libList(lib), []);
    const k = libAdd(lib, 'x.ulx', 'AA');
    assert.ok(libRemove(lib, k));                                 // by key
    assert.ok(!libRemove(lib, 'missing'));
});

test('refIdentity distinguishes sources; snapshotMatchesRef guards restores', () => {
    assert.equal(refIdentity({ source: 'bundled', file: 'tavern.z5', name: 'Tavern' }), 'bundled:tavern.z5');
    assert.equal(refIdentity({ source: 'library', key: 'trinity-z4', name: 'Trinity.z4' }), 'library:trinity-z4');
    assert.equal(refIdentity({ source: 'legacy', name: 'X' }), 'legacy:X');
    assert.equal(refIdentity(null), null);
    // A snapshot may only restore into the story it was made on.
    assert.ok(snapshotMatchesRef('Trinity.z4', { source: 'library', key: 'k', name: 'Trinity.z4' }));
    assert.ok(!snapshotMatchesRef('The Adventurer\'s Rest', { source: 'legacy', name: 'Trinity.z4' }));
    assert.ok(!snapshotMatchesRef(null, { name: 'X' }));
    assert.ok(!snapshotMatchesRef('X', null));
});

test('promoteLegacyRef upgrades the mutable global slot to a stable ref (PR #34 review P1)', () => {
    // Bundled slot → bundled ref (re-fetchable by filename).
    const b = promoteLegacyRef({ storyFile: 'tavern.z5', storyName: 'Tavern', storyId: 'tavern' }, {});
    assert.deepEqual(b, { source: 'bundled', file: 'tavern.z5', name: 'Tavern', id: 'tavern' });
    // Uploaded slot → captured into the library, so later global-slot changes can't
    // swap this chat's bytes out from under its snapshot.
    const lib = {};
    const u = promoteLegacyRef({ storyName: 'Trinity.z4', storyBase64: 'AAAA' }, lib);
    assert.equal(u.source, 'library');
    assert.equal(libGet(lib, u.key).base64, 'AAAA');
    // Empty slot → nothing to promote.
    assert.equal(promoteLegacyRef({}, {}), null);
});

test('storyRef persists in chat state', () => {
    const md = {};
    initState(md, 'Tavern', 'SNAP');
    assert.equal(getStoryRef(md), null);
    setStoryRef(md, { source: 'bundled', file: 'tavern.z5', name: 'Tavern' });
    assert.deepEqual(getStoryRef(md), { source: 'bundled', file: 'tavern.z5', name: 'Tavern' });
});
