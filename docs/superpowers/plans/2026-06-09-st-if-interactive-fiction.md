# ST_IF Interactive Fiction Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SillyTavern client-side extension that embeds a Z-machine IF VM, translates player prose into canonical parser commands each turn, runs them against the VM, and injects the VM's output + status line into the chat prompt as ground truth for the narrator.

**Architecture:** A `generate_interceptor` hook runs before each generation. Player prose → strict LLM translator → 0+ VM commands → ifvms ZVM step → canon block injected via `setExtensionPrompt`. The VM snapshot is the only source of truth, persisted per-chat in `chatMetadata`. Pure-RP turns (translator returns `[]`) pass through untouched. All logic except the VM wrapper is decoupled from the SillyTavern runtime (dependencies injected as parameters) so it can be unit-tested with `node --test`.

**Tech Stack:** Vanilla ES modules, jQuery (ST convention), vendored `ifvms.js` (ZVM) + a headless Glk shim, `node --test` for unit tests, ESLint (repo default).

---

## Spec refinement (deviation from the approved design doc)

The approved spec ([2026-06-09-st-if-interactive-fiction-design.md](../specs/2026-06-09-st-if-interactive-fiction-design.md)) described the injected state block as `Location / Exits / Inventory`. During planning we confirmed a Z-machine exposes **no structured world model** — exits and inventory are not machine-readable from arbitrary Z-code without issuing extra parser commands (which can advance game time and cause side effects). What *is* reliably readable, side-effect-free, is the **status line**: location name + score + moves (the upper status window the VM updates every turn).

**v1 injected state block is therefore:** the raw VM text output of the turn's commands + the status line `{location, score, moves}`. Synthetic exits/inventory (by auto-issuing `look`/`inventory`) is deferred to post-v1 as an opt-in toggle. Everything else in the spec stands.

## File structure

**RESOLVED (Task 1):** All paths under `public/scripts/extensions/ST_IF/`. The server `/discover` endpoint treats every directory under `public/scripts/extensions/` except `third-party/` as a built-in "system" extension, so this path is auto-discovered. Crucially, `third-party/` is gitignored but `ST_IF/` is not — this path commits into the fork, which is the goal. Template render therefore uses module name `'ST_IF'` (not `'third-party/ST_IF'`).

| File | Responsibility | ST runtime coupling |
|------|----------------|---------------------|
| `manifest.json` | Extension manifest; declares `generate_interceptor`, `js`, `css` | n/a |
| `lib/zvm.js` (+ deps) | Vendored ifvms ZVM + headless Glk shim | none (self-contained) |
| `vm.js` | Wrapper exposing our stable interface over ifvms: `load/step/save/restore/getStatus` | none (only ifvms) |
| `canon.js` | Pure: assemble the canon block string from outputs + status + options | none |
| `translator.js` | Pure: build translate prompt, call an injected `generate` fn, parse JSON array, fail-open to `[]` | none (generate injected) |
| `state.js` | Pure: read/write `chatMetadata.ST_IF`, snapshot history keyed by msg index, rewind | none (context injected) |
| `turn.js` | Pure: orchestrate one turn (`runTurn(deps, chat, type)`) — guards, translate→step→persist→canon | none (deps injected) |
| `settings.js` | `extension_settings.ST_IF` defaults + merge; UI wiring; story upload→base64 | ST (extension_settings, jQuery) |
| `settings.html` | Settings panel template | n/a |
| `index.js` | Wire everything: imports, init, `globalThis` interceptor, slash commands, event listeners | ST (all imports) |
| `style.css` | Minimal panel styling | n/a |
| `test/*.test.js` | `node --test` unit tests for pure modules | none |
| `test/fixtures/tiny.z5` | Tiny compiled story for the VM integration test | n/a |

Decoupling rule that makes this testable: `canon.js`, `translator.js`, `state.js`, `turn.js`, `vm.js` import **nothing** from `script.js`/`extensions.js`. They receive ST functions (`generateQuietPrompt`, the context object, `setExtensionPrompt`) as parameters. Only `index.js` and `settings.js` touch the ST runtime. This is why the orchestration is unit-testable without a browser.

---

## Task 1: Extension skeleton + VM wrapper spike

This task is a **spike**: ifvms.js headless embedding is under-documented, so the VM wrapper's internals must be pinned against a real story file before downstream work. The deliverable is `vm.js` satisfying a stable, tested interface — downstream tasks depend only on that interface, never on ifvms internals.

**Files:**
- Create: `public/scripts/extensions/third-party/ST_IF/manifest.json`
- Create: `public/scripts/extensions/third-party/ST_IF/lib/` (vendored ifvms ZVM + Glk shim)
- Create: `public/scripts/extensions/third-party/ST_IF/vm.js`
- Create: `public/scripts/extensions/third-party/ST_IF/test/vm.integration.test.js`
- Create: `public/scripts/extensions/third-party/ST_IF/test/fixtures/tiny.z5`

**Reference material to pin the API (read these first):**
- ifvms.js repo: https://github.com/curiousdannii/ifvms.js — read `tests/` and the ZVM `prepare(storyBytes, {Glk, Dialog, ...})` / `start()` entry points.
- Parchment `runner.js` and the `glkote` / `glkapi.js` Glk implementation — the headless shim mirrors GlkOte's Glk but writes text to a buffer instead of the DOM and feeds line input from a queue.
- npm: `ifvms`, `glkote` (or `@curiousdannii/glkote`).

**Our `vm.js` interface (stable — do not change downstream):**

