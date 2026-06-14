# ST_IF Dynamic World Growth (Path A) — Design

**Status:** approved design, pre-plan
**Date:** 2026-06-13
**Author:** brainstormed with the user (emanuel)

## Goal

Let the ST_IF narrator LLM **grow an Inform/Z-machine world at runtime** — inventing new
rooms (and simple objects in them) as the fiction wanders somewhere that does not exist
yet — **without an offline recompile**, and have those additions persist across the chat.

This is "Path A" from the larger feature discussion: a pre-allocated pool of blank
rooms/objects plus `parse_name`, mutated live through a meta-command channel. The "proper"
unbounded version (a native JS world engine, "Path C") is explicitly deferred to a later,
separate spec. The multi-NPC registry (mapping ST cards to in-world NPCs) is also a
separate, later spec that will build on this one.

## Core decisions (locked during brainstorming)

1. **Experience:** the *narrator auto-expands* the world. Growth is a side effect of play,
   not a separate build mode.
2. **Trigger:** *lazy, on blocked movement.* When the player moves a direction with no exit,
   instead of "you can't go that way" the engine invents the room there, on demand. Nothing
   generates until the player walks into a wall, so normal turns have zero overhead.
3. **Content:** *rooms + simple objects.* A generated room has a name, a description, an
   automatic return exit, and optionally a few **takeable items / examinable scenery**. No
   containers, switches, timers, or locked doors in v1 (those need generic behaviours that
   are hard to author blind).
4. **Coherence:** *from the chat/scenario context.* The narrator already knows the RP
   scenario and character card; generated rooms ride that context so they match the ongoing
   fiction. No separate theme configuration.
5. **Approach:** *Z-machine pool + meta-command channel* (Approach 1 below). The world model
   stays the single source of truth inside the VM, persists via the existing snapshot, and
   reuses the proven Inform parser.
6. **Seed:** the pool is a **reusable Inform include**. The seed can be an *empty expanse*
   or *any of our source-available worlds recompiled with the include* (apartment, garden).
   Only worlds we have source for can be made expandable; arbitrary Infocom `.z5` games
   cannot grow (no source, fixed image).

## Approaches considered

- **Approach 1 — Z-machine pool + meta-command channel (chosen).** A pool of blank
  rooms/objects compiled into the story, each with `parse_name` and settable text buffers,
  mutated live via a custom meta-verb the engine drives. One source of truth (the VM); free
  persistence via snapshot; reuses the Inform parser. Cost: authoring the pool include and a
  JS↔Inform protocol, and one genuinely unproven technique (runtime text + `parse_name`).
- **Approach 2 — JS shadow world (rejected).** Track rooms/objects as JS data, inject as
  canon, do not use the Z-machine for the dynamic world. Unbounded and simple, but
  reimplements the parser/world-model in JS — that is Path C in disguise and rejects the
  premise of staying on the Z-machine.
- **Approach 3 — Hybrid VM-topology + JS-strings (rejected).** The parser cannot match names
  it does not hold in VM memory, so `parse_name` breaks. Dead end.

## Architecture

```
player prose
   │  (existing translator)
   ▼
parser commands ──► VM.step() ──► outputs (canon)
   │
   │  if a move was BLOCKED and dynamic-world is on:
   ▼
worldgen.generateRoom(dir, room, chatContext)   ← one quiet LLM call
   ▼
worldgen.sanitize(json) → meta-commands
   ▼
VM.step("xcreate …"), VM.step("xobj …")   ← pool claims a blank, fills buffers, links exits
   ▼
re-issue the original move → new room description becomes this turn's canon
```

### Components

- **`worlds/expanse.h`** — shared Inform include (the pool library):
  - `BlankRoom` class: text buffers `rname`/`rdesc`, exit slots (`n_to`…`d_to`), `used`
    flag, `short_name`/`description` routines that print the buffers, and a `parse_name`
    that matches typed words against the `rname` buffer.
  - `BlankObject` class: `oname`/`odesc` buffers, `takeable` flag, `short_name`/
    `description`/`parse_name` analogues.
  - Meta-verbs `xcreate` and `xobj` (grammar with a raw-text token) whose handlers write
    characters into a target blank's buffers, set exits **both ways**, and mark `used`.
  - A small fixed pool (initial sizes: **64 blank rooms, 192 blank objects** — tunable),
    declared as instances of the classes.
- **`worlds/expanse.inf` → `expanse.z5`** — empty seed: one start room + `Include "expanse.h";`.
- **`worlds/apartment.inf` / `garden.inf`** — gain an optional expandable build by adding
  `Include "expanse.h";` and recompiling (kept as separate `*-expanse.z5` outputs so the
  plain demo worlds stay unchanged).
- **`public/scripts/extensions/ST_IF/worldgen.js`** (new, pure) — `parseRoomJson`,
  `sanitizeRoom` (ZSCII strip, length caps, object-name normalisation, count caps),
  `buildMetaCommands(room) -> string[]`. No ST/VM/LLM imports; unit-tested.
- **`vm.js`** — thin helpers: `applyWorldEdits(cmds)` (issue each meta-command, return
  success), and reuse of existing `step`/`save`/`getStatus`.
- **`turn.js`** — blocked-move detection + the generate→sanitize→apply→re-issue sequence,
  gated by the setting and the story being expandable.
- **settings** — a `dynamicWorld` toggle (default off); only meaningful for expandable
  stories. Surfaced in `settings.html`/`settings.js`.

## The pool world and runtime text (the crux)

The Z-machine cannot create new packed strings at runtime, so generated text cannot be a
normal Z-string. Each blank therefore pre-allocates **byte buffers** in dynamic memory:

- Room: `rname` ≤ 32 bytes, `rdesc` ≤ 200 bytes, six exit slots, `used`.
- Object: `oname` ≤ 24 bytes, `odesc` ≤ 160 bytes, `takeable`.

`short_name`/`description` print the buffers character by character (a loop over stored
ZSCII codes). The meta-verb handlers copy the incoming characters into the buffers; buffer
sizes are the hard caps that `worldgen.sanitize` truncates to.

`parse_name` is what lets the parser recognise generated names that are **not in the
dictionary**: the routine walks the player's typed words (`WordAddress`/`WordLength` against
the input buffer) and compares them against the stored `rname`/`oname` buffer, returning the
number of words matched. This is a known Inform 6 idiom but is the fiddliest piece.

### Meta-command channel

A custom verb whose grammar captures a raw text token, e.g.:

```
xcreate <slot> <dir> <name-bytes> | <desc-bytes>
xobj    <slot> <takeable> <name-bytes> | <desc-bytes>
```

The engine (not the player) emits these via `vm.step(...)`. The exact token framing is an
implementation detail to settle during the spike; the contract is "ST hands the pool a
direction + name + description (+ object specs); the pool claims the next free blank, fills
it, and links exits both ways."

## Critical risk and de-risking

The **runtime-text-in-buffers + `parse_name` matching** is the one unproven technique. It is
de-risked exactly as the inform6 toolchain was before the demo worlds:

> **Step 0 (spike):** one blank room whose name and description are set live via buffers,
> with `parse_name` matching, driven from `vm.js` end to end. Prove "examine" and movement
> recognise the runtime name before building anything else. If it fights us, we learn it
> cheaply and can fall back (e.g. number-keyed rooms, or escalate to Path C) before
> committing to the full pool.

## Generation call

On a blocked move the engine fires **one** quiet LLM call (the `deps.generate` path the
translator already uses — sequential, single-slot-safe). The prompt supplies the current
room name + description, the attempted direction, and the live chat/scenario context for
theme, and asks for JSON:

```json
{
  "name": "Dusty Attic",
  "description": "Cobwebs drape the rafters; a round window faces the street below.",
  "objects": [
    { "name": "trunk",   "description": "A battered travelling trunk.", "takeable": true },
    { "name": "cobwebs", "description": "Grey and sticky.",             "takeable": false }
  ]
}
```

`worldgen.sanitize` enforces: ZSCII-only text; `name` ≤ room-name buffer; `description` ≤
desc buffer; object `name` normalised to ≤ 2 lowercase words (for tractable `parse_name`);
object count capped to the remaining pool budget; takeables capped. Malformed or non-JSON
output ⇒ no generation (the move just stays blocked).

## Data flow per turn (unchanged unless a wall is hit)

1. Normal translate → `vm.step` loop (existing).
2. Detect a **blocked move**: a movement command whose location did not change and whose
   output matches the "can't go that way / no exit" pattern.
3. If `settings.dynamicWorld` and the story is expandable:
   a. derive direction + current room;
   b. `generateRoom(...)` (quiet LLM call);
   c. `worldgen.sanitize` + `buildMetaCommands`;
   d. `vm.applyWorldEdits(cmds)`;
   e. re-issue the original move; its output is this turn's canon.
4. Otherwise the move stays blocked as today.

## Persistence

Pool mutations are ordinary Z-machine dynamic-memory writes, already captured by the
existing per-turn `vm.save()` snapshot in `chatMetadata`. Revisiting a generated room
returns the same room. No new state accessors.

## Error handling / edge cases

- **Pool exhausted** → skip generation, fall back to the normal block, and `log()` it (no
  silent cap).
- **Junk / non-JSON LLM output** → skip generation gracefully.
- **Direction already has an exit** → never triggers (only blocked moves do).
- **Companion tracking** → the second VM does not know generated rooms. v1 constraint:
  **dynamic world is single-protagonist**; companion tracking is ignored in expandable mode.
  Replaying edits to the companion VM is a later iteration.
- **Extra LLM call** only on wall-hits → rare, sequential, safe for the local backend.
- **Non-expandable story loaded with the toggle on** → no-op (no pool verbs present); detect
  by probing for the pool and disable cleanly.

## Testing strategy

- **`worldgen.js` (pure)** — node `--test`: JSON parse, sanitisation (length caps, ZSCII
  strip, object-name normalisation, count caps), meta-command building, malformed input.
- **Integration (`vm.integration.test.js`)** — a tiny expandable `.z5` (small pool) driven
  by `vm.js` with **canned** room JSON (no LLM, deterministic): move into the void → apply →
  assert the new room is reachable, correctly named (parser recognises it), holds the
  objects, has a working back-link, is stable on revisit, and that pool exhaustion blocks
  gracefully.
- **Step 0 spike** validates buffers + `parse_name` before any of the above is built.

## Out of scope (this spec)

- Containers / switchable devices / timers / locked doors in generated rooms.
- Editing or deleting already-generated rooms.
- Companion/second-VM awareness of generated rooms.
- Multi-NPC card↔world registry (separate later spec).
- Native JS world engine (Path C, separate later spec).

## Success criteria

1. Load an expandable seed, walk into an undefined direction, and arrive in a themed room
   the LLM invented — named, described, with a working return exit.
2. The parser recognises generated room/object names (`examine trunk`, `take trunk`).
3. Walking back and forth is stable; the room persists across a save/reload of the chat.
4. With the toggle off, or on a non-expandable story, behaviour is exactly as today.
5. Pool exhaustion and malformed generation both degrade gracefully (normal block).
