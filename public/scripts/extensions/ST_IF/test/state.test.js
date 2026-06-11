import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readState, initState, recordTurn, rewindTo, getActiveSnapshot, HISTORY_CAP } from '../state.js';

test('initState seeds an empty game record', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    const s = readState(md);
    assert.equal(s.storyId, 'tiny.z5');
    assert.equal(s.snapshot, 'SNAP0');
    assert.deepEqual(s.history, []);
});

test('recordTurn updates canonical snapshot and appends history keyed by msg index', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    recordTurn(md, { msgIndex: 4, snapBefore: 'SNAP0', snapshot: 'SNAP1', summary: { location: 'Cave' }, cmds: ['north'] });
    const s = readState(md);
    assert.equal(s.snapshot, 'SNAP1');
    assert.equal(s.summary.location, 'Cave');
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].msgIndex, 4);
    assert.equal(s.history[0].snapBefore, 'SNAP0');
    assert.deepEqual(s.history[0].cmds, ['north']);
});

test('getActiveSnapshot returns latest canonical snapshot', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    recordTurn(md, { msgIndex: 4, snapBefore: 'SNAP0', snapshot: 'SNAP1', summary: {}, cmds: [] });
    assert.equal(getActiveSnapshot(md), 'SNAP1');
});

test('rewindTo restores the snapBefore of the target msg index and truncates later history', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    recordTurn(md, { msgIndex: 4, snapBefore: 'SNAP0', snapshot: 'SNAP1', summary: {}, cmds: ['north'] });
    recordTurn(md, { msgIndex: 6, snapBefore: 'SNAP1', snapshot: 'SNAP2', summary: {}, cmds: ['take key'] });
    const restored = rewindTo(md, 6);
    assert.equal(restored, 'SNAP1', 'rewinding turn at msg 6 returns its snapBefore');
    assert.equal(getActiveSnapshot(md), 'SNAP1');
    assert.equal(readState(md).history.length, 1, 'history after msg 6 is dropped');
});

test('rewindTo returns null for unknown msg index', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    assert.equal(rewindTo(md, 99), null);
});

test('history is capped at HISTORY_CAP, dropping oldest', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
        recordTurn(md, { msgIndex: i, snapBefore: `S${i}`, snapshot: `S${i + 1}`, summary: {}, cmds: [] });
    }
    const s = readState(md);
    assert.equal(s.history.length, HISTORY_CAP);
    assert.equal(s.history[0].msgIndex, 5, 'oldest entries dropped');
});

test('readState returns null when no game initialized', () => {
    assert.equal(readState({}), null);
});

import { initState as initState2, readState as readState2, getCompanionSnapshot, setCompanion, setTogether, readTogether } from '../state.js';

test('initState seeds a co-located companion and together=true', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.equal(getCompanionSnapshot(md), 'SNAP0');
    assert.equal(readTogether(md), true);
    assert.equal(readState2(md).snapshot, 'SNAP0');
});

test('setCompanion updates the companion snapshot/summary without touching the player', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    setCompanion(md, { snapshot: 'CSNAP1', summary: { location: 'Cave' } });
    assert.equal(getCompanionSnapshot(md), 'CSNAP1');
    assert.equal(readState2(md).companion.summary.location, 'Cave');
    assert.equal(readState2(md).snapshot, 'SNAP0', 'player snapshot untouched');
});

test('setTogether / readTogether round-trip', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    setTogether(md, false);
    assert.equal(readTogether(md), false);
});

test('getCompanionSnapshot falls back to the player snapshot for legacy state (no companion field)', () => {
    const md = { ST_IF: { storyId: 'x', snapshot: 'PLAYERSNAP', summary: null, history: [] } };
    assert.equal(getCompanionSnapshot(md), 'PLAYERSNAP');
    assert.equal(readTogether(md), true, 'legacy state defaults to together');
});

test('setCompanion seeds the companion object on legacy state', () => {
    const md = { ST_IF: { storyId: 'x', snapshot: 'P', summary: null, history: [] } };
    setCompanion(md, { snapshot: 'C', summary: null });
    assert.equal(getCompanionSnapshot(md), 'C');
});

