# ST_IF Reliable Following + Direction Cues — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the companion's "stays near player" slider drive deterministic trailing (glued / trail / wander) built from the player's real move directions, and add "left heading <dir>" cues to the apart canon.

**Architecture:** Extract the player's compass moves from the translator's commands; a pure `zone(bias)` selects glued (mirror all moves), trail (queue one-per-turn), or wander (existing LLM `decideMove`). Logic stays pure/dependency-injected and unit-tested; ST wiring stays in `index.js`. Builds on the companion-location feature.

**Tech Stack:** Same as ST_IF — vanilla ES modules, vendored ifvms ZVM, `node --test`, ESLint.

---

## File structure

All under `public/scripts/extensions/ST_IF/`.

| File | Change |
|------|--------|
| `companion.js` | Add pure `extractMoves(cmds)` and `zone(bias)`. Keep `decideMove` (wander only). |
| `state.js` | `companion.followQueue`; `getFollowQueue`/`setFollowQueue`; `setCompanion` preserves the queue. |
| `canon.js` | `buildApartCanonBlock` gains optional `playerDir`/`companionDir`. |
| `turn.js` | Replace the LLM companion-move with zone logic; compute `playerDir`/`companionDir`; pass to canon + narration. **Existing companion turn tests are rewritten** (they encoded the old LLM-move behavior). |
| `index.js` | Add `companionBias` to `deps.settings`; keep `decideMove` wired for wander; pass `companionDir` to `onNarratePlayerRoom`. |
| `settings.html` | Tooltip describing the three zones. |

---

## Task 1: companion.js — `extractMoves` + `zone`

**Files:**
- Modify: `public/scripts/extensions/ST_IF/companion.js`
- Modify: `public/scripts/extensions/ST_IF/test/companion.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/companion.test.js`)**

```javascript
import { extractMoves, zone } from '../companion.js';

test('extractMoves keeps compass directions and drops other verbs', () => {
    assert.deepEqual(extractMoves(['take lantern', 'north']), ['north']);
    assert.deepEqual(extractMoves(['look']), []);
    assert.deepEqual(extractMoves([]), []);
    assert.deepEqual(extractMoves(['N', 'south', 'GET key']), ['n', 'south']);
});

test('zone maps bias to glued / trail / wander', () => {
    assert.equal(zone(0.8), 'glued');
    assert.equal(zone(0.66), 'glued');
    assert.equal(zone(0.5), 'trail');
    assert.equal(zone(0.34), 'trail');
    assert.equal(zone(0.33), 'wander');
    assert.equal(zone(0.2), 'wander');
    assert.equal(zone(undefined), 'trail'); // safe default when unset
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/companion.test.js`
Expected: FAIL — `extractMoves` / `zone` not exported.

- [ ] **Step 3: Implement in `companion.js`**

Add (after the `DIRECTIONS` set):

```javascript
/** Pull the compass-direction commands out of a translated command list, in order. */
export function extractMoves(cmds) {
    return (cmds || [])
        .map((c) => String(c).trim().toLowerCase())
        .filter((c) => DIRECTIONS.has(c));
}

/** Map the bias slider to a deterministic behavior zone. */
export function zone(bias) {
    const b = Number(bias);
    if (b >= 0.66) return 'glued';
    if (b <= 0.33) return 'wander';
    return 'trail';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/companion.test.js`
Expected: PASS (original 7 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/companion.js public/scripts/extensions/ST_IF/test/companion.test.js
git commit -m "feat(ST_IF): extractMoves + bias zone helpers"
```

---

## Task 2: state.js — follow queue

**Files:**
- Modify: `public/scripts/extensions/ST_IF/state.js`
- Modify: `public/scripts/extensions/ST_IF/test/state.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/state.test.js`)**

```javascript
import { getFollowQueue, setFollowQueue } from '../state.js';

test('follow queue defaults to empty and round-trips', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    assert.deepEqual(getFollowQueue(md), []);
    setFollowQueue(md, ['north', 'west']);
    assert.deepEqual(getFollowQueue(md), ['north', 'west']);
});

