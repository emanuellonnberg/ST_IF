// Unit tests for quest.js — pure quest registry + completion resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addQuest, removeQuest, listQuests, questsForGiver, questCanonLine, resolveCompletion } from '../quest.js';

const RATS = { id: 'rats', giver: 'barkeep', goal: 'clear the rats from the cellar', reward: { effect: 'grant', amount: 10 }, condition: 'cellar_clear' };

test('addQuest defaults status active and replaces by id', () => {
    let l = addQuest([], RATS);
    assert.equal(l[0].status, 'active');
    l = addQuest(l, { ...RATS, goal: 'changed' });
    assert.equal(l.length, 1);
    assert.equal(l[0].goal, 'changed');
});

test('removeQuest / listQuests', () => {
    let l = addQuest([], RATS);
    assert.equal(listQuests(l).length, 1);
    l = removeQuest(l, 'rats');
    assert.equal(l.length, 0);
});

test('questsForGiver returns active quests for that NPC', () => {
    const l = [addQuest([], RATS)[0], { id: 'x', giver: 'hazel', reward: {}, status: 'done' }];
    assert.deepEqual(questsForGiver(l, 'barkeep').map((q) => q.id), ['rats']);
    assert.deepEqual(questsForGiver(l, 'hazel'), []);   // done, not active
});

test('questCanonLine formats active quests or empty', () => {
    assert.equal(questCanonLine([]), '');
    assert.match(questCanonLine(addQuest([], RATS)), /rats — clear the rats from the cellar \(reward 10 gold\) \[active\]/);
});

test('resolveCompletion: flag-gated needs the flag; soft does not; done/absent → null', () => {
    const l = addQuest([], RATS);                       // has condition cellar_clear
    assert.equal(resolveCompletion(l, 'rats', false), null);   // flag not set
    assert.equal(resolveCompletion(l, 'rats', true)?.id, 'rats');
    const soft = addQuest([], { id: 'hi', giver: 'b', reward: { effect: 'grant', amount: 5 } });
    assert.equal(resolveCompletion(soft, 'hi', false)?.id, 'hi');   // no condition → soft pays
    const done = [{ id: 'rats', giver: 'b', reward: {}, status: 'done' }];
    assert.equal(resolveCompletion(done, 'rats', true), null);      // already claimed
    assert.equal(resolveCompletion(l, 'nope', true), null);         // unknown id
});