```javascript
// vm.js — wrapper over ifvms ZVM. No SillyTavern imports.
export class IFVM {
    /** Load a story file. bytes: Uint8Array of a .z5/.z8 file. Resets all state. */
    async load(bytes) { /* spike */ }
    /** Run one parser command, return the text the VM emitted in response. */
    step(command) { /* spike */ }
    /** Serialize full VM state to a base64 string (Quetzal-backed). */
    save() { /* spike */ }
    /** Restore VM state from a base64 string produced by save(). */
    restore(snapshot) { /* spike */ }
    /** Read the status line. Returns { location: string, score: number|null, moves: number|null }. */
    getStatus() { /* spike */ }
    /** True once a story is loaded and runnable. */
    get loaded() { /* spike */ }
}
```

- [ ] **Step 1: Create the manifest**

`manifest.json`:
```json
{
    "display_name": "ST_IF — Interactive Fiction",
    "loading_order": 50,
    "requires": [],
    "optional": [],
    "js": "index.js",
    "css": "style.css",
    "author": "emanuellonnberg",
    "version": "0.1.0",
    "homePage": "https://github.com/emanuellonnberg/ST_IF",
    "generate_interceptor": "ST_IF_interceptor"
}
```

- [ ] **Step 2: Create a minimal `index.js` + `style.css` so the extension loads**

`index.js`:
```javascript
// Minimal bootstrap — replaced/extended in later tasks.
globalThis.ST_IF_interceptor = async function (chat, _contextSize, _abort, _type) {
    // No-op until the pipeline is wired (Task 7).
};

jQuery(() => {
    console.log('[ST_IF] loaded');
});
```

`style.css`:
```css
/* ST_IF settings panel — filled in Task 6 */
```

- [ ] **Step 3: Verify the extension loads in SillyTavern**

Run: start SillyTavern (`npm start`), open it in the browser, open the Extensions panel, confirm "ST_IF — Interactive Fiction" appears in the installed list and the console prints `[ST_IF] loaded` with no errors.
Expected: extension listed, no console errors. (This is the only way to verify manifest wiring — it requires the ST runtime.)

- [ ] **Step 4: Vendor ifvms ZVM + add a headless Glk shim into `lib/`**

Obtain the ZVM build (`npm pack ifvms` or copy `dist/zvm.js` from the repo) into `lib/zvm.js`. Add a `lib/headless-glk.js` shim that implements the Glk surface ZVM calls, capturing all `glk_put_*` text into an internal string buffer and supplying queued line input on `glk_select`. Pin the exact required Glk method set by reading which Glk functions ZVM invokes in the repo source.

- [ ] **Step 5: Add the integration test fixture**

Place a tiny compiled story at `test/fixtures/tiny.z5`. Use any small public-domain Z5 (e.g. a 6-line Inform 7 test story compiled to Z5, or a known minimal story). Note its known intro text and a known room name for the assertions in Step 6. The expected substrings in the test are data tied to *this* chosen story — set them to match it.

- [ ] **Step 6: Write the failing integration test against the `vm.js` interface**

`test/vm.integration.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IFVM } from '../vm.js';

const story = new Uint8Array(readFileSync(new URL('./fixtures/tiny.z5', import.meta.url)));

test('loads and produces intro text', async () => {
    const vm = new IFVM();
    await vm.load(story);
    assert.equal(vm.loaded, true);
    const intro = vm.step('look');
    assert.equal(typeof intro, 'string');
    assert.ok(intro.length > 0, 'look should produce text');
});

test('status line is readable', async () => {
    const vm = new IFVM();
    await vm.load(story);
    vm.step('look');
    const status = vm.getStatus();
    assert.equal(typeof status.location, 'string');
    assert.ok(status.location.length > 0);
    assert.ok('score' in status && 'moves' in status);
});

test('save/restore round-trips state', async () => {
    const vm = new IFVM();
    await vm.load(story);
    vm.step('look');
    const snap = vm.save();
    const after1 = vm.step('wait');
    const vm2 = new IFVM();
    await vm2.load(story);
    vm2.restore(snap);
    const after2 = vm2.step('wait');
    assert.equal(after2, after1, 'restored VM must reproduce identical next-step output');
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/vm.integration.test.js`
Expected: FAIL — `vm.js` methods are unimplemented stubs.

- [ ] **Step 8: Implement `vm.js` against ifvms until the test passes**

Wire `IFVM` to `lib/zvm.js` + `lib/headless-glk.js`: `load` calls ZVM `prepare(bytes, {Glk: headlessGlk, ...})` + `start()` and drains output; `step` queues the command line, resumes the VM, returns the newly buffered text; `save`/`restore` use ZVM's Quetzal save/restore to/from base64; `getStatus` reads the status-window state the shim captured. Pin exact calls from the repo source during this step.

- [ ] **Step 9: Run the test to verify it passes**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/vm.integration.test.js`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add public/scripts/extensions/third-party/ST_IF
git commit -m "feat(ST_IF): extension skeleton + ifvms ZVM wrapper with headless Glk"
```

---

## Task 2: Canon block assembly (`canon.js`)

Pure string assembly. No dependencies. Fully unit-tested.

**Files:**
- Create: `public/scripts/extensions/third-party/ST_IF/canon.js`
- Create: `public/scripts/extensions/third-party/ST_IF/test/canon.test.js`

- [ ] **Step 1: Write the failing test**

