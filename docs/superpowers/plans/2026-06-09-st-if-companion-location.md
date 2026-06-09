# ST_IF Companion Location — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat character (`{{char}}`) its own location in the IF world — a position-only marker that moves on the same map — with the narrator grounding in the companion's room (and unaware of the player) when the two are apart.

**Architecture:** A second movement-only `IFVM` instance (`companionVM`) of the same story acts as the companion's position. Each turn a side LLM call decides the companion's move; co-location is room-name equality. State, canon, and turn logic stay pure (deps injected, `node --test`); ST wiring lives in `index.js`/`settings`. Builds on the v1 ST_IF extension.

**Tech Stack:** Same as v1 — vanilla ES modules, jQuery, vendored ifvms ZVM, `node --test`, ESLint.

---

## Spec refinement (simpler than the design doc)

The spec proposed nesting state as `{ player, companion, together }` with a migration that
normalizes legacy flat state into `.player`. During planning we confirmed the current
state object is *already* the player (flat `snapshot`/`summary`/`history`). So instead of
restructuring, we **keep the player fields flat and add `companion` + `together`
alongside**:

```
chatMetadata.ST_IF = {
   storyId, snapshot, summary, history,   // the player (unchanged from v1)
   companion: { snapshot, summary },      // new: position-only marker
   together: boolean,                     // new
}
```

This needs **no migration** (legacy chats simply lack `companion`; accessors seed it from
the player snapshot on first use), keeps every existing v1 test green, and leaves the
player code path untouched. Everything else in the spec stands.

## File structure

All under `public/scripts/extensions/ST_IF/`.

| File | Change | Phase |
|------|--------|-------|
| `state.js` | Add `companion`/`together` to `initState`; add companion/together accessors | 1 |
| `companion.js` *(new, pure)* | `decideMove(playerText, playerRoom, companionRoom, bias, generate) → string\|null` | 1 |
| `canon.js` | Add `buildApartCanonBlock(...)`; keep `buildCanonBlock` | 1 |
| `turn.js` | Companion branch: step `companionVM`, compute `together`, pick canon, persist | 1 |
| `settings.js` / `settings.html` | `companionTracking` toggle + `companionBias` control | 1 |
| `index.js` | Instantiate `companionVM`; wire companion-move call; seed companion on load | 1 |
| `turn.js` | On apart, emit a `narratePlayerRoom` request via injected callback | 2 |
| `index.js` | Player-room `generateRaw` + post as not-in-prompt comment message | 2 |
| `README.md` | Document the feature + toggle | 2 |

Decoupling rule (unchanged): `state.js`, `companion.js`, `canon.js`, `turn.js` import nothing from the ST runtime; deps are injected. Only `index.js`/`settings.js` touch ST.

---

# PHASE 1 — Two locations, single reply

## Task 1: State — companion + together accessors

**Files:**
- Modify: `public/scripts/extensions/ST_IF/state.js`
- Modify: `public/scripts/extensions/ST_IF/test/state.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/state.test.js`)**

```javascript
import { initState as initState2, readState as readState2, getCompanionSnapshot, setCompanion, setTogether, readTogether } from '../state.js';

test('initState seeds a co-located companion and together=true', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.equal(getCompanionSnapshot(md), 'SNAP0');
    assert.equal(readTogether(md), true);
    // player fields unchanged
    assert.equal(readState2(md).snapshot, 'SNAP0');
});

test('setCompanion updates the companion snapshot/summary without touching the player', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    setCompanion(md, { snapshot: 'CSNAP1', summary: { location: 'Cave' } });
    assert.equal(getCompanionSnapshot(md), 'CSNAP1');
    assert.equal(readState2(md).companion.summary.location, 'Cave');
    assert.equal(readState2(md).snapshot, 'SNAP0', 'player snapshot untouched');
});

test('setTogether / readTogether round-trip', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    setTogether(md, false);
    assert.equal(readTogether(md), false);
});

test('getCompanionSnapshot falls back to the player snapshot for legacy state (no companion field)', () => {
    const md = { ST_IF: { storyId: 'x', snapshot: 'PLAYERSNAP', summary: null, history: [] } };
    assert.equal(getCompanionSnapshot(md), 'PLAYERSNAP');
    assert.equal(readTogether(md), true, 'legacy state defaults to together');
});

test('setCompanion seeds the companion object on legacy state', () => {
    const md = { ST_IF: { storyId: 'x', snapshot: 'P', summary: null, history: [] } };
    setCompanion(md, { snapshot: 'C', summary: null });
    assert.equal(getCompanionSnapshot(md), 'C');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/state.test.js`
