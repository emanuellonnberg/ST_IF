// quest.js — pure quest registry + completion resolution. No ST/VM imports.
// A quest: { id, giver, goal, reward:{effect,amount|flag}, condition?, status }.

export function addQuest(list, q) {
    const rest = (list ?? []).filter((x) => x.id !== q.id);
    return [...rest, { status: 'active', ...q }];
}

export function removeQuest(list, id) {
    return (list ?? []).filter((x) => x.id !== id);
}

export function listQuests(list) {
    return [...(list ?? [])];
}

/** Active quests offered by the named NPC. */
export function questsForGiver(list, name) {
    return (list ?? []).filter((q) => q.giver === name && q.status === 'active');
}

function rewardText(reward) {
    if (!reward) return 'something';
    if (reward.effect === 'flag') return `flag ${reward.flag}`;
    return `${reward.amount} gold`;
}

/** Canon line describing active quests (for a present giver), or ''. */
export function questCanonLine(active) {
    if (!active || !active.length) return '';
    return 'Quests here: ' + active.map((q) => `${q.id} — ${q.goal} (reward ${rewardText(q.reward)}) [${q.status}]`).join('; ') + '.';
}

/**
 * The quest to pay out for a proposed completion, or null. Flag-gated quests
 * require their condition flag to be set; quests without a condition pay softly.
 */
export function resolveCompletion(list, questId, flagIsSet) {
    const q = (list ?? []).find((x) => x.id === questId && x.status === 'active');
    if (!q) return null;
    if (q.condition && !flagIsSet) return null;
    return q;
}
