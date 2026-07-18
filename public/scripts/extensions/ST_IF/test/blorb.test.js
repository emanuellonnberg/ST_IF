// Unit tests for blorb.js (Blorb unwrap) and snapcodec.js (Glulx snapshot packing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlorb, extractStory } from '../blorb.js';
import { packSnapshot, unpackSnapshot, glulxRamStart } from '../snapcodec.js';

// --- helpers: build a Blorb in memory -----------------------------------------
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

/** Minimal valid Blorb: RIdx with one Exec entry pointing at a story chunk. */
function makeBlorb(storyType, storyBytes, { extraChunk = null } = {}) {
    const chunks = [];
    const ridxData = [...be32(1), ...ascii('Exec'), ...be32(0), ...be32(0)]; // start patched below
    chunks.push({ type: 'RIdx', data: ridxData });
    if (extraChunk) chunks.push(extraChunk);
    chunks.push({ type: storyType, data: Array.from(storyBytes) });

    // Lay out: FORM len IFRS, then chunks (even-padded); patch the Exec start offset.
    let body = [...ascii('IFRS')];
    let storyChunkPos = null;
    for (const c of chunks) {
        const pos = 8 + body.length;
        if (c.type === storyType) storyChunkPos = pos;
        body = body.concat(ascii(c.type), be32(c.data.length), c.data);
        if (c.data.length & 1) body.push(0);
    }
    const bytes = new Uint8Array([...ascii('FORM'), ...be32(body.length), ...body]);
    // Patch the RIdx Exec 'start' field (last 4 bytes of the 12-byte entry).
    const ridxStart = 12 + 8 + 4 + 4 + 4;   // FORM hdr + RIdx hdr + count + usage + resnum
    bytes.set(be32(storyChunkPos), ridxStart);
    return bytes;
}

const GLULX = new Uint8Array([...ascii('Glul'), ...be32(0x00030102), ...be32(64), ...be32(128), ...be32(256), 1, 2, 3, 4]);

test('isBlorb detects the container; plain stories are not blorbs', () => {
    assert.ok(isBlorb(makeBlorb('GLUL', GLULX)));
    assert.ok(!isBlorb(GLULX));
    assert.ok(!isBlorb(new Uint8Array([0x05, 0, 0, 0])));   // a z5 header byte
    assert.ok(!isBlorb(new Uint8Array(4)));
});

test('extractStory unwraps a GLUL exec chunk via the RIdx', () => {
    const res = extractStory(makeBlorb('GLUL', GLULX));
    assert.equal(res.format, 'glulx');
    assert.deepEqual(Array.from(res.bytes), Array.from(GLULX));
});

test('extractStory unwraps ZCOD and skips non-exec chunks', () => {
    const zcode = new Uint8Array([5, 0, 1, 2, 3, 4, 5, 6]);
    const res = extractStory(makeBlorb('ZCOD', zcode, {
        extraChunk: { type: 'IFmd', data: ascii('<metadata/>') },   // odd length → padding exercised
    }));
    assert.equal(res.format, 'zcode');
    assert.deepEqual(Array.from(res.bytes), Array.from(zcode));
});

test('extractStory returns null for a blorb without an executable', () => {
    const res = extractStory(makeBlorb('PNG ', new Uint8Array([1, 2, 3])));
    assert.equal(res, null);
});

// --- snapcodec ------------------------------------------------------------------

// A fake image: RAMSTART=8 (header bytes 8..11), then some "ROM"+"RAM" content.
function makeImage(len = 200) {
    const img = new Uint8Array(len);
    img.set([0x47, 0x6c, 0x75, 0x6c, 0, 3, 1, 2]);   // magic + version
    img.set(be32(8), 8);                              // RAMSTART = 8
    for (let i = 12; i < len; i++) img[i] = (i * 7) & 0xff;
    return img;
}

test('glulxRamStart reads the header field', () => {
    assert.equal(glulxRamStart(makeImage()), 8);
});

test('packSnapshot/unpackSnapshot round-trip is lossless (incl. extended memory)', () => {
    const image = makeImage(200);
    // ram runs from RAMSTART(8) to beyond the image end (extended memory).
    const ram = [];
    for (let i = 0; i < 300; i++) ram.push(image[8 + i] ?? 0);   // mostly matches the image
    ram[5] = 99; ram[6] = 100;            // a small change
    ram[250] = 42;                        // a change out in extended memory
    const snap = { ram, pc: 1234, stack: [1, 2, 3], glk: { windows: [] } };
    const packed = packSnapshot(snap, image);
    assert.equal(packed.ram, undefined);
    assert.equal(typeof packed.__ram64, 'string');
    assert.equal(packed.pc, 1234);                              // other fields pass through
    assert.deepEqual(snap.ram.slice(0, 8), ram.slice(0, 8));    // input not mutated
    const back = unpackSnapshot(JSON.parse(JSON.stringify(packed)), image);   // survives JSON
    assert.deepEqual(Array.from(back.ram), ram);
    assert.equal(back.__ram64, undefined);
    assert.equal(back.pc, 1234);
});

test('packSnapshot shrinks a mostly-unchanged ram; edge cases hold', () => {
    const image = makeImage(5000);
    const ram = Array.from(image.slice(8));                     // identical to the image
    ram[100] = (ram[100] + 1) & 0xff;                           // one changed byte
    const packed = packSnapshot({ ram }, image);
    assert.ok(packed.__ram64.length < 64, `tiny diff should pack tiny (got ${packed.__ram64.length})`);
    assert.deepEqual(Array.from(unpackSnapshot(packed, image).ram), ram);
    // all-different ram (worst case) still round-trips
    const noisy = ram.map((v, i) => (v + i + 1) & 0xff);
    assert.deepEqual(Array.from(unpackSnapshot(packSnapshot({ ram: noisy }, image), image).ram), noisy);
    // empty ram
    assert.deepEqual(Array.from(unpackSnapshot(packSnapshot({ ram: [] }, image), image).ram), []);
    // null / raw snapshots pass through untouched
    assert.equal(packSnapshot(null, image), null);
    assert.equal(unpackSnapshot(null, image), null);
    const raw = { ram: [1, 2, 3] };
    assert.equal(unpackSnapshot(raw, image), raw);              // no marker → untouched
});
