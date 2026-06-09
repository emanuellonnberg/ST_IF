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

import { buildApartCanonBlock } from '../canon.js';

test('apart block grounds in the companion room and withholds player actions', () => {
    const block = buildApartCanonBlock({
        companionRoom: 'Misty Clearing',
        companionScene: 'A clearing wreathed in fog. Paths lead north and east.',
        playerLocation: 'Dark Cave',
    });
    assert.match(block, /apart/i);
    assert.match(block, /Misty Clearing/);
    assert.match(block, /fog/);
    assert.match(block, /Dark Cave/);
    assert.match(block, /do not/i);
});

test('apart block tolerates an empty companion scene', () => {
    const block = buildApartCanonBlock({ companionRoom: 'Foyer', companionScene: '', playerLocation: 'Cellar' });
    assert.match(block, /Foyer/);
    assert.match(block, /Cellar/);
});

test('apart block adds companion and player departure directions when given', () => {
    const block = buildApartCanonBlock({
        companionRoom: 'Clearing', companionScene: 'Fog drifts.', playerLocation: 'Cave',
        playerDir: 'north', companionDir: 'east',
    });
    assert.match(block, /You headed east/);
    assert.match(block, /\{\{user\}\} headed north/);
});

test('apart block omits direction lines when dirs are null', () => {
    const block = buildApartCanonBlock({
        companionRoom: 'Clearing', companionScene: '', playerLocation: 'Cave',
        playerDir: null, companionDir: null,
    });
    assert.doesNotMatch(block, /headed/);
});
