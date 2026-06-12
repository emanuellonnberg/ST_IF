# ST_IF Companion Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While together, the companion can act on the canonical world (light the lantern, open the door) via one quiet decision call, gated by an on/off toggle, an initiative level, and a safety level.

**Architecture:** Pure `decideUse` + `validateAction` in `companion.js`; `turn.js` runs the validated command on the **player VM** after the player's own commands, with a death-rollback, then re-persists the canonical snapshot so the together-sync mirrors her change; `canon.js` attributes the deed to `{{char}}`. Settings/wiring in `settings.js`/`index.js`.

**Tech Stack:** Same as ST_IF — vanilla ES modules, `node --test`, ESLint.

---

## File structure

All under `public/scripts/extensions/ST_IF/`.

| File | Change |
|------|--------|
| `companion.js` | `buildUsePrompt`, `decideUse` (fail-open), `validateAction` (blocklist / allowlist / single-command) |
| `canon.js` | optional `companionActionCmd` attribution line in the together canon |
| `turn.js` | together-action block: decide → validate → execute on player VM → death rollback → re-persist → canon; swipe reuses the recorded `companionCmd` |
| `settings.js` / `settings.html` | `companionActs` (off), `companionInitiative` (`need`), `companionActionSafety` (`safe`) + UI |
| `index.js` | `companionUse` dep + settings passthrough |
| `README.md` | document the feature |

---

## Task 1: companion.js — decideUse + validateAction

**Files:**
- Modify: `public/scripts/extensions/ST_IF/companion.js`
- Modify: `public/scripts/extensions/ST_IF/test/companion.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/companion.test.js`)**

```javascript
import { buildUsePrompt, decideUse, validateAction } from '../companion.js';

test('use prompt includes scene, player message, executed cmds, and initiative wording', () => {
    const p = buildUsePrompt('Nausicaä, light the lamp', 'A dark cellar.', ['south'], 'asked');
    assert.match(p, /light the lamp/);
    assert.match(p, /dark cellar/);
    assert.match(p, /south/);
    assert.match(p, /ONLY if/i);
    const p2 = buildUsePrompt('x', 'scene', [], 'proactive');
    assert.match(p2, /whenever/i);
});

test('decideUse parses a command and null, fails open on garbage/throw', async () => {
    assert.deepEqual(await decideUse('x', 's', [], 'need', async () => '{"command":"light lantern"}'),
        { command: 'light lantern' });
    assert.deepEqual(await decideUse('x', 's', [], 'need', async () => '{"command":null}'),
        { command: null });
    assert.deepEqual(await decideUse('x', 's', [], 'need', async () => 'no json'),
        { command: null });
    assert.deepEqual(await decideUse('x', 's', [], 'need', async () => { throw new Error('down'); }),
        { command: null });
});

test('validateAction: safe level allows allowlisted verbs, rejects others', () => {
    assert.equal(validateAction('light lantern', 'safe'), 'light lantern');
    assert.equal(validateAction('open door', 'safe'), 'open door');
    assert.equal(validateAction('take key', 'safe'), 'take key');
    assert.equal(validateAction('drop lantern', 'safe'), null);
    assert.equal(validateAction('attack troll', 'safe'), null);
    assert.equal(validateAction('give sword to troll', 'safe'), null);
});

test('validateAction: open level allows in-world verbs but never meta-verbs', () => {
    assert.equal(validateAction('attack troll', 'open'), 'attack troll');
    assert.equal(validateAction('drop lantern', 'open'), 'drop lantern');
    assert.equal(validateAction('restart', 'open'), null);
    assert.equal(validateAction('quit', 'open'), null);
    assert.equal(validateAction('save', 'open'), null);
    assert.equal(validateAction('restore game', 'open'), null);
    assert.equal(validateAction('undo', 'open'), null);
});

test('validateAction: rejects multi-command strings and junk', () => {
    assert.equal(validateAction('open door. take key', 'open'), null);
    assert.equal(validateAction('open door then go north', 'open'), null);
    assert.equal(validateAction('open door\ntake key', 'open'), null);
    assert.equal(validateAction(null, 'safe'), null);
    assert.equal(validateAction('   ', 'safe'), null);
    assert.equal(validateAction(42, 'safe'), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/companion.test.js`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement in `companion.js`** (append at the end)

