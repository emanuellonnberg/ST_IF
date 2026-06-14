# ST_IF Expandable Authored Worlds — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** authored worlds grow only at author-marked frontier rooms; interiors sealed; export
covers authored growth (v3, story-tagged); coordinate clusters per frontier.

**Spec:** `docs/superpowers/specs/2026-06-14-st-if-expandable-authored-worlds-design.md`
**Branch:** `st-if-authored-worlds` (on `release`, which has PR #5/#6/#7).
**Compile:** `node worlds/gen_expanse.mjs` then `inform6 "+include_path=tools/inform6lib-master,worlds" -v5 worlds/<f>.inf worlds/<f>.z5`.

**Key unification (decided during planning):** Origin is just frontier #0 with slug `origin`
(seed calls `XP_RegisterFrontier(Origin, 'origin')`). `XP_FindRoom` resolves frontiers by
**dictionary word** (slugs are I6 dict words) and generated rooms by buffer — no separate
`XP_root`/`XP_WordIsOrigin`.

---

### Task 1 — expanse.h frontier registry + xcangrow (VM, highest risk → smoke first)
`worlds/gen_expanse.mjs` → regen `expanse.h`; `expanse.inf` seed.
- `Attribute`-style: add `growable` to `BlankRoom` (`has ... growable`).
- `Constant XP_MAXFRONT 12;  Array XP_FrontObj --> XP_MAXFRONT;  Array XP_FrontWord --> XP_MAXFRONT;  Global XP_nfront = 0;`
- `[ XP_RegisterFrontier room dword; give room growable; XP_FrontObj-->XP_nfront = room; XP_FrontWord-->XP_nfront = dword; XP_nfront++; ];`
- Rewrite `XP_FindRoom(wx)`:
  ```
  [ XP_FindRoom wx o i dv;
     wn = wx; dv = NextWordStopped();
     if (dv ~= 0 or -1)
        for (i=0: i<XP_nfront: i++) if (XP_FrontWord-->i == dv) return XP_FrontObj-->i;
     objectloop (o ofclass BlankRoom) if (o.used && XP_WordEq(wx, XP_RNm(o))) return o;
     return 0;
  ];
  ```
  (drop `XP_WordIsOrigin`/`XP_root`; xroom/xlinkn/xnew unchanged except they call this finder).
- `XroomSub` already links `location` → uses `location` directly (fine; frontier or generated).
- `[ XcangrowSub i;`
  ```
     for (i=0: i<XP_nfront: i++) if (XP_FrontObj-->i == location) { print (address) XP_FrontWord-->i; new_line; rtrue; }
     if (location ofclass BlankRoom && location has growable) { XP_PrintBuf(XP_RNm(location)); new_line; rtrue; }
     "no";
  ];  Verb 'xcangrow' * -> Xcangrow;`
- Seed `expanse.inf` Initialise: `XP_RegisterFrontier(Origin, 'origin');` (remove old `XP_root = Origin`). Origin needs `growable`? register gives it. Keep its six exit slots.
- **Smoke (node):** load expanse → `xcangrow` at Origin prints `origin`; grow a room, walk in, `xcangrow` prints its name; `xlinkn origin north <room>` still works.

### Task 2 — state anchors (JS, `state.js`)
- graph gains `anchors: {}`; `initState` seeds `grownRooms.anchors = {}`.
- `getAnchors(metadata)`, `setAnchor(metadata, slug, cell)`, `nextAnchorCell(metadata)` →
  `{ x: XP_SPAN * (count+1), y:0, z:0 }` (`XP_SPAN = 100000`).
- `cellOfRoom(metadata, slug)`: `origin` → 0,0,0; a room in `rooms` → its cell; an anchor in
  `anchors` → that cell; else null.
- `roomAtCell` unchanged (searches rooms; origin special-case stays).
Tests: anchor spacing; cellOfRoom for origin/anchor/generated.

### Task 3 — vm.xCanGrow (vm.js)
- `xCanGrow() { const s = this.query('xcangrow').trim(); return s; }` (query = zero net effect).
  Returns the slug or `no`.
Smoke covered in Task 1/integration.

### Task 4 — turn.js gating
- Replace `fromRoom = vm.getStatus().location` growth-identity with:
  `const slug = (typeof vm.xCanGrow === 'function') ? vm.xCanGrow() : 'origin';`
  `if (slug === 'no' || /not a verb/i.test(slug)) { /* sealed → skip growth */ }`
- If frontier slug has no anchor and isn't `origin`/a known room → `setAnchor(metadata, slug, nextAnchorCell(metadata))`.
- `fromCell = cellOfRoom(metadata, slug) ?? {0,0,0}`; the existing grid-vs-generate logic keys on `slug`.
- Records `from`/edges use `slug` (lowercase). `recordMapEdge` keeps display location.

### Task 5 — export v3 + upconvert (index.js, worldmap.js)
- Export: `{format, version:3, story: getSettings().storyId || 'expanse', rooms, edges, anchors}`.
- Import: load base by `story` (lookup `worlds.json` for the file whose `id===story`; reject if mismatch with the loadable set); replay; restore anchors; re-seed.
- `worldmap.upconvert`: v1 tree → graph (+ empty anchors, story expanse); v2 graph → add empty anchors + story expanse.
- `worlds.json` entries gain `"id"`; `applyStoryBytes`/picker store `settings.storyId`.

### Task 6 — retrofit apartment + garden
- Add `Include "expanse.h";` before Grammar; declare six exit slots on the frontier room
  (apartment **Street**, garden **Lawn**); `XP_RegisterFrontier(Street, 'street')` /
  `(Lawn, 'lawn')` in Initialise. Compile `apartment-expanse.z5` / `garden-expanse.z5`
  (separate outputs). Add to `worlds.json` with ids `apartment`/`garden`.
- Verify interior rooms sealed (`xcangrow` → `no`), frontier grows.

### Task 7 — integration tests
`apartment-expanse.z5` (canned): sealed interior no-grow; frontier grows + links back; two
frontiers non-colliding coords; export→import round-trip on the authored base; story mismatch
rejected. Empty `expanse` unchanged.

### Task 8 — lint, suite, commit per task, push, PR (base release).