import { getFollowQueue, setFollowQueue } from '../state.js';

test('follow queue defaults to empty and round-trips', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.deepEqual(getFollowQueue(md), []);
    setFollowQueue(md, ['north', 'west']);
    assert.deepEqual(getFollowQueue(md), ['north', 'west']);
});

test('setCompanion preserves an existing follow queue', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    setFollowQueue(md, ['south']);
    setCompanion(md, { snapshot: 'CSNAP1', summary: { location: 'Cave' } });
    assert.deepEqual(getFollowQueue(md), ['south'], 'queue survives a companion snapshot update');
});

test('getFollowQueue is empty for legacy companion without the field', () => {
    const md = { ST_IF: { storyId: 'x', snapshot: 'P', summary: null, history: [], companion: { snapshot: 'C', summary: null } } };
    assert.deepEqual(getFollowQueue(md), []);
});

import { getRoomDescription, setRoomDescription } from '../state.js';

test('roomDescription round-trips and defaults to empty', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.equal(getRoomDescription(md), '');
    setRoomDescription(md, 'A dark cave. Exits lead north.');
    assert.equal(getRoomDescription(md), 'A dark cave. Exits lead north.');
});

test('getRoomDescription is empty for legacy state without the field', () => {
    assert.equal(getRoomDescription({ ST_IF: { storyId: 'x', snapshot: 'P', summary: null, history: [] } }), '');
});

import { getInventoryText, setInventoryText, getExitsForRoom, setExitsForRoom, getEdgesForRoom, recordMapEdge } from '../state.js';

test('inventoryText round-trips and defaults to empty', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.equal(getInventoryText(md), '');
    setInventoryText(md, 'a lantern, a sword');
    assert.equal(getInventoryText(md), 'a lantern, a sword');
});

test('exits cache: unset room is undefined; set round-trips incl. empty array', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.equal(getExitsForRoom(md, 'Cave'), undefined);
    setExitsForRoom(md, 'Cave', [{ dir: 'north', label: null }]);
    assert.deepEqual(getExitsForRoom(md, 'Cave'), [{ dir: 'north', label: null }]);
    setExitsForRoom(md, 'Void', []);
    assert.deepEqual(getExitsForRoom(md, 'Void'), [], 'empty array is a cached success');
});

test('map edges record and read per room', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.deepEqual(getEdgesForRoom(md, 'Cave'), {});
    recordMapEdge(md, 'Cave', 'north', 'Hall');
    recordMapEdge(md, 'Cave', 'up', 'Attic');
    assert.deepEqual(getEdgesForRoom(md, 'Cave'), { north: 'Hall', up: 'Attic' });
});

test('hud accessors tolerate legacy state without the fields', () => {
    const md = { ST_IF: { storyId: 'x', snapshot: 'P', summary: null, history: [] } };
    assert.equal(getInventoryText(md), '');
    assert.equal(getExitsForRoom(md, 'Cave'), undefined);
    assert.deepEqual(getEdgesForRoom(md, 'Cave'), {});
});

test('exits cache invalidates when the room description changes', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    setExitsForRoom(md, 'Cave', [{ dir: 'north', label: null }], 'A dark cave. Exit north.');
    assert.deepEqual(getExitsForRoom(md, 'Cave', 'A dark cave. Exit north.'), [{ dir: 'north', label: null }], 'same desc → cached');
    assert.equal(getExitsForRoom(md, 'Cave', 'A dark cave, now lit. Exits north and east.'), undefined, 'changed desc → stale');
    assert.deepEqual(getExitsForRoom(md, 'Cave'), [{ dir: 'north', label: null }], 'no-desc read returns cached exits for display');
});

test('legacy array-shaped cache entries are treated as uncached (forces re-extract)', () => {
    const md = { ST_IF: { storyId: 'x', snapshot: 'P', summary: null, history: [], exitsCache: { Carousel: [] } } };
    assert.equal(getExitsForRoom(md, 'Carousel'), undefined);
    assert.equal(getExitsForRoom(md, 'Carousel', 'Eight passages.'), undefined);
});
