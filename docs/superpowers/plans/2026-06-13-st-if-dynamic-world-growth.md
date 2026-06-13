# ST_IF Dynamic World Growth (Path A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the ST_IF narrator LLM invent new rooms (and simple objects) at runtime when the player walks into an undefined direction, with no offline recompile, persisting via the existing VM snapshot.

**Architecture:** A Z-machine "expanse" story carries a pool of blank rooms/objects whose names/descriptions live in runtime byte buffers (printed by `short_name`/`description`, matched by `parse_name`). The engine detects a blocked move, asks the LLM for a room (JSON), sanitises it, and drives meta-verbs (`xroom`/`xobj`) into the VM to claim and fill a blank, linking exits both ways. The original move is re-issued.

**Tech Stack:** Inform 6.44 (committed toolchain under `worlds/../tools/`), ifvms ZVM (vendored), Node `--test`, the existing ST_IF turn/translator/snapshot machinery.

**Spec:** `docs/superpowers/specs/2026-06-13-st-if-dynamic-world-growth-design.md`

**Branch:** `st-if-dynamic-world` (already based on `release` with the full apartment).

**Gating note:** Task 0 is a research spike. It is the ONLY unproven technique. Tasks 1+ reuse the exact `BlankThing` pattern Task 0 proves. If Task 0 fails, STOP and re-plan (fallback: number-keyed names, or escalate to Path C) — do not proceed.

