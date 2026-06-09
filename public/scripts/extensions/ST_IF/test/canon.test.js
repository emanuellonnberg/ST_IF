import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonBlock } from '../canon.js';

test('action turn includes result and status', () => {
    const block = buildCanonBlock({
        outputs: ['You take the brass lantern.', 'You head north. A dark cave.'],
        status: { location: 'Dark Cave', score: 5, moves: 12 },
        ranCommands: true,
        injectStateOnRp: false,
    });
    assert.match(block, /ground truth/i);
    assert.match(block, /You take the brass lantern\./);
    assert.match(block, /You head north\. A dark cave\./);
    assert.match(block, /Dark Cave/);
    assert.match(block, /5/);
    assert.match(block, /12/);
});

test('pure-RP turn with injectStateOnRp=false returns empty string', () => {
    const block = buildCanonBlock({
        outputs: [],
        status: { location: 'Dark Cave', score: 5, moves: 12 },
        ranCommands: false,
        injectStateOnRp: false,
    });
    assert.equal(block, '');
});

test('pure-RP turn with injectStateOnRp=true returns status-only block', () => {
    const block = buildCanonBlock({
        outputs: [],
        status: { location: 'Dark Cave', score: 5, moves: 12 },
        ranCommands: false,
        injectStateOnRp: true,
    });
    assert.match(block, /Dark Cave/);
    assert.doesNotMatch(block, /Action result/i);
});

test('null score/moves are omitted gracefully', () => {
    const block = buildCanonBlock({
        outputs: ['You wait.'],
        status: { location: 'Foyer', score: null, moves: null },
        ranCommands: true,
        injectStateOnRp: false,
    });
    assert.match(block, /Foyer/);
    assert.doesNotMatch(block, /Score:/);
});
