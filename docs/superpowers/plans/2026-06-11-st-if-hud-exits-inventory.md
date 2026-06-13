# ST_IF HUD: Exits + Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A toggleable HUD strip above the chat input showing location, exits (LLM-extracted + learned edges), and exact inventory — without touching the narrator prompt.

**Architecture:** `vm.query()` (save/step/restore, zero net effect) gives exact inventory. A new pure `exits.js` extracts exits from the cached room prose (one quiet LLM call per new room, cached on parse success) and merges them with map edges learned from real moves in `turn.js`. `index.js` renders the HUD after each turn. All pure logic DI'd and unit-tested per the extension's pattern.

**Tech Stack:** Same as ST_IF — vanilla ES modules, `node --test`, ESLint.

---

## File structure

All under `public/scripts/extensions/ST_IF/`.

| File | Change |
|------|--------|
| `vm.js` | `query(cmd)` — side-effect-free command round-trip |
| `clean.js` | `compactInventory(text)` — header-stripping + comma-joining |
| `exits.js` *(new, pure)* | `extractExits`, `mergeExits`, `formatExitsLine` |
| `state.js` | `inventoryText`, `exitsCache`, `mapEdges` accessors |
| `turn.js` | Per-step map-edge recording; inventory query + store after action turns |
| `index.js` | HUD render + collapse, extraction trigger, settings wiring |
| `settings.js` / `settings.html` / `style.css` | `showHud` toggle (default on) + HUD styles |

---

## Task 1: vm.js — `query(cmd)`

**Files:**
- Modify: `public/scripts/extensions/ST_IF/vm.js`
- Modify: `public/scripts/extensions/ST_IF/test/vm.integration.test.js`

- [ ] **Step 1: Write the failing integration test (append to `test/vm.integration.test.js`)**

```javascript
test('query runs a command with zero net game effect', async () => {
    const vm = new IFVM();
    await vm.load(zork);
    vm.step('open mailbox'); vm.step('take leaflet');
    const before = vm.getStatus();
    const inv = vm.query('inventory');
    assert.match(inv, /carrying|leaflet/i, 'returns the inventory answer');
    const after = vm.getStatus();
    assert.deepEqual(after, before, 'location/score/moves unchanged by the query');
    const next = vm.step('look');
    assert.match(next, /West of House/i, 'VM still playable after a query');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/vm.integration.test.js`
Expected: FAIL — `vm.query is not a function`.

- [ ] **Step 3: Implement `query` in `vm.js`** (after `step`)

```javascript
    /**
     * Run a command and roll the VM back: returns the command's output with zero
     * net game effect (the restore rewinds everything, move counter included).
     * Used for read-only queries like 'inventory'.
     */
    query(command) {
        if (!this._loaded) throw new Error('ST_IF: no story loaded');
        const snap = this.save();
        const out = this.step(command);
        this.restore(snap);
        return out;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/vm.integration.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/vm.js public/scripts/extensions/ST_IF/test/vm.integration.test.js
git commit -m "feat(ST_IF): side-effect-free vm.query via save/step/restore"
```

---

## Task 2: pure helpers — `compactInventory` + `exits.js`

**Files:**
- Modify: `public/scripts/extensions/ST_IF/clean.js`
- Create: `public/scripts/extensions/ST_IF/exits.js`
- Modify: `public/scripts/extensions/ST_IF/test/clean.test.js`
- Create: `public/scripts/extensions/ST_IF/test/exits.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/clean.test.js`:
```javascript
import { compactInventory } from '../clean.js';

test('compactInventory strips the header and joins items', () => {
    assert.equal(compactInventory('You are carrying:\n  a brass lantern\n  a sword'), 'a brass lantern, a sword');
});

test('compactInventory passes through single-line answers', () => {
    assert.equal(compactInventory('You are empty-handed.'), 'You are empty-handed.');
});

test('compactInventory handles empty/null', () => {
    assert.equal(compactInventory(''), '');
    assert.equal(compactInventory(null), '');
});
```