```javascript
// --- Companion world-actions (run on the canonical player VM while together) ---

const META_VERBS = new Set(['save', 'restore', 'restart', 'quit', 'undo', 'script']);
const SAFE_VERBS = new Set([
    'light', 'extinguish', 'open', 'close', 'read', 'take', 'get', 'push', 'pull',
    'turn', 'ring', 'knock', 'touch', 'examine', 'look', 'search', 'unlock', 'wear',
    'tie', 'untie',
]);

const INITIATIVE_NOTE = {
    asked: 'Act ONLY if {{user}}\'s message explicitly asks {{char}} to do something. Otherwise respond with null.',
    need: 'Act if {{user}} asks {{char}} to do something, or if the scene has an obvious immediate need {{char}} would naturally handle. Otherwise respond with null.',
    proactive: 'Act whenever a useful action presents itself; respond with null only if nothing is worth doing.',
};

export function buildUsePrompt(playerText, sceneDesc, playerCmds, initiative) {
    const note = INITIATIVE_NOTE[initiative] ?? INITIATIVE_NOTE.need;
    const done = playerCmds.length ? `Already done this turn by {{user}} (do NOT repeat): ${playerCmds.join('; ')}.` : '';
    return [
        'You decide whether a companion character ({{char}}) performs ONE Interactive Fiction parser action this turn.',
        `Scene: ${sceneDesc}`,
        `{{user}} said/did: ${playerText}`,
        done,
        note,
        'Respond with ONLY JSON: {"command":"<short imperative parser command>"} or {"command":null}.',
    ].filter(Boolean).join('\n');
}

/**
 * @returns {Promise<{command: string|null}>} fail-open to null on garbage/error.
 */
export async function decideUse(playerText, sceneDesc, playerCmds, initiative, generate) {
    let raw;
    try {
        raw = await generate(buildUsePrompt(playerText, sceneDesc, playerCmds, initiative));
    } catch {
        return { command: null };
    }
    const text = String(raw ?? '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return { command: null };
    try {
        const obj = JSON.parse(text.slice(start, end + 1));
        return { command: typeof obj.command === 'string' && obj.command.trim() ? obj.command.trim() : null };
    } catch {
        return { command: null };
    }
}

/**
 * Validate a companion action command against the safety level.
 * @returns {string|null} the cleaned command, or null if rejected.
 */
export function validateAction(command, safety) {
    if (typeof command !== 'string') return null;
    const cmd = command.trim();
    if (!cmd) return null;
    if (/[\n.;]|\bthen\b/i.test(cmd)) return null;            // one command max
    const verb = cmd.split(/\s+/)[0].toLowerCase();
    if (META_VERBS.has(verb)) return null;                    // never touch the session
    if (safety === 'safe' && !SAFE_VERBS.has(verb)) return null;
    return cmd;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/companion.test.js`
Expected: PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/companion.js public/scripts/extensions/ST_IF/test/companion.test.js
git commit -m "feat(ST_IF): decideUse + validateAction for companion world-actions"
```

---

## Task 2: canon.js — action attribution line

**Files:**
- Modify: `public/scripts/extensions/ST_IF/canon.js`
- Modify: `public/scripts/extensions/ST_IF/test/canon.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/canon.test.js`)**

```javascript
test('together canon attributes a companion action when given', () => {
    const b = buildCanonBlock({
        outputs: ['Taken.', 'The brass lantern is now on.'],
        status: { location: 'Cellar', score: 25, moves: 10 },
        ranCommands: true, injectStateOnRp: false,
        companionPresent: true, companionActionCmd: 'light lantern',
    });
    assert.match(b, /"light lantern".*\{\{char\}\}|\{\{char\}\}.*"light lantern"/);
    assert.match(b, /deed|performed|did/i);
});