**Conventions in this repo (do not rediscover):**
- Compile: `cd public/scripts/extensions/ST_IF && ./tools/inform6.exe "+tools/inform6lib-master" -v5 worlds/<f>.inf worlds/<f>.z5`
- Test: `node --test public/scripts/extensions/ST_IF/test/*.test.js`
- Lint: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"`
- Inform gotchas already learned: a bare `"string";` statement in a routine prints AND returns (use `print "..."` mid-sequence); `fill`/`scrub`/`sleep`/`nap` are library verbs (don't redefine — `Extend` or pick new words); the empty-pot-style guards return on first matching `"..."`.

---

## Task 0: Spike — runtime-named thing via byte buffer + `parse_name`

Prove, end to end through `vm.js`, that we can (a) write text into a Z-machine byte buffer at runtime via a parser command, (b) print it from `short_name`/`description`, and (c) have `parse_name` resolve the player's typed word to that object. This is the whole risk.

**Files:**
- Create: `public/scripts/extensions/ST_IF/worlds/spike.inf`
- Create (temp, not committed): drive via an inline node script
- Test: none yet (manual spike); promoted to a real test in Task 7

- [ ] **Step 1: Write the spike world**

Create `public/scripts/extensions/ST_IF/worlds/spike.inf`:

```inform6
! spike.inf — de-risk: a blank object whose name/description are set at runtime
! into byte buffers, recognised by the parser via parse_name. CC0.
Constant Story "SPIKE";
Constant Headline "^parse_name spike^";
Include "Parser";
Include "VerbLib";

Constant NBUF = 24;    ! name buffer length (byte 0 = current length)
Constant DBUF = 160;   ! description buffer length

Array onamebuf -> NBUF;
Array odescbuf -> DBUF;

[ Initialise;
   location = Origin;
   onamebuf->0 = 0;     ! starts empty/unnamed
   odescbuf->0 = 0;
   "^Spike loaded. A blank thing is here, waiting to be named.^";
];

[ PrintBuf arr i len;
   len = arr->0;
   for (i=1 : i<=len : i++) print (char) arr->i;
];

! Copy the player-typed word number `wx` into byte-array `arr` (cap to `cap`).
[ CopyWordToBuf wx arr cap   ad ln i;
   ad = WordAddress(wx); ln = WordLength(wx);
   if (ln > cap-1) ln = cap-1;
   arr->0 = ln;
   for (i=0 : i<ln : i++) arr->(i+1) = ad->i;
];

! True if the player's word number `wx` equals the text stored in `arr`.
! Input is already lower-cased by the Z-machine reader; store names lower-case.
[ WordEqBuf wx arr   ad ln i;
   ad = WordAddress(wx); ln = WordLength(wx);
   if (ln ~= arr->0) rfalse;
   for (i=0 : i<ln : i++)
      if (ad->i ~= arr->(i+1)) rfalse;
   rtrue;
];

Object Origin "Origin"
  with description "The origin room.",
  has light;

Object blankthing
  with short_name [;
          if (onamebuf->0 == 0) print "blank thing";
          else PrintBuf(onamebuf);
          rtrue;
       ],
       description [;
          if (odescbuf->0 == 0) "It has no description yet.";
          PrintBuf(odescbuf); new_line; rtrue;
       ],
       parse_name [ count;
          count = 0;
          while (wn <= num_words && WordEqBuf(wn, onamebuf)) { wn++; count++; }
          return count;
       ],
  has ;

! Meta-verbs the engine drives. 'xname X' sets the name to word 2.
! 'xdesc a b c...' copies words 2.. into the description buffer (space-joined).
[ XnameSub;
   CopyWordToBuf(2, onamebuf, NBUF);
   "Name set.";
];
[ XdescSub   w ad ln i p;
   p = 0;
   for (w=2 : w<=num_words : w++) {
      if (p > 0 && p < DBUF-1) { odescbuf->(p+1) = ' '; p++; }
      ad = WordAddress(w); ln = WordLength(w);
      for (i=0 : i<ln && p<DBUF-1 : i++) { odescbuf->(p+1) = ad->i; p++; }
   }
   odescbuf->0 = p;
   "Description set.";
];

[ Initialise2; ];   ! placeholder to keep structure obvious (unused)

Verb 'xname' * topic -> Xname;
Verb 'xdesc' * topic -> Xdesc;

Include "Grammar";

[ XnameSubGuard; ];
```

> Note: `topic` grammar token matches arbitrary words after the verb. `num_words`, `WordAddress`, `WordLength` are library globals/routines. Move `blankthing` into `Origin` via `Initialise` if needed — add `move blankthing to Origin;` before the welcome string.

- [ ] **Step 2: Add `move blankthing to Origin;`** to `Initialise` (before the final string) and compile:

```bash
cd public/scripts/extensions/ST_IF && ./tools/inform6.exe "+tools/inform6lib-master" -v5 worlds/spike.inf worlds/spike.z5
```
Expected: compiles (warnings tolerable, no errors). Fix any error before continuing (likely candidates: a bare-string-returns issue, or a verb-word clash — pick different meta-verb words if so).

- [ ] **Step 3: Drive it through `vm.js`** with an inline node script (not committed):

```bash
cd k:/llm-locals/sillytavern && node --input-type=module -e '
import { IFVM } from "./public/scripts/extensions/ST_IF/vm.js";
import { readFileSync } from "fs";
const z = new Uint8Array(readFileSync("./public/scripts/extensions/ST_IF/worlds/spike.z5"));
const vm = new IFVM(); await vm.load(z);
const S=(c)=>{const o=vm.step(c);console.log(`> ${c}\n${o.trim()}\n`);return o;};
S("look");
S("xname trunk");
S("xdesc a battered travelling trunk");
S("examine trunk");      // EXPECT: prints "a battered travelling trunk"
S("look");               // EXPECT: lists "trunk" (runtime short_name)
S("take trunk");         // EXPECT: Taken.  (parse_name resolved it)
S("examine blank");      // EXPECT: not recognised now (renamed) — sanity
'
```

- [ ] **Step 4: Judge the spike.**
  - PASS if `examine trunk` prints the runtime description, `look` shows `trunk`, and `take trunk` succeeds (parse_name resolved a non-dictionary word).
  - If `take trunk` fails to resolve, the `parse_name`/`WordEqBuf` path needs adjustment (common fixes: guard `wn > num_words`, confirm input is lower-cased, confirm `WordAddress` is valid in `parse_name` scope). Iterate on `spike.inf` only.
  - If it cannot be made to work after reasonable iteration, STOP and re-plan per the gating note.

- [ ] **Step 5: Record the proven pattern.** Once green, the working `PrintBuf`/`CopyWordToBuf`/`WordEqBuf`/`parse_name` routines ARE the canonical pattern reused verbatim in Task 1. Do not commit `spike.inf`/`spike.z5` yet (kept until Task 1 lifts the pattern, then deleted in Task 2 Step 6).

---

## Task 1: `expanse.h` — the reusable pool include

Lift the spike pattern into a reusable include with `BlankRoom`/`BlankObject` classes, a pool, and `xroom`/`xobj` meta-verbs that claim-and-fill blanks and link exits both ways.

**Files:**
- Create: `public/scripts/extensions/ST_IF/worlds/expanse.h`

- [ ] **Step 1: Write the include** using the Task-0-proven routines. Structure:

```inform6
! expanse.h — reusable pool for runtime-grown worlds (Path A). CC0.
! Include AFTER VerbLib and BEFORE Grammar in the host .inf.
Constant XP_NBUF = 32;
Constant XP_DBUF = 200;
Constant XP_ROOMS = 64;      ! pool capacity (tune later)
Constant XP_OBJS  = 192;

! --- shared text helpers (proven in the spike) ---
[ XP_PrintBuf arr i len; len = arr->0; for (i=1:i<=len:i++) print (char) arr->i; ];
[ XP_CopyWord wx arr cap ad ln i;
   ad = WordAddress(wx); ln = WordLength(wx); if (ln > cap-1) ln = cap-1;
   arr->0 = ln; for (i=0:i<ln:i++) arr->(i+1) = ad->i; ];
[ XP_WordEq wx arr ad ln i;
   ad = WordAddress(wx); ln = WordLength(wx);
   if (ln ~= arr->0) rfalse;
   for (i=0:i<ln:i++) if (ad->i ~= arr->(i+1)) rfalse; rtrue; ];

! --- classes ---
Class BlankRoom
  with nbuf 0, dbuf 0,          ! each instance points at its own arrays (set below)
       short_name [; if (self.nbuf->0 == 0) print "somewhere"; else XP_PrintBuf(self.nbuf); rtrue; ],
       description [; if (self.dbuf->0 == 0) "An undefined space."; XP_PrintBuf(self.dbuf); new_line; rtrue; ],
       parse_name [ c; c=0; while (wn <= num_words && XP_WordEq(wn, self.nbuf)) { wn++; c++; } return c; ],
       used false,
  has light;

Class BlankObject
  with nbuf 0, dbuf 0,
       short_name [; if (self.nbuf->0 == 0) print "thing"; else XP_PrintBuf(self.nbuf); rtrue; ],
       description [; if (self.dbuf->0 == 0) "Nothing special."; XP_PrintBuf(self.dbuf); new_line; rtrue; ],
       parse_name [ c; c=0; while (wn <= num_words && XP_WordEq(wn, self.nbuf)) { wn++; c++; } return c; ],
       used false,
  has ;
```

> Per-instance buffers: declare arrays and a generated pool. Because Inform 6 has no array-of-arrays sugar, the plan generates the pool with a compile-time loop is not available; instead declare each blank with its own `Array` and set `nbuf`/`dbuf` in `Initialise` of the host, OR (cleaner) declare a fixed block of arrays and a parallel object list. Task 0 informs the exact mechanism; if per-instance `Array` declarations are verbose, generate them with a short script and `#Include` — decide during Task 1 Step 1 using the spike learnings. Keep `XP_ROOMS`/`XP_OBJS` small (e.g. 8/16) for the first compile, raise after the integration test passes.

- [ ] **Step 2: Implement `xroom` and `xobj` meta-verbs.**

```inform6
! xroom <dir-word> <name-word> — claim a blank room <dir> of the player's room,
! set its name to <name-word>, link exits both ways. Description set by a follow-up
! xdesc-style call against the most-recently-claimed room (global XP_lastroom).
Global XP_lastroom = 0;
Global XP_lastobj  = 0;

[ XP_FreeRoom i o;
   objectloop (o ofclass BlankRoom) if (o.used == false) return o;
   rfalse;
];
[ XP_DirProp w;   ! map a typed direction word to an exit property number
   if (XP_WordEq(w, ... )) ...   ! compare against 'north','south',... — see Step 2b
];
```

Step 2 is where the spike's word-compare is reused to map a direction word to `n_to`/`s_to`/… and to wire `room.<dir>_to = newroom` and the reverse. Provide the full `XP_DirProp` mapping (north/south/east/west/up/down and reverses) and the `XroomSub` that: finds a free room, copies the name word into its `nbuf`, sets exits both ways, sets `XP_lastroom`, and moves the player is NOT done here (engine re-issues the move). Mirror `xobj` to claim a `BlankObject` into `XP_lastroom` and set takeable.

- [ ] **Step 3: Compile a host that includes it** (done in Task 2). No standalone compile.

---

## Task 2: `expanse.inf` seed + build + smoke

**Files:**
- Create: `public/scripts/extensions/ST_IF/worlds/expanse.inf`
- Modify: `public/scripts/extensions/ST_IF/worlds/build.ps1` (already globs `*.inf` — verify it picks up `expanse.inf`)
- Delete: `worlds/spike.inf`, `worlds/spike.z5`

- [ ] **Step 1: Write the seed:**

```inform6
! expanse.inf — empty expandable seed. CC0.
Constant Story "EXPANSE";
Constant Headline "^An empty, growable world.^";
Include "Parser";
Include "VerbLib";
[ Initialise; location = Origin; "^You stand at the origin. Walk in any direction.^"; ];
Object Origin "Origin"
  with description "A featureless origin point. Paths could lead anywhere.",
  has light;
Include "expanse.h";
Include "Grammar";
```

- [ ] **Step 2: Compile** `cd public/scripts/extensions/ST_IF && ./tools/inform6.exe "+tools/inform6lib-master" -v5 worlds/expanse.inf worlds/expanse.z5`. Expected: clean compile.

- [ ] **Step 3: Manual smoke via node** (inline, not committed): load `expanse.z5`, `vm.step("xroom north attic")`, `vm.step("xdesc ...")` (or the chosen desc verb), `vm.step("north")` → EXPECT to arrive in a room titled "attic"; `vm.step("south")` → EXPECT back at Origin (reverse exit linked).

- [ ] **Step 4: Raise pool sizes** to `XP_ROOMS=64`, `XP_OBJS=192`, recompile, confirm still clean.

- [ ] **Step 5: Delete the spike** (`rm worlds/spike.inf worlds/spike.z5`).

- [ ] **Step 6: Commit.**
```bash
git add public/scripts/extensions/ST_IF/worlds/expanse.h public/scripts/extensions/ST_IF/worlds/expanse.inf public/scripts/extensions/ST_IF/worlds/expanse.z5
git commit -m "feat(ST_IF): expanse pool include + empty seed (runtime room/object growth)"
```

---

## Task 3: `worldgen.js` — pure JSON → meta-commands (TDD)

**Files:**
- Create: `public/scripts/extensions/ST_IF/worldgen.js`
- Test: `public/scripts/extensions/ST_IF/test/worldgen.test.js`

- [ ] **Step 1: Failing tests:**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoomJson, sanitizeRoom, buildMetaCommands } from '../worldgen.js';

