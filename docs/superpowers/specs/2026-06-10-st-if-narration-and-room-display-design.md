# ST_IF — Character-Forward Narration + Persistent Room Display

**Date:** 2026-06-10
**Status:** Design approved, pending implementation plan
**Builds on:** the ST_IF companion features
**Target repo:** `emanuellonnberg/ST_IF` (branch off `st-if-companion`)

## Summary

Two related play-quality fixes:

1. **Character-forward narration** — when the player moves/acts, the narrator currently
   transcribes the room in second person and drops `{{char}}` entirely (observed: long
   travelogue prose with no Dora, even while together). Reframe the canon so the game
   text is *setting*, and `{{char}}` reacts/speaks/acts within it.
2. **Persistent room display** — the only current room readout is the debug **toast**,
   which disappears. Add a persistent **"Current room"** box (location + room prose +
   score/moves) in the ST_IF drawer, so you can always see where you are and what the
   room said (which names exits/items in prose).

## Feature 1 — Character-forward narration

A Z-machine room description fed as "ground truth" pulls the model into pure narration.
The fix is wording + a presence reminder.

**`canon.js` `buildCanonBlock`** — replace the instruction line and add an optional
`companionPresent` flag. New action-turn block:

```
[GAME — canon ground truth. Stay in character as {{char}}: react, speak, and act
within this setting. The game text is the setting, not your reply — don't just
describe the room.]
Action result: <vm output>
Location: <room>.  Score: N.  Moves: N.
{{char}} is here with you.        ← only when companionPresent is true
```

- `Action result:` and the status line are unchanged (keeps existing tests/behavior).
- `companionPresent` defaults false; the together-branch passes `true`.

**`turn.js`** — the together-branch calls `buildCanonBlock({ ..., companionPresent: true })`.
The apart canon is already character-forward ("narrate your own situation, in character")
and is left as is. Base/no-companion turns get the stronger instruction too (it helps
even without tracking).

## Feature 2 — Persistent room display

### Capture

The player's "current room description" is stored in chat state and updated only when it
should change:

- **Moved rooms** (location changed this turn) → the move's output *is* the new room
  description; store the last output.
- **Look command** (`look` / `l` / `examine room` among the player's commands) → store the
  last output.
- **Otherwise** (e.g. `take lamp`) → keep the existing description (don't overwrite with an
  action result).
- **On story load** → seed from the opening scene (`vm.getIntro()`).

State gains a top-level `roomDescription` string with `setRoomDescription(metadata, text)`
/ `getRoomDescription(metadata)` accessors (legacy state → `''`).

### Display

A read-only **"Current room"** box in the ST_IF settings drawer shows:

```
Current room: <location>
<room description prose>
Score N · Moves N
```

Rendered by `index.js` `renderRoomPanel()`, called after every `runTurn` (in the
interceptor), on `CHAT_CHANGED`, and after load. Works in base and companion modes (it's
the player's room). `settings.html` gets the container.

## Components

| File | Change |
|------|--------|
| `canon.js` | New character-forward instruction in `buildCanonBlock`; optional `companionPresent` line. |
| `state.js` | `roomDescription` field + `setRoomDescription` / `getRoomDescription` (legacy → `''`). |
| `turn.js` | Pass `companionPresent: true` in the together-branch; capture room description on move / look. |
| `index.js` | `renderRoomPanel()`; seed room description on load; call render after each turn + on chat-change. |
| `settings.html` | "Current room" read-only container. |

All logic (`canon`, `state`, `turn`) stays pure/DI and unit-tested; `index.js`/`settings`
hold the ST wiring.

## Error handling

- Missing/empty room description → the box shows just the location + status (no crash).
- Capture failures are impossible to throw (pure string ops); a non-room output simply
  isn't stored.

## Testing

- Unit (`node --test`): `canon` — character-forward instruction present, `companionPresent`
  adds the line, existing assertions still pass; `state` — `roomDescription` round-trip +
  legacy default; `turn` — moving captures the new room prose, a `look` captures it, a
  non-move/non-look action keeps the previous description, and the together-branch canon
  includes "is here with you".
- Manual (ST runtime): replies keep `{{char}}` present and reacting (no more travelogue);
  the "Current room" box shows the location + prose and updates on move/look and persists
  across turns and reloads.

## Out of scope

- Structured exits/items extraction (LLM-parsed list) — possible later toggle.
- Floating always-visible room panel — the drawer box is v1.
- Changing the apart-narration voice (already character-forward).