Create `test/exits.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExitsPrompt, extractExits, mergeExits, formatExitsLine } from '../exits.js';

const DESC = 'West of House\nYou are standing in an open field west of a white house. A path leads north, and the forest lies to the west.';

test('prompt includes the room prose and asks for JSON', () => {
    const p = buildExitsPrompt(DESC);
    assert.match(p, /open field/);
    assert.match(p, /JSON/i);
});

test('extractExits parses a clean JSON array', async () => {
    const gen = async () => '[{"dir":"north","label":"path"},{"dir":"west","label":"forest"}]';
    assert.deepEqual(await extractExits(DESC, gen), [
        { dir: 'north', label: 'path' },
        { dir: 'west', label: 'forest' },
    ]);
});

test('extractExits accepts entries without labels and normalizes dirs', async () => {
    const gen = async () => '[{"dir":"N"},{"dir":"South","label":""}]';
    assert.deepEqual(await extractExits(DESC, gen), [
        { dir: 'n', label: null },
        { dir: 'south', label: null },
    ]);
});

test('extractExits drops non-direction entries but keeps the rest', async () => {
    const gen = async () => '[{"dir":"north"},{"dir":"banana","label":"x"}]';
    assert.deepEqual(await extractExits(DESC, gen), [{ dir: 'north', label: null }]);
});

test('extractExits returns null (do not cache) on garbage or throw', async () => {
    assert.equal(await extractExits(DESC, async () => 'no json'), null);
    assert.equal(await extractExits(DESC, async () => { throw new Error('down'); }), null);
});

test('extractExits returns [] (cacheable) for a legitimate empty array', async () => {
    assert.deepEqual(await extractExits(DESC, async () => '[]'), []);
});

test('mergeExits enriches with learned destinations and appends unknown learned dirs', () => {
    const extracted = [{ dir: 'north', label: 'path' }, { dir: 'west', label: 'forest' }];
    const edges = { north: 'North of House', up: 'Attic' };
    assert.deepEqual(mergeExits(extracted, edges), [
        { dir: 'north', label: 'path', dest: 'North of House' },
        { dir: 'west', label: 'forest', dest: null },
        { dir: 'up', label: null, dest: 'Attic' },
    ]);
});

test('formatExitsLine renders labels, destinations, and visited marks', () => {
    const line = formatExitsLine([
        { dir: 'north', label: 'path', dest: 'North of House' },
        { dir: 'west', label: 'forest', dest: null },
        { dir: 'up', label: null, dest: 'Attic' },
    ]);
    assert.equal(line, 'north → North of House ✓, west (forest), up → Attic ✓');
});

test('formatExitsLine handles empty', () => {
    assert.equal(formatExitsLine([]), '');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test public/scripts/extensions/ST_IF/test/clean.test.js public/scripts/extensions/ST_IF/test/exits.test.js`
Expected: FAIL — `compactInventory` not exported; `exits.js` not found.

- [ ] **Step 3: Implement**

Append to `clean.js`:
```javascript
/**
 * Compact a Z-machine inventory answer for one-line display: drop the
 * "You are carrying:"-style header and join the item lines with commas.
 */
export function compactInventory(text) {
    const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) return lines[0] ?? '';
    const items = lines[0].endsWith(':') ? lines.slice(1) : lines;
    return items.join(', ');
}
```

Create `exits.js`:
```javascript
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test public/scripts/extensions/ST_IF/test/clean.test.js public/scripts/extensions/ST_IF/test/exits.test.js`
Expected: PASS (clean 10, exits 9).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/clean.js public/scripts/extensions/ST_IF/exits.js public/scripts/extensions/ST_IF/test/clean.test.js public/scripts/extensions/ST_IF/test/exits.test.js
git commit -m "feat(ST_IF): exits extraction/merge/format + inventory compaction helpers"
```

---

## Task 3: state.js — inventory, exits cache, map edges

**Files:**
- Modify: `public/scripts/extensions/ST_IF/state.js`
- Modify: `public/scripts/extensions/ST_IF/test/state.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/state.test.js`)**

```javascript
import { getInventoryText, setInventoryText, getExitsForRoom, setExitsForRoom, getEdgesForRoom, recordMapEdge } from '../state.js';

test('inventoryText round-trips and defaults to empty', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.equal(getInventoryText(md), '');
    setInventoryText(md, 'a lantern, a sword');
    assert.equal(getInventoryText(md), 'a lantern, a sword');
});

test('exits cache: unset room is undefined; set round-trips incl. empty array', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.equal(getExitsForRoom(md, 'Cave'), undefined);
    setExitsForRoom(md, 'Cave', [{ dir: 'north', label: null }]);
    assert.deepEqual(getExitsForRoom(md, 'Cave'), [{ dir: 'north', label: null }]);
    setExitsForRoom(md, 'Void', []);
    assert.deepEqual(getExitsForRoom(md, 'Void'), [], 'empty array is a cached success');
});

