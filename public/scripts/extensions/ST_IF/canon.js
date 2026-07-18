// canon.js — pure assembly of the canon block injected into the prompt. No ST imports.

/**
 * A short role directive for the active narration mode, or '' for the default.
 * 'narrate' = faithful play (the canon header already covers it); 'build' = let the
 * narrator extend the world at its edges so new places persist.
 * @param {string} mode
 * @returns {string}
 */
export function modeDirective(mode) {
    if (mode === 'build') {
        return 'World-building mode: when the scene reaches an edge of the known world, you may introduce new rooms, objects, and exits that fit the established setting and tone. Name each new place in one word, and mention one or two concrete onward exits so it can persist and connect. Never contradict or rewrite places that already exist.';
    }
    if (mode === 'gm') {
        return 'Game-master mode: besides narrating faithfully, briefly voice the minor background characters present — give them a line or a reaction when it fits — and you may introduce small incidental figures the scene calls for. Keep any named, registered character to their own voice; do not speak for them. Drive the pacing: surface hooks, consequences, and what could happen next.';
    }
    return '';
}

function statusLine(status) {
    const parts = [`Location: ${status.location}.`];
    if (status.score !== null && status.score !== undefined) parts.push(`Score: ${status.score}.`);
    if (status.moves !== null && status.moves !== undefined) parts.push(`Moves: ${status.moves}.`);
    return parts.join('  ');
}

/**
 * @param {{outputs: string[], status: {location:string, score:number|null, moves:number|null}, ranCommands: boolean, injectStateOnRp: boolean, companionPresent?: boolean, companionActionCmd?: string|null}} args
 * @returns {string} canon block, or '' when nothing should be injected
 */
export function buildCanonBlock({ outputs, status, ranCommands, injectStateOnRp, companionPresent, companionActionCmd, npcLine, npcSpeakingFor, whereaboutsLine, questLine, effectLine, mode }) {
    const modeLine = modeDirective(mode);
    if (!ranCommands) {
        if (!injectStateOnRp) return '';
        const base = `[GAME STATE — ground truth, do not contradict]\n${statusLine(status)}`;
        return [base, modeLine, npcLine, questLine].filter(Boolean).join('\n');
    }
    const result = outputs.join('\n').trim();
    const lines = [
        '[GAME — canon ground truth; never contradict it. The "Action result" below is exactly what happened — honor it, including failures (if it didn\'t work, it didn\'t work, and {{char}} sees that). Stay in character as {{char}}: react, speak, and act — and weave the room\'s details (exits, objects, mood) into the scene through {{char}}\'s eyes. Don\'t omit the setting; don\'t just transcribe it.]',
        `Action result: ${result}`,
        statusLine(status),
    ];
    if (modeLine) lines.push(modeLine);
    if (companionActionCmd) lines.push(`The action "${companionActionCmd}" was performed by {{char}} — its result above is {{char}}'s own deed; narrate it as theirs.`);
    if (companionPresent) lines.push('{{char}} is here with you.');
    if (npcLine) lines.push(npcLine);
    if (npcSpeakingFor) lines.push(`${npcSpeakingFor} is here and answers in their OWN message right after yours. Narrate only {{user}}'s approach/words and the setting — do NOT speak, quote, or describe ${npcSpeakingFor}'s reply, reaction, or expression; leave all of that to them. End on {{user}} addressing them.`);
    if (whereaboutsLine) lines.push(`${whereaboutsLine} (Share these whereabouts only if {{user}} asks where someone is, or has them look around / ask a servant.)`);
    if (questLine) lines.push(questLine);
    if (effectLine) lines.push(effectLine);
    return lines.join('\n');
}

/**
 * Canon for the very first message of a fresh game: ground the narrator in the
 * opening scene/room so it opens where the story actually starts (not a guess).
 * @param {string} introText the VM's opening scene / starting-room text
 * @param {{location:string, score:number|null, moves:number|null}} status
 * @returns {string}
 */
export function buildOpeningBlock(introText, status) {
    const intro = String(introText ?? '').trim();
    const lines = ['[GAME — opening scene; ground truth. The story begins now, in this place: open the scene here, honoring these details. Do not relocate the player or invent a different starting point.]'];
    if (intro) lines.push(intro);
    lines.push(statusLine(status));
    return lines.join('\n');
}

/**
 * Canon for an APART turn, from the companion's point of view. The narrator
 * ({{char}}) grounds in their own room and must not narrate {{user}}'s actions.
 * @param {{companionRoom:string, companionScene:string, playerLocation:string, playerDir?:string|null, companionDir?:string|null, playerShouted?:boolean, shoutDir?:string|null}} args
 */
export function buildApartCanonBlock({ companionRoom, companionScene, playerLocation, playerDir, companionDir, playerShouted, shoutDir, npcLine }) {
    const header = playerShouted
        ? '[GAME — IMPORTANT. {{char}} is NOT with {{user}} right now; you are apart, in different places. {{user}}\'s last message is something they do ELSEWHERE — {{char}} cannot see it and must NOT appear in that scene.]'
        : '[GAME — IMPORTANT. {{char}} is NOT with {{user}} right now; you are apart, in different places. {{user}}\'s last message is something they do ELSEWHERE — {{char}} cannot see or hear it and must NOT react to it or appear in that scene.]';
    const lines = [
        header,
        'That last message was {{user}}\'s action, not yours — {{char}} did not say or do any of it.',
        `{{char}} is alone at: ${companionRoom}.`,
    ];
    if (companionScene && companionScene.trim()) lines.push(companionScene.trim());
    if (companionDir) lines.push(`You headed ${companionDir}, leaving {{user}} behind.`);
    if (playerDir) lines.push(`{{user}} headed ${playerDir} as you parted.`);
    if (playerShouted) {
        lines.push(shoutDir
            ? `You DO hear {{user}}'s voice shouting from the ${shoutDir} — you may react to the sound and go that way.`
            : 'You DO hear {{user}}\'s voice shouting from somewhere beyond this room — you may react to the sound and try to go toward it.');
    }
    lines.push(`You last saw {{user}} moving toward ${playerLocation}; you do not know what they are doing now.`);
    if (npcLine) lines.push(npcLine);
    lines.push('Write ONLY what {{char}} does alone here, in character. Do not address {{user}} as if present, and do not narrate {{user}}\'s actions.');
    return lines.join('\n');
}