test('setCompanion preserves an existing follow queue', () => {
    const md = {};
    initState2(md, 'tiny.z5', 'SNAP0');
    setFollowQueue(md, ['south']);
    setCompanion(md, { snapshot: 'CSNAP1', summary: { location: 'Cave' } });
    assert.deepEqual(getFollowQueue(md), ['south'], 'queue survives a companion snapshot update');
});

test('getFollowQueue is empty for legacy companion without the field', () => {
    const md = { ST_IF: { storyId: 'x', snapshot: 'P', summary: null, history: [], companion: { snapshot: 'C', summary: null } } };
    assert.deepEqual(getFollowQueue(md), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/state.test.js`
Expected: FAIL — `getFollowQueue` / `setFollowQueue` not exported.

- [ ] **Step 3: Implement in `state.js`**

Update `initState`'s companion seed to include the queue, change `setCompanion` to preserve it, and add the accessors.

Replace the companion line in `initState`:
```javascript
        companion: { snapshot, summary: null, followQueue: [] },
```

Replace `setCompanion`:
```javascript
export function setCompanion(metadata, { snapshot, summary }) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.companion = { snapshot, summary: summary ?? null, followQueue: s.companion?.followQueue ?? [] };
}
```

Add:
```javascript
export function getFollowQueue(metadata) {
    return metadata[KEY]?.companion?.followQueue ?? [];
}

export function setFollowQueue(metadata, queue) {
    const s = metadata[KEY];
    if (!s) throw new Error('ST_IF state not initialized');
    s.companion = s.companion ?? { snapshot: s.snapshot, summary: null };
    s.companion.followQueue = Array.isArray(queue) ? queue : [];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/state.test.js`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/state.js public/scripts/extensions/ST_IF/test/state.test.js
git commit -m "feat(ST_IF): companion follow queue in state"
```

---

## Task 3: canon.js — direction cues

**Files:**
- Modify: `public/scripts/extensions/ST_IF/canon.js`
- Modify: `public/scripts/extensions/ST_IF/test/canon.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/canon.test.js`)**

```javascript
test('apart block adds companion and player departure directions when given', () => {
    const block = buildApartCanonBlock({
        companionRoom: 'Clearing', companionScene: 'Fog drifts.', playerLocation: 'Cave',
        playerDir: 'north', companionDir: 'east',
    });
    assert.match(block, /You headed east/);
    assert.match(block, /\{\{user\}\} headed north/);
});

test('apart block omits direction lines when dirs are null', () => {
    const block = buildApartCanonBlock({
        companionRoom: 'Clearing', companionScene: '', playerLocation: 'Cave',
        playerDir: null, companionDir: null,
    });
    assert.doesNotMatch(block, /headed/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/canon.test.js`
Expected: FAIL — direction lines not present.

- [ ] **Step 3: Implement — replace `buildApartCanonBlock` in `canon.js`**

```javascript
/**
 * Canon for an APART turn, from the companion's point of view. The narrator
 * ({{char}}) grounds in their own room and must not narrate {{user}}'s actions.
 * @param {{companionRoom:string, companionScene:string, playerLocation:string, playerDir?:string|null, companionDir?:string|null}} args
 */
export function buildApartCanonBlock({ companionRoom, companionScene, playerLocation, playerDir, companionDir }) {
    const lines = [
        '[GAME — ground truth. You ({{char}}) are on your own, apart from {{user}}.]',
        `You are at: ${companionRoom}.`,
    ];
    if (companionScene && companionScene.trim()) lines.push(companionScene.trim());
    if (companionDir) lines.push(`You headed ${companionDir}, leaving {{user}} behind.`);
    if (playerDir) lines.push(`{{user}} headed ${playerDir} as you parted.`);
    lines.push(`You do not know what {{user}} is doing; you last saw them near ${playerLocation}.`);
    lines.push('Narrate only your own situation, in character. Do not describe {{user}}\'s actions.');
    return lines.join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/canon.test.js`
Expected: PASS (existing apart tests still pass — they pass no dirs — plus 2 new).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/canon.js public/scripts/extensions/ST_IF/test/canon.test.js
git commit -m "feat(ST_IF): departure-direction cues in apart canon"
```

---

## Task 4: turn.js — zone-based companion movement

**Files:**
- Modify: `public/scripts/extensions/ST_IF/turn.js`
- Modify: `public/scripts/extensions/ST_IF/test/turn.test.js`

**The old companion turn tests encoded the LLM-move behavior and must be replaced** — under the new logic, default bias routes to *trail*, not the `companionMove` LLM call.

- [ ] **Step 1: Replace the old companion tests in `test/turn.test.js`**

Delete the four tests added by the companion feature: `'companion tracking off: ...'`, `'together: companion in same room ...'`, `'apart: companion moves to a different room ...'`, and `'apart with no move: companion looks ...'`. Keep `makeCompanionVM`. Replace them with:

```javascript
test('tracking off: companionVM untouched', async () => {
    const deps = makeDeps();
    deps.companionVM = makeCompanionVM('Cave');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: false, companionBias: 0.7 };
    await runTurn(deps, [{ is_user: true, mes: 'go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, []);
});

test('glued (bias>=0.66): mirrors all player moves, stays together', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'west'] });   // player moved N then W
    deps.companionVM = makeCompanionVM('Cave');                            // player VM reports 'Cave' regardless
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north then west' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north', 'west'], 'companion replays both moves');
    const { readTogether, getFollowQueue } = await import('../state.js');
    assert.deepEqual(getFollowQueue(deps.metadata), [], 'glued leaves no lag');
    // makeCompanionVM sets room = last cmd, but player VM is fixed 'Cave' -> apart in this fake; assert canon names player dir
    assert.match(deps._calls.setPrompt[0], /headed west/);
});

