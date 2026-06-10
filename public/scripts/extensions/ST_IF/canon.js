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
        '[GAME — canon ground truth. Stay in character as {{char}}: react, speak, and act within this setting. The game text is the setting, not your reply — don\'t just describe the room.]',
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
        '[GAME — ground truth. You ({{char}}) are on your own, apart from {{user}}.]',
        `You are at: ${companionRoom}.`,
    ];
    if (companionScene && companionScene.trim()) lines.push(companionScene.trim());
    if (companionDir) lines.push(`You headed ${companionDir}, leaving {{user}} behind.`);
    if (playerDir) lines.push(`{{user}} headed ${playerDir} as you parted.`);
    lines.push(`You do not know what {{user}} is doing; you last saw them near ${playerLocation}.`);
    lines.push('Narrate only your own situation, in character. Do not describe {{user}}\'s actions.');
    return lines.join('\n');
}