Expected: FAIL — `getCompanionSnapshot` etc. not exported.

- [ ] **Step 3: Implement in `state.js`**

Change `initState` and append the new accessors:

```javascript
export function initState(metadata, storyId, snapshot) {
    metadata[KEY] = {
        storyId, snapshot, summary: null, history: [],
        companion: { snapshot, summary: null },
        together: true,
    };
    return metadata[KEY];
}

export function getCompanionSnapshot(metadata) {
    const s = metadata[KEY];
    if (!s) return null;
    return s.companion?.snapshot ?? s.snapshot ?? null;   // legacy fallback: player snapshot
}

export function setCompanion(metadata, { snapshot, summary }) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.companion = { snapshot, summary: summary ?? null };
}

export function setTogether(metadata, value) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.together = !!value;
}

export function readTogether(metadata) {
    const s = metadata[KEY];
    if (!s) return true;
    return s.together ?? true;   // legacy default: together
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/state.test.js`
Expected: PASS — all original + 5 new tests green.

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/state.js public/scripts/extensions/ST_IF/test/state.test.js
git commit -m "feat(ST_IF): companion + together accessors in state"
```

---

## Task 2: Companion movement intent (`companion.js`)

**Files:**
- Create: `public/scripts/extensions/ST_IF/companion.js`
- Create: `public/scripts/extensions/ST_IF/test/companion.test.js`

- [ ] **Step 1: Write the failing test**

`test/companion.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntentPrompt, decideMove } from '../companion.js';

test('prompt includes both rooms, the player message, and the bias', () => {
    const p = buildIntentPrompt('I storm off north', 'Forest', 'Clearing', 0.8);
    assert.match(p, /I storm off north/);
    assert.match(p, /Forest/);
    assert.match(p, /Clearing/);
    assert.match(p, /0\.8|stay close|near/i);
});

test('parses a move direction', async () => {
    const gen = async () => '{"move":"north"}';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), 'north');
});

test('null move means stay put', async () => {
    const gen = async () => '{"move":null}';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), null);
});

test('extracts move from prose-wrapped JSON', async () => {
    const gen = async () => 'Sure:\n```json\n{"move":"se"}\n```';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), 'se');
});

test('fails open to null on garbage', async () => {
    const gen = async () => 'the companion thinks about it';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), null);
});

test('rejects a non-direction token (fails open to null)', async () => {
    const gen = async () => '{"move":"take lantern"}';
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), null);
});