test('trail (mid bias): queues moves, consumes one per turn', async () => {
    const deps = makeDeps({ translate: async () => ['north', 'west'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.5 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north then west' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['north'], 'only the first queued move is consumed');
    const { getFollowQueue } = await import('../state.js');
    assert.deepEqual(getFollowQueue(deps.metadata), ['west'], 'remaining move stays queued');
});

test('wander (bias<=0.33): uses the LLM decideMove, ignores player moves', async () => {
    const deps = makeDeps({ translate: async () => ['north'] });
    deps.companionVM = makeCompanionVM('Cave');
    deps.companionMove = async () => 'south';
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.2 };
    await runTurn(deps, [{ is_user: true, mes: 'I go north' }], 'normal');
    assert.deepEqual(deps.companionVM.steps, ['south'], 'companion wanders south, not following north');
    const { getFollowQueue } = await import('../state.js');
    assert.deepEqual(getFollowQueue(deps.metadata), [], 'wander does not queue');
});
```

Note: `makeCompanionVM.step(cmd)` sets `room = cmd` for non-look, while the player VM is a fixed `'Cave'`, so these fakes are "apart" after a move — which is why the glued test asserts the `headed west` cue. That's fine for unit purposes; real VMs share the map.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: FAIL — zone logic not implemented (companion still uses the single LLM move).

- [ ] **Step 3: Update imports in `turn.js`** (`extractMoves`/`zone` come from `companion.js`)

```javascript
import { readState, recordTurn, getActiveSnapshot, setCompanion, setTogether, getFollowQueue, setFollowQueue } from './state.js';
import { translate as translateDefault } from './translator.js';
import { extractMoves, zone } from './companion.js';
import { buildCanonBlock, buildApartCanonBlock } from './canon.js';
```

- [ ] **Step 4: Replace the companion block (the `// 7. COMPANION ...` section through its closing `return;`) in `turn.js`**

```javascript
    // 7. COMPANION (position-only second marker), if tracking is on.
    if (settings.companionTracking && deps.companionVM?.loaded) {
        const companionVM = deps.companionVM;
        const playerRoom = status.location;
        const playerMoves = extractMoves(cmds);
        const playerDir = playerMoves.length ? playerMoves[playerMoves.length - 1] : null;

        const z = zone(settings.companionBias);
        let queue = getFollowQueue(metadata).slice();
        let companionDir = null;
        const companionOutputs = [];

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

- [ ] **Step 5: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: PASS — guards/action/RP/swipe/debug (unchanged) + tracking-off + glued + trail + wander.

- [ ] **Step 6: Full suite + lint**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS (all suites).
Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add public/scripts/extensions/ST_IF/turn.js public/scripts/extensions/ST_IF/test/turn.test.js
git commit -m "feat(ST_IF): deterministic glued/trail/wander companion movement"
```

---

## Task 5: index.js + settings wiring

**Files:**
- Modify: `public/scripts/extensions/ST_IF/index.js`
- Modify: `public/scripts/extensions/ST_IF/settings.html`

- [ ] **Step 1: Pass `companionBias` into `deps.settings` (index.js `buildDeps`)**

Replace the `settings:` line in `buildDeps()`:
```javascript
        settings: { strictness: s.strictness, injectStateOnRp: s.injectStateOnRp, companionTracking: s.companionTracking, companionBias: s.companionBias },
```

- [ ] **Step 2: Thread `companionDir` into the narration (index.js `onNarratePlayerRoom`)**

Replace the `onNarratePlayerRoom` destructure and prose prompt to mention the companion's exit:
```javascript
        onNarratePlayerRoom: async ({ playerRoom, outputs, companionDir }) => {
            const result = (outputs || []).join('\n').trim() || '(you wait)';
            const leftNote = companionDir ? ` {{char}} has just left, heading ${companionDir}.` : '';
            let prose;
            try {
                prose = await generateQuietPrompt({
                    quietPrompt: `[Narrate, in 2-3 vivid third-person sentences, the following happening to {{user}}, who is alone at "${playerRoom}".${leftNote} Do not voice {{char}}. Event:\n${result}]`,
                    responseLength: 160,
                    skipWIAN: true,
                });
            } catch (e) {
                console.error('[ST_IF] player-room narration failed', e);
                return;
            }
            postComment(`*(${playerRoom})* ${String(prose || '').trim()}`);
        },
```

- [ ] **Step 3: Update the bias control tooltip in `settings.html`**

Replace the bias label/input block:
```html
            <label for="st_if_bias" title="High = the companion mirrors your moves and stays with you. Middle = trails one room behind. Low = wanders on its own.">Companion stays near player (glued / trail / wander)</label>
            <input id="st_if_bias" type="range" min="0" max="1" step="0.1" class="text_pole" />
```

- [ ] **Step 4: Lint**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 5: Manual verification (requires ST runtime)**

Run: `npm start`, open ST, load a story, enable companion tracking.
Verify with the bias slider:
1. **High (≥0.7):** move around several rooms → `/if-state`-style debug shows companion in your room every turn (stays together).
2. **Middle (~0.5):** move two rooms in one turn → companion is one room behind, catches up next turn (brief apart, then together).
3. **Low (≤0.3):** companion strays on its own; apart turns name the departure direction ("{{user}} headed north as you parted" / the player-room comment notes "{{char}} has just left, heading <dir>").
Expected: each zone behaves distinctly; no console errors.

- [ ] **Step 6: Commit**

```bash
git add public/scripts/extensions/ST_IF/index.js public/scripts/extensions/ST_IF/settings.html
git commit -m "feat(ST_IF): wire companion bias zones + departure-direction narration"
```

---

## Task 6: README + final pass

**Files:**
- Modify: `public/scripts/extensions/ST_IF/README.md`

- [ ] **Step 1: Update the companion section**

In the "Companion location tracking" section, replace the bias bullet with the three zones (glued ≥0.66 mirrors your moves and stays with you; trail 0.34–0.65 follows one room behind; wander ≤0.33 strays via the LLM) and note the departure-direction cues. Add the limitation: glued/trail keep or trail you but don't reunite from afar (no map yet).

- [ ] **Step 2: Full suite**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS — canon, translator, state, turn, companion, vm.integration all green.

- [ ] **Step 3: Lint**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/scripts/extensions/ST_IF/README.md
git commit -m "docs(ST_IF): document companion follow zones + direction cues"
```

---

## Verification summary

- **Unit-tested (node --test):** `extractMoves`/`zone` (companion), `followQueue` (state), direction cues (canon), glued/trail/wander branches (turn).
- **Manually verified (ST runtime):** the three slider zones behave distinctly end-to-end, and apart turns name the departure direction.

## Open items

- Reuniting from afar (map learning / pathfinding — "C"/"D") remains deferred.
- Direction cues fire only on the turn a move happens (no persisted "last seen heading" across static apart turns).
