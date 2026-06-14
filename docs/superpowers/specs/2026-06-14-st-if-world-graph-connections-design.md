# ST_IF World Graph Connections (loops) — Design

**Status:** approved design, pre-plan
**Date:** 2026-06-14
**Builds on:** dynamic world growth (PR #5) and world export/import (PR #6, branch
`st-if-world-io`). This feature changes the growth logic *and* the export/import records.

## Goal

Let dynamically-grown rooms **connect into a graph with loops**, instead of an
ever-branching tree of dead-ends. Two mechanisms (approach "C"):

- **(A) Coordinate grid auto-connect** — every room has `(x,y,z)`; growing a direction into
  a cell an existing room already occupies **links to that room** instead of generating a new
  dead-end. Walk a square and you arrive back where you started.
- **(B) LLM-named links** — when inventing a room the generator may declare that an exit
  connects to an existing room by name; the engine links them. Handles non-Euclidean
  connections (caves, houses, secret tunnels) the grid can't express.

## Motivation / current limitation

The grown world is a strict **tree**: each generated room's only real exit is back to its
parent; every other direction is a wall until walked, and walking always carves a *new*
room. No loops ever form, and the LLM cannot connect rooms. (The back-link itself works —
verified — so this is a design gap, not a bug.)

## Core decisions (locked during brainstorming)

1. **Scope: graph-aware end to end.** Records, replay, and export/import are updated so a
   looped world round-trips faithfully (not just its tree spine).
2. **Coordinates live JS-side** (`state.js` / records), not in the VM. Geometry is pure and
   testable; the VM stays simple and just gains a link-by-name verb.
3. **Grid auto-connect on cell collision:** growing into an occupied neighbour cell links to
   the occupant; no generation, no LLM call.
4. **LLM links may target ANY existing room** (full list shown to the generator), validated
   by **exact name match**; hallucinated/duplicate/occupied-direction links are silently
   dropped.
5. **Conflict stance:** grid wins on geometry; LLM links are additive; non-Euclidean
   contradictions are left as-is (not detected). Out of scope to model true non-Euclidean
   space — that is exactly what the LLM-link escape hatch is for.
6. **One room per cell** is guaranteed (collisions become links), so coordinates never clash.

## Architecture

```
BLOCKED MOVE dir D from room R (current):
  target = R.cell + delta(D)            (delta: n y+1, s y-1, e x+1, w x-1, u z+1, d z-1)
  if a room X already occupies target:
     xlinkn R.name D X.name             → link both ways (grid auto-loop). step D into X.
     record edge {from:R, dir:D, to:X}
  else:
     room = sanitize(generateRoom(D, R, existingRoomNames))     ← prompt includes room list
     xroom D room.name; xdesc; xobj…    → create + parent-link (existing live path)
     assign room.cell = target
     for each valid connection {dir,to} in room.connections:    ← LLM links
        if `to` exists and `dir` free on the new room: xlinkn room.name dir to ; record edge
     step D into the new room
     record room {name,x,y,z,description,objects} + parent edge
```

### Components

- **`worldgen.js`** (extend, pure):
  - `cellDelta(dir)` → `{dx,dy,dz}`; `addCell(cell, dir)`.
  - `validateConnections(conns, existingNames, takenDirs)` → the subset of `{dir,to}` that are
    safe to apply (exact-name match, dir free, no self/dup).
  - `generateRoom` prompt gains the existing-room-name list and asks for an optional
    `connections` array.
- **`state.js`** (extend): records move from a flat tree list to a graph:
  - `grownRooms` → `{ rooms: [{name,x,y,z,description,objects}], edges: [{from,dir,to}] }`
    (or two parallel accessors). `recordGrownRoom(rec)`, `recordEdge(from,dir,to)`,
    `getWorldGraph()`, `roomAtCell(cell)` / `cellOfRoom(name)` helpers.
- **`turn.js`** (extend): the growth block implements the grid decision above, applies LLM
  links, and records rooms + edges.
- **`worldmap.js`** (rewrite for the graph):
  - `formatMap(graph)` → tree spine (BFS from Origin) with `↺ loops to <name>` annotations for
    non-spine edges.
  - `planReplay(graph)` → `xnew`/`xdesc`/`xobj`/`xodesc` for every room, then `xlinkn` for
    every edge. No navigation.