`test/canon.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonBlock } from '../canon.js';

test('action turn includes result and status', () => {
    const block = buildCanonBlock({
        outputs: ['You take the brass lantern.', 'You head north. A dark cave.'],
        status: { location: 'Dark Cave', score: 5, moves: 12 },
        ranCommands: true,
        injectStateOnRp: false,
    });
    assert.match(block, /ground truth/i);
    assert.match(block, /You take the brass lantern\./);
    assert.match(block, /You head north\. A dark cave\./);
    assert.match(block, /Dark Cave/);
    assert.match(block, /5/);
    assert.match(block, /12/);
});

test('pure-RP turn with injectStateOnRp=false returns empty string', () => {
    const block = buildCanonBlock({
        outputs: [],
        status: { location: 'Dark Cave', score: 5, moves: 12 },
        ranCommands: false,
        injectStateOnRp: false,
    });
    assert.equal(block, '');
});

test('pure-RP turn with injectStateOnRp=true returns status-only block', () => {
    const block = buildCanonBlock({
        outputs: [],
        status: { location: 'Dark Cave', score: 5, moves: 12 },
        ranCommands: false,
        injectStateOnRp: true,
    });
    assert.match(block, /Dark Cave/);
    assert.doesNotMatch(block, /Action result/i);
});

test('null score/moves are omitted gracefully', () => {
    const block = buildCanonBlock({
        outputs: ['You wait.'],
        status: { location: 'Foyer', score: null, moves: null },
        ranCommands: true,
        injectStateOnRp: false,
    });
    assert.match(block, /Foyer/);
    assert.doesNotMatch(block, /Score:/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/canon.test.js`
Expected: FAIL with "buildCanonBlock is not a function" / module not found.

- [ ] **Step 3: Implement `canon.js`**

```javascript
// canon.js — pure assembly of the canon block injected into the prompt. No ST imports.

function statusLine(status) {
    const parts = [`Location: ${status.location}.`];
    if (status.score !== null && status.score !== undefined) parts.push(`Score: ${status.score}.`);
    if (status.moves !== null && status.moves !== undefined) parts.push(`Moves: ${status.moves}.`);
    return parts.join('  ');
}

/**
 * @param {{outputs: string[], status: {location:string, score:number|null, moves:number|null}, ranCommands: boolean, injectStateOnRp: boolean}} args
 * @returns {string} canon block, or '' when nothing should be injected
 */
export function buildCanonBlock({ outputs, status, ranCommands, injectStateOnRp }) {
    if (!ranCommands) {
        if (!injectStateOnRp) return '';
        return `[GAME STATE — ground truth, do not contradict]\n${statusLine(status)}`;
    }
    const result = outputs.join('\n').trim();
    return [
        '[GAME — ground truth, narrate in character, never contradict]',
        `Action result: ${result}`,
        statusLine(status),
    ].join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/canon.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/third-party/ST_IF/canon.js public/scripts/extensions/third-party/ST_IF/test/canon.test.js
git commit -m "feat(ST_IF): canon block assembly"
```

---

## Task 3: Prose→command translator (`translator.js`)

Pure. The `generate` function (wrapping `generateQuietPrompt`) is injected so it tests without the ST runtime.

**Files:**
- Create: `public/scripts/extensions/third-party/ST_IF/translator.js`
- Create: `public/scripts/extensions/third-party/ST_IF/test/translator.test.js`

- [ ] **Step 1: Write the failing test**

`test/translator.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranslatePrompt, translate } from '../translator.js';

const status = { location: 'Forest Path', score: 0, moves: 3 };

test('prompt includes player text, status, and strictness instruction', () => {
    const p = buildTranslatePrompt('I grab the lantern and creep north', status, 'strict');
    assert.match(p, /I grab the lantern and creep north/);
    assert.match(p, /Forest Path/);
    assert.match(p, /JSON array/i);
});

test('parses a clean JSON array of commands', async () => {
    const fakeGenerate = async () => '["take lantern", "north"]';
    const cmds = await translate('whatever', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, ['take lantern', 'north']);
});

test('returns [] for pure-RP (model emits empty array)', async () => {
    const fakeGenerate = async () => '[]';
    const cmds = await translate('I smile and ask for rumors', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, []);
});

test('fails open to [] on non-JSON garbage', async () => {
    const fakeGenerate = async () => 'Sure! Here are the commands: take lantern';
    const cmds = await translate('x', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, []);
});

test('extracts array even when wrapped in prose/code fence', async () => {
    const fakeGenerate = async () => 'Here you go:\n```json\n["look"]\n```';
    const cmds = await translate('x', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, ['look']);
});

test('caps command list at 4', async () => {
    const fakeGenerate = async () => '["a","b","c","d","e","f"]';
    const cmds = await translate('x', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, ['a', 'b', 'c', 'd']);
});

test('drops non-string / empty entries', async () => {
    const fakeGenerate = async () => '["take lantern", 42, "", "  ", "north"]';
    const cmds = await translate('x', status, 'strict', fakeGenerate);
    assert.deepEqual(cmds, ['take lantern', 'north']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/translator.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `translator.js`**

```javascript
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
        'Respond with ONLY a JSON array of short imperative parser commands (e.g. ["take lantern","north"]). No prose, no explanation. Empty array if no world-action.',
        '',
        `Player message: ${playerText}`,
    ].join('\n');
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/translator.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/third-party/ST_IF/translator.js public/scripts/extensions/third-party/ST_IF/test/translator.test.js
git commit -m "feat(ST_IF): prose-to-command translator with fail-open parsing"
```

---

## Task 4: Per-chat state + snapshot history (`state.js`)

Pure. Operates on a plain `metadata` object (the real one is `getContext().chatMetadata`, injected by `index.js`). Manages the canonical VM snapshot plus a per-message-index snapshot history for `/if-rewind`.

**Files:**
- Create: `public/scripts/extensions/third-party/ST_IF/state.js`
- Create: `public/scripts/extensions/third-party/ST_IF/test/state.test.js`

- [ ] **Step 1: Write the failing test**

`test/state.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readState, initState, recordTurn, rewindTo, getActiveSnapshot, HISTORY_CAP } from '../state.js';

