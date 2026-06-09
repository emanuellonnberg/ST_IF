# ST_IF Companion Agency Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in toggle where the companion decides each turn — follow / hang back / go its own way — via one LLM call, with the slider as a clinginess lean.

**Architecture:** A pure `decideAgency` in `companion.js` returns `{action, direction}`; `turn.js` gains an agency branch (before the existing deterministic zone logic) that shares the same scene/together/persist/canon tail. Toggle defaults off, so deterministic behavior is unchanged. Logic stays pure/DI and unit-tested.

**Tech Stack:** Same as ST_IF — vanilla ES modules, vendored ifvms ZVM, `node --test`, ESLint.

---

## File structure

All under `public/scripts/extensions/ST_IF/`.

| File | Change |
|------|--------|
| `companion.js` | Add pure `buildAgencyPrompt` + `decideAgency`. |
| `turn.js` | Add the `companionAgency` branch; restructure the companion block so both paths share one tail. |
| `settings.js` / `settings.html` | `companionAgency` toggle (default false). |
| `index.js` | Add `companionAgency` to `deps.settings`; wire `deps.companionDecide`. |

`state.js` and `canon.js` unchanged.

---

## Task 1: companion.js — `decideAgency`

**Files:**
- Modify: `public/scripts/extensions/ST_IF/companion.js`
- Modify: `public/scripts/extensions/ST_IF/test/companion.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/companion.test.js`)**

```javascript
import { buildAgencyPrompt, decideAgency } from '../companion.js';

test('agency prompt includes rooms, player moves, and the clinginess lean', () => {
    const p = buildAgencyPrompt('I sprint off', 'Cave', 'Hall', ['north'], 0.8);
    assert.match(p, /Cave/);
    assert.match(p, /Hall/);
    assert.match(p, /north/);
    assert.match(p, /I sprint off/);
    assert.match(p, /rarely break off/i);
});

test('decideAgency parses follow / stay / move', async () => {
    assert.deepEqual(await decideAgency('x', 'A', 'B', ['north'], 0.7, async () => '{"action":"follow"}'),
        { action: 'follow', direction: null });
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => '{"action":"stay"}'),
        { action: 'stay', direction: null });
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.3, async () => '{"action":"move","direction":"south"}'),
        { action: 'move', direction: 'south' });
});

test('decideAgency downgrades a move with a non-direction to stay', async () => {
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.3, async () => '{"action":"move","direction":"take lamp"}'),
        { action: 'stay', direction: null });
});

test('decideAgency fails open to follow on unknown action, garbage, or throw', async () => {
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => '{"action":"dance"}'),
        { action: 'follow', direction: null });
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => 'no json here'),
        { action: 'follow', direction: null });
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => { throw new Error('down'); }),
        { action: 'follow', direction: null });
});

test('decideAgency extracts JSON wrapped in prose', async () => {
    assert.deepEqual(await decideAgency('x', 'A', 'B', [], 0.7, async () => 'Sure:\n{"action":"stay"}\nok'),
        { action: 'stay', direction: null });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/companion.test.js`
Expected: FAIL — `decideAgency` / `buildAgencyPrompt` not exported.

- [ ] **Step 3: Implement in `companion.js`**

Add (after `decideMove`):

```javascript
const ACTIONS = new Set(['follow', 'stay', 'move']);

export function buildAgencyPrompt(playerText, playerRoom, companionRoom, playerMoves, bias) {
    const lean = bias >= 0.66 ? 'You strongly prefer to stay with {{user}} and rarely break off.'
        : bias <= 0.33 ? 'You are independent and often go your own way.'
            : 'You balance staying with them against doing your own thing.';
    const movesNote = playerMoves.length
        ? `{{user}} just moved: ${playerMoves.join(', ')}.`
        : '{{user}} did not move this turn.';
    return [
        'You control a companion character on a map. Decide what they do THIS turn.',
        `The companion is at: ${companionRoom}. {{user}} is at: ${playerRoom}.`,
        movesNote,
        `{{user}} said/did: ${playerText}`,
        `Disposition: ${lean}`,
        'Choose ONE: follow {{user}} (go where they went), stay (hang back here), or move (go your own way).',
        'Respond with ONLY JSON: {"action":"follow"|"stay"|"move","direction":"<compass word or null>"}.',
    ].join('\n');
}

function extractObject(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

/**
 * @returns {Promise<{action:'follow'|'stay'|'move', direction:string|null}>}
 */
export async function decideAgency(playerText, playerRoom, companionRoom, playerMoves, bias, generate) {
    let raw;
    try {
        raw = await generate(buildAgencyPrompt(playerText, playerRoom, companionRoom, playerMoves, bias));
    } catch {
        return { action: 'follow', direction: null };
    }
    const obj = extractObject(String(raw ?? ''));
    if (!obj || !ACTIONS.has(obj.action)) return { action: 'follow', direction: null };
    if (obj.action === 'move') {
        const d = typeof obj.direction === 'string' ? obj.direction.trim().toLowerCase() : '';
        if (!DIRECTIONS.has(d)) return { action: 'stay', direction: null };
        return { action: 'move', direction: d };
    }
    return { action: obj.action, direction: null };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/companion.test.js`