- **`worlds/expanse.h`** (extend via `gen_expanse.mjs`): add meta-verbs
  - `xnew <name>` — claim a blank, name it, set `lastroom`, **no link**.
  - `xlinkn <fromname> <dir> <toname>` — find both rooms by name (`parse_name`-style buffer
    match) and link both ways. Used by grid auto-connect, LLM links, and replay.
  - Keep `xroom`/`xdesc`/`xobj`/`xodesc`.
- **`index.js`**: export/import use the new graph records; `generateRoom` dep passes the
  existing room-name list; `/if-map` renders the graph.

## Data format (export file v2)

```json
{ "format": "st_if_world", "version": 2, "story": "expanse",
  "rooms": [
    { "name": "attic", "x": 0, "y": 1, "z": 0, "description": "...", "objects": [] }
  ],
  "edges": [
    { "from": "Origin", "dir": "north", "to": "attic" },
    { "from": "study",  "dir": "east",  "to": "library" }
  ] }
```

Version bumps to 2. Import accepts v2; a v1 (tree) file is upconverted (its `from/dir/name`
records become rooms with derived coords + edges) so PR #6 exports still load.

## Replay (graph, navigation-free)

1. For each room (Origin excluded): `xnew <name>`, `xdesc <description>`, then per object
   `xobj <1|0> <name>` + `xodesc <description>`.
2. For each edge: `xlinkn <from> <dir> <to>`.
3. Return the player to Origin (a known room; no navigation needed since `xnew` doesn't move
   the player).

`xnew` leaves rooms unreachable until wired — fine in the Z-machine; step 2 connects them.

## Error handling / edge cases

- **LLM connection to a non-existent / duplicate / already-linked direction** → dropped by
  `validateConnections`; growth proceeds normally.
- **Grid auto-link into a room reached by a different name** (duplicate names) → documented v1
  limitation carried over; `roomAtCell` keys by coordinate, so the grid itself is unambiguous.
- **Pool exhaustion on replay** → `applyWorldEdits` surfaces `no-free-room`; stop and warn
  (partial import), as in PR #6.
- **`xlinkn` to an unknown name** → the verb reports a miss; the engine skips that edge and
  continues (replay stays robust to a hand-edited file).
- **Non-Euclidean weirdness** (A says north→B but B's south is taken) → left as-is by design.

## Testing strategy

- **Pure (`worldgen`/`worldmap`, node `--test`):** `cellDelta`/`addCell`; `validateConnections`
  (exact-name, free-dir, drop self/dupes/misses); `formatMap` with loop annotations;
  `planReplay` emits `xnew` + `xlinkn` in the right order for a looped graph; v1→v2 upconvert.
- **Integration (`expanse.z5`, canned, no LLM):**
  - **Square loop:** grow N, E, S, then W back toward Origin's cell → assert the 4th step
    **links to Origin** (no new room) and walking N-E-S-W returns to Origin.
  - **LLM cross-link:** create two rooms, `xlinkn` a tunnel between them → reachable both ways.
  - **Graph round-trip:** export a looped world, `planReplay` into a fresh `expanse.z5`,
    assert every room and every edge (loops included) reconstructs and is walkable.

## Out of scope (this spec)

- Modelling true non-Euclidean space / contradiction detection.
- A coordinate-aware minimap UI (the text `/if-map` is enough).
- Retroactively re-linking already-grown rooms by hand in-app (edit the exported JSON).
- Expandable authored worlds (still deferred from the dynamic-world spec).

## Success criteria

1. Growing a path that returns to an existing cell **links** to it (a loop), instead of
   spawning a new dead-end; walking the loop returns the player to the start.
2. The generator can connect a new room to a named existing room (validated); a tunnel
   between distant rooms works both ways.
3. `/if-map` shows the spine plus loop annotations.
4. Exporting a looped world and importing it into a fresh chat reconstructs every room and
   edge, loops included.
5. A v1 (PR #6, tree) export still imports.
6. Invalid LLM links and hand-edited bad files degrade gracefully (dropped/skipped, no crash).