test('fails open to null when the generator throws', async () => {
    const gen = async () => { throw new Error('llm down'); };
    assert.equal(await decideMove('x', 'A', 'B', 0.5, gen), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/companion.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `companion.js`**

```javascript
// companion.js — decide the companion's movement intent. Pure; `generate` injected.

// Z-machine movement verbs the companion is allowed to use (position-only).
const DIRECTIONS = new Set([
    'north', 'south', 'east', 'west', 'up', 'down', 'in', 'out',
    'ne', 'nw', 'se', 'sw', 'northeast', 'northwest', 'southeast', 'southwest',
    'n', 's', 'e', 'w', 'u', 'd',
]);

export function buildIntentPrompt(playerText, playerRoom, companionRoom, bias) {
    const lean = bias >= 0.66 ? 'You strongly prefer to stay close to them and tend to follow.'
        : bias <= 0.33 ? 'You are independent and often wander on your own.'
            : 'You balance following them against doing your own thing.';
    return [
        'You decide whether a companion character takes ONE step on a map this turn.',
        `The companion is currently at: ${companionRoom}.`,
        `The player ({{user}}) is at: ${playerRoom}.`,
        `Companion disposition (bias ${bias}): ${lean}`,
        `The player just said/did: ${playerText}`,
        'Decide the companion\'s single movement this turn, or none.',
        'Respond with ONLY JSON: {"move":"<direction>"} or {"move":null}. ' +
        'A direction is one compass word (north, south, east, west, up, down, in, out, ne, nw, se, sw). No other verbs.',
    ].join('\n');
}

function extractMove(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    try {
        const obj = JSON.parse(text.slice(start, end + 1));
        return Object.prototype.hasOwnProperty.call(obj, 'move') ? obj.move : null;
    } catch {
        return null;
    }
}

/**
 * @returns {Promise<string|null>} a direction command, or null to stay put
 */
export async function decideMove(playerText, playerRoom, companionRoom, bias, generate) {
    let raw;
    try {
        raw = await generate(buildIntentPrompt(playerText, playerRoom, companionRoom, bias));
    } catch {
        return null;
    }
    const move = extractMove(String(raw ?? ''));
    if (typeof move !== 'string') return null;
    const norm = move.trim().toLowerCase();
    return DIRECTIONS.has(norm) ? norm : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/companion.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/companion.js public/scripts/extensions/ST_IF/test/companion.test.js
git commit -m "feat(ST_IF): companion movement-intent decider"
```

---

## Task 3: Apart canon block (`canon.js`)

**Files:**
- Modify: `public/scripts/extensions/ST_IF/canon.js`
- Modify: `public/scripts/extensions/ST_IF/test/canon.test.js`

- [ ] **Step 1: Write the failing test (append to `test/canon.test.js`)**

```javascript
import { buildApartCanonBlock } from '../canon.js';

test('apart block grounds in the companion room and withholds player actions', () => {
    const block = buildApartCanonBlock({
        companionRoom: 'Misty Clearing',
        companionScene: 'A clearing wreathed in fog. Paths lead north and east.',
        playerLocation: 'Dark Cave',
    });
    assert.match(block, /apart/i);
    assert.match(block, /Misty Clearing/);
    assert.match(block, /fog/);
    assert.match(block, /Dark Cave/);                 // last-known player location is named
    assert.match(block, /do not/i);                   // instruction not to narrate the player
});

test('apart block tolerates an empty companion scene', () => {
    const block = buildApartCanonBlock({ companionRoom: 'Foyer', companionScene: '', playerLocation: 'Cellar' });
    assert.match(block, /Foyer/);
    assert.match(block, /Cellar/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/canon.test.js`
Expected: FAIL — `buildApartCanonBlock` not exported.

- [ ] **Step 3: Implement in `canon.js` (append)**

```javascript
/**
 * Canon for an APART turn, from the companion's point of view. The narrator
 * ({{char}}) grounds in their own room and must not narrate {{user}}'s actions.
 * @param {{companionRoom:string, companionScene:string, playerLocation:string}} args
 */
export function buildApartCanonBlock({ companionRoom, companionScene, playerLocation }) {
    const lines = [
        '[GAME — ground truth. You ({{char}}) are on your own, apart from {{user}}.]',
        `You are at: ${companionRoom}.`,
    ];
    if (companionScene && companionScene.trim()) lines.push(companionScene.trim());
    lines.push(`You do not know what {{user}} is doing; you last saw them near ${playerLocation}.`);
    lines.push('Narrate only your own situation, in character. Do not describe {{user}}\'s actions.');
    return lines.join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/canon.test.js`
Expected: PASS (original 4 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/canon.js public/scripts/extensions/ST_IF/test/canon.test.js
git commit -m "feat(ST_IF): apart companion-POV canon block"
```

---

## Task 4: Turn orchestration — companion branch (`turn.js`)

**Files:**
- Modify: `public/scripts/extensions/ST_IF/turn.js`
- Modify: `public/scripts/extensions/ST_IF/test/turn.test.js`

**New `deps` fields (Phase 1):**
```
companionVM,                  // IFVM instance (loaded) or null
companionMove,                // async (playerText, playerRoom, companionRoom) => string|null
settings.companionTracking,   // boolean
```

- [ ] **Step 1: Write the failing tests (append to `test/turn.test.js`)**

```javascript
function makeCompanionVM(room) {
    return {
        loaded: true, room, steps: [], _snap: 'CSNAP0',
        step(cmd) { this.steps.push(cmd); if (cmd !== 'look') this.room = cmd; return `companion does ${cmd}`; },
        save() { return this._snap; },
        restore(s) { this._snap = s; },
        getStatus() { return { location: this.room, score: 0, moves: 0 }; },
    };
}

test('companion tracking off: companionVM never touched, no together computed', async () => {
    const deps = makeDeps();
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionMove = async () => 'north';
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: false };
    await runTurn(deps, [{ is_user: true, mes: 'go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, []);
});

test('together: companion in same room → shared canon, together=true persisted', async () => {
    const deps = makeDeps();                               // player VM reports 'Cave'
    deps.companionVM = makeCompanionVM('Cave');            // companion already in 'Cave'
    deps.companionMove = async () => null;                 // stays
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true };
    await runTurn(deps, [{ is_user: true, mes: 'I wait' }], 'normal');
    assert.match(deps._calls.setPrompt[0], /Cave/);
    assert.doesNotMatch(deps._calls.setPrompt[0], /apart/i);
    const { readTogether } = await import('../state.js');
    assert.equal(readTogether(deps.metadata), true);
});

test('apart: companion moves to a different room → apart canon, together=false', async () => {
    const deps = makeDeps();                               // player VM reports 'Cave'
    deps.companionVM = makeCompanionVM('Clearing');        // companion elsewhere
    deps.companionMove = async () => 'north';              // moves to 'north' room
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true };
    await runTurn(deps, [{ is_user: true, mes: 'I dig' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north']);
    assert.match(deps._calls.setPrompt[0], /apart/i);
    const { readTogether, getCompanionSnapshot } = await import('../state.js');
    assert.equal(readTogether(deps.metadata), false);
    assert.equal(getCompanionSnapshot(deps.metadata), 'CSNAP0');
});

test('apart with no move: companion looks to describe its room', async () => {
    const deps = makeDeps();
    deps.companionVM = makeCompanionVM('Clearing');
    deps.companionMove = async () => null;
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true };
    await runTurn(deps, [{ is_user: true, mes: 'I dig' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['look']);
    assert.match(deps._calls.setPrompt[0], /Clearing/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: FAIL — companion branch not implemented (companionVM untouched / no apart canon).

- [ ] **Step 3: Implement the companion branch in `turn.js`**

Add the import and a helper, and insert the companion logic after the player's canon is built. Replace the import line and the final canon section:

```javascript
import { readState, recordTurn, getActiveSnapshot, setCompanion, setTogether } from './state.js';
import { translate as translateDefault } from './translator.js';
import { buildCanonBlock, buildApartCanonBlock } from './canon.js';
```

Replace the final block (the `// 7. INJECT canon.` section) with:

```javascript
    // 7. COMPANION (position-only second marker), if tracking is on.
    if (settings.companionTracking && deps.companionVM?.loaded) {
        const companionVM = deps.companionVM;
        const playerRoom = status.location;
        const companionRoomBefore = companionVM.getStatus().location;
        const move = await deps.companionMove(player.text, playerRoom, companionRoomBefore);
        const companionScene = move ? companionVM.step(move) : companionVM.step('look');
        const companionStatus = companionVM.getStatus();
        const together = playerRoom === companionStatus.location;

        setCompanion(metadata, { snapshot: companionVM.save(), summary: companionStatus });
        setTogether(metadata, together);
        save();

        if (together) {
            const block = buildCanonBlock({ outputs, status, ranCommands: cmds.length > 0, injectStateOnRp: settings.injectStateOnRp });
            if (block) setPrompt(block);
        } else {
            const block = buildApartCanonBlock({
                companionRoom: companionStatus.location,
                companionScene,
                playerLocation: playerRoom,
            });
            setPrompt(block);
            if (deps.onNarratePlayerRoom) {
                await deps.onNarratePlayerRoom({ playerRoom, outputs, cmds, msgIndex: player.index });
            }
        }
        if (deps.debugLog && cmds.length) deps.debugLog({ outputs, status, cmds });
        return;
    }

    // 7b. No companion tracking — original single-marker canon.
    const block = buildCanonBlock({ outputs, status, ranCommands: cmds.length > 0, injectStateOnRp: settings.injectStateOnRp });
    if (block) setPrompt(block);
    if (deps.debugLog && cmds.length) deps.debugLog({ outputs, status, cmds });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: PASS — original 8 + 4 new.

- [ ] **Step 5: Run the full unit suite + lint**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS (all suites).
Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add public/scripts/extensions/ST_IF/turn.js public/scripts/extensions/ST_IF/test/turn.test.js
git commit -m "feat(ST_IF): companion together/apart branch in turn orchestration"
```

---

## Task 5: Settings + index wiring (Phase 1)

**Files:**
- Modify: `public/scripts/extensions/ST_IF/settings.js`
- Modify: `public/scripts/extensions/ST_IF/settings.html`
- Modify: `public/scripts/extensions/ST_IF/index.js`

- [ ] **Step 1: Add settings defaults + wiring**

In `settings.js` `defaultSettings`, add:
```javascript
    companionTracking: false,
    companionBias: 0.7,   // 0 = wanders freely, 1 = stays glued to the player
```

In `wireSettingsUI`, after the `showRawOutput` block, add:
```javascript
    $('#st_if_companion').prop('checked', s.companionTracking).on('change', function () {
        s.companionTracking = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_bias').val(s.companionBias).on('input', function () {
        s.companionBias = Number($(this).val()); saveSettingsDebounced();
    });
```

- [ ] **Step 2: Add the controls to `settings.html`**

After the "Show raw game output" label block, add:
```html
            <label class="checkbox_label">
                <input id="st_if_companion" type="checkbox" />
                <span>Companion location tracking</span>
            </label>

            <label for="st_if_bias">Companion stays near player</label>
            <input id="st_if_bias" type="range" min="0" max="1" step="0.1" class="text_pole" />
```

- [ ] **Step 3: Wire `index.js` — second VM, companion move, seeding**

Add imports:
```javascript
import { decideMove } from './companion.js';
import { setCompanion, getCompanionSnapshot, readState as readIfState } from './state.js';
```

Add a second VM instance next to `const vm = new IFVM();`:
```javascript
const companionVM = new IFVM();
```

In `buildDeps()`'s returned object, add:
```javascript
        companionVM,
        companionMove: (playerText, playerRoom, companionRoom) =>
            decideMove(playerText, playerRoom, companionRoom, getSettings().companionBias,
                (prompt) => generateQuietPrompt({ quietPrompt: prompt, responseLength: 40, skipWIAN: true })),
```

And extend the `settings` object passed in `buildDeps()`:
```javascript
        settings: { strictness: s.strictness, injectStateOnRp: s.injectStateOnRp, companionTracking: s.companionTracking },
```

In `ensureStoryLoaded()`, after the player VM is loaded/restored, load + seed the companion VM:
```javascript
    // Companion VM mirrors the same story; seed/restore its own position.
    if (!companionVM.loaded) await companionVM.load(base64ToBytes(s.storyBase64));
    const st = readIfState(ctx.chatMetadata);
    if (st) {
        const csnap = getCompanionSnapshot(ctx.chatMetadata);
        if (csnap) companionVM.restore(csnap);
        if (!st.companion) { setCompanion(ctx.chatMetadata, { snapshot: companionVM.save(), summary: companionVM.getStatus() }); saveMetadataDebounced(); }
    }
```

And in the `wireSettingsUI` story-load callback (new story chosen), reset the companion too, right after the player `initState`:
```javascript
        await companionVM.load(base64ToBytes(s.storyBase64));
        setCompanion(ctx.chatMetadata, { snapshot: companionVM.save(), summary: companionVM.getStatus() });
        saveMetadataDebounced();
```

- [ ] **Step 4: Lint**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 5: Manual verification (requires ST runtime)**

Run: `npm start`, open ST, load a story, enable the extension AND "Companion location tracking".
Verify:
1. Play a few turns staying put → narrator behaves as before (together); `/if-state` shows the player location.
2. Move the player away (e.g. several `north`/`south`); after some turns the companion's room (in the canon, visible via the debug toggle / console) differs → narrator grounds in the companion's room and stops narrating your distant actions.
3. Move back to the same room → reverts to the shared scene.
4. Reload the page mid-game → both player and companion positions resume.
Expected: together/apart transitions work; no console errors.

- [ ] **Step 6: Commit**

```bash
git add public/scripts/extensions/ST_IF/settings.js public/scripts/extensions/ST_IF/settings.html public/scripts/extensions/ST_IF/index.js
git commit -m "feat(ST_IF): wire companion VM, movement intent, and settings (Phase 1)"
```

---

# PHASE 2 — Two narrated blocks when apart

The apart branch already calls `deps.onNarratePlayerRoom(...)` when present (Task 4). Phase 2 supplies it in `index.js`: generate a neutral narration of the player's room and post it as a comment message that the companion narrator never sees.

## Task 6: Player-room narration + comment posting (`index.js`)

**Files:**
- Modify: `public/scripts/extensions/ST_IF/index.js`

- [ ] **Step 1: Confirm SillyTavern's comment-message mechanism**

Run: `node node_modules/eslint/bin/eslint.js --version` (sanity), then inspect how a comment message (displayed but excluded from the prompt) is created in this checkout:
Run: `grep -rn "is_system\|/comment\|sendCommentMessage\|comment.*message" public/scripts/slash-commands.js public/script.js | head -30`
Expected: identify the helper or message shape used for `/comment` (a message with `is_system: true` and an `extra` flag that excludes it from prompts). Use that exact mechanism in Step 2. (If a `sendCommentMessage`/`/comment` slash command exists, prefer calling it via `getContext().executeSlashCommandsWithOptions('/comment ...')`.)

- [ ] **Step 2: Implement `onNarratePlayerRoom` in `index.js`**

Add to the object returned by `buildDeps()`:
```javascript
        onNarratePlayerRoom: async ({ playerRoom, outputs }) => {
            const result = (outputs || []).join('\n').trim() || '(you wait)';
            let prose;
            try {
                prose = await generateRaw({
                    prompt: `You are a neutral narrator. In 2-3 sentences, vividly narrate the following happening to {{user}}, who is alone at "${playerRoom}". Do not mention {{char}}. Event:\n${result}`,
                    systemPrompt: 'You narrate interactive fiction scenes concisely and in third person.',
                    responseLength: 160,
                });
            } catch (e) {
                console.error('[ST_IF] player-room narration failed', e);
                return;   // fail-open: skip the extra block
            }
            await postComment(`*(${playerRoom})* ${prose}`);
        },
```

Add `generateRaw` to the `script.js` import list, and add the `postComment` helper (using whatever mechanism Step 1 identified — example using the slash-command path):
```javascript
async function postComment(text) {
    const ctx = getContext();
    // Comment messages are displayed but excluded from the LLM prompt — the
    // companion narrator must not see the player's-room block.
    await ctx.executeSlashCommandsWithOptions(`/comment ${text.replace(/\n/g, ' ')}`);
}
```

- [ ] **Step 3: Lint**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 4: Manual verification (requires ST runtime)**

Run: `npm start`, load a story, enable companion tracking, separate from the companion, then take an action in your room.
Verify:
1. A comment message appears narrating *your* room/action (distinct styling), AND the `{{char}}` reply narrates the companion's separate scene.
2. The companion reply does NOT reference your action (open the next prompt or reason about it — the comment is excluded from context).
3. When reunited, turns revert to a single shared reply.
Expected: two visible blocks while apart; companion stays unaware; no console errors.

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/index.js
git commit -m "feat(ST_IF): player-room narration as a not-in-prompt comment when apart (Phase 2)"
```

---

## Task 7: README + final pass

**Files:**
- Modify: `public/scripts/extensions/ST_IF/README.md`

- [ ] **Step 1: Document the feature**

Add a "Companion location tracking" section to the README: what it does (companion has its own location, moves on the map, narrator grounds in the companion's room when apart and is unaware of you), the toggle + bias control, the two-blocks-when-apart behavior, the cost note (up to 4 LLM calls on an apart turn), and the position-only limitation (companion never manipulates objects).

- [ ] **Step 2: Full unit suite**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS — canon, translator, state, turn, companion, and vm.integration all green.

- [ ] **Step 3: Lint**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/scripts/extensions/ST_IF/README.md
git commit -m "docs(ST_IF): document companion location tracking"
```

---

## Verification summary

- **Unit-tested (node --test):** `state` (companion/together accessors + legacy fallback), `companion` (move parsing, fail-open, direction allowlist), `canon` (apart block), `turn` (tracking off / together / apart / no-move look).
- **Manually verified (ST runtime):** settings toggle + bias, two-VM seeding/resume, together↔apart transitions, and the Phase 2 comment-message block with prompt-exclusion.

## Open items

- Phase 2 Step 1 pins the exact comment-message mechanism in this checkout; the plan assumes a `/comment` slash command exists (it does in current SillyTavern) and excludes the message from prompts. If the mechanism differs, adjust `postComment` accordingly.
- Companion "scene" on a stay turn uses `companionVM.step('look')`; in the rare game where `look` advances a turn counter, the companion's move count may tick — cosmetic only (companion moves aren't surfaced as score/moves).