test('initState seeds an empty game record', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    const s = readState(md);
    assert.equal(s.storyId, 'tiny.z5');
    assert.equal(s.snapshot, 'SNAP0');
    assert.deepEqual(s.history, []);
});

test('recordTurn updates canonical snapshot and appends history keyed by msg index', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    recordTurn(md, { msgIndex: 4, snapBefore: 'SNAP0', snapshot: 'SNAP1', summary: { location: 'Cave' }, cmds: ['north'] });
    const s = readState(md);
    assert.equal(s.snapshot, 'SNAP1');
    assert.equal(s.summary.location, 'Cave');
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].msgIndex, 4);
    assert.equal(s.history[0].snapBefore, 'SNAP0');
    assert.deepEqual(s.history[0].cmds, ['north']);
});

test('getActiveSnapshot returns latest canonical snapshot', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    recordTurn(md, { msgIndex: 4, snapBefore: 'SNAP0', snapshot: 'SNAP1', summary: {}, cmds: [] });
    assert.equal(getActiveSnapshot(md), 'SNAP1');
});

test('rewindTo restores the snapBefore of the target msg index and truncates later history', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    recordTurn(md, { msgIndex: 4, snapBefore: 'SNAP0', snapshot: 'SNAP1', summary: {}, cmds: ['north'] });
    recordTurn(md, { msgIndex: 6, snapBefore: 'SNAP1', snapshot: 'SNAP2', summary: {}, cmds: ['take key'] });
    const restored = rewindTo(md, 6);
    assert.equal(restored, 'SNAP1', 'rewinding turn at msg 6 returns its snapBefore');
    assert.equal(getActiveSnapshot(md), 'SNAP1');
    assert.equal(readState(md).history.length, 1, 'history after msg 6 is dropped');
});

test('rewindTo returns null for unknown msg index', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    assert.equal(rewindTo(md, 99), null);
});

test('history is capped at HISTORY_CAP, dropping oldest', () => {
    const md = {};
    initState(md, 'tiny.z5', 'SNAP0');
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
        recordTurn(md, { msgIndex: i, snapBefore: `S${i}`, snapshot: `S${i + 1}`, summary: {}, cmds: [] });
    }
    const s = readState(md);
    assert.equal(s.history.length, HISTORY_CAP);
    assert.equal(s.history[0].msgIndex, 5, 'oldest entries dropped');
});

