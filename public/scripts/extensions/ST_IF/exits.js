// exits.js — extract a room's exits from its prose and merge with learned map
// edges. Pure: the LLM `generate` function is injected. No ST imports.
import { extractMoves } from './companion.js';

export function buildExitsPrompt(roomDesc) {
    return [
        'Read this Interactive Fiction room description and list the exits it mentions.',
        'Respond with ONLY a JSON array: [{"dir":"<compass word>","label":"<short landmark or empty>"}].',
        'Use compass words only (north, south, east, west, up, down, in, out, ne, nw, se, sw). Empty array if none.',
        '',
        roomDesc,
    ].join('\n');
}

/**
 * @returns {Promise<Array<{dir:string,label:string|null}>|null>} exits on parse
 *   success ([] is a valid success), or null on garbage/error (caller must not cache).
 */
export async function extractExits(roomDesc, generate) {
    let raw;
    try {
        raw = await generate(buildExitsPrompt(roomDesc));
    } catch {
        return null;
    }
    const text = String(raw ?? '');
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return null;
    let arr;
    try {
        arr = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    if (!Array.isArray(arr)) return null;
    return arr
        .map((e) => ({
            dir: typeof e?.dir === 'string' ? e.dir.trim().toLowerCase() : '',
            label: (typeof e?.label === 'string' && e.label.trim()) ? e.label.trim() : null,
        }))
        .filter((e) => extractMoves([e.dir]).length === 1);
}

/**
 * Merge extracted exits with learned edges ({dir: destRoom}). Learned dirs not in
 * the extraction are appended.
 * @returns {Array<{dir:string,label:string|null,dest:string|null}>}
 */
export function mergeExits(extracted, edges) {
    const out = (extracted ?? []).map((e) => ({ ...e, dest: edges?.[e.dir] ?? null }));
    for (const [dir, dest] of Object.entries(edges ?? {})) {
        if (!out.some((e) => e.dir === dir)) out.push({ dir, label: null, dest });
    }
    return out;
}

/** "north → North of House ✓, west (forest), up → Attic ✓" */
export function formatExitsLine(merged) {
    return (merged ?? []).map((e) => {
        if (e.dest) return `${e.dir} → ${e.dest} ✓`;
        return e.label ? `${e.dir} (${e.label})` : e.dir;
    }).join(', ');
}
