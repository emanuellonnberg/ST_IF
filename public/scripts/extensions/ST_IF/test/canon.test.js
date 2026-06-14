import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonBlock } from '../canon.js';

test('quest and effect lines appear only when provided', () => {
    const base = { outputs: ['A tavern.'], status: { location: 'tavern', score: 0, moves: 1 }, ranCommands: true };
    assert.doesNotMatch(buildCanonBlock(base), /Quests here|gold across/);
    const withQE = buildCanonBlock({ ...base, questLine: 'Quests here: rats — clear the cellar (reward 10 gold) [active].', effectLine: 'The barkeep slides 10 gold across; you now have 30.' });
    assert.match(withQE, /Quests here: rats/);
    assert.match(withQE, /slides 10 gold across/);
});

test('present NPCs and the speaking cue appear only when provided', () => {
    const base = { outputs: ['A tavern.'], status: { location: 'tavern', score: 0, moves: 1 }, ranCommands: true };
    const plain = buildCanonBlock(base);
    assert.doesNotMatch(plain, /Present here/);
    const withNpc = buildCanonBlock({ ...base, npcLine: 'Present here: barkeep — gruff.', npcSpeakingFor: 'barkeep' });
    assert.match(withNpc, /Present here: barkeep — gruff\./);
    assert.match(withNpc, /barkeep is here and will answer for themselves/);
    const noSpeaker = buildCanonBlock({ ...base, npcLine: 'Present here: hazel — shy.' });
    assert.match(noSpeaker, /Present here: hazel/);
    assert.doesNotMatch(noSpeaker, /answer for themselves/);
});

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

test('action canon is character-forward and omits the companion line by default', () => {
    const b = buildCanonBlock({ outputs: ['You go north.'], status: { location: 'Cave', score: 0, moves: 1 }, ranCommands: true, injectStateOnRp: false });
    assert.match(b, /in character/i);
    assert.match(b, /setting/i);
    assert.match(b, /ground truth/i);
    assert.match(b, /Action result: You go north\./);
    assert.doesNotMatch(b, /here with you/i);
});

test('companionPresent adds the presence line', () => {
    const b = buildCanonBlock({ outputs: ['You go north.'], status: { location: 'Cave', score: 0, moves: 1 }, ranCommands: true, injectStateOnRp: false, companionPresent: true });
    assert.match(b, /\{\{char\}\} is here with you/);
});

test('canon honors failures and keeps the setting (never contradict)', () => {
    const b = buildCanonBlock({ outputs: ['You\'ll have to unlock it first.'], status: { location: 'Patio', score: 0, moves: 3 }, ranCommands: true, injectStateOnRp: false });
    assert.match(b, /never contradict/i);
    assert.match(b, /fail/i);
    assert.match(b, /weave/i);
    assert.match(b, /You'll have to unlock it first\./);
});

test('apart block forcefully states separation and forbids reacting to the user', () => {
    const b = buildApartCanonBlock({ companionRoom: 'Cellar', companionScene: 'Dust.', playerLocation: 'Hall', playerDir: null, companionDir: null });
    assert.match(b, /NOT with \{\{user\}\}/);
    assert.match(b, /must NOT react/i);
    assert.match(b, /alone at: Cellar/);
    assert.match(b, /ONLY what \{\{char\}\} does/);
});

test('apart block always attributes the last message to the user, not the char', () => {
    const b = buildApartCanonBlock({ companionRoom: 'Cellar', companionScene: '', playerLocation: 'Hall' });
    assert.match(b, /not yours/i);
    assert.match(b, /did not say or do/i);
});

test('apart block with playerShouted lets the companion hear the shout', () => {
    const b = buildApartCanonBlock({ companionRoom: 'Cellar', companionScene: '', playerLocation: 'Hall', playerShouted: true });
    assert.match(b, /hear \{\{user\}\}.{0,40}shout/i);
    assert.doesNotMatch(b, /cannot see or hear/i);
    assert.match(b, /did not say or do/i, 'attribution still present');
});

test('apart block without shout keeps the absolute wall', () => {
    const b = buildApartCanonBlock({ companionRoom: 'Cellar', companionScene: '', playerLocation: 'Hall', playerShouted: false });
    assert.match(b, /cannot see or hear/i);
});

test('apart shout names the direction when known', () => {
    const b = buildApartCanonBlock({ companionRoom: 'Cellar', companionScene: '', playerLocation: 'Hall', playerShouted: true, shoutDir: 'up' });
    assert.match(b, /shouting from the up/i);
});

test('apart shout stays vague without a known direction', () => {
    const b = buildApartCanonBlock({ companionRoom: 'Cellar', companionScene: '', playerLocation: 'Hall', playerShouted: true, shoutDir: null });
    assert.match(b, /somewhere beyond this room/i);
});

test('together canon attributes a companion action when given', () => {
    const b = buildCanonBlock({
        outputs: ['Taken.', 'The brass lantern is now on.'],
        status: { location: 'Cellar', score: 25, moves: 10 },
        ranCommands: true, injectStateOnRp: false,
        companionPresent: true, companionActionCmd: 'light lantern',
    });
    assert.match(b, /"light lantern".*\{\{char\}\}|\{\{char\}\}.*"light lantern"/);
    assert.match(b, /deed|performed|did/i);
});

test('no attribution line without a companion action', () => {
    const b = buildCanonBlock({
        outputs: ['Taken.'], status: { location: 'Cellar', score: 25, moves: 10 },
        ranCommands: true, injectStateOnRp: false, companionPresent: true,
    });
    assert.doesNotMatch(b, /deed/i);
});
