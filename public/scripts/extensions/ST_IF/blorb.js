// blorb.js — pure: unwrap a Blorb (IFF FORM/IFRS) archive to its executable story
// chunk. Most published Glulx games ship as .gblorb (and Z-machine as .zblorb); the
// story bytes live in a 'GLUL' / 'ZCOD' chunk indexed by the 'RIdx' resource index.
// No ST/VM imports.

const te = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/** True if the bytes are a Blorb container (FORM....IFRS). */
export function isBlorb(bytes) {
    const b = bytes;
    return b && b.length >= 12 && te(b, 0) === 'FORM' && te(b, 8) === 'IFRS';
}

/**
 * Extract the executable story from a Blorb.
 * Prefers the RIdx 'Exec' entry; falls back to scanning top-level chunks.
 * @param {Uint8Array} bytes
 * @returns {{format: 'glulx'|'zcode', bytes: Uint8Array} | null} null if not a
 *   Blorb or no executable chunk is present.
 */
export function extractStory(bytes) {
    if (!isBlorb(bytes)) return null;
    const b = bytes;
    const end = Math.min(b.length, 8 + u32(b, 4));

    const chunkAt = (pos) => {
        if (pos + 8 > end) return null;
        const len = u32(b, pos + 4);
        if (pos + 8 + len > b.length) return null;
        return { type: te(b, pos), len, data: () => b.slice(pos + 8, pos + 8 + len) };
    };
    const asStory = (c) => (c && (c.type === 'GLUL' || c.type === 'ZCOD'))
        ? { format: c.type === 'GLUL' ? 'glulx' : 'zcode', bytes: c.data() }
        : null;

    // Walk top-level chunks: use the RIdx 'Exec' entry when present, remember any
    // executable chunk as a fallback.
    let pos = 12;
    let fallback = null;
    while (pos + 8 <= end) {
        const c = chunkAt(pos);
        if (!c) break;
        if (c.type === 'RIdx') {
            const d = c.data();
            const count = u32(d, 0);
            for (let i = 0; i < count; i++) {
                const off = 4 + i * 12;
                if (off + 12 > d.length) break;
                if (te(d, off) === 'Exec') {
                    const story = asStory(chunkAt(u32(d, off + 8)));
                    if (story) return story;
                }
            }
        }
        if (!fallback) fallback = asStory(c);
        pos += 8 + c.len + (c.len & 1);   // chunks are padded to even length
    }
    return fallback;
}
