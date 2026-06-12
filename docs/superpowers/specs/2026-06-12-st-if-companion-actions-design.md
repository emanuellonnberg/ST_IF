# ST_IF — Companion Acts on the World

**Date:** 2026-06-12
**Status:** Design approved, pending implementation plan
**Builds on:** the ST_IF companion features (tracking, agency, world-sync, dark-guard)
**Target repo:** `emanuellonnberg/ST_IF` (branch `st-if-companion`)

## Summary

Lets the companion **do things** in the game world — light the lantern, open a door,
pick something up — not just move. While the pair is **together**, her actions execute
on the **canonical (player) VM**, so the world genuinely changes; the narration
attributes the deed to her. Off by default, with a player-controlled initiative level
and a safety level.

## The mechanic and its boundary

The Z-machine has a single protagonist. "She acts" therefore means: her command runs on
the player's VM — mechanically the same avatar, narratively her deed. Consequences:

- **Together:** fully real. She lights the lamp → the lamp is lit in the one true
  world. Inventory is shared (one pack); "she is carrying it" is fiction the narration
  maintains.
- **Apart:** unchanged from today — her forked world cannot affect the real one, and
  her fork is overwritten at reunion. She does not act-for-real while apart.

## Settings

| Setting | Values | Default |
|---------|--------|---------|
| **Companion can act** (`companionActs`) | on / off | **off** |
| **Initiative** (`companionInitiative`) | `asked` (only when {{user}}'s message asks her) · `need` (asked, or an obvious immediate need) · `proactive` (whenever she judges useful) | `need` |
| **Action safety** (`companionActionSafety`) | `safe` (verb allowlist) · `open` (any in-world command) | `safe` |

## Decision call

One extra quiet LLM call per **together** turn, only when `companionActs` is on:

```
decideUse(playerText, sceneDesc, playerCmds, initiative, generate)
  → Promise<{ command: string | null }>
```

- Pure module function in `companion.js`; `generate` injected; fail-open to
  `{ command: null }` on garbage or error.
- The prompt embeds: the player's message, the current scene, the commands the player
  already executed this turn ("do not repeat these"), and the initiative level's
  behavioral instruction.
- Output JSON: `{"command":"light lantern"}` or `{"command":null}`. Single command only.

Orthogonal to movement: works with the deterministic zones and with agency mode alike
(movement logic untouched).

## Safety — three layers

1. **Hard blocklist, all levels:** meta-verbs that damage the session, never the
   fiction — `save`, `restore`, `restart`, `quit`, `undo`, `script` (word-boundary
   match on the command's first verb). Multi-command strings (newlines, periods
   chaining, "then") are rejected — one command max.
2. **`safe` level — verb allowlist:** the command's first verb must be one of
   `light, extinguish, open, close, read, take, get, push, pull, turn, ring, knock,
   touch, examine, look, search, unlock, wear, tie, untie`. Everything else (drop,
   give, throw, break, attack, eat, drink, burn, put, pour, cut, kill, …) is rejected.
   `open` level skips the allowlist (blocklist still applies).
3. **Outcome rollback, all levels:** snapshot the player VM before her command; if the
   output reads as death (`you have died` / `****`), restore the snapshot — she
   "thought better of it" and the action is dropped. (Same mechanism as the companion
   dark-guard.)

A rejected or rolled-back action is silently dropped: the turn proceeds as if she chose
not to act (fail-open, never blocks the chat).

## Turn flow (delta)

In `runTurn`, after the player's commands have executed and the companion block has
established `together`:

```
if together && settings.companionActs:
    decision = await deps.companionUse(player.text, roomDesc/outputs, cmds)
    cmd = validateAction(decision.command, settings.companionActionSafety)
    if cmd:
        snap = vm.save()
        out = vm.step(cmd)
        if DEATH.test(out): vm.restore(snap)        // rolled back, dropped
        else:
            outputs.push(out)                        // joins the turn's results
            companionAction = { cmd, out }           // for canon attribution
re-persist the canonical snapshot (her change is part of the world now)
canon gains: "{{char}}'s action: <cmd> — <out>" so the narrator attributes it to her
```

Ordering notes:
- Runs **after** the player's commands (she reacts to the turn, not preempts it) and
  **before** the canonical snapshot persist + together-sync (so her change is saved and
  mirrored into her own fork).
- Swipe turns reuse the cached outputs — her action is **not** re-executed on swipe
  (swipe-safety preserved).
- The history entry records her command alongside the player's (audit + swipe reuse).

## Components

| Module | Change | Tested |
|--------|--------|--------|
| `companion.js` | `buildUsePrompt`, `decideUse` (fail-open), `validateAction(cmd, safety)` (blocklist, allowlist, single-command) | unit |
| `turn.js` | together-action block per the flow above (decision → validate → execute → rollback → canon) | unit (fake VM + fake decide) |
| `canon.js` | optional `companionAction` line in the together canon block | unit |
| `settings.js` / `settings.html` | the three settings + wiring | manual |
| `index.js` | `companionUse` dep wired to `decideUse` + `generateQuietPrompt`; settings passthrough | manual |

## Costs

One quiet call (~40 output tokens) per together turn while `companionActs` is on.
Apart turns and disabled state: zero extra calls.

## Error handling

Fail-open at every stage: LLM error/garbage → no action; blocked verb → no action;
death outcome → rolled back, no action. The player's turn always completes normally.

## Out of scope

- Acting while apart (cannot be real; see boundary above).
- Multi-command companion plans.
- Companion-owned separate inventory (single-protagonist limitation).
- Confirmation UI before her actions (the safety levels are the control surface).
