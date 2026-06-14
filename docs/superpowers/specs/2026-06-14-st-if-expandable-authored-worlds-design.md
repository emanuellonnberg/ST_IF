# ST_IF Expandable Authored Worlds (growable frontiers) — Design

**Status:** approved design, pre-plan
**Date:** 2026-06-14
**Builds on:** world graph connections (PR #7, branch `st-if-world-graph`). This feature lets
hand-authored worlds (apartment/garden) grow at author-marked edges while staying sealed
inside.

## Goal

Let a hand-authored world hand off to dynamic generation at **author-marked frontier rooms**,
without letting the player sprout rooms off every interior wall (which would destroy the
authorship). A finished flat stays finished; step out to the Street (a frontier) and the
neighbourhood grows.

## Motivation

Dynamic growth currently only works on the empty `expanse` seed. Authored worlds can't grow
because (a) Inform rooms only provide the exit slots they declare, and (b) growing off every
wall of a designed space is undesirable. Both are addressed: a frontier is explicitly marked,
and only frontiers (and generated rooms) grow.

## Core decisions (locked during brainstorming)

1. **Frontier model = growable rooms.** The author tags whole rooms as growable; any blocked
   direction from a growable room grows; sealed (unmarked authored) rooms never do. Generated
   rooms stay freely growable.
2. **Export covers authored growth.** Export records rooms grown off an authored world and
   tags the base story; import requires the same base `.z5`.
3. **Coordinate clustering:** each frontier roots its own cluster, anchored far apart, so
   subtrees off different frontiers never collide on the grid.
4. **Demo:** apartment + garden each get exactly one frontier; interior rooms untouched.

## Architecture

### Section 1 — Frontier registry (VM, `expanse.h`)

- **`growable` attribute.** `BlankRoom` has it by default. Authored rooms gain it only via
  registration.
- **`XP_RegisterFrontier(room, "slug")`** — the host calls this in `Initialise` for each
  growable authored room. It (a) gives the room `growable`, (b) stores `(room, slugbuf)` in a
  small frontier table so `XP_FindRoom` can resolve the slug, and (c) lets JS treat the room
  as a cluster anchor. The seed registers its root (`XP_RegisterFrontier(Origin, "origin")`),
  so the empty Expanse is unchanged.
- **`xcangrow`** query → prints the current room's **slug** if it is growable, else `no`.
  - generated `BlankRoom` → its buffer name (single token);
  - registered frontier / Origin → its slug;
  - sealed authored room → `no`.
- **`XP_FindRoom`** extended: resolve registered frontier slugs in addition to BlankRoom
  buffers and Origin — so `xlinkn` can wire a generated room back to a frontier, and replay
  can link edges whose endpoint is an authored frontier.

### Section 2 — Coordinate clustering (JS, `state.js`)

- Origin anchors `(0,0,0)`. Each authored frontier gets a far-apart anchor `(XP_SPAN*n, 0, 0)`
  (`XP_SPAN` large, e.g. 100000) assigned the first time the player grows from it.
- `state.js` stores `anchors: { slug: cell }`. `cellOfRoom(slug)` returns: Origin → 0,0,0;
  a generated room → its recorded cell; a frontier slug → its anchor; unknown → null (caller
  assigns a new anchor on first growth from a frontier).
- Subtree growth proceeds locally from the anchor; `XP_SPAN` spacing guarantees clusters never
  overlap for any realistic world size.

### Section 3 — Records / export / import

- **Graph records** (in `chatMetadata`): `{ rooms:[{name,x,y,z,description,objects}],
  edges:[{from,dir,to}], anchors:{slug:cell} }`. A generated room's `from` may be a frontier
  slug; authored rooms are referenced by slug, never recreated.
- **Export file v3:** `{ format:"st_if_world", version:3, story:"<id>", rooms, edges, anchors }`.
  `story` is the loaded world's id (`expanse` / `apartment` / `garden`).
- **Import:** validates `format`; loads the **matching base** `.z5` (rejects a story
  mismatch); replays `planReplay` (`xnew` per generated room, `xlinkn` per edge — frontier
  endpoints resolve via the registry); restores `anchors`; re-seeds the graph. v1/v2
  (expanse-only) files upconvert (v1 tree → graph; v2 → add empty `anchors`, `story:"expanse"`).

### Section 4 — Turn gating (`turn.js`)

- Before growing: `const slug = vm.xCanGrow()` (wraps `xcangrow`). If `slug === 'no'` → the
  blocked move stays blocked (sealed room). Otherwise use `slug` as the room's identity:
  - if the frontier has no anchor yet, assign one (`anchors[slug] = nextAnchor()`),
  - `fromCell = cellOfRoom(slug)`, then the existing grid-vs-generate logic (Section from
    PR #7) runs unchanged, keyed on the slug.
- Generated rooms report their own slug via `xcangrow`, so growth chains exactly as today.

## Demo retrofit (`worlds/`)

- **apartment.inf / garden.inf:** add `Include "expanse.h";`, declare all six exit slots on the
  one frontier room, and `XP_RegisterFrontier(<frontier>, "<slug>")` in `Initialise`
  (apartment **Street** → `street`; garden **Lawn** → `lawn`). Compile separate
  `apartment-expanse.z5` / `garden-expanse.z5` outputs (plain demos unchanged). Add to
  `worlds.json`. Interior rooms get no exit slots and no registration → sealed.

## Error handling / edge cases

- **Sealed room blocked move** → normal "can't go that way"; no generation, no LLM call.
- **Story mismatch on import** → reject with a toast; current world untouched.
- **Frontier slug collision with a generated room name** → frontier slugs are author-chosen;
  document "keep them distinct"; `XP_FindRoom` checks frontiers first so a frontier always
  wins (deterministic).
- **Anchor exhaustion** → `XP_SPAN` spacing supports far more frontiers than any world needs;
  not a practical limit.
- **Non-expandable plain story** (`apartment.z5` without the pool) → `xcangrow` is an unknown
  verb → treated as `no` everywhere → never grows (matches `isExpandable()` being false).

## Testing strategy

- **Pure (`worldgen`/`worldmap`/state helpers, node `--test`):** anchor assignment +
  far-apart clustering; `cellOfRoom` for Origin/frontier/generated; export v3 shape; v2→v3 and
  v1→v3 upconvert.
- **Integration (`apartment-expanse.z5`, canned, no LLM):**
  - a blocked move from a **sealed** interior room does **not** grow (`xcangrow` → `no`);
  - a blocked move from the **frontier** grows a room linked to the frontier;
  - two frontiers' subtrees get **non-colliding** coordinates;
  - a generated room `xlinkn`-links back to its frontier (both ways);
  - **round-trip:** export an authored-grown world, import onto a fresh `apartment-expanse.z5`,
    assert the grown rooms + their frontier links reconstruct; a wrong-`story` import is rejected.

## Out of scope (this spec)

- Multiple frontiers per authored world beyond the one demo each (the mechanism supports N;
  we author one).
- Retrofitting *every* authored room to be growable (the point is that they are sealed).
- A visual minimap (text `/if-map` suffices).
- Multi-NPC registry / native engine (separate deferred specs).

## Success criteria

1. In `apartment-expanse`, walking into a wall **inside** the flat stays blocked; walking off
   the **Street** frontier grows a new room.
2. Rooms grown off two different frontiers never collide on the grid.
3. A generated room can connect back to its authored frontier (grid or LLM link).
4. Exporting an authored-grown world and importing it onto the same base reconstructs the
   grown rooms and their links; a mismatched base is rejected.
5. The empty `expanse` seed behaves exactly as before (Origin is just the root frontier).
