# ST_IF World Export / Import + Map — Design

**Status:** approved design, pre-plan
**Date:** 2026-06-14
**Builds on:** dynamic world growth (Path A), `docs/superpowers/specs/2026-06-13-st-if-dynamic-world-growth-design.md` (branch `st-if-dynamic-world` / PR #5).

## Goal

Make a runtime-grown world **shareable, viewable, and reloadable**: record each grown room
as structured JSON in the chat, render the world as a map (`/if-map`), export it to a file,
and import a shared file to rebuild the world in another chat. Persistence across sessions
already works (the VM snapshot lives in `chatMetadata`); this adds a human-readable,
portable layer on top.

## Core decisions (locked during brainstorming)

1. **Import mechanism:** *replay readable JSON.* Export is human-readable room JSON; import
   replays it through the existing `xroom`/`xobj` meta-commands into a fresh `expanse.z5`.
   Portable, editable, survives `expanse.z5` tweaks, and powers `/if-map` from the same data.
   (Rejected: sharing the opaque base64 VM snapshot — exact but unreadable and brittle.)
2. **Interface:** file buttons + a slash command. Settings panel gets **Export** (downloads
   `world-<name>.json`) and **Import** (file picker, like the story upload). **`/if-map`**
   prints the map.
3. **Identity by room name** (no synthetic ids). A record's `from` is simply the room the
   player stood in when the room was generated (`vm.getStatus().location`). Reuses existing
   patterns. *Known v1 limitation:* two generated rooms with the identical name would merge
   in the map/replay — rare in a coherent world; documented, not handled.
4. **Captures the world as generated**, not live object positions/inventory. Importing
   resets objects to where they spawned. "Share the map/world," not the play state.
5. **Import replaces** the current chat's IF world (the user chose to import).
6. **Same base story required, not the same chat/scenario.** Replay needs `expanse.z5`'s pool
   (everyone has it); it does not need the RP card that themed the world.

## Architecture

```
PLAY:   turn.js grows a room ──► recordGrownRoom(metadata, {from,dir,name,description,objects})
                                   (appended to chatMetadata[KEY].grownRooms, in creation order)

MAP:    /if-map ──► formatMap(getGrownRooms()) ──► tree text ──► comment message

EXPORT: button ──► {format,version,story,rooms} ──► Blob download  world-<name>.json

IMPORT: file ──► validate ──► load fresh expanse.z5 + initState
              ──► planReplay(rooms) ──► [VM commands] ──► vm.applyWorldEdits / vm.step
              ──► persist snapshot ──► render
```

### Components

- **`state.js`** — add `grownRooms: []` to `initState`; `recordGrownRoom(metadata, rec)`
  (append), `getGrownRooms(metadata)` (read, `[]` default).
- **`turn.js`** — in the existing growth block, after the room materialises and the move is
  re-issued, one call: `recordGrownRoom(metadata, { from: fromRoom, dir, name: room.name,
  description: room.description, objects: room.objects })`. No new control flow.
- **`worldmap.js`** (new, pure — no ST/VM imports):
  - `reverseDir(dir)` → opposite compass word.
  - `formatMap(records)` → multi-line tree string rooted at `Origin`.
  - `pathToRoom(records, targetName)` → ordered `[dir, ...]` from `Origin` to the room.
  - `planReplay(records)` → ordered `[command, ...]` (navigation `step`s interleaved with
    `xroom`/`xdesc`/`xobj`/`xodesc`) that rebuilds the world from a fresh seed.
- **`index.js`** —
  - **Export** handler: build the export object, `JSON.stringify`, trigger a Blob download.
  - **Import** handler: read the file, validate, load fresh `expanse.z5`, `initState`,
    run `planReplay` output through `vm.applyWorldEdits`/`vm.step`, persist, render. Also
    re-seed `grownRooms` from the imported rooms so `/if-map` and a future re-export work.
  - **`/if-map`** slash command → `postComment(formatMap(getGrownRooms()))`.
- **`settings.html`** — Export and Import controls in the dynamic-world area.

## Data formats

**Per-room record** (in `chatMetadata[KEY].grownRooms`, creation order):
```json
{ "from": "Origin", "dir": "north", "name": "attic",
  "description": "A dusty attic with a round window. A door leads east.",
  "objects": [ { "name": "trunk", "description": "A battered trunk.", "takeable": true } ] }
```

**Export file** (`world-<name>.json`):
```json
{ "format": "st_if_world", "version": 1, "story": "expanse",
  "rooms": [ { "from": "Origin", "dir": "north", "name": "attic", "description": "...", "objects": [] } ] }
```

## Replay algorithm (`planReplay`)

Records are in creation order, so each `from` room already exists when its child is replayed.
Maintain a "current room" cursor starting at `Origin`.

For each record `{from, dir, name, ...}`:
1. **Navigate** the cursor to `from`: compute `pathToRoom(records, cursor)` and
   `pathToRoom(records, from)`, drop the shared prefix, walk **up** the cursor's remaining
   tail via `reverseDir`, then **down** `from`'s remaining tail forward. Emit those `step`s.
   (Simpler valid fallback if common-ancestor logic is fiddly: walk fully back to `Origin`
   via reverse dirs, then down to `from` — extra VM steps cost nothing.)
2. Emit `xroom <dir> <name>`, `xdesc <description>`, and per object
   `xobj <1|0> <name>` + `xodesc <description>`.
3. Set cursor to `from` (xroom does not move the player).

`buildMetaCommands` from `worldgen.js` already formats the `xroom`/`xobj` lines; `planReplay`
reuses it and prepends navigation.

## Error handling / edge cases

- **Malformed / wrong-format import** → reject with a toast; leave the current world untouched.
- **Story mismatch** (`story !== "expanse"`, or a future expandable id we don't recognise) →
  reject. (v1 supports the `expanse` seed only.)
- **Empty `grownRooms`** → `/if-map` prints just `Origin`; export yields an empty `rooms` array.
- **Duplicate room names** → documented v1 limitation (rooms merge in the tree). No crash:
  `pathToRoom` returns the first match.
- **Navigation into the dark / dead ends** → not applicable; generated rooms are always lit
  and the tree is fully connected by construction.
- **Pool exhaustion on import** (more rooms than the pool holds) → `applyWorldEdits` surfaces
  `no-free-room`; stop replaying further rooms and toast a partial-import warning.

## Testing strategy

- **`worldmap.js` (pure, node `--test`):** `reverseDir`; `formatMap` tree for a branching
  world; `pathToRoom` for nested rooms; `planReplay` emits navigation + edits in the correct
  order for a multi-branch world.
- **Integration (`vm.integration.test.js`, canned, no LLM):** grow a small branching world on
  `expanse.z5` via meta-commands, capture records, `planReplay` them into a **fresh**
  `expanse.z5`, then assert round-trip fidelity — every room reachable by name, objects
  present (takeable guard intact), and connections identical (walk the tree both ways).

## Out of scope (this spec)

- Live object/inventory state in the export (world is captured as-generated).
- Importing into expandable *authored* worlds (the apartment retrofit is its own deferred task).
- Merge-on-import (import replaces).
- Editing the map in-app (the JSON is hand-editable in a text editor; that is enough).

## Success criteria

1. After growing a world, `/if-map` prints a correct tree of rooms and connections.
2. Export downloads a readable `world-<name>.json`.
3. Importing that file into a different chat rebuilds the identical world (rooms, names,
   descriptions, objects, connections) on a fresh `expanse.z5`.
4. A hand-edited export imports correctly (rename a room, add an object) — proving the format
   is genuinely editable.
5. Malformed or wrong-story imports are rejected without disturbing the current world.
