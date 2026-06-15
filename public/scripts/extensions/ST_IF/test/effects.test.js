// Unit tests for effects.js — NPC effect proposal parse + validation + verb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEffectProposal, validateEffect, effectVerb } from '../effects.js';

test('parseEffectProposal extracts JSON or null', () => {
    assert.deepEqual(parseEffectProposal('sure ```{"effect":"grant","amount":10}```'), { effect: 'grant', amount: 10 });
    assert.equal(parseEffectProposal('no json'), null);
});

test('validateEffect: safety off blocks everything', () => {
    assert.equal(validateEffect({ effect: 'grant', amount: 5 }, { safety: 'off' }), null);
});

test('validateEffect: grant within cap, rejects over-cap and non-int', () => {
    assert.deepEqual(validateEffect({ effect: 'grant', amount: 10 }, { safety: 'safe', maxGrant: 25 }), { effect: 'grant', amount: 10 });
    assert.equal(validateEffect({ effect: 'grant', amount: 999 }, { safety: 'safe', maxGrant: 25 }), null);
    assert.equal(validateEffect({ effect: 'grant', amount: 0 }, { safety: 'safe', maxGrant: 25 }), null);
    assert.equal(validateEffect({ effect: 'grant', amount: 2.5 }, { safety: 'safe', maxGrant: 25 }), null);
});

test('validateEffect: safe forbids take, open allows it', () => {
    assert.equal(validateEffect({ effect: 'take', amount: 5 }, { safety: 'safe', maxGrant: 25 }), null);
    assert.deepEqual(validateEffect({ effect: 'take', amount: 5 }, { safety: 'open', maxGrant: 25 }), { effect: 'take', amount: 5 });
});

test('validateEffect: flag name format', () => {
    assert.deepEqual(validateEffect({ effect: 'flag', flag: 'cellar_clear' }, { safety: 'safe' }), { effect: 'flag', flag: 'cellar_clear' });
    assert.equal(validateEffect({ effect: 'flag', flag: 'Bad Flag!' }, { safety: 'safe' }), null);
    assert.equal(validateEffect({ effect: 'none' }, { safety: 'open' }), null);
});

test('effectVerb formats the meta-command', () => {
    assert.equal(effectVerb({ effect: 'grant', amount: 10 }), 'xgrant 10');
    assert.equal(effectVerb({ effect: 'take', amount: 3 }), 'xtake 3');
    assert.equal(effectVerb({ effect: 'flag', flag: 'clear' }), 'xflag clear');
});

test('validateEffect: give an item (safe) — single lowercase token only', () => {
    assert.deepEqual(validateEffect({ effect: 'give', item: 'key' }, { safety: 'safe' }), { effect: 'give', item: 'key' });
    assert.equal(validateEffect({ effect: 'give', item: 'Rusty Key' }, { safety: 'safe' }), null);   // spaces/caps
    assert.equal(validateEffect({ effect: 'give', item: '' }, { safety: 'safe' }), null);
    assert.equal(validateEffect({ effect: 'give' }, { safety: 'safe' }), null);                       // no item
});

test('validateEffect: take-item is open-only', () => {
    assert.equal(validateEffect({ effect: 'take-item', item: 'key' }, { safety: 'safe' }), null);
    assert.deepEqual(validateEffect({ effect: 'take-item', item: 'key' }, { safety: 'open' }), { effect: 'take-item', item: 'key' });
});

test('effectVerb formats item verbs', () => {
    assert.equal(effectVerb({ effect: 'give', item: 'key' }), 'xgive key');
    assert.equal(effectVerb({ effect: 'take-item', item: 'coin' }), 'xtakeitem coin');
});