test('readState returns null when no game initialized', () => {
    assert.equal(readState({}), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/state.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `state.js`**

```javascript
// state.js — per-chat game state in chatMetadata. Pure: operates on a plain metadata object.

export const KEY = 'ST_IF';
export const HISTORY_CAP = 50;

export function readState(metadata) {
    return metadata[KEY] ?? null;
}

export function initState(metadata, storyId, snapshot) {
    metadata[KEY] = { storyId, snapshot, summary: null, history: [] };
    return metadata[KEY];
}

/**
 * @param {object} metadata
 * @param {{msgIndex:number, snapBefore:string, snapshot:string, summary:object, cmds:string[]}} turn
 */
export function recordTurn(metadata, turn) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.snapshot = turn.snapshot;
    s.summary = turn.summary;
    s.history.push({
        msgIndex: turn.msgIndex,
        snapBefore: turn.snapBefore,
        cmds: turn.cmds,
    });
    if (s.history.length > HISTORY_CAP) {
        s.history.splice(0, s.history.length - HISTORY_CAP);
    }
}

export function getActiveSnapshot(metadata) {
    return metadata[KEY]?.snapshot ?? null;
}

/**
 * Restore to the state *before* the turn at msgIndex; drop that turn and all later ones.
 * @returns {string|null} the restored snapshot, or null if msgIndex unknown.
 */
export function rewindTo(metadata, msgIndex) {
    const s = metadata[KEY];
    if (!s) return null;
    const idx = s.history.findIndex((h) => h.msgIndex === msgIndex);
    if (idx === -1) return null;
    const snap = s.history[idx].snapBefore;
    s.history.splice(idx);
    s.snapshot = snap;
    return snap;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/state.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/third-party/ST_IF/state.js public/scripts/extensions/third-party/ST_IF/test/state.test.js
git commit -m "feat(ST_IF): per-chat state and snapshot history"
```

---

## Task 5: Turn orchestration (`turn.js`)

The heart of the pipeline, kept pure by injecting all ST/VM dependencies via a `deps` object. This is what `index.js`'s interceptor calls. Covers guards, the action/RP/swipe branches, VM stepping, persistence, and canon assembly.

**Files:**
- Create: `public/scripts/extensions/third-party/ST_IF/turn.js`
- Create: `public/scripts/extensions/third-party/ST_IF/test/turn.test.js`

**`deps` contract (provided by `index.js` in Task 7):**
```
deps = {
  vm,                       // IFVM instance (loaded)
  metadata,                 // chatMetadata object
  translate: (text, status, strictness) => Promise<string[]>,  // translator bound to generateQuietPrompt
  setPrompt: (block) => void,   // wraps setExtensionPrompt(KEY, block, IN_CHAT, depth, SYSTEM)
  clearPrompt: () => void,      // setExtensionPrompt(KEY, '', NONE, 0)
  save: () => void,             // saveMetadataDebounced
  settings: { strictness, injectStateOnRp },
}
```

- [ ] **Step 1: Write the failing test**

`test/turn.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../turn.js';
import { initState, readState } from '../state.js';

function makeVM() {
    return {
        loaded: true,
        _snap: 'SNAP0',
        steps: [],
        step(cmd) { this.steps.push(cmd); return `did ${cmd}`; },
        save() { return this._snap; },
        restore(s) { this._snap = s; },
        getStatus() { return { location: 'Cave', score: 1, moves: 2 }; },
    };
}

function makeDeps(overrides = {}) {
    const metadata = {};
    initState(metadata, 'tiny.z5', 'SNAP0');
    const calls = { setPrompt: [], clearPrompt: 0, save: 0 };
    return {
        vm: makeVM(),
        metadata,
        translate: async () => ['north'],
        setPrompt: (b) => calls.setPrompt.push(b),
        clearPrompt: () => { calls.clearPrompt++; },
        save: () => { calls.save++; },
        settings: { strictness: 'strict', injectStateOnRp: false },
        _calls: calls,
        ...overrides,
    };
}

test('guard: skips quiet generations, clears any stale prompt', async () => {
    const deps = makeDeps();
    const chat = [{ is_user: true, mes: 'go north' }];
    await runTurn(deps, chat, 'quiet');
    assert.equal(deps._calls.setPrompt.length, 0);
    assert.equal(deps._calls.clearPrompt, 1);
    assert.deepEqual(deps.vm.steps, []);
});

test('guard: skips when last message is not from user', async () => {
    const deps = makeDeps();
    const chat = [{ is_user: false, mes: 'narrator text' }];
    await runTurn(deps, chat, 'normal');
    assert.deepEqual(deps.vm.steps, []);
});

test('guard: skips when no game loaded for this chat', async () => {
    const deps = makeDeps({ metadata: {} }); // no ST_IF key
    const chat = [{ is_user: true, mes: 'go north' }];
    await runTurn(deps, chat, 'normal');
    assert.deepEqual(deps.vm.steps, []);
});

test('action turn: steps VM, injects canon, persists, records history', async () => {
    const deps = makeDeps();
    const chat = [{ is_user: true, mes: 'I creep north' }];
    await runTurn(deps, chat, 'normal');
    assert.deepEqual(deps.vm.steps, ['north']);
    assert.equal(deps._calls.setPrompt.length, 1);
    assert.match(deps._calls.setPrompt[0], /did north/);
    assert.match(deps._calls.setPrompt[0], /Cave/);
    assert.equal(deps._calls.save, 1);
    const s = readState(deps.metadata);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].msgIndex, 0);
    assert.equal(s.history[0].snapBefore, 'SNAP0');
});

test('pure-RP turn: no VM step, no canon when injectStateOnRp=false', async () => {
    const deps = makeDeps({ translate: async () => [] });
    const chat = [{ is_user: true, mes: 'I smile warmly' }];
    await runTurn(deps, chat, 'normal');
    assert.deepEqual(deps.vm.steps, []);
    assert.equal(deps._calls.setPrompt.length, 0);
    assert.equal(deps._calls.clearPrompt, 1);
});

test('pure-RP turn: injects status-only canon when injectStateOnRp=true', async () => {
    const deps = makeDeps({ translate: async () => [], settings: { strictness: 'strict', injectStateOnRp: true } });
    const chat = [{ is_user: true, mes: 'I look around idly' }];
    await runTurn(deps, chat, 'normal');
    assert.equal(deps._calls.setPrompt.length, 1);
    assert.match(deps._calls.setPrompt[0], /Cave/);
});

test('swipe: reuses cached cmds, does NOT re-step or re-translate', async () => {
    const deps = makeDeps();
    const chat = [{ is_user: true, mes: 'I creep north' }];
    await runTurn(deps, chat, 'normal');           // first pass: steps 'north'
    deps.translate = async () => { throw new Error('must not translate on swipe'); };
    await runTurn(deps, chat, 'swipe');            // swipe: reuse
    assert.deepEqual(deps.vm.steps, ['north'], 'VM not stepped again');
    assert.equal(deps._calls.setPrompt.length, 2, 'canon re-injected on swipe');
    assert.match(deps._calls.setPrompt[1], /did north/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/turn.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `turn.js`**

```javascript
// turn.js — orchestrate one chat turn. Pure: all ST/VM deps injected.
import { readState, recordTurn, getActiveSnapshot } from './state.js';
import { translate as translateDefault } from './translator.js';
import { buildCanonBlock } from './canon.js';

const SKIP_TYPES = new Set(['quiet', 'impersonate']);

function lastUserMessage(chat) {
    const last = chat[chat.length - 1];
    if (!last || !last.is_user) return null;
    return { text: last.mes ?? '', index: chat.length - 1 };
}

/**
 * @param {object} deps  see deps contract in the plan
 * @param {Array} chat   live chat array
 * @param {string} type  generation type
 */
export async function runTurn(deps, chat, type) {
    const { vm, metadata, setPrompt, clearPrompt, save, settings } = deps;
    const translate = deps.translate ?? ((t, s, str) => translateDefault(t, s, str, deps.generate));

    // 1. GUARDS — always clear stale injection so a skipped turn can't leak last turn's canon.
    clearPrompt();
    if (SKIP_TYPES.has(type)) return;
    if (!vm?.loaded) return;
    if (!readState(metadata)) return;
    const player = lastUserMessage(chat);
    if (!player) return;

    const state = readState(metadata);
    const lastTurn = state.history[state.history.length - 1];

    // 2. SWIPE / regen on the same message → reuse cached commands, do not re-step.
    if ((type === 'swipe' || type === 'regenerate') && lastTurn && lastTurn.msgIndex === player.index) {
        const status = vm.getStatus();
        const block = buildCanonBlock({
            outputs: lastTurn.outputs ?? [],
            status,
            ranCommands: (lastTurn.cmds ?? []).length > 0,
            injectStateOnRp: settings.injectStateOnRp,
        });
        if (block) setPrompt(block);
        return;
    }

    // 3. SNAPSHOT before stepping (swipe-safety / rewind anchor).
    const snapBefore = getActiveSnapshot(metadata) ?? vm.save();

    // 4. TRANSLATE.
    const statusForPrompt = vm.getStatus();
    const cmds = await translate(player.text, statusForPrompt, settings.strictness);

    // 5. STEP VM.
    const outputs = [];
    for (const cmd of cmds) outputs.push(vm.step(cmd));
    const status = vm.getStatus();

    // 6. PERSIST canonical snapshot + history (store outputs for swipe reuse).
    const snapshot = vm.save();
    recordTurn(metadata, {
        msgIndex: player.index,
        snapBefore,
        snapshot,
        summary: status,
        cmds,
    });
    // recordTurn keeps cmds; stash outputs on the same history entry for swipe reuse.
    const justAdded = readState(metadata).history.slice(-1)[0];
    justAdded.outputs = outputs;
    save();

    // 7. INJECT canon.
    const block = buildCanonBlock({
        outputs,
        status,
        ranCommands: cmds.length > 0,
        injectStateOnRp: settings.injectStateOnRp,
    });
    if (block) setPrompt(block);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/turn.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full unit suite**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/`
Expected: PASS — canon, translator, state, turn, and vm.integration all green.

- [ ] **Step 6: Commit**

```bash
git add public/scripts/extensions/third-party/ST_IF/turn.js public/scripts/extensions/third-party/ST_IF/test/turn.test.js
git commit -m "feat(ST_IF): turn orchestration with guards, swipe reuse, persistence"
```

---

## Task 6: Settings + story upload (`settings.js`, `settings.html`)

ST-runtime-coupled. Verified manually in-app (no node test — touches `extension_settings`, jQuery, DOM).

**Files:**
- Create: `public/scripts/extensions/third-party/ST_IF/settings.js`
- Create: `public/scripts/extensions/third-party/ST_IF/settings.html`
- Modify: `public/scripts/extensions/third-party/ST_IF/style.css`

- [ ] **Step 1: Create the settings template**

`settings.html`:
```html
<div class="ST_IF_settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Interactive Fiction (ST_IF)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label">
                <input id="st_if_enabled" type="checkbox" />
                <span>Enable for this session</span>
            </label>

            <label class="checkbox_label">
                <input id="st_if_inject_rp" type="checkbox" />
                <span>Inject game state on pure roleplay turns</span>
            </label>

            <label for="st_if_strictness">Translator strictness</label>
            <select id="st_if_strictness" class="text_pole">
                <option value="strict">Strict (only clear actions)</option>
                <option value="loose">Loose (more verbs)</option>
            </select>

            <label for="st_if_depth">Canon injection depth</label>
            <input id="st_if_depth" type="number" min="0" max="10" class="text_pole" />

            <hr />
            <div>Story file (.z5 / .z8): <span id="st_if_story_name">none loaded</span></div>
            <input id="st_if_story_file" type="file" hidden accept=".z5,.z8,.z3" />
            <div id="st_if_story_upload" class="menu_button">Load story file</div>
        </div>
    </div>
</div>
```

- [ ] **Step 2: Implement `settings.js`**

```javascript
// settings.js — extension_settings.ST_IF defaults, UI wiring, story upload to base64.
import { extension_settings } from '../../extensions.js';
import { saveSettingsDebounced } from '../../../script.js';

export const MODULE = 'ST_IF';

export const defaultSettings = {
    enabled: false,
    injectStateOnRp: false,
    strictness: 'strict',
    depth: 1,
    storyName: '',
    storyBase64: '',   // the .z5/.z8 bytes, base64
};

export function getSettings() {
    return extension_settings[MODULE];
}

export function loadSettings() {
    extension_settings[MODULE] = extension_settings[MODULE] ?? {};
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings[MODULE][key] === undefined) {
            extension_settings[MODULE][key] = defaultSettings[key];
        }
    }
}

function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

export function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * @param {(name:string, bytes:Uint8Array)=>Promise<void>} onStoryLoaded called after a new story file is selected
 */
export function wireSettingsUI(onStoryLoaded) {
    const s = getSettings();

    $('#st_if_enabled').prop('checked', s.enabled).on('change', function () {
        s.enabled = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_inject_rp').prop('checked', s.injectStateOnRp).on('change', function () {
        s.injectStateOnRp = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_strictness').val(s.strictness).on('change', function () {
        s.strictness = String($(this).val()); saveSettingsDebounced();
    });
    $('#st_if_depth').val(s.depth).on('input', function () {
        s.depth = Number($(this).val()); saveSettingsDebounced();
    });
    $('#st_if_story_name').text(s.storyName || 'none loaded');

    $('#st_if_story_upload').on('click', () => $('#st_if_story_file').trigger('click'));
    $('#st_if_story_file').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        const bytes = new Uint8Array(await file.arrayBuffer());
        s.storyName = file.name;
        s.storyBase64 = bytesToBase64(bytes);
        saveSettingsDebounced();
        $('#st_if_story_name').text(s.storyName);
        await onStoryLoaded(file.name, bytes);
        this.value = '';
    });
}
```

- [ ] **Step 3: Add panel styling**

Append to `style.css`:
```css
.ST_IF_settings .inline-drawer-content { display: flex; flex-direction: column; gap: 8px; }
.ST_IF_settings #st_if_story_name { opacity: 0.8; }
```

- [ ] **Step 4: Manual verification (requires ST runtime)**

Run: `npm start`, open ST, open the Extensions panel.
Verify: the "Interactive Fiction (ST_IF)" drawer renders; toggling each control persists across a page reload (settings saved); clicking "Load story file" opens a file picker; selecting a `.z5` updates the filename label and persists after reload.
Expected: all controls present and persistent; no console errors.

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/third-party/ST_IF/settings.js public/scripts/extensions/third-party/ST_IF/settings.html public/scripts/extensions/third-party/ST_IF/style.css
git commit -m "feat(ST_IF): settings panel and story-file upload"
```

