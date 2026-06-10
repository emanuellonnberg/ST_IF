// canon.js — pure assembly of the canon block injected into the prompt. No ST imports.

function statusLine(status) {
    const parts = [`Location: ${status.location}.`];
    if (status.score !== null && status.score !== undefined) parts.push(`Score: ${status.score}.`);
    if (status.moves !== null && status.moves !== undefined) parts.push(`Moves: ${status.moves}.`);
    return parts.join('  ');
}

/**
 * @param {{outputs: string[], status: {location:string, score:number|null, moves:number|null}, ranCommands: boolean, injectStateOnRp: boolean, companionPresent?: boolean}} args
 * @returns {string} canon block, or '' when nothing should be injected
 */
export function buildCanonBlock({ outputs, status, ranCommands, injectStateOnRp, companionPresent }) {
    if (!ranCommands) {
        if (!injectStateOnRp) return '';
        return `[GAME STATE — ground truth, do not contradict]\n${statusLine(status)}`;
    }
    const result = outputs.join('\n').trim();
    const lines = [
        '[GAME — canon ground truth; never contradict it. The "Action result" below is exactly what happened — honor it, including failures (if it didn\'t work, it didn\'t work, and {{char}} sees that). Stay in character as {{char}}: react, speak, and act — and weave the room\'s details (exits, objects, mood) into the scene through {{char}}\'s eyes. Don\'t omit the setting; don\'t just transcribe it.]',
        `Action result: ${result}`,
        statusLine(status),
    ];
    if (companionPresent) lines.push('{{char}} is here with you.');
    return lines.join('\n');
}

/**
 * Canon for an APART turn, from the companion's point of view. The narrator
 * ({{char}}) grounds in their own room and must not narrate {{user}}'s actions.
 * @param {{companionRoom:string, companionScene:string, playerLocation:string, playerDir?:string|null, companionDir?:string|null}} args
 */
export function buildApartCanonBlock({ companionRoom, companionScene, playerLocation, playerDir, companionDir }) {
    const lines = [
        '[GAME — IMPORTANT. {{char}} is NOT with {{user}} right now; you are apart, in different places. {{user}}\'s last message is something they do ELSEWHERE — {{char}} cannot see or hear it and must NOT react to it or appear in that scene.]',
        `{{char}} is alone at: ${companionRoom}.`,
    ];
    if (companionScene && companionScene.trim()) lines.push(companionScene.trim());
    if (companionDir) lines.push(`You headed ${companionDir}, leaving {{user}} behind.`);
    if (playerDir) lines.push(`{{user}} headed ${playerDir} as you parted.`);
    lines.push(`You last saw {{user}} moving toward ${playerLocation}; you do not know what they are doing now.`);
    lines.push('Write ONLY what {{char}} does alone here, in character. Do not address {{user}} as if present, and do not narrate {{user}}\'s actions.');
    return lines.join('\n');
}
