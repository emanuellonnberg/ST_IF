// snapcodec.js — pure: compact encoding for Glulx (Quixe) snapshots. The dominant
// field is `ram` (all post-RAMSTART memory as a JS number array — ~3.5 JSON chars per
// byte). Most of it matches the original game image, so: XOR against the image, then
// run-length-encode the zero runs, then base64. Lossless, synchronous, and ~10-30x
// smaller on real snapshots. No ST/VM imports.

/** Glulx header: RAMSTART lives at bytes 8..11. */
export function glulxRamStart(image) {
    return ((image[8] << 24) | (image[9] << 16) | (image[10] << 8) | image[11]) >>> 0;
}

const pushVarint = (out, v) => {
    while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
};

const b64FromBytes = (arr) => {
    let s = '';
    for (let i = 0; i < arr.length; i += 0x8000) {
        s += String.fromCharCode.apply(null, arr.slice(i, i + 0x8000));
    }
    return btoa(s);
};

const bytesFromB64 = (b64) => {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
};

/**
 * Pack a Quixe autosave snapshot for persistence. The ram array is XOR-diffed
 * against the game image (aligned at RAMSTART), RLE'd, and base64'd. Other fields
 * pass through as-is (they are small JSON). Never mutates the input.
 * @param {object} snap the Dialog-stored Quixe snapshot ({ram, stack, glk, ...})
 * @param {Uint8Array} image the original story image the VM booted from
 */
export function packSnapshot(snap, image) {
    if (!snap || !snap.ram || snap.__ram64 !== undefined) return snap;
    const ram = snap.ram;
    const ramstart = glulxRamStart(image);
    // XOR against the image (zero beyond the image's end — extended memory).
    const diff = new Uint8Array(ram.length);
    for (let i = 0; i < ram.length; i++) {
        const gi = ramstart + i;
        diff[i] = (ram[i] ^ (gi < image.length ? image[gi] : 0)) & 0xff;
    }
    // RLE: repeated (zero-run varint, literal-len varint, literal bytes...).
    const rle = [];
    let i = 0;
    while (i < diff.length) {
        let z = i;
        while (z < diff.length && diff[z] === 0) z++;
        pushVarint(rle, z - i);                     // zeros skipped
        let l = z;
        while (l < diff.length && !(diff[l] === 0 && diff[l + 1] === 0 && diff[l + 2] === 0 && diff[l + 3] === 0)) l++;
        pushVarint(rle, l - z);                     // literal length (runs of <4 zeros stay literal)
        for (let k = z; k < l; k++) rle.push(diff[k]);
        i = l;
    }
    const { ram: _drop, ...rest } = snap;
    return { ...rest, __ram64: b64FromBytes(rle), __ramlen: ram.length };
}

/**
 * Reverse packSnapshot. Returns a snapshot whose ram is a Uint8Array (Quixe's
 * `memmap.set(snapshot.ram, ramstart)` accepts any array-like). A snapshot without
 * the pack marker is returned untouched (backward compatibility with raw saves).
 */
export function unpackSnapshot(packed, image) {
    if (!packed || packed.__ram64 === undefined) return packed;
    const rle = bytesFromB64(packed.__ram64);
    const diff = new Uint8Array(packed.__ramlen);
    let i = 0, o = 0;
    const readVarint = () => {
        let v = 0, shift = 0;
        for (;;) {
            const byte = rle[i++];
            v |= (byte & 0x7f) << shift;
            if (!(byte & 0x80)) return v >>> 0;
            shift += 7;
        }
    };
    while (i < rle.length && o < diff.length) {
        o += readVarint();                          // zero run (buffer is pre-zeroed)
        const lit = readVarint();
        for (let k = 0; k < lit; k++) diff[o++] = rle[i++];
    }
    const ramstart = glulxRamStart(image);
    const ram = new Uint8Array(packed.__ramlen);
    for (let j = 0; j < ram.length; j++) {
        const gi = ramstart + j;
        ram[j] = (diff[j] ^ (gi < image.length ? image[gi] : 0)) & 0xff;
    }
    const { __ram64: _a, __ramlen: _b, ...rest } = packed;
    return { ...rest, ram };
}
