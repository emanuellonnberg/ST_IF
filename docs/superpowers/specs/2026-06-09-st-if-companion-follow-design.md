# ST_IF — Reliable Companion Following + Direction Cues

**Date:** 2026-06-09
**Status:** Design approved, pending implementation plan
**Builds on:** [companion location tracking](2026-06-09-st-if-companion-location-design.md)
**Target repo:** `emanuellonnberg/ST_IF` (branch off `st-if-companion`)

## Summary

Makes the companion's "stays near player" slider **actually reliable**, and tells the
narrator which way each character departed. Today the companion picks a blind compass
guess via an LLM call, so even at high bias it wanders off (observed: it strayed to
"Endless Stair" while the player was elsewhere). This replaces the guess with
**deterministic trailing** built from the player's *real* move directions, and adds
**"left heading <dir>"** cues to the canon.

Two parts: **A** reliable following; **B** direction cues.

## A — Deterministic trailing

The translator already resolves the player's moves into commands (e.g. `["take lantern",
"north"]`). We extract the compass directions from those and use them to drive the
companion, instead of asking an LLM to guess.

The `companionBias` slider maps to three deterministic zones:

| Zone | Slider | Behavior |
|------|--------|----------|
| **Glued** | ≥ 0.66 | Replay **all** of the player's move directions this turn → companion ends in the player's room. Stays together. |
| **Trail** | 0.34–0.65 | Queue the player's moves; consume **one per turn** → follows ~1 room behind; brief separations while catching up. |
| **Wander** | ≤ 0.33 | Ignore the player; the existing LLM `decideMove` picks a direction or stays. |

No randomness — behavior is a pure function of the bias and the player's moves.

## B — Direction cues

Both directions are known each turn: the player's move (from the translator) and the
companion's move (we issue it). On a turn where someone departs, the apart canon weaves
it in:

- `companionDir` (move sent to the companion) → "You head **<dir>**, leaving {{user}} behind."
- `playerDir` (player's move this turn) → "{{user}} headed **<dir>** as you parted."
- Neither moved this turn → fall back to the existing "you last saw them near <playerLocation>."

The Phase-2 player-room comment may likewise note "{{char}} vanishes to the **<dir>**."

## State

Extends `chatMetadata.ST_IF.companion`:

```
companion: { snapshot, summary, followQueue: string[] }   // pending player directions to trail
```

`followQueue` is only used by the **Trail** zone (Glued drains the moves immediately;
Wander ignores them). Legacy companion records without `followQueue` are treated as an
empty queue on read.

## Turn flow (companion tracking on)

Replaces the single `companionMove` call in `turn.js`:

```
1. step playerVM (unchanged). playerMoves = directions among the player's cmds this turn
   (filtered by the compass-direction allowlist).
2. companion movement by zone(bias):
   - Glued:  for d of playerMoves: companionVM.step(d);          companionDir = last(playerMoves)
   - Trail:  followQueue.push(...playerMoves);
             if followQueue.length: d = followQueue.shift(); companionVM.step(d); companionDir = d
   - Wander: d = await decideMove(...); if d: companionVM.step(d); companionDir = d
3. playerDir = last(playerMoves) or null
4. together = playerRoom === companionRoom
5. persist companion snapshot + followQueue + together
6. canon: together → shared; apart → buildApartCanonBlock(..., playerDir, companionDir)
```

## Components

All logic stays pure / dependency-injected (tested with `node --test`); ST wiring stays
in `index.js`/`settings.js`.

| Module | Change |
|--------|--------|
| `companion.js` | Add pure `extractMoves(cmds)` (filter the compass tokens via the existing `DIRECTIONS` set) and `zone(bias)` → `'glued' \| 'trail' \| 'wander'`. Keep `decideMove` for the wander zone. |
| `state.js` | `companion` gains `followQueue`; `setCompanion` persists it; add `getFollowQueue` / `setFollowQueue`; legacy → empty queue. |
| `canon.js` | `buildApartCanonBlock` gains optional `playerDir`, `companionDir`. |
| `turn.js` | Replace the single companion-move call with the zone logic; compute `playerDir`/`companionDir`; pass them to canon and `onNarratePlayerRoom`. |
| `index.js` | Add `companionBias` to `deps.settings`; keep `decideMove` wired (wander only); pass `companionDir` to the narration. |
| `settings.html` | Tooltip clarifying the three zones. |

## Honest limitation (v1)

Glued/Trail **keep** you together or trail an *existing* path — they do **not reunite
from afar**. If you wander off (low bias) and then raise the bias while rooms apart, the
companion can't navigate back: there's no learned map yet (that's the deferred
"D: pathfinding / map-learning"). It re-converges only once you're adjacent again. The
LLM `decideMove` remains the wander brain.

Other caveats:
- Direction cues fire only on the turn a move happens; a static apart turn shows just the
  location (no stale "last seen heading" memory in v1).
- Mazes / one-way passages (e.g. Zork) can make a trailed direction land somewhere
  unexpected — acceptable; the companion simply ends wherever the VM puts it.

## Testing

- Unit (`node --test`, no runtime): `extractMoves` (keeps compass tokens, drops verbs),
  `zone` thresholds (0.2/0.5/0.8), `state` followQueue round-trip + legacy default,
  `canon` direction-cue variants, `turn` glued (replays all moves) / trail (one per turn,
  queue persists) / wander (LLM path).
- Manual in-app (ST runtime): slider at each zone — glued stays with you, trail lags one
  room, wander strays; the apart canon names the departure direction.

## Out of scope (deferred)

- Map learning + pathfinding to reunite from a distance ("D").
- "Seems to be to the <dir>" cue for adjacent-but-unseen rooms ("C") — needs the learned
  edge table.
- Companion manipulating world objects (still position-only).
