# ST_IF — Companion Location Tracking

**Date:** 2026-06-09
**Status:** Design approved, pending implementation plan
**Builds on:** [ST_IF interactive fiction engine](2026-06-09-st-if-interactive-fiction-design.md)
**Target repo:** `emanuellonnberg/ST_IF` (branch off `st-if-extension` / `release`)

## Summary

Lets the chat character (the companion, `{{char}}`) have its **own location** in the
interactive-fiction world, distinct from the player (`{{user}}`). The companion is a
**position-only marker** that moves around the same map; the player remains the only
true agent on world state, so the two never desync. When player and companion are in
the same room, play is as today (one shared scene). When they're apart, the narrator
grounds in the companion's room and is unaware of the player's distant actions —
enabling real separation-and-reunion drama.

Gated behind a **"Companion tracking" toggle, off by default.**

## Why position-only

A Z-machine models exactly one protagonist; it has no native concept of a second
actor. Giving the companion full independent play would require a second VM running
the same story as a **separate universe** — shared objects would desync (both avatars
could take the same lamp). Restricting the companion to *movement only* (never
`take`/`use`/world mutation) means its second VM instance can't meaningfully diverge
from the player's world: it's just a token walking the shared map.

## Core decisions

| Decision | Choice |
|----------|--------|
| Companion agency | Position-only token (moves; never mutates world state) |
| Position engine | A second `IFVM` instance of the same story (`companionVM`), movement-only |
| Movement driver | Per-turn intent: a side LLM call decides the companion's move (0–1 step) |
| Split-scene POV | Companion POV; companion is unaware of the player's actions while apart |
| Apart-turn rendering | Two narrated blocks: player-room narration + companion scene |
| Co-location test | `playerVM` room name === `companionVM` room name |
| Gating | "Companion tracking" toggle, off by default; companion starts co-located |

## State

Extends `chatMetadata.ST_IF`:

```
ST_IF = {
   storyId,
   player:    { snapshot, summary, history[] },   // the existing single-VM state, now namespaced
   companion: { snapshot, summary },              // position-only second marker
   together:  boolean,                            // last-known co-location
}
```

**Migration:** existing chats store a flat `{ snapshot, summary, history }`. On read,
normalize legacy flat state into `.player` and seed `.companion` from the same start
snapshot, `together = true`. `state.js` owns this normalization so callers always see
the new shape.

## Turn flow (companion tracking ON)

```
1. translate player prose → cmds → step playerVM            (unchanged from v1)
2. companion intent: decideMove(context, playerRoom, companionRoom, bias) → 0-1 move
   → step companionVM (movement only)
3. together = (playerVM.room === companionVM.room)
4a. TOGETHER → canon = shared room + player action result → single {{char}} reply  (v1 flow)
4b. APART →
      • player-room block: generateRaw(neutral narrator, player room + action result)
        → posted as a COMMENT message (visible to user, excluded from the LLM prompt)
      • companion scene: the normal {{char}} reply; canon = companion's room only,
        player's action withheld (companion is unaware)
5. persist player + companion snapshots; save together flag
```

Cost: a *together* turn adds one cheap intent call over v1. An *apart* turn can fire up
to four LLM calls (player-translate, companion-intent, player-room narration,
companion reply). Acceptable because it is opt-in and only grows when the player
deliberately separates.

## The unaware constraint

The player-room narration must be visible to the user but invisible to the companion
narrator. SillyTavern **comment messages** are displayed but excluded from the prompt,
so the player-room block is posted as a comment. The main `{{char}}` reply receives
canon for the companion's room only, with the player's action explicitly withheld —
no telepathy leak.

## Components

Follows the existing pure / dependency-injected pattern (logic decoupled from the ST
runtime, tested with `node --test`; ST wiring isolated to `index.js`/`settings.js`).

| Module | Responsibility | Coupling |
|--------|----------------|----------|
| `vm.js` | Unchanged. `index.js` instantiates `IFVM` twice (`playerVM`, `companionVM`). | none |
| `companion.js` *(new, pure)* | `decideMove(context, playerRoom, companionRoom, bias, generate) → string\|null`. Intent LLM injected; bias = stay-near-player tendency. | none (generate injected) |
| `canon.js` | Add an apart companion-POV block (companion room only; "you are apart from {{user}}, last seen at X") alongside the existing together block. | none |
| `state.js` | New `{ player, companion, together }` schema + legacy-flat normalization on read. | none |
| `turn.js` | Branch together/apart; step `companionVM`; select canon; on apart, emit a `narratePlayerRoom` request via an injected callback. | none (deps injected) |
| `index.js` | Wire two VMs, the companion-intent and player-room-narration `generateRaw` calls, comment-message posting, settings. | ST |
| `settings` | "Companion tracking" toggle (off by default) + "companion stays near player" bias control. | ST |

**Co-location** is room-name equality between the two VMs' status lines (room names are
unique in practice).

## Error handling

Fail-open, never block the main chat:
- companion-intent call fails → companion does not move this turn.
- player-room-narration call fails → skip the player-room block; fall back to a single
  reply for the turn.
- companion VM step fails (e.g. invalid direction) → companion stays put.
All failures log to console.

## Phasing

**Phase 1 — locations visible, single reply.** Two VMs, companion intent + movement,
`together`/apart computed, canon expresses both locations and the apart companion-POV.
Apart turns still produce a single `{{char}}` reply grounded in the companion's room
(no second narration block yet). Delivers the core feature — "we're in different
rooms" — early and cheaply.

**Phase 2 — two narrated blocks when apart.** Add the player-room `generateRaw` call
and the comment-message posting, so an apart turn shows the player's own room scene
plus the companion's scene.

Each phase is independently shippable and testable.

## Testing

- Unit (`node --test`, no runtime): `companion.decideMove` (move/stay/invalid,
  fail-open), `canon` together vs apart blocks, `state` schema + legacy normalization,
  `turn` together/apart branching and the `narratePlayerRoom` callback.
- Manual in-app (needs ST runtime): the two `generateRaw` calls, comment-message
  posting and prompt-exclusion, the toggle, and end-to-end separation/reunion across a
  real story.

## Out of scope (v1 of this feature)

- Companion manipulating world objects (would reintroduce desync).
- Group chats with more than one companion.
- Companion pathfinding toward a goal room (intent picks one adjacent move per turn).
- NPCs beyond the single active chat character.