---

## Task 7: Wire it all together (`index.js`) + slash commands

Replaces the Task 1 stub. Imports the ST runtime, builds `deps`, exposes the global interceptor, loads the story on init / chat change, and registers slash commands.

**Files:**
- Modify: `public/scripts/extensions/third-party/ST_IF/index.js`

- [ ] **Step 1: Implement the full `index.js`**

```javascript
import {
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles,
    generateQuietPrompt, eventSource, event_types, saveMetadataDebounced,
} from '../../../script.js';
import { getContext, renderExtensionTemplateAsync } from '../../extensions.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../slash-commands/SlashCommandArgument.js';

import { IFVM } from './vm.js';
import { translate } from './translator.js';
import { runTurn } from './turn.js';
import { readState, initState, getActiveSnapshot, rewindTo, KEY } from './state.js';
import { loadSettings, getSettings, wireSettingsUI, base64ToBytes } from './settings.js';

const vm = new IFVM();

function buildDeps() {
    const ctx = getContext();
    const s = getSettings();
    return {
        vm,
        metadata: ctx.chatMetadata,
        translate: (text, status, strictness) =>
            translate(text, status, strictness, (prompt) =>
                generateQuietPrompt({ quietPrompt: prompt, responseLength: 80, skipWIAN: true })),
        setPrompt: (block) =>
            setExtensionPrompt(KEY, block, extension_prompt_types.IN_CHAT, s.depth, false, extension_prompt_roles.SYSTEM),
        clearPrompt: () =>
            setExtensionPrompt(KEY, '', extension_prompt_types.NONE, 0),
        save: () => saveMetadataDebounced(),
        settings: { strictness: s.strictness, injectStateOnRp: s.injectStateOnRp },
    };
}

// The generation interceptor — must be global, matched by manifest "generate_interceptor".
globalThis.ST_IF_interceptor = async function (chat, _contextSize, _abort, type) {
    const s = getSettings();
    if (!s.enabled) return;
    try {
        await runTurn(buildDeps(), chat, type);
    } catch (e) {
        console.error('[ST_IF] interceptor error', e);
    }
};

/** Load the configured story into the VM and seed per-chat state if absent. */
async function ensureStoryLoaded() {
    const s = getSettings();
    if (!s.storyBase64) return;
    if (!vm.loaded) await vm.load(base64ToBytes(s.storyBase64));
    const ctx = getContext();
    if (!readState(ctx.chatMetadata)) {
        initState(ctx.chatMetadata, s.storyName, vm.save());
        saveMetadataDebounced();
    } else {
        // Resume: restore the canonical snapshot for this chat.
        const snap = getActiveSnapshot(ctx.chatMetadata);
        if (snap) vm.restore(snap);
    }
}

function registerSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-cmd',
        helpString: 'Send a raw parser command directly to the IF VM (bypasses the translator).',
        unnamedArgumentList: [new SlashCommandArgument('parser command', [ARGUMENT_TYPE.STRING], true, false, '')],
        returns: ARGUMENT_TYPE.STRING,
        callback: async (_args, value) => {
            if (!vm.loaded) return 'No story loaded.';
            const out = vm.step(String(value));
            const ctx = getContext();
            initOrUpdateAfterRaw(ctx, out);
            return out;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-state',
        helpString: 'Show the current IF game status line.',
        returns: ARGUMENT_TYPE.STRING,
        callback: async () => {
            if (!vm.loaded) return 'No story loaded.';
            const st = vm.getStatus();
            return `Location: ${st.location} | Score: ${st.score} | Moves: ${st.moves}`;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-rewind',
        helpString: 'Rewind the IF game to before the action at the given message index.',
        unnamedArgumentList: [new SlashCommandArgument('message index', [ARGUMENT_TYPE.NUMBER], true, false, '')],
        returns: ARGUMENT_TYPE.STRING,
        callback: async (_args, value) => {
            const ctx = getContext();
            const snap = rewindTo(ctx.chatMetadata, Number(value));
            if (!snap) return `No game turn recorded at message ${value}.`;
            vm.restore(snap);
            saveMetadataDebounced();
            return `Rewound to before message ${value}.`;
        },
    }));
}

function initOrUpdateAfterRaw(ctx, _out) {
    // /if-cmd advances the VM outside the turn pipeline; persist the new canonical snapshot.
    const s = readState(ctx.chatMetadata);
    if (s) { s.snapshot = vm.save(); s.summary = vm.getStatus(); saveMetadataDebounced(); }
}

jQuery(async () => {
    const html = await renderExtensionTemplateAsync('third-party/ST_IF', 'settings');
    $('#extensions_settings2').append(html);
    loadSettings();
    wireSettingsUI(async (name) => {
        // New story chosen: reset VM + state for the current chat.
        const ctx = getContext();
        const s = getSettings();
        await vm.load(base64ToBytes(s.storyBase64));
        initState(ctx.chatMetadata, name, vm.save());
        saveMetadataDebounced();
    });
    registerSlashCommands();
    eventSource.on(event_types.CHAT_CHANGED, ensureStoryLoaded);
    await ensureStoryLoaded();
    console.log('[ST_IF] ready');
});
```