Expected: PASS (existing 9 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/companion.js public/scripts/extensions/ST_IF/test/companion.test.js
git commit -m "feat(ST_IF): decideAgency — follow/stay/move companion decision"
```

---

## Task 2: turn.js — agency branch

**Files:**
- Modify: `public/scripts/extensions/ST_IF/turn.js`
- Modify: `public/scripts/extensions/ST_IF/test/turn.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/turn.test.js`)**

```javascript
test('agency follow: mirrors all player moves', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'west'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionDecide = async () => ({ action: 'follow', direction: null });
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionAgency: true, companionBias: 0.8 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north then west' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north', 'west']);
});

test('agency move: steps the chosen direction', async () => {
    const deps = makeDeps({ translate: async () => ['north'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionDecide = async () => ({ action: 'move', direction: 'south' });
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionAgency: true, companionBias: 0.5 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['south']);
});

test('agency stay: no movement (only a look to describe the room)', async () => {
    const deps = makeDeps({ translate: async () => ['north'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionDecide = async () => ({ action: 'stay', direction: null });
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionAgency: true, companionBias: 0.5 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['look']);
});

test('agency off: zone logic runs, companionDecide is never called', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'west'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionDecide = async () => { throw new Error('must not call agency when off'); };
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionAgency: false, companionBias: 0.5 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north then west' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north'], 'trail zone consumed one move');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: FAIL — agency branch not implemented.

- [ ] **Step 3: Replace the companion block in `turn.js`**

Replace the entire `// 7. COMPANION ...` block (from that comment through its closing `return;`) with:

```javascript
    // 7. COMPANION (position-only second marker), if tracking is on.
    if (settings.companionTracking && deps.companionVM?.loaded) {
        const companionVM = deps.companionVM;
        const playerRoom = status.location;
        const playerMoves = extractMoves(cmds);
        const playerDir = playerMoves.length ? playerMoves[playerMoves.length - 1] : null;

        let companionDir = null;
        const companionOutputs = [];
        let queue = getFollowQueue(metadata).slice();

        if (settings.companionAgency) {
            // The companion decides for itself: follow / stay / own-way.
            const decision = await deps.companionDecide(player.text, playerRoom, companionVM.getStatus().location, playerMoves);
            if (decision.action === 'follow') {
                for (const d of playerMoves) companionOutputs.push(companionVM.step(d));
                if (playerMoves.length) companionDir = playerMoves[playerMoves.length - 1];
            } else if (decision.action === 'move' && decision.direction) {
                companionDir = decision.direction;
                companionOutputs.push(companionVM.step(decision.direction));
            } // 'stay' → no step
            queue = [];   // agency mode does not use the trail queue
        } else {
            // Deterministic zones.
            const z = zone(settings.companionBias);
            if (z === 'glued') {
                for (const d of playerMoves) companionOutputs.push(companionVM.step(d));
                if (playerMoves.length) companionDir = playerMoves[playerMoves.length - 1];
                queue = [];
            } else if (z === 'trail') {
                queue.push(...playerMoves);
                if (queue.length) {
                    companionDir = queue.shift();
                    companionOutputs.push(companionVM.step(companionDir));
                }
            } else { // wander
                const d = await deps.companionMove(player.text, playerRoom, companionVM.getStatus().location);
                if (d) {
                    companionDir = d;
                    companionOutputs.push(companionVM.step(d));
                }
                queue = [];
            }
        }

        const companionScene = companionOutputs.length
            ? companionOutputs[companionOutputs.length - 1]
            : companionVM.step('look');
        const companionStatus = companionVM.getStatus();
        const together = playerRoom === companionStatus.location;

        setCompanion(metadata, { snapshot: companionVM.save(), summary: companionStatus });
        setFollowQueue(metadata, queue);
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
                playerDir,
                companionDir,
            });
            setPrompt(block);
            if (deps.onNarratePlayerRoom) {
                await deps.onNarratePlayerRoom({ playerRoom, outputs, cmds, msgIndex: player.index, companionDir });
            }
        }
        if (deps.debugLog && cmds.length) deps.debugLog({ outputs, status, cmds });
        return;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: PASS — existing zone tests (glued/trail/wander/off) + 4 new agency tests.

- [ ] **Step 5: Full suite + lint**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS (all suites).
Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add public/scripts/extensions/ST_IF/turn.js public/scripts/extensions/ST_IF/test/turn.test.js
git commit -m "feat(ST_IF): companion agency branch in turn orchestration"
```

---

## Task 3: settings + index wiring

**Files:**
- Modify: `public/scripts/extensions/ST_IF/settings.js`
- Modify: `public/scripts/extensions/ST_IF/settings.html`
- Modify: `public/scripts/extensions/ST_IF/index.js`

- [ ] **Step 1: Add the setting default + wiring (settings.js)**

In `defaultSettings`, after `companionBias`:
```javascript
    companionAgency: false,   // LLM decides follow/stay/move instead of the deterministic zones
```

In `wireSettingsUI`, after the `st_if_bias` handler:
```javascript
    $('#st_if_agency').prop('checked', s.companionAgency).on('change', function () {
        s.companionAgency = $(this).prop('checked'); saveSettingsDebounced();
    });
```

- [ ] **Step 2: Add the toggle to settings.html**

After the bias range input, add:
```html
            <label class="checkbox_label" title="Let the companion decide each turn (follow, hang back, or go its own way). The slider becomes how clingy it is.">
                <input id="st_if_agency" type="checkbox" />
                <span>Companion can choose (agency)</span>
            </label>
```

- [ ] **Step 3: Wire index.js — settings + `companionDecide`**

Add the import:
```javascript
import { decideMove, decideAgency } from './companion.js';
```

In `buildDeps()`, extend `settings` and add `companionDecide`:
```javascript
        settings: { strictness: s.strictness, injectStateOnRp: s.injectStateOnRp, companionTracking: s.companionTracking, companionBias: s.companionBias, companionAgency: s.companionAgency },
        companionDecide: (playerText, playerRoom, companionRoom, playerMoves) =>
            decideAgency(playerText, playerRoom, companionRoom, playerMoves, getSettings().companionBias,
                (prompt) => generateQuietPrompt({ quietPrompt: prompt, responseLength: 40, skipWIAN: true })),
```

- [ ] **Step 4: Lint**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 5: Manual verification (requires ST runtime)**

Run: `npm start`, open ST, load a story, enable companion tracking AND "Companion can choose (agency)".
Verify:
1. **High slider (~0.8):** the companion mostly follows you but occasionally hangs back / wanders for story reasons.
2. **Low slider (~0.2):** it frequently goes its own way.
3. **Toggle off:** behavior is identical to the deterministic zones (glued at high, etc.).
Expected: agency feels reactive; no console errors.

- [ ] **Step 6: Commit**

```bash
git add public/scripts/extensions/ST_IF/settings.js public/scripts/extensions/ST_IF/settings.html public/scripts/extensions/ST_IF/index.js
git commit -m "feat(ST_IF): wire companion agency toggle"
```

---

## Task 4: README + final pass

**Files:**
- Modify: `public/scripts/extensions/ST_IF/README.md`

- [ ] **Step 1: Document the toggle**

In the companion section, add a "Companion can choose (agency)" paragraph: off = deterministic zones; on = the companion decides each turn (follow / hang back / go its own way) and the slider becomes its clinginess lean (high = sticks with you but can break off; low = independent). Note it costs one extra LLM call per turn and shares the same "can't reunite from afar" limitation.

- [ ] **Step 2: Full suite**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS — all suites green.

- [ ] **Step 3: Lint**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/scripts/extensions/ST_IF/README.md
git commit -m "docs(ST_IF): document companion agency toggle"
```

---

## Verification summary

- **Unit-tested (node --test):** `decideAgency` (follow/stay/move parsing, bad-direction → stay, fail-open to follow, prose extraction); `turn.js` agency branch (follow mirrors, move steps, stay no-op, off → zone logic, agency never called when off).
- **Manually verified (ST runtime):** the toggle changes behavior; high vs low slider lean; off matches the deterministic zones.

## Open items

- Reuniting from afar (map learning / pathfinding) remains deferred.
- Agency `move` is one step per turn (no multi-room own-way travel), matching the rest.
