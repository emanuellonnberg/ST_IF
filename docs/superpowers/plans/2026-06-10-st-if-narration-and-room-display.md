# ST_IF Character-Forward Narration + Room Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `{{char}}` present and reacting in the narration (instead of pure room transcription), and add a persistent "Current room" box showing the location + room prose.

**Architecture:** `canon.js` gets a character-forward instruction + optional `companionPresent` line; `turn.js` passes it in the together-branch and captures the room description on move/look; `state.js` stores `roomDescription`; `index.js` renders a drawer box each turn. Pure logic stays unit-tested.

**Tech Stack:** Same as ST_IF — vanilla ES modules, `node --test`, ESLint.

---

## File structure

All under `public/scripts/extensions/ST_IF/`.

| File | Change |
|------|--------|
| `canon.js` | Character-forward instruction in `buildCanonBlock` + optional `companionPresent` line. |
| `state.js` | `roomDescription` field + `getRoomDescription` / `setRoomDescription`. |
| `turn.js` | `companionPresent: true` in the together-branch; capture room description on move/look. |
| `index.js` | `renderRoomPanel()`; seed room description on load; render after each turn + on chat-change. |
| `settings.html` / `style.css` | "Current room" read-only box. |

---

## Task 1: canon.js — character-forward + companionPresent

**Files:**
- Modify: `public/scripts/extensions/ST_IF/canon.js`
- Modify: `public/scripts/extensions/ST_IF/test/canon.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/canon.test.js`)**

```javascript
test('action canon is character-forward and omits the companion line by default', () => {
    const b = buildCanonBlock({ outputs: ['You go north.'], status: { location: 'Cave', score: 0, moves: 1 }, ranCommands: true, injectStateOnRp: false });
    assert.match(b, /in character/i);
    assert.match(b, /setting/i);
    assert.match(b, /ground truth/i);          // existing behavior preserved
    assert.match(b, /Action result: You go north\./);
    assert.doesNotMatch(b, /here with you/i);
});

test('companionPresent adds the presence line', () => {
    const b = buildCanonBlock({ outputs: ['You go north.'], status: { location: 'Cave', score: 0, moves: 1 }, ranCommands: true, injectStateOnRp: false, companionPresent: true });
    assert.match(b, /\{\{char\}\} is here with you/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/canon.test.js`
Expected: FAIL — instruction lacks "in character"/"setting"; no companion line.

- [ ] **Step 3: Replace `buildCanonBlock` in `canon.js`**

```javascript
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
```

Also update the JSDoc above it to include `companionPresent`:
```javascript
/**
 * @param {{outputs: string[], status: {location:string, score:number|null, moves:number|null}, ranCommands: boolean, injectStateOnRp: boolean, companionPresent?: boolean}} args
 * @returns {string} canon block, or '' when nothing should be injected
 */
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/canon.test.js`
Expected: PASS — existing tests still green (header still says "ground truth", `Action result:` unchanged) + 2 new.

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/canon.js public/scripts/extensions/ST_IF/test/canon.test.js
git commit -m "feat(ST_IF): character-forward canon + companionPresent line"
```

---

## Task 2: state.js — room description

**Files:**
- Modify: `public/scripts/extensions/ST_IF/state.js`
- Modify: `public/scripts/extensions/ST_IF/test/state.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/state.test.js`)**

```javascript
import { getRoomDescription, setRoomDescription } from '../state.js';

test('roomDescription round-trips and defaults to empty', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.equal(getRoomDescription(md), '');
    setRoomDescription(md, 'A dark cave. Exits lead north.');
    assert.equal(getRoomDescription(md), 'A dark cave. Exits lead north.');
});