- [ ] **Step 2: Lint the extension**

Run: `npx eslint "public/scripts/extensions/third-party/ST_IF/**/*.js"`
Expected: no errors. Fix any reported issues (the repo's ESLint config governs style).

- [ ] **Step 3: Manual end-to-end verification (requires ST runtime)**

Run: `npm start`, open ST, load a `.z5` via the panel, enable the extension, start a chat with any character.
Verify, using the matrix from the spec:
1. Type an action ("I pick up the lamp and go north") → the narrator's reply reflects the VM result and status; `/if-state` shows updated location/moves.
2. Type pure RP ("I smile and ask about the weather") → normal reply, `/if-state` location unchanged, moves unchanged.
3. Type a blocked action ("I open the locked door") → narrator honors the VM refusal.
4. Swipe an action reply → game state does not double-advance (`/if-state` moves unchanged across swipes of the same turn).
5. Reload the page mid-game → state resumes (status line unchanged).
6. `/if-rewind <index>` → status line returns to the earlier turn.
Expected: all six behave as described; no console errors.

- [ ] **Step 4: Commit**

```bash
git add public/scripts/extensions/third-party/ST_IF/index.js
git commit -m "feat(ST_IF): wire interceptor, story loading, and slash commands"
```

---

## Task 8: README + final pass

**Files:**
- Create: `public/scripts/extensions/third-party/ST_IF/README.md`

- [ ] **Step 1: Write the README**

Document: what the extension does, install path, how to obtain/load a `.z5`/`.z8` story, the settings, the three slash commands, the v1 limitations (VM-is-law, no auto exits/inventory, manual rewind), and a pointer to the design spec.

- [ ] **Step 2: Run the full unit suite once more**

Run: `node --test public/scripts/extensions/third-party/ST_IF/test/`
Expected: PASS — all suites green.

- [ ] **Step 3: Lint the whole extension**

Run: `npx eslint "public/scripts/extensions/third-party/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/scripts/extensions/third-party/ST_IF/README.md
git commit -m "docs(ST_IF): add extension README"
```

---

## Verification summary

- **Unit-tested (node --test, no runtime):** `canon.js`, `translator.js`, `state.js`, `turn.js` — the entire decision pipeline (guards, action/RP/swipe branches, persistence, canon assembly, rewind).
- **Integration-tested:** `vm.js` against a real `.z5` (load, step, status, save/restore round-trip).
- **Manually verified (needs ST runtime):** manifest load, settings panel + persistence, story upload, the six end-to-end behaviors, slash commands.

## Spike findings (2026-06-09) and execution reorder

Investigated ifvms 1.1.6 during Task 1. Findings:

- **ifvms is MIT licensed** (source headers + README), not GPL. The spec's licensing concern was wrong — vendoring is unrestricted.
- **Clean snapshot API exists:** `do_autosave(save)` builds a plain state object `{glk: Glk.save_allstate(), io, ram, read_data, xorshift_seed}` and hands it to `Dialog.autosave_write(signature, snapshot)`; `do_autorestore(snapshot)` reverses it. So `vm.save()`/`vm.restore()` are feasible via a custom in-memory Dialog.
- **The hard part:** ZVM renders no text itself — it drives a full Glk (glkapi) → GlkOte display + Dialog. The reference runner uses `glkote-term`, which is **node-only** (`fs`/`readline`/stdout) and cannot run in the browser. A client-side wrapper therefore needs a vendored browser-compatible `glkapi.js` + a custom headless GlkOte (~200 lines) + a Dialog stub. This is a sub-project, not a bite-sized step.

**Decisions (user, 2026-06-09):**
1. **Reorder execution:** implement Tasks 2-6 (pure, unit-testable modules) first against the defined `vm.js` interface; `vm.js` stays a stub. Then tackle the Glk harness as an isolated spike (Task 1 Steps 4-9).
2. **VM location decided during harness build:** start the harness as shared pure-JS (node + browser); if bundling `glkapi.js` for the browser proves painful, fall back to a server-side ST plugin exposing step/status/save over an endpoint.

Execution order is now: Task 1 skeleton + `vm.js` stub → Tasks 2,3,4,5,6 → Glk harness spike (Task 1 Steps 4-9) → Task 7 → Task 8.

## Open items carried from the spec

- ~~Install path~~ RESOLVED: `public/scripts/extensions/ST_IF/` (committable, auto-discovered).
- Pin the exact ifvms ZVM + headless Glk wiring during the Glk harness spike (deferred per reorder above).
- Post-v1 (explicitly out of scope here): LLM adjudication of VM failures, retry-translation, auto-sync on edit/delete, synthetic exits/inventory via auto `look`/`inventory`, Glulx, multi-game, map rendering.