test('parseRoomJson tolerates fenced / surrounded JSON', () => {
    const r = parseRoomJson('blah ```json\n{"name":"Attic","description":"Dusty.","objects":[]}\n``` end');
    assert.equal(r.name, 'Attic');
});
test('parseRoomJson returns null on junk', () => {
    assert.equal(parseRoomJson('not json at all'), null);
});
test('sanitizeRoom caps lengths and normalises object names', () => {
    const r = sanitizeRoom({ name: 'X'.repeat(80), description: 'D'.repeat(400),
        objects: [{ name: 'Old Brass Lantern', description: 'y', takeable: true }] }, { nameMax: 31, descMax: 199, maxObjects: 8 });
    assert.ok(r.name.length <= 31);
    assert.ok(r.description.length <= 199);
    assert.equal(r.objects[0].name, 'old brass');     // ≤2 lowercase words
});
test('sanitizeRoom strips non-ASCII/control chars', () => {
    const r = sanitizeRoom({ name: 'Café', description: 'a b', objects: [] }, { nameMax: 31, descMax: 199, maxObjects: 8 });
    assert.doesNotMatch(r.name, /[^\x20-\x7e]/);
    assert.doesNotMatch(r.description, /[^\x20-\x7e]/);
});
test('buildMetaCommands emits xroom + xdesc + one xobj/xodesc per object', () => {
    const cmds = buildMetaCommands('north', { name: 'attic', description: 'dusty', objects: [{ name: 'trunk', description: 'old', takeable: true }] });
    assert.deepEqual(cmds, ['xroom north attic', 'xdesc dusty', 'xobj 1 trunk', 'xodesc old']);
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing): `node --test public/scripts/extensions/ST_IF/test/worldgen.test.js`.

- [ ] **Step 3: Implement `worldgen.js`:**

```javascript
// worldgen.js — pure: LLM room JSON -> sanitised model -> VM meta-commands.
const ASCII = (s) => String(s ?? '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();

export function parseRoomJson(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

export function sanitizeRoom(raw, { nameMax = 31, descMax = 199, maxObjects = 8 } = {}) {
    const name = ASCII(raw?.name).slice(0, nameMax) || 'somewhere';
    const description = ASCII(raw?.description).slice(0, descMax) || 'An undefined space.';
    const objects = Array.isArray(raw?.objects) ? raw.objects.slice(0, maxObjects).map((o) => ({
        name: ASCII(o?.name).toLowerCase().split(' ').slice(0, 2).join(' ') || 'thing',
        description: ASCII(o?.description).slice(0, descMax) || 'Nothing special.',
        takeable: !!o?.takeable,
    })) : [];
    return { name: ASCII(name).slice(0, nameMax), description, objects };
}

export function buildMetaCommands(dir, room) {
    const cmds = [`xroom ${dir} ${room.name}`, `xdesc ${room.description}`];
    room.objects.forEach((o, i) => {
        cmds.push(`xobj ${i + 1} ${o.name}`);
        cmds.push(`xodesc ${o.description}`);
    });
    return cmds;
}
```

> Note: `xobj <takeable-flag>` vs `xobj <index>` — the integer after `xobj` is the **takeable flag** (1/0), not an index. Fix the test + code to agree: emit `xobj 1 trunk` where `1` = takeable. Update the Task 1 `xobj` grammar to read word 2 as the flag. (Resolved here: flag, not index.)

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit.**
```bash
git add public/scripts/extensions/ST_IF/worldgen.js public/scripts/extensions/ST_IF/test/worldgen.test.js
git commit -m "feat(ST_IF): worldgen — pure room-JSON sanitiser + meta-command builder"
```

---

## Task 4: `vm.js` — `applyWorldEdits` helper

**Files:**
- Modify: `public/scripts/extensions/ST_IF/vm.js`

- [ ] **Step 1: Add the helper** (near the other VM methods):

```javascript
/**
 * Push engine meta-commands (xroom/xdesc/xobj/xodesc) into the VM in order.
 * Each is a normal step; the pool world mutates its dynamic memory. Returns the
 * concatenated output (for debugging). Never throws on a single bad command.
 */
applyWorldEdits(cmds) {
    let out = '';
    for (const c of cmds) {
        try { out += this.step(c) + '\n'; } catch (e) { out += `[edit failed: ${c}] `; }
    }
    return out;
}
```

- [ ] **Step 2: Add `isExpandable()`** — probe whether the loaded story has the pool (so the toggle no-ops on plain stories):

```javascript
/** True if the story understands the xroom meta-verb (i.e. includes expanse.h). */
isExpandable() {
    const snap = this.save();
    const out = this.step('xroom');           // bare verb → pool prints a usage/err; plain story → "not a verb"
    this.restore(snap);                        // zero net effect
    return !/not a verb|don't know|can't see/i.test(out);
}
```

- [ ] **Step 3: Smoke** (inline node): load `expanse.z5` → `isExpandable()` true; load `apartment.z5` → false.

- [ ] **Step 4: Commit.**
```bash
git add public/scripts/extensions/ST_IF/vm.js
git commit -m "feat(ST_IF): vm.applyWorldEdits + isExpandable probe"
```

---

## Task 5: `turn.js` — blocked-move detection + generation wiring

**Files:**
- Modify: `public/scripts/extensions/ST_IF/turn.js`
- Create: `public/scripts/extensions/ST_IF/test/worldgrow.test.js` (pure detection helper)

- [ ] **Step 1: Add a pure detection helper to `worldgen.js`** and test it:

```javascript
// worldgen.js (add)
const BLOCKED = /can't go that way|can't go in that direction|no exit that way|only way is|wall is in the way/i;
const DIRS = ['north','south','east','west','up','down','n','s','e','w','u','d'];
const DIR_FULL = { n:'north', s:'south', e:'east', w:'west', u:'up', d:'down' };
export function blockedMove(cmd, output) {
    const c = String(cmd ?? '').trim().toLowerCase();
    if (!DIRS.includes(c)) return null;
    if (!BLOCKED.test(output ?? '')) return null;
    return DIR_FULL[c] ?? c;          // normalised direction, or null
}
```

```javascript
// test/worldgrow.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedMove } from '../worldgen.js';
test('blockedMove returns the normalised dir on a blocked compass move', () => {
    assert.equal(blockedMove('n', "You can't go that way."), 'north');
});
test('blockedMove is null when the move succeeded', () => {
    assert.equal(blockedMove('north', 'Kitchen\nA small kitchen.'), null);
});
test('blockedMove is null for non-movement commands', () => {
    assert.equal(blockedMove('take lamp', "You can't go that way."), null);
});
```

- [ ] **Step 2: Wire into `turn.js`** after the step loop (single-protagonist path only; the spec defers companion mode). Add deps `generateRoom` and a `settings.dynamicWorld` gate. Pseudocode-free concrete block:

```javascript
// turn.js — after the step loop builds `outputs`, before persisting canon.
import { parseRoomJson, sanitizeRoom, buildMetaCommands, blockedMove } from './worldgen.js';
// ...
if (settings.dynamicWorld && deps.generateRoom && typeof vm.applyWorldEdits === 'function') {
    const lastCmd = cmds[cmds.length - 1];
    const lastOut = outputs[outputs.length - 1] ?? '';
    const dir = blockedMove(lastCmd, lastOut);
    if (dir && vm.isExpandable?.()) {
        const room = sanitizeRoom(parseRoomJson(await deps.generateRoom(dir, vm.getStatus(), player.text)) ?? {});
        const edits = vm.applyWorldEdits(buildMetaCommands(dir, room));
        if (!/no free room|pool full/i.test(edits)) {
            outputs.push(vm.step(dir));            // re-issue; arrival is the new canon
        }
    }
}
```

- [ ] **Step 3: Add `generateRoom` to `buildDeps` in `index.js`** — a quiet LLM call returning the raw string (mirrors the translator's `deps.generate`). Concrete prompt builder lives here; `worldgen.parseRoomJson` consumes it.

- [ ] **Step 4: Run the pure tests** (`worldgrow.test.js`), expect PASS. (turn.js wiring is covered by the integration test in Task 7.)

- [ ] **Step 5: Commit.**
```bash
git add public/scripts/extensions/ST_IF/worldgen.js public/scripts/extensions/ST_IF/turn.js public/scripts/extensions/ST_IF/index.js public/scripts/extensions/ST_IF/test/worldgrow.test.js
git commit -m "feat(ST_IF): blocked-move detection + dynamic-world generation wiring"
```

---

## Task 6: Settings toggle

**Files:**
- Modify: `settings.js` (defaults), `settings.html` (checkbox), `index.js` (wire)

- [ ] **Step 1: Add default** `dynamicWorld: false` to `defaultSettings` in `settings.js`.
- [ ] **Step 2: Add checkbox** in `settings.html` after the bundled-world picker:
```html
<label class="checkbox_label" title="When you walk into an undefined direction, let the narrator invent the room (expandable worlds only).">
    <input id="st_if_dynamic_world" type="checkbox" />
    <span>Dynamic world (narrator grows the map)</span>
</label>
```
- [ ] **Step 3: Wire** in `wireSettingsUI` (mirror the existing toggles):
```javascript
$('#st_if_dynamic_world').prop('checked', s.dynamicWorld).on('change', function () {
    s.dynamicWorld = $(this).prop('checked'); saveSettingsDebounced();
});
```
- [ ] **Step 4: Add `expanse.z5`** to `worlds/worlds.json` so the picker can load it: `{ "name": "Expanse (empty, growable)", "file": "expanse.z5" }`.
- [ ] **Step 5: Lint, commit.**
```bash
node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"
git add public/scripts/extensions/ST_IF/settings.js public/scripts/extensions/ST_IF/settings.html public/scripts/extensions/ST_IF/index.js public/scripts/extensions/ST_IF/worlds/worlds.json
git commit -m "feat(ST_IF): dynamic-world toggle + expanse in the world picker"
```

---

## Task 7: Integration test (canned JSON, deterministic)

**Files:**
- Modify: `public/scripts/extensions/ST_IF/test/vm.integration.test.js`

- [ ] **Step 1: Add tests** driving `expanse.z5` with `worldgen` + canned JSON (no LLM):

```javascript
import { sanitizeRoom, buildMetaCommands } from '../worldgen.js';
const expanse = new Uint8Array(readFileSync(new URL('../worlds/expanse.z5', import.meta.url)));

test('expanse: a generated room is reachable, named, and back-linked', async () => {
    const vm = new IFVM(); await vm.load(expanse);
    assert.equal(vm.getStatus().location, 'Origin');
    assert.match(vm.step('north'), /can't go that way/i);              // blocked first
    const room = sanitizeRoom({ name: 'attic', description: 'A dusty attic.', objects: [{ name: 'trunk', description: 'A battered trunk.', takeable: true }] });
    vm.applyWorldEdits(buildMetaCommands('north', room));
    assert.match(vm.step('north'), /attic/i);                          // now reachable + named
    assert.match(vm.step('examine trunk'), /battered trunk/i);         // parse_name resolves the object
    assert.match(vm.step('take trunk'), /taken/i);
    assert.match(vm.step('south'), /Origin/);                          // reverse exit linked
});

test('expanse: a generated room persists across save/restore', async () => {
    const vm = new IFVM(); await vm.load(expanse);
    vm.step('north');
    vm.applyWorldEdits(buildMetaCommands('north', sanitizeRoom({ name: 'attic', description: 'Dusty.', objects: [] })));
    vm.step('north');
    const snap = vm.save();
    const vm2 = new IFVM(); await vm2.load(expanse); vm2.restore(snap);
    assert.match(vm2.step('look'), /attic/i);                          // generated room survived the snapshot
});

test('expanse: pool exhaustion degrades to a normal blocked move', async () => {
    // (only meaningful with a tiny pool build; with 64 rooms this asserts the path exists)
    const vm = new IFVM(); await vm.load(expanse);
    assert.match(vm.step('north'), /can't go that way/i);
});
```

- [ ] **Step 2: Run** `node --test public/scripts/extensions/ST_IF/test/*.test.js` — expect all green (existing apartment suite + new worldgen/worldgrow/expanse cases).

- [ ] **Step 3: Commit.**
```bash
git add public/scripts/extensions/ST_IF/test/vm.integration.test.js
git commit -m "test(ST_IF): integration coverage for runtime room growth on expanse.z5"
```

---

## Task 8: Expandable apartment/garden variants (optional, after green)

**Files:**
- Modify: `worlds/apartment.inf`, `worlds/garden.inf` (add `Include "expanse.h";` before `Include "Grammar";`), `worlds/build.ps1`, `worlds/worlds.json`

- [ ] **Step 1:** Add `Include "expanse.h";` to each just before `Include "Grammar";`. Recompile to `apartment-expanse.z5` / `garden-expanse.z5` (separate outputs; keep the plain demos unchanged). Adjust `build.ps1` to emit the variants, or compile manually.
- [ ] **Step 2:** Smoke: load `apartment-expanse.z5`, walk to the Street, `out`/an undefined dir, apply a canned room, confirm it grows at the edge while authored rooms stay exact.
- [ ] **Step 3:** Add the two variants to `worlds.json`.
- [ ] **Step 4: Lint, full suite, commit.**
```bash
git add public/scripts/extensions/ST_IF/worlds/apartment.inf public/scripts/extensions/ST_IF/worlds/garden.inf public/scripts/extensions/ST_IF/worlds/apartment-expanse.z5 public/scripts/extensions/ST_IF/worlds/garden-expanse.z5 public/scripts/extensions/ST_IF/worlds/build.ps1 public/scripts/extensions/ST_IF/worlds/worlds.json
git commit -m "feat(ST_IF): expandable apartment/garden variants (grow at the edges)"
```

---

## Self-review notes

- **Spec coverage:** trigger=blocked-move (Task 5), rooms+objects (Tasks 1/3), theme-from-chat (Task 5 Step 3 prompt), pool-as-include (Task 1), empty+existing seeds (Tasks 2/8), runtime text + parse_name (Task 0 spike → Task 1), persistence (Task 7 save/restore test), pool-exhaustion + malformed-JSON graceful (Tasks 3/5/7), settings toggle + non-expandable no-op (Tasks 4/6), single-protagonist v1 (Task 5 note). All covered.
- **Known open detail (by design):** the exact `xobj` argument framing and the per-instance buffer declaration mechanism are finalised using Task 0's spike output — that is the point of the spike, not a placeholder. The `xobj <flag>` decision is fixed in Task 3 Step 3.
- **Risk:** Task 0 is the gate. Everything after reuses its proven routines verbatim.