test('no attribution line without a companion action', () => {
    const b = buildCanonBlock({
        outputs: ['Taken.'], status: { location: 'Cellar', score: 25, moves: 10 },
        ranCommands: true, injectStateOnRp: false, companionPresent: true,
    });
    assert.doesNotMatch(b, /deed/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/canon.test.js`
Expected: FAIL — no attribution line.

- [ ] **Step 3: Implement in `canon.js`**

Update `buildCanonBlock`'s signature and add the line before the companion-present line:

```javascript
export function buildCanonBlock({ outputs, status, ranCommands, injectStateOnRp, companionPresent, companionActionCmd }) {
    if (!ranCommands) {
        if (!injectStateOnRp) return '';
        return `[GAME STATE — ground truth, do not contradict]\n${statusLine(status)}`;
    }
    const result = outputs.join('\n').trim();
    const lines = [
        '[GAME — canon ground truth; never contradict it. The "Action result" below is exactly what happened — honor it, including failures (if it didn\'t work, it didn\'t work, and {{char}} sees that). Stay in character as {{char}}: react, speak, and act — and weave the room\'s details (exits, objects, mood) into the scene through {{char}}\'s eyes. Don\'t omit the setting; don\'t just transcribe it.]',
        `Action result: ${result}`,
        statusLine(status),
    ];
    if (companionActionCmd) lines.push(`The action "${companionActionCmd}" was performed by {{char}} — its result above is {{char}}'s own deed; narrate it as theirs.`);
    if (companionPresent) lines.push('{{char}} is here with you.');
    return lines.join('\n');
}
```

Also update the JSDoc param list above it to include `companionActionCmd?: string|null`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/canon.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add public/scripts/extensions/ST_IF/canon.js public/scripts/extensions/ST_IF/test/canon.test.js
git commit -m "feat(ST_IF): canon attribution line for companion actions"
```

---

## Task 3: turn.js — execute her action on the canonical VM

**Files:**
- Modify: `public/scripts/extensions/ST_IF/turn.js`
- Modify: `public/scripts/extensions/ST_IF/test/turn.test.js`

- [ ] **Step 1: Write the failing tests (append to `test/turn.test.js`)**

```javascript
function makeActVM() {
    // a player-VM fake: 'light lantern' works, 'pull lever' kills you
    return {
        loaded: true, room: 'Cellar', steps: [], restores: [], _state: 'PSNAP',
        step(cmd) {
            this.steps.push(cmd);
            if (cmd === 'light lantern') { this._state = 'PSNAP+lit'; return 'The brass lantern is now on.'; }
            if (cmd === 'pull lever') { this._state = 'DEAD'; return '\n    **** You have died ****\n'; }
            if (cmd === 'look') return 'Cellar\nA dark and damp cellar.';
            return `You ${cmd}.`;
        },
        save() { return this._state; },
        restore(s) { this.restores.push(s); this._state = s; },
        getStatus() { return { location: this.room, score: 25, moves: 10 }; },
    };
}

function actDeps(useCmd, vm) {
    const deps = makeDeps({ translate: async () => ['look'], vm });
    deps.companionVM = makeCompanionVM('Cellar');                 // same room → together
    deps.companionUse = async () => ({ command: useCmd });
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8, companionActs: true, companionActionSafety: 'safe' };
    return deps;
}

test('together + acts: her validated action runs on the player VM and is attributed', async () => {
    const vm = makeActVM();
    const deps = actDeps('light lantern', vm);
    await runTurn(deps, [{ is_user: true, mes: 'Nausicaä, light the lamp' }], 'normal');
    assert.ok(vm.steps.includes('light lantern'), 'her command executed on the canonical VM');
    assert.match(deps._calls.setPrompt[0], /light lantern/, 'canon attributes the action');
    assert.match(deps._calls.setPrompt[0], /brass lantern is now on/i, 'her result joined the outputs');
    const s = readState(deps.metadata);
    assert.equal(s.snapshot, 'PSNAP+lit', 'canonical snapshot re-persisted with her change');
    assert.equal(s.history[s.history.length - 1].companionCmd, 'light lantern', 'recorded for swipe reuse');
});

test('death outcome rolls her action back', async () => {
    const vm = makeActVM();
    const deps = actDeps('pull lever', vm);
    deps.settings.companionActionSafety = 'open';                 // 'pull' is allowlisted anyway, but be explicit
    await runTurn(deps, [{ is_user: true, mes: 'try the lever' }], 'normal');
    assert.ok(vm.restores.includes('PSNAP'), 'rolled back to the pre-action snapshot');
    assert.equal(readState(deps.metadata).snapshot, 'PSNAP', 'canonical snapshot unchanged');
    assert.doesNotMatch(deps._calls.setPrompt[0] ?? '', /performed by \{\{char\}\}/, 'no attribution');
});

test('blocked verb never executes', async () => {
    const vm = makeActVM();
    const deps = actDeps('drop lantern', vm);                     // safe level blocks drop
    await runTurn(deps, [{ is_user: true, mes: 'hold this' }], 'normal');
    assert.ok(!vm.steps.includes('drop lantern'));
});

test('acts toggle off / apart: companionUse never called', async () => {
    const vm = makeActVM();
    const depsOff = actDeps('light lantern', vm);
    depsOff.settings.companionActs = false;
    depsOff.companionUse = async () => { throw new Error('must not be called'); };
    await runTurn(depsOff, [{ is_user: true, mes: 'x' }], 'normal');

    const depsApart = actDeps('light lantern', makeActVM());
    depsApart.companionVM = makeCompanionVM('Elsewhere');         // apart
    depsApart.companionUse = async () => { throw new Error('must not be called'); };
    await runTurn(depsApart, [{ is_user: true, mes: 'x' }], 'normal');
    assert.ok(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: FAIL — action block not implemented.

- [ ] **Step 3: Implement in `turn.js`**

Add to the companion.js import: `validateAction`; add `getRoomDescription` to the state import:
```javascript
import { extractMoves, zone, detectShout, validateAction } from './companion.js';
```
…and extend the state import list with `getRoomDescription`.

Insert AFTER `const together = playerRoom === companionStatus.location;` and BEFORE the together-sync `if (together) {` block:

```javascript
        // 7b. COMPANION ACTION — while together she may act on the CANONICAL world.
        let companionActionCmd = null;
        let canonSnap = snapshot;
        if (together && settings.companionActs && deps.companionUse) {
            const decision = await deps.companionUse(player.text, getRoomDescription(metadata) || outputs.join('\n'), cmds);
            const actCmd = validateAction(decision?.command, settings.companionActionSafety);
            if (actCmd) {
                const preSnap = vm.save();
                const out = vm.step(actCmd);
                if (/you have died|\*\*\*\*/i.test(out)) {
                    vm.restore(preSnap);                  // her action would kill the avatar — dropped
                } else {
                    companionActionCmd = actCmd;
                    outputs.push(out);
                    // The world changed after the canonical persist — re-persist.
                    const s2 = readState(metadata);
                    canonSnap = vm.save();
                    s2.snapshot = canonSnap;
                    s2.summary = vm.getStatus();
                    const last = s2.history[s2.history.length - 1];
                    if (last) { last.outputs = outputs; last.companionCmd = actCmd; }
                }
            }
        }
```

Update the together-sync to use `canonSnap`:
```javascript
        if (together) {
            // While together, the companion shares the player's world (inherits puzzle
            // progress — unlocked doors, taken items); sync its VM to the player's snapshot.
            companionVM.restore(canonSnap);
            setCompanion(metadata, { snapshot: canonSnap, summary: companionVM.getStatus() });
        } else {
```

Update the together canon call to refresh the status and attribute the action:
```javascript
        if (together) {
            const statusForCanon = companionActionCmd ? vm.getStatus() : status;
            const block = buildCanonBlock({ outputs, status: statusForCanon, ranCommands: cmds.length > 0, injectStateOnRp: settings.injectStateOnRp, companionPresent: true, companionActionCmd });
            if (block) setPrompt(block);
        } else {
```

And in the SWIPE branch, pass the recorded command so re-rolls keep the attribution — change its `buildCanonBlock` call to:
```javascript
        const block = buildCanonBlock({
            outputs: reuseOutputs,
            status,
            ranCommands: (lastTurn.cmds ?? []).length > 0,
            injectStateOnRp: settings.injectStateOnRp,
            companionActionCmd: lastTurn.companionCmd ?? null,
        });
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: PASS — existing + 4 new.

- [ ] **Step 5: Full suite + lint**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS.
Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add public/scripts/extensions/ST_IF/turn.js public/scripts/extensions/ST_IF/test/turn.test.js
git commit -m "feat(ST_IF): companion acts on the canonical world while together"
```

---

## Task 4: settings, index wiring, README

**Files:**
- Modify: `public/scripts/extensions/ST_IF/settings.js`
- Modify: `public/scripts/extensions/ST_IF/settings.html`
- Modify: `public/scripts/extensions/ST_IF/index.js`
- Modify: `public/scripts/extensions/ST_IF/README.md`

- [ ] **Step 1: Settings defaults + wiring (settings.js)**

In `defaultSettings`, after `showHud`:
```javascript
    companionActs: false,            // companion may act on the world while together
    companionInitiative: 'need',     // asked | need | proactive
    companionActionSafety: 'safe',   // safe (verb allowlist) | open
```

In `wireSettingsUI`, after the HUD toggle handler:
```javascript
    $('#st_if_acts').prop('checked', s.companionActs).on('change', function () {
        s.companionActs = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_initiative').val(s.companionInitiative).on('change', function () {
        s.companionInitiative = String($(this).val()); saveSettingsDebounced();
    });
    $('#st_if_act_safety').val(s.companionActionSafety).on('change', function () {
        s.companionActionSafety = String($(this).val()); saveSettingsDebounced();
    });
```

- [ ] **Step 2: Settings UI (settings.html)** — after the HUD toggle label block:

```html
            <label class="checkbox_label" title="While together, the companion may perform one game action per turn (it really happens in the world).">
                <input id="st_if_acts" type="checkbox" />
                <span>Companion can act (use things)</span>
            </label>

            <label for="st_if_initiative">Companion initiative</label>
            <select id="st_if_initiative" class="text_pole">
                <option value="asked">Only when asked</option>
                <option value="need">Asked or obvious need</option>
                <option value="proactive">Fully proactive</option>
            </select>

            <label for="st_if_act_safety">Action safety</label>
            <select id="st_if_act_safety" class="text_pole">
                <option value="safe">Safe verbs only</option>
                <option value="open">Unrestricted (still no save/restart)</option>
            </select>
```

- [ ] **Step 3: index.js wiring**

Add `decideUse` to the companion import:
```javascript
import { decideMove, decideAgency, decideUse } from './companion.js';
```

In `buildDeps()`, extend `settings` and add the dep:
```javascript
        settings: { strictness: s.strictness, injectStateOnRp: s.injectStateOnRp, companionTracking: s.companionTracking, companionBias: s.companionBias, companionAgency: s.companionAgency, companionActs: s.companionActs, companionActionSafety: s.companionActionSafety },
        companionUse: (playerText, scene, playerCmds) =>
            decideUse(playerText, scene, playerCmds, getSettings().companionInitiative,
                (prompt) => generateQuietPrompt({ quietPrompt: prompt, responseLength: 40, skipWIAN: true })),
```

- [ ] **Step 4: Lint + full suite**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
Expected: no errors.
Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
Expected: PASS.

- [ ] **Step 5: README**

Add a "Companion can act" bullet under the companion section: while together her actions run for real in the shared world (one action per turn, narrated as hers); initiative setting (asked / need / proactive); safety setting (safe verb allowlist vs unrestricted, with save/restart/quit always blocked and any lethal outcome rolled back); apart she cannot affect the real world (fork limitation); inventory is mechanically shared.

- [ ] **Step 6: Manual verification (requires ST runtime)**

Run: hard-refresh ST, enable companion tracking + "Companion can act", play together.
Verify:
1. "Nausicaä, light the lantern" (while you hold it unlit) → the lamp actually turns on (HUD inventory shows "providing light"), narration credits her.
2. Initiative 'asked': she doesn't act unprompted; 'proactive': she occasionally does.
3. Safety 'safe': ask her to drop the lantern → she declines/no action; switch to 'open' → she can.
4. Apart: she never acts on the real world.
Expected: all behave; no console errors.

- [ ] **Step 7: Commit**

```bash
git add public/scripts/extensions/ST_IF/settings.js public/scripts/extensions/ST_IF/settings.html public/scripts/extensions/ST_IF/index.js public/scripts/extensions/ST_IF/README.md
git commit -m "feat(ST_IF): wire companion-acts settings and decision call"
```

---

## Verification summary

- **Unit (node --test):** `validateAction` (allowlist / blocklist / multi-command / junk), `decideUse` (parse + fail-open), `buildUsePrompt` (initiative wording, don't-repeat list), canon attribution line, turn-level: execute + attribute + re-persist + history record, death rollback, blocked verb, toggle-off/apart never calls.
- **Manual (ST runtime):** the four scenarios in Task 4 Step 6.

## Open items

- Acting while apart stays impossible (single-protagonist fork; documented).
- Multi-step companion plans and a confirmation UI are out of scope (safety levels are the control surface).
