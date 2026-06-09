// clean.js — strip model reasoning/"channel" scaffolding from generated narration.
// Pure. SillyTavern's reasoning auto-parse handles normal replies, but ST_IF's
// player-room narration comes from a quiet generation that the model frames
// differently (e.g. a bare "<thought\n...") which the configured parser misses.

/**
 * Remove reasoning scaffolding tokens wherever they appear and any leftover
 * leading channel name. Robust to the harmony "<|channel>thought<channel|>" form
 * and the degraded "<thought>" / "<thought\n" form.
 * @param {string} text
 * @returns {string}
 */
export function stripReasoning(text) {
    return String(text ?? '')
        .replace(/<\|?channel\|?>/gi, '')                 // <|channel>, <channel|>, <channel>, <|channel|>
        .replace(/<\/?thought\b\s*>?/gi, '')              // <thought>, </thought>, bare <thought
        .replace(/^\s*(?:thought|analysis|final|commentary)\b[:\s]*/i, '')  // leftover channel name at the start
        .trim();
}