test('getRoomDescription is empty for legacy state without the field', () => {
    assert.equal(getRoomDescription({ ST_IF: { storyId: 'x', snapshot: 'P', summary: null, history: [] } }), '');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/state.test.js`
Expected: FAIL — accessors not exported.

- [ ] **Step 3: Add to `state.js`**

```javascript
export function getRoomDescription(metadata) {
    return metadata[KEY]?.roomDescription ?? '';
}

export function setRoomDescription(metadata, text) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.roomDescription = String(text ?? '');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/state.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/state.js public/scripts/extensions/ST_IF/test/state.test.js
git commit -m "feat(ST_IF): roomDescription state accessors"
```

---

## Task 3: turn.js — companionPresent + room capture

**Files:**
- Modify: `public/scripts/extensions/ST_IF/turn.js`
- Modify: `public/scripts/extensions/ST_IF/test/turn.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/turn.test.js`)**

```javascript
function makeMovingVM() {
    const DIRS = ['north', 'south', 'east', 'west', 'up', 'down'];
    return {
        loaded: true, _snap: 'S', room: 'Start', steps: [],
        step(cmd) {
            this.steps.push(cmd);
            if (DIRS.includes(cmd)) { this.room = cmd; return `You go ${cmd}. A new place called ${cmd}.`; }
            if (cmd === 'look') return `You are at ${this.room}. Exits lead away.`;
            return `You ${cmd}.`;
        },
        save() { return this._snap; },
        restore(s) { this._snap = s; },
        getStatus() { return { location: this.room, score: 0, moves: 0 }; },
    };
}

test('captures room description when the player changes rooms', async () => {
    const deps = makeDeps({ translate: async () => ['north'], vm: makeMovingVM() });
    await runTurn(deps, [{ is_user: true, mes: 'go north' }], 'normal');
    const { getRoomDescription } = await import('../state.js');
    assert.match(getRoomDescription(deps.metadata), /A new place called north/);
});

test('captures room description on a look command', async () => {
    const deps = makeDeps({ translate: async () => ['look'], vm: makeMovingVM() });
    await runTurn(deps, [{ is_user: true, mes: 'look' }], 'normal');
    const { getRoomDescription } = await import('../state.js');
    assert.match(getRoomDescription(deps.metadata), /You are at Start/);
});

test('does not overwrite room description on a non-move, non-look action', async () => {
    const deps = makeDeps({ translate: async () => ['north'], vm: makeMovingVM() });
    await runTurn(deps, [{ is_user: true, mes: 'go north' }], 'normal');
    deps.translate = async () => ['take lamp'];
    await runTurn(deps, [{ is_user: true, mes: 'take lamp' }], 'normal');
    const { getRoomDescription } = await import('../state.js');
    assert.match(getRoomDescription(deps.metadata), /A new place called north/, 'kept the room desc through a take');
});

test('together-branch canon includes the companion-present line', async () => {
    // A non-move action: ranCommands is true (so the companion line applies) but no
    // movement, so both VMs stay in 'Cave' and the turn is "together".
    const deps = makeDeps({ translate: async () => ['take lamp'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    await runTurn(deps, [{ is_user: true, mes: 'take the lamp' }], 'normal');
    assert.match(deps._calls.setPrompt[0], /here with you/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: FAIL — no room capture; together canon lacks the companion line.

- [ ] **Step 3: Update imports + add capture in `turn.js`**

Add `setRoomDescription` to the state import:
```javascript
import { readState, recordTurn, getActiveSnapshot, setCompanion, setTogether, getFollowQueue, setFollowQueue, setRoomDescription } from './state.js';
```

Insert the capture right after `const status = vm.getStatus();` (the line following the step loop, before the `// 6. PERSIST` block):
```javascript
    // Capture the current room description for the persistent display:
    // update on a room change (the move output IS the new room) or an explicit look.
    const movedRoom = status.location !== statusForPrompt.location;
    const lookish = cmds.some((c) => /^(look|l|examine room)$/i.test(String(c).trim()));
    if ((movedRoom || lookish) && outputs.length) {
        setRoomDescription(metadata, outputs[outputs.length - 1]);
    }
```

- [ ] **Step 4: Add `companionPresent` to the together-branch canon**

In the companion block's `if (together) { ... }`, change the `buildCanonBlock` call to include `companionPresent: true`:
```javascript
        if (together) {
            const block = buildCanonBlock({ outputs, status, ranCommands: cmds.length > 0, injectStateOnRp: settings.injectStateOnRp, companionPresent: true });
            if (block) setPrompt(block);
        } else {
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: PASS — existing + 4 new.

- [ ] **Step 6: Full suite + lint**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS.
Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add public/scripts/extensions/ST_IF/turn.js public/scripts/extensions/ST_IF/test/turn.test.js
git commit -m "feat(ST_IF): capture room description + companion-present canon"
```

---

## Task 4: index.js + settings — persistent room panel

**Files:**
- Modify: `public/scripts/extensions/ST_IF/index.js`
- Modify: `public/scripts/extensions/ST_IF/settings.html`
- Modify: `public/scripts/extensions/ST_IF/style.css`
- Modify: `public/scripts/extensions/ST_IF/README.md`

- [ ] **Step 1: Add the "Current room" container to settings.html**

After the closing of the story-file controls (before `</div></div></div>` that ends the drawer content), add:
```html
            <hr />
            <div><b>Current room</b></div>
            <div id="st_if_room" class="st_if_room">(no game loaded)</div>
```

- [ ] **Step 2: Style it (append to style.css)**

```css
.ST_IF_settings #st_if_room {
    white-space: pre-wrap;
    max-height: 220px;
    overflow-y: auto;
    font-size: 0.9em;
    opacity: 0.95;
    border: 1px solid var(--SmartThemeBorderColor, #444);
    border-radius: 6px;
    padding: 6px 8px;
}
```

- [ ] **Step 3: Wire `index.js` — imports, render, seed**

Add `getRoomDescription`, `setRoomDescription` to the state import:
```javascript
import { readState, initState, getActiveSnapshot, rewindTo, KEY, setCompanion, getCompanionSnapshot, getRoomDescription, setRoomDescription } from './state.js';
```

Add the render function (next to `showIntroIfDebug`):
```javascript
/** Update the persistent "Current room" box from this chat's state. */
function renderRoomPanel() {
    const el = document.getElementById('st_if_room');
    if (!el) return;
    const ctx = getContext();
    const s = readState(ctx.chatMetadata);
    if (!s) { el.textContent = '(no game loaded)'; return; }
    const loc = s.summary?.location ?? '?';
    const desc = getRoomDescription(ctx.chatMetadata);
    const bits = [];
    if (s.summary?.score !== null && s.summary?.score !== undefined) bits.push(`Score ${s.summary.score}`);
    if (s.summary?.moves !== null && s.summary?.moves !== undefined) bits.push(`Moves ${s.summary.moves}`);
    el.textContent = `${loc}${desc ? `\n\n${desc}` : ''}${bits.length ? `\n\n${bits.join(' · ')}` : ''}`;
}
```

In the interceptor, render after the turn runs:
```javascript
globalThis.ST_IF_interceptor = async function (chat, _contextSize, _abort, type) {
    const s = getSettings();
    if (!s || !s.enabled) return;
    try {
        await runTurn(buildDeps(), chat, type);
        renderRoomPanel();
    } catch (e) {
        console.error('[ST_IF] interceptor error', e);
    }
};
```

In `ensureStoryLoaded()`, seed the room description on a fresh game and render at the end. Replace the `if (!readState(...)) { ... } else { ... }` block's first branch body and add a render before the function returns:
```javascript
    if (!readState(ctx.chatMetadata)) {
        initState(ctx.chatMetadata, s.storyName, vm.save());
        setRoomDescription(ctx.chatMetadata, vm.getIntro());
        saveMetadataDebounced();
        showIntroIfDebug();
    } else {
        const snap = getActiveSnapshot(ctx.chatMetadata);
        if (snap) vm.restore(snap);
    }
```
…and at the very end of `ensureStoryLoaded()` (after the companion seeding block), add:
```javascript
    renderRoomPanel();
```

In the `wireSettingsUI` new-story callback, seed + render after `initState`:
```javascript
        await vm.load(base64ToBytes(s.storyBase64));
        initState(ctx.chatMetadata, name, vm.save());
        setRoomDescription(ctx.chatMetadata, vm.getIntro());
        await companionVM.load(base64ToBytes(s.storyBase64));
        setCompanion(ctx.chatMetadata, { snapshot: companionVM.save(), summary: companionVM.getStatus() });
        saveMetadataDebounced();
        showIntroIfDebug();
        renderRoomPanel();
```

In the `jQuery(async () => { ... })` init, after `await ensureStoryLoaded();`, add `renderRoomPanel();` (ensureStoryLoaded already renders, but this covers the no-story case so the box shows "(no game loaded)").

- [ ] **Step 4: Lint**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 5: Update the README**

In the README, add a short "Current room" bullet (a persistent box in the drawer showing the location + room prose + score/moves, updated on move/look) and note the narration is now character-forward (the companion stays present in the scene).

- [ ] **Step 6: Manual verification (requires ST runtime)**

Run: `npm start`, open ST, load a story, enable the extension, expand the ST_IF drawer.
Verify:
1. Replies keep `{{char}}` present and reacting (no pure-room travelogue); with a companion together, the companion is in the scene.
2. The "Current room" box shows the location + room prose; it updates when you move or `look`, and **keeps** the description through a non-move action (e.g. `take`).
3. The box persists across turns and survives a page reload.
Expected: as described; no console errors.

- [ ] **Step 7: Commit**

```bash
git add public/scripts/extensions/ST_IF/index.js public/scripts/extensions/ST_IF/settings.html public/scripts/extensions/ST_IF/style.css public/scripts/extensions/ST_IF/README.md
git commit -m "feat(ST_IF): persistent Current room panel + docs"
```

---

## Verification summary

- **Unit-tested (node --test):** `canon` character-forward + companionPresent; `state` roomDescription round-trip + legacy default; `turn` room capture on move/look, keep-through-action, together-branch companion line.
- **Manually verified (ST runtime):** character-forward replies, the persistent room box updating on move/look and surviving reloads.

## Open items

- Structured exits/items extraction remains a possible later toggle.
- A floating always-visible room panel (vs the drawer box) is deferred.
