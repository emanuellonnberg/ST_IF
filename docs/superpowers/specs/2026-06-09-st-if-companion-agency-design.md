# ST_IF — Companion Agency Toggle

**Date:** 2026-06-09
**Status:** Design approved, pending implementation plan
**Builds on:** [reliable following + direction cues](2026-06-09-st-if-companion-follow-design.md)
**Target repo:** `emanuellonnberg/ST_IF` (branch off `st-if-companion`)

## Summary

Adds an opt-in mode where the companion **decides for itself** each turn — follow you,
hang back, or go its own way — instead of the deterministic glued/trail/wander zones.
The "stays near player" slider becomes the LLM's *clinginess lean*: it usually obeys the
slider but can break off when the scene calls for it. Gated behind a new toggle,
**off by default** (so today's deterministic behavior is unchanged).

## Behavior

New setting **`companionAgency`** (default false):

- **Off** — current deterministic zones (glued ≥0.66 / trail 0.34–0.65 / wander ≤0.33).
  Unchanged.
- **On** — each turn (companion tracking on) one LLM call, `decideAgency`, returns
  `{ action, direction }`:

| `action` | Result |
|----------|--------|
| `follow` | Mirror the player's move(s) this turn (reliable glued-style follow). If the player didn't move → stays. |
| `stay`   | Hang back, no move. |
| `move`   | Go its own way — step the LLM's chosen compass `direction`. |

The `companionBias` slider is passed as a **lean** in the prompt: high → "you strongly
prefer to stay with {{user}} and rarely break off"; low → "you are independent and often
go your own way." The LLM usually honors it but may deviate for story reasons.

**Fail-open:** on LLM error or unparseable output, default to `follow` (the expected,
safe behavior).

## Turn flow

The companion block in `turn.js` gains an agency branch; everything downstream
(together/apart detection, direction cues, persistence, canon) is shared with the
existing zone path:

```
if settings.companionAgency:                       # NEW
    { action, direction } = await deps.companionDecide(playerText, playerRoom, companionRoom, playerMoves)
    follow → for d of playerMoves: companionVM.step(d); companionDir = last(playerMoves)
    move   → if direction: companionVM.step(direction); companionDir = direction
    stay   → (no step)
else:                                               # existing zone logic, unchanged
    glued / trail / wander ...
companionScene = last step output, or companionVM.step('look')
together = playerRoom === companionRoom
persist snapshot + together; canon as today (with playerDir/companionDir cues)
```

`followQueue` is unused in agency mode (follow mirrors all moves, glued-style); it stays
for the non-agency **trail** zone.

## Components

Pure / dependency-injected, tested with `node --test`; ST wiring in `index.js`/`settings`.

| Module | Change |
|--------|--------|
| `companion.js` | Add pure `buildAgencyPrompt(...)` and `decideAgency(playerText, playerRoom, companionRoom, playerMoves, bias, generate) → { action: 'follow'\|'stay'\|'move', direction: string\|null }`. Reuses the `DIRECTIONS` allowlist; fail-open to `{ action:'follow', direction:null }`. |
| `turn.js` | Add the `companionAgency` branch before the existing zone logic; reuse `extractMoves`, the scene/together/persist/canon tail. |
| `settings.js` / `settings.html` | `companionAgency` toggle (default false). |
| `index.js` | Add `companionAgency` to `deps.settings`; wire `deps.companionDecide` to `decideAgency` (bias + `generateQuietPrompt` injected). |

`state.js` and `canon.js` are unchanged.

## `decideAgency` contract

```
decideAgency(playerText, playerRoom, companionRoom, playerMoves, bias, generate)
  → Promise<{ action: 'follow' | 'stay' | 'move', direction: string | null }>
```

- Prompt includes both rooms, the player's message, the player's move directions this
  turn (offered as the "follow" option), and the clinginess lean from `bias`.
- Output JSON `{"action":"...","direction":"..."}`. Parsing:
  - `action` not one of follow/stay/move → fail-open `follow`.
  - `move` with a `direction` not in the compass allowlist → downgrade to `stay`
    (it wanted to move but gave nonsense).
  - generator throws / non-JSON → `{ action:'follow', direction:null }`.

## Error handling

Fail-open throughout — a bad agency decision never blocks the chat; worst case the
companion follows (agency on) or the turn proceeds without a companion move.

## Testing

- Unit (`node --test`): `decideAgency` parses follow/stay/move, validates the move
  direction (bad dir → stay), fails open to follow on garbage/throw; prompt includes the
  rooms, the player moves, and the bias lean. `turn.js` agency branch: follow mirrors all
  player moves, move steps the chosen direction, stay does nothing — and the agency
  branch is skipped when `companionAgency` is off (zone logic still runs).
- Manual (ST runtime): toggle on; high slider → companion mostly sticks but occasionally
  lingers/breaks off; low slider → frequently goes its own way; toggle off → identical to
  the deterministic zones.

## Out of scope

- Reuniting from afar (map learning / pathfinding) — still deferred.
- Companion manipulating world objects (still position-only).
- Multi-step own-way moves (agency `move` is one step per turn, like the rest).
