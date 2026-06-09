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
