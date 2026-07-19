// translator.js — prose → canonical VM commands. No ST imports; `generate` is injected.

const MAX_CMDS = 4;

const STRICTNESS_NOTE = {
    strict: 'Only translate clear physical world-actions (move, take, drop, open, close, use, push, pull, attack, give, read, wear, eat, etc.). If the message is pure conversation, emotion, or description with no concrete world-action, return an empty array.',
    loose: 'Translate any plausible in-world action, including examining and social actions the parser might accept. Still return an empty array if nothing maps to a command.',
};

export function buildTranslatePrompt(playerText, status, strictness) {
    const note = STRICTNESS_NOTE[strictness] ?? STRICTNESS_NOTE.strict;
    return [
        'You convert a player\'s natural-language roleplay into Interactive Fiction parser commands.',
        `Current location: ${status.location}.`,
        note,
        'Use canonical parser verbs the standard parser understands, and the simplest one- or two-word noun. Prefer: a bare direction (north/n, south, east, west, up, down, in, out); take/drop <obj>; examine <obj>; open/close <obj>; switch on/off <obj>; put <obj> in/on <obj>; give <obj> to <person>; unlock <obj> with <obj>; read/wear/eat <obj>.',
        'Examples:',
        '  I pick up the brass lantern -> ["take lantern"]',
        '  I head through the door to the north -> ["north"]',
        '  I flick the lamp on -> ["switch on lamp"]',
        '  I take a close look at the old painting -> ["examine painting"]',
        '  I slot the rusty key into the lock and turn it -> ["unlock door with key"]',
        '  "Evening," I say with a tired nod -> []',
        'Respond with ONLY a JSON array of short imperative parser commands. No prose, no explanation. Empty array if no world-action.',
        '',
        `Player message: ${playerText}`,
    ].join('\n');
}

// Standard-library messages that mean the parser rejected the wording (wrong verb,
// unknown word, or no such object) — i.e. the translation missed, not the world.
// Deliberately excludes "you can't go that way" (a real blocked exit, handled elsewhere).
const PARSE_FAILS = [
    /can't see any such thing/i,
    /\bdon't know the word\b/i,
    /that's not a verb/i,
    /not a verb i (?:recognis|recogniz)e/i,
    /only understood you as far as/i,
    /didn't understand that sentence/i,
    /that's not something you can/i,
];

/**
 * Direct answer for a game that is waiting on a yes/no question (not a normal
 * command prompt). IF games drop into these sub-prompts ("Are you sure? >",
 * "Please answer yes or no.") and the translator would return [] for a bare
 * "no" — so when the last VM output looks like a pending question and the
 * player's message contains a clear yes/no, pass the literal answer through.
 * @returns {'yes'|'no'|null}
 */
export function answerForPendingPrompt(lastOutput, playerText) {
    const out = String(lastOutput ?? '').trim();
    // Require MODAL evidence of a parser sub-prompt, not just story prose that
    // happens to end with a question mark (NPC dialogue does that constantly).
    // A sub-prompt keeps its same-line "? >" through output cleaning (only a
    // newline-separated ">" is stripped); explicit "answer yes or no" / "y/n"
    // also qualifies. A missed first attempt self-heals: the game re-asks with
    // "Please answer yes or no. >", which this matches.
    if (!/answer yes or no|\by\/n\b|\?\s*>\s*$/i.test(out)) return null;
    const t = String(playerText ?? '');
    const yes = t.search(/\b(yes|yeah|yep|aye)\b/i);
    const no = t.search(/\b(no|nope|nah)\b/i);
    if (yes < 0 && no < 0) return null;
    if (yes < 0) return 'no';
    if (no < 0) return 'yes';
    return no < yes ? 'no' : 'yes';   // both present → the one said first wins
}

/** True if the VM output is a parser-level rejection worth re-translating. */
export function isParserFailure(text) {
    const t = String(text ?? '');
    return PARSE_FAILS.some((re) => re.test(t));
}

/** Prompt to repair one rejected command into a parser-acceptable one. */
export function buildRepairPrompt(playerText, status, failedCmd, failureText) {
    return [
        'An Interactive Fiction parser rejected a command. Correct it.',
        `Location: ${status.location}.`,
        `The player wanted: ${playerText}`,
        `Command tried: ${failedCmd}`,
        `Parser replied: ${String(failureText ?? '').trim().slice(0, 120)}`,
        'Give ONE corrected parser command using a canonical verb and the simplest noun (e.g. "take key", "switch on lamp", "examine sign", "north"), or the single word none if it cannot be done. Respond with ONLY the command — no quotes, no prose.',
    ].join('\n');
}

/** Pull a single parser command out of the repair model's reply, or null. */
export function parseCommand(raw) {
    let s = String(raw ?? '').trim();
    if (!s) return null;
    const arr = extractArray(s);                 // tolerate a ["..."] wrapper
    if (arr && arr.length) s = String(arr[0] ?? '');
    s = s.replace(/^[\s"'`[]+|[\s"'`\]]+$/g, '').split('\n')[0].trim();
    if (!s || /^none$/i.test(s)) return null;
    return s.slice(0, 60);
}

/** Extract the first top-level JSON array from arbitrary model text. */
function extractArray(text) {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return null;
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} playerText
 * @param {{location:string,score:number|null,moves:number|null}} status
 * @param {'strict'|'loose'} strictness
 * @param {(prompt:string)=>Promise<string>} generate
 * @returns {Promise<string[]>}
 */
export async function translate(playerText, status, strictness, generate) {
    let raw;
    try {
        raw = await generate(buildTranslatePrompt(playerText, status, strictness));
    } catch {
        return [];
    }
    const arr = extractArray(String(raw ?? ''));
    if (!arr) return [];
    return arr
        .filter((c) => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim())
        .slice(0, MAX_CMDS);
}