test('map edges record and read per room', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.deepEqual(getEdgesForRoom(md, 'Cave'), {});
    recordMapEdge(md, 'Cave', 'north', 'Hall');
    recordMapEdge(md, 'Cave', 'up', 'Attic');
    assert.deepEqual(getEdgesForRoom(md, 'Cave'), { north: 'Hall', up: 'Attic' });
});

test('hud accessors tolerate legacy state without the fields', () => {
    const md = { ST_IF: { storyId: 'x', snapshot: 'P', summary: null, history: [] } };
    assert.equal(getInventoryText(md), '');
    assert.equal(getExitsForRoom(md, 'Cave'), undefined);
    assert.deepEqual(getEdgesForRoom(md, 'Cave'), {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/state.test.js`
Expected: FAIL — accessors not exported.

- [ ] **Step 3: Implement in `state.js`** (append)

```javascript
export function getInventoryText(metadata) {
    return metadata[KEY]?.inventoryText ?? '';
}

export function setInventoryText(metadata, text) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.inventoryText = String(text ?? '');
}

export function getExitsForRoom(metadata, room) {
    return metadata[KEY]?.exitsCache?.[room];
}

export function setExitsForRoom(metadata, room, exits) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.exitsCache = s.exitsCache ?? {};
    s.exitsCache[room] = exits;
}

export function getEdgesForRoom(metadata, room) {
    return metadata[KEY]?.mapEdges?.[room] ?? {};
}

export function recordMapEdge(metadata, fromRoom, dir, toRoom) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.mapEdges = s.mapEdges ?? {};
    s.mapEdges[fromRoom] = s.mapEdges[fromRoom] ?? {};
    s.mapEdges[fromRoom][dir] = toRoom;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/state.test.js`
Expected: PASS (existing 17 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/state.js public/scripts/extensions/ST_IF/test/state.test.js
git commit -m "feat(ST_IF): inventory, exits-cache, and map-edge state accessors"
```

---

## Task 4: turn.js — edge recording + inventory capture

**Files:**
- Modify: `public/scripts/extensions/ST_IF/turn.js`
- Modify: `public/scripts/extensions/ST_IF/test/turn.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/turn.test.js`)**

```javascript
test('records map edges per step when moves change rooms', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'east'], vm: makeMovingVM() });
    await runTurn(deps, [{ is_user: true, mes: 'north then east' }], 'normal');
    const { getEdgesForRoom } = await import('../state.js');
    assert.deepEqual(getEdgesForRoom(deps.metadata, 'Start'), { north: 'north' });
    assert.deepEqual(getEdgesForRoom(deps.metadata, 'north'), { east: 'east' });
});

test('captures compacted inventory after an action turn when vm.query exists', async () => {
    const vm = makeMovingVM();
    vm.query = (cmd) => cmd === 'inventory' ? 'You are carrying:\n  a brass lantern\n  a sword' : '';
    const deps = makeDeps({ translate: async () => ['take lamp'], vm });
    await runTurn(deps, [{ is_user: true, mes: 'take lamp' }], 'normal');
    const { getInventoryText } = await import('../state.js');
    assert.equal(getInventoryText(deps.metadata), 'a brass lantern, a sword');
});

test('inventory capture fails open when query throws or is absent', async () => {
    const vm = makeMovingVM();
    vm.query = () => { throw new Error('boom'); };
    const deps = makeDeps({ translate: async () => ['take lamp'], vm });
    await runTurn(deps, [{ is_user: true, mes: 'take lamp' }], 'normal');   // must not throw
    const deps2 = makeDeps({ translate: async () => ['take lamp'] });       // makeVM has no query
    await runTurn(deps2, [{ is_user: true, mes: 'take lamp' }], 'normal');  // must not throw
    assert.ok(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: FAIL — no edges recorded, no inventory stored.

- [ ] **Step 3: Implement in `turn.js`**

Update the state import:
```javascript
import { readState, recordTurn, getActiveSnapshot, setCompanion, setTogether, getFollowQueue, setFollowQueue, setRoomDescription, recordMapEdge, setInventoryText } from './state.js';
```
Add to the helper imports:
```javascript
import { compactInventory } from './clean.js';
```

Replace the step loop (the `// 5. STEP VM.` block, keeping the room-description capture that follows) with a per-step version that records edges:
```javascript
    // 5. STEP VM — recording learned map edges per step (move that changed rooms).
    const outputs = [];
    let prevLoc = statusForPrompt.location;
    for (const cmd of cmds) {
        outputs.push(vm.step(cmd));
        const nowLoc = vm.getStatus().location;
        const dir = extractMoves([cmd])[0];
        if (dir && nowLoc !== prevLoc) recordMapEdge(metadata, prevLoc, dir, nowLoc);
        prevLoc = nowLoc;
    }
    const status = vm.getStatus();
```
(`extractMoves` is already imported from `./companion.js`.)

After the room-description capture block, add the inventory capture:
```javascript
    // Exact inventory for the HUD — vm.query is side-effect-free; fail open.
    if (cmds.length && typeof vm.query === 'function') {
        try {
            setInventoryText(metadata, compactInventory(vm.query('inventory')));
        } catch { /* HUD-only data — never block the turn */ }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: PASS (existing 22 + 3 new).

- [ ] **Step 5: Full suite + lint**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS.
Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add public/scripts/extensions/ST_IF/turn.js public/scripts/extensions/ST_IF/test/turn.test.js
git commit -m "feat(ST_IF): learn map edges per step + capture inventory via vm.query"
```

---

## Task 5: HUD — index.js, settings, styles, README

**Files:**
- Modify: `public/scripts/extensions/ST_IF/index.js`
- Modify: `public/scripts/extensions/ST_IF/settings.js`
- Modify: `public/scripts/extensions/ST_IF/settings.html`
- Modify: `public/scripts/extensions/ST_IF/style.css`
- Modify: `public/scripts/extensions/ST_IF/README.md`

- [ ] **Step 1: Setting default + wiring**

`settings.js` `defaultSettings`, after `companionAgency`:
```javascript
    showHud: true,          // floating exits/inventory strip above the chat input
```
In `wireSettingsUI`, after the `st_if_agency` handler (note: the HUD re-render on toggle lives in index.js via the callback param — keep settings.js dumb; index.js re-renders after every turn anyway, so a toggle takes effect on the next render; acceptable v1):
```javascript
    $('#st_if_hud_toggle').prop('checked', s.showHud).on('change', function () {
        s.showHud = $(this).prop('checked'); saveSettingsDebounced();
        document.getElementById('st_if_hud')?.classList.toggle('st_if_hidden', !s.showHud);
    });
```

`settings.html`, after the agency checkbox label block:
```html
            <label class="checkbox_label" title="Floating strip above the chat input showing location, exits, and inventory.">
                <input id="st_if_hud_toggle" type="checkbox" />
                <span>Show game HUD (location / exits / inventory)</span>
            </label>
```

- [ ] **Step 2: HUD styles (append to `style.css`)**

```css
#st_if_hud {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin: 2px 5px;
    padding: 3px 10px;
    font-size: 0.85em;
    border: 1px solid var(--SmartThemeBorderColor, #444);
    border-radius: 8px;
    background: var(--SmartThemeBlurTintColor, rgba(0, 0, 0, 0.3));
    opacity: 0.95;
}
#st_if_hud .st_if_hud_pin { cursor: pointer; user-select: none; }
#st_if_hud.st_if_collapsed > :not(.st_if_hud_pin) { display: none; }
#st_if_hud.st_if_hidden { display: none; }
#st_if_hud .st_if_hud_seg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
```

- [ ] **Step 3: index.js — render + extraction trigger**

Update imports:
```javascript
import { readState, initState, getActiveSnapshot, rewindTo, KEY, setCompanion, getCompanionSnapshot, getRoomDescription, setRoomDescription, getInventoryText, getExitsForRoom, setExitsForRoom, getEdgesForRoom, readTogether } from './state.js';
import { extractExits, mergeExits, formatExitsLine } from './exits.js';
```

Add next to `renderRoomPanel` (and keep that function unchanged):
```javascript
/** Render the floating HUD strip (location · exits · inventory [· companion]). */
function renderHud() {
    let el = document.getElementById('st_if_hud');
    if (!el) {
        const form = document.getElementById('send_form');
        if (!form) return;
        el = document.createElement('div');
        el.id = 'st_if_hud';
        el.innerHTML = '<span class="st_if_hud_pin" title="Collapse/expand">📍</span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_loc"></span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_exits"></span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_inv"></span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_comp"></span>';
        form.parentElement.insertBefore(el, form);
        el.querySelector('.st_if_hud_pin').addEventListener('click', () => el.classList.toggle('st_if_collapsed'));
    }
    const cfg = getSettings();
    const ctx = getContext();
    const s = readState(ctx.chatMetadata);
    el.classList.toggle('st_if_hidden', !cfg?.showHud || !s);
    if (!s) return;
    const room = s.summary?.location ?? '?';
    el.querySelector('#st_if_hud_loc').textContent = room;
    const merged = mergeExits(getExitsForRoom(ctx.chatMetadata, room) ?? [], getEdgesForRoom(ctx.chatMetadata, room));
    const exitsLine = formatExitsLine(merged);
    el.querySelector('#st_if_hud_exits').textContent = exitsLine ? `· Exits: ${exitsLine}` : '';
    const inv = getInventoryText(ctx.chatMetadata);
    el.querySelector('#st_if_hud_inv').textContent = inv ? `· 🎒 ${inv}` : '';
    const compRoom = s.companion?.summary?.location;
    const apart = cfg?.companionTracking && compRoom && !readTogether(ctx.chatMetadata);
    el.querySelector('#st_if_hud_comp').textContent = apart ? `· 👥 ${compRoom}` : '';
}

/** Fire-and-forget: extract exits for the current room if not cached yet. */
function ensureExitsExtracted() {
    const ctx = getContext();
    const s = readState(ctx.chatMetadata);
    const room = s?.summary?.location;
    const desc = getRoomDescription(ctx.chatMetadata);
    if (!room || !desc || getExitsForRoom(ctx.chatMetadata, room) !== undefined) return;
    extractExits(desc, (prompt) => generateQuietPrompt({ quietPrompt: prompt, responseLength: 60, skipWIAN: true }))
        .then((exits) => {
            if (exits === null) return;            // parse failure — leave uncached, retry later
            setExitsForRoom(ctx.chatMetadata, room, exits);
            saveMetadataDebounced();
            renderHud();
        })
        .catch((e) => console.warn('[ST_IF] exits extraction failed', e));
}
```

Wire the calls:
- In the interceptor, after `renderRoomPanel();` add:
```javascript
        renderHud();
        ensureExitsExtracted();
```
- At the end of `ensureStoryLoaded()` (it already calls `renderRoomPanel()`), add the same two calls.
- In the `wireSettingsUI` new-story callback, after `renderRoomPanel();` add the same two calls.

- [ ] **Step 4: Lint + full suite**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.
Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS.

- [ ] **Step 5: README**

Add a "Game HUD" bullet under Settings: a toggleable strip above the chat input with location, exits (extracted from the room text once per room + confirmed by your actual moves, `✓` = walked), exact inventory (queried from the game with zero side effects), and the companion's room when you're apart. Click 📍 to collapse.

- [ ] **Step 6: Manual verification (requires ST runtime)**

Run: hard-refresh the running ST, load a story, enable the extension.
Verify:
1. HUD strip appears above the input with the location; after a turn or two, the Exits segment fills in (once per room) and 🎒 shows your items after an action.
2. Walk through an exit and back → that exit gains `→ <room> ✓`.
3. Take an item → 🎒 updates; the game's move counter is NOT advanced by the query (play a turn, compare Moves in the room panel).
4. 📍 click collapses/expands; the settings toggle hides/shows; reload keeps cached exits.
5. Split from the companion (tracking on) → `👥 <their room>` appears; reunite → disappears.
Expected: all behave; no console errors.

- [ ] **Step 7: Commit**

```bash
git add public/scripts/extensions/ST_IF/index.js public/scripts/extensions/ST_IF/settings.js public/scripts/extensions/ST_IF/settings.html public/scripts/extensions/ST_IF/style.css public/scripts/extensions/ST_IF/README.md
git commit -m "feat(ST_IF): floating HUD with exits, inventory, and companion location"
```

---

## Verification summary

- **Unit/integration (node --test):** `vm.query` zero-net-effect round-trip (real Zork I); `compactInventory`; `extractExits` (parse/normalize/drop/fail-open/empty-success), `mergeExits`, `formatExitsLine`; state accessors incl. legacy; turn-level edge recording + inventory capture + fail-open.
- **Manual (ST runtime):** HUD render/update/collapse/toggle, exits filling in per room and gaining ✓ on traversal, inventory updating without advancing moves, companion segment on apart.

## Open items

- Auto-map visualization stays out of scope.
- Random-exit rooms (Zork II Carousel) make learned edges unreliable there — accepted in the spec.
