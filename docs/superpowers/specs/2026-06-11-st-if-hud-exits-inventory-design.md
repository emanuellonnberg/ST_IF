# ST_IF — HUD: Exits + Inventory Display

**Date:** 2026-06-11
**Status:** Design approved, pending implementation plan
**Builds on:** the ST_IF room-display feature
**Target repo:** `emanuellonnberg/ST_IF` (branch `st-if-companion`)

## Summary

Players can't easily see a room's exits or their inventory: the narrator shouldn't be
forced to recite them, and the drawer's room box is buried behind a click. Add a
**toggleable floating HUD strip** above the chat input:

```
📍 West of House  ·  Exits: north, east, west → small house ✓  ·  🎒 lantern, sword
```

Out-of-band, player-facing only — the narrator prompt is untouched.

## Data layer

### Inventory — exact, no LLM

New `IFVM.query(cmd)`: `save() → step(cmd) → restore()`. Returns the command's output
with **zero net game effect** (the restore rewinds everything, move counter included).

After each action turn, `turn.js` runs `vm.query('inventory')`, compacts the text
(drop the "You are carrying:"-style header line, join item lines with commas), and
stores it in chat state as `inventoryText`. Always correct — it is the game's own
answer, not a guess.

### Exits — LLM extraction + learned edges

No "list exits" call exists in the Z-machine, so two complementary sources, both in
chat state:

- **`exitsCache[roomName]`** — extracted once per *new* room from the cached room
  prose by a small quiet LLM call returning JSON `[{dir, label}]`
  (e.g. `{"dir":"west","label":"small house"}`; label optional). Cache hit → no call.
  Fail-open to `[]` on garbage/error. Implemented in a new pure module `exits.js`
  (generate injected, unit-tested).
- **`mapEdges[roomName][dir] = destRoom`** — recorded automatically in `turn.js`
  whenever a move changes rooms. Ground truth for explored exits.

**Merge for display:** the extracted list, enriched by learned edges — a learned dir
gets `→ destRoom ✓`; learned dirs missing from extraction are appended. Known caveat:
rooms with randomized exits (e.g. Zork II's Carousel Room) make learned edges
unreliable there; acceptable.

## HUD strip

- Fixed, compact bar above the chat input; **`showHud` setting, default on**.
- Content: `📍 <location> · Exits: <merged list> · 🎒 <inventory>`.
- When companion tracking is on and the pair is **apart**, append
  `👥 {{char}}: <companion room>`.
- Click the 📍 to collapse to icon-only; click again to expand.
- Re-rendered after every turn (interceptor), on `CHAT_CHANGED`, and on load — same
  hooks as the existing room panel.
- Missing data degrades gracefully: no exits extracted → omit the Exits segment; no
  inventory yet → omit 🎒; no game → hide the HUD.

## Components

| File | Change | Tested |
|------|--------|--------|
| `vm.js` | `query(cmd)` — save/step/restore round-trip | integration (real .z3: query leaves location/moves unchanged, returns inventory text) |
| `exits.js` *(new, pure)* | `extractExits(roomDesc, generate)` → `[{dir, label}]`, fail-open; `mergeExits(extracted, edges)` | unit |
| `state.js` | `inventoryText`, `exitsCache`, `mapEdges` accessors (legacy → empty) | unit |
| `turn.js` | After action turns: inventory query + store; record `mapEdges` on room change | unit (fake VM with query) |
| `index.js` | HUD render + collapse; fire exits extraction for uncached rooms after turns; settings toggle wiring | manual |
| `settings.js` / `settings.html` / `style.css` | `showHud` toggle + HUD styles | manual |

Pure logic stays runtime-decoupled (DI) per the extension's existing pattern.

## Costs

- Inventory: free (local VM round-trip).
- Exits: one small quiet LLM call per **new** room only (~40 output tokens), cached
  forever per room in the chat.

## Error handling

Fail-open everywhere: query throws → skip inventory this turn. Extraction: cache the
result only on parse **success** (including a legitimately empty list); on garbage or
a thrown generate, leave the room uncached so a later entry retries. HUD render never
blocks or breaks the chat.

## Out of scope

- Auto-map / room graph visualization.
- Narrator-side changes (it never sees the HUD).
- Structured object lists for the room (beyond exits).
