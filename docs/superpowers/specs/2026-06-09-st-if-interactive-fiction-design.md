# ST_IF — Interactive Fiction Engine for SillyTavern

**Date:** 2026-06-09
**Status:** Design approved, pending implementation plan
**Target repo:** `emanuellonnberg/ST_IF` (SillyTavern fork)

## Summary

A SillyTavern extension that bolts a real interactive-fiction (IF) game onto
normal chat. Each turn, the player's natural-language prose is evaluated; if it
maps to a meaningful in-game action, that action is run against an embedded
Z-machine virtual machine (the canonical game engine). The VM's output plus a
compact game-state block is injected into the chat prompt as ground truth, and
the normal SillyTavern narrator LLM writes rich prose around it.

The game layer is **additive, not a gate**: pure-roleplay turns that don't map
to a game action flow through untouched, and chat reacts as it always does.

## Core decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Engine model | Hybrid; v1 = "VM is law" | Deterministic core now, soft adjudication deferred |
| World source | Import existing IF — Z-machine (`.z5`/`.z8`) | Free-text parser IF matches the vision; reuse real games |
| IF interpreter | Embed `ifvms.js` / ZVM (pure JS) | Mature, embeddable, lightest real path; VM *is* the deterministic engine |
| Action mapping | LLM translator (strict) | Player stays in natural chat; prose → 0+ canonical VM commands |
| Injected payload | VM output + state block, as SYSTEM canon | Narrator honors ground truth, never contradicts |
| VM failure handling | VM is law (pass refusal through) | Fully consistent, zero extra LLM calls; adjudication is post-v1 |
| Mount mechanism | `generate_interceptor` manifest hook | Async, awaited before prompt build, gets live chat + abort + type |
| Runtime location | Client-side browser extension | No server changes |
| State persistence | `chatMetadata` (per-chat) | Survives reload; forks with chat branches for free |
| Story storage | base64 in `extensionSettings` (client) | No server endpoints; fine for typical <1MB IF files |
| VM bundling | Vendor `ifvms.js` into extension | Works offline; license-compatible in a separate extension |

## Architecture

Client-side extension at `public/scripts/extensions/third-party/ST_IF/`
(note: `third-party/` is typically gitignored in upstream SillyTavern — for a
bundled-in-fork build, place under `public/scripts/extensions/ST_IF/` and add to
the extensions manifest instead; resolve during planning).

```
Player prose ("grab lantern, creep north")
      │
      ▼  generate_interceptor(chat, ctxSize, abort, type)
┌─────────────────────────────────────────────┐
│ ST_IF interceptor                            │
│  1. guard: skip if type in {quiet,           │
│     impersonate}, no game loaded, or last    │
│     msg not from user                         │
│  2. snapshot VM (swipe safety)                │
│  3. translate: prose + state → 0+ VM cmds     │
│        (generateQuietPrompt, strict)          │
│  4. step VM with cmds → capture terse output  │
│  5. persist snapshot + summary to chatMetadata│
│  6. inject CANON block (VM output + state)    │
│        setExtensionPrompt, IN_CHAT, SYSTEM    │
└─────────────────────────────────────────────┘
      │
      ▼  normal generation proceeds
Narrator LLM writes rich prose around canon
```

### Units

Four isolated, independently testable modules:

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `vm.js` | Wrap ifvms/ZVM: load story, `step(cmds) → text`, `save()`/`restore(snap)` | ifvms lib only |
| `translator.js` | `(playerText, stateSummary) → string[]` via `generateQuietPrompt`; `[]` allowed | ST context |
| `state.js` | Read/write game state + VM snapshot in `chatMetadata`; serialize/derive summary | ST context |
| `index.js` | Interceptor wiring, guards, canon-block assembly, settings UI, slash commands | the other three |

Authority chain: **the VM snapshot is the only source of truth.** `summary` is a
derived cache for the prompt and UI. Narrator prose is decorative and is never
written back to game state.

## Turn pipeline

`chat` = live message array; last entry = the player's new message.

```
generate_interceptor(chat, ctxSize, abort, type):

 1. GUARD
    - type in {quiet, impersonate} → return
    - no game loaded for this chat → return
    - last msg not from user → return

 2. SNAPSHOT (before any step)
    - snapBefore = vm.save()
    - stash snapBefore + chat.length for this turn

 3. TRANSLATE
    - state = state.summary()            // room, exits, objects, inventory
    - cmds  = translator(playerText, state)
              generateQuietPrompt(strict prompt, responseLength ~80,
                                  jsonSchema = array of string)
    - parse → array; [] allowed; cap length (≤4 cmds)

 4. STEP VM  (skip if cmds empty)
    - outputs = []
    - for cmd in cmds: outputs.push(vm.step(cmd))
    - newState = state.read(vm)

 5. PERSIST
    - state.write(chatMetadata, { snapshot: vm.save(),
                                  summary: newState,
                                  lastTurnCmds: cmds,
                                  forMsgIndex: chat.length - 1 })
    - saveMetadataDebounced()

 6. INJECT CANON  (only if cmds ran; else optional quiet state line)
    block =
      [GAME — ground truth, narrate in character, never contradict]
      Action result: <outputs joined>
      Location: <room>.  Exits: <...>.  Inventory: <...>.
    setExtensionPrompt(KEY, block, IN_CHAT, depth=1, role=SYSTEM)

 7. return → generation proceeds, narrator dresses canon
```

LLM calls: two per **action** turn (translator + narrator), one per
**pure-RP** turn (translator returns `[]`, narrator only). Translator is cheap
(~80 output tokens). VM step is instant and local.

### Three turn types from one pipeline

| Player prose | Translator | VM | Result |
|---|---|---|---|
| "creep north, grab lantern" | `["north","take lantern"]` | steps | canon injected, narrator honors it |
| "I smile and ask for rumors" | `[]` | no step | normal chat, no game effect |
| "open the locked vault" (refused) | `["open vault"]` | steps → "It's locked." | canon = refusal, narrator must honor |

### Data shapes

```
state.summary()  → { room, exits[], objects[], inventory[], score?, moves? }
translator out   → ["take lantern","north"]   // or []
chatMetadata.ST_IF = {
   storyId,                       // which loaded game
   snapshot,                      // VM save (Quetzal/base64) — canonical truth
   summary,                       // last derived state (prompt + UI cache)
   history: [{ msg, cmds, out }], // optional audit, capped
}
```

## Translator strictness

v1 = **strict**: fire only on clear physical/world actions (move, take, drop,
use, open, attack, etc.); let most prose pass as pure RP (`[]`). Fewer wrong VM
steps; the game stays invisible until the player genuinely acts. Strictness is a
settings knob (strict ↔ loose) for tuning.

## State, swipes, and edge cases

The chat is mutable (swipe, edit, delete) while the VM has already stepped.
Must not double-step or desync.

- **Swipe / regenerate** (`type='swipe'`, same player msg): v1 reuses the
  cached `lastTurnCmds` + outputs for this turn — **do not re-translate, do not
  re-step**. VM stays at its already-stepped state; re-inject the same canon
  block; narrator re-rolls prose only. Zero risk, zero extra cost. (A
  restore-snapBefore-then-replay variant exists but is unnecessary for v1.)
- **Edit player message** (`MESSAGE_UPDATED`): v1 marks the turn stale and does
  nothing automatic; the next generation re-translates from edited text against
  `snapBefore`. "Edit = soft re-do," documented.
- **Delete / rewind**: manual slash command `/if-rewind` restores the VM
  snapshot from the turn at the target message index (snapshots kept keyed by
  msg index). Auto-sync on delete is post-v1.
- **Branch / new chat**: state lives in `chatMetadata`, so branching forks game
  state automatically.
- **Translator garbage / non-JSON**: treat as `[]` (pure RP), log a warning.
  Fail open — never block chat.
- **VM not loaded but interceptor enabled**: guard returns early; chat normal.
- **Multi-command ordering**: step in array order, concatenate outputs.

## v1 scope (YAGNI)

**In:**
- One story file per chat, uploaded via the settings panel.
- Strict translator, VM-is-law, canon injection.
- Swipe-safe via cached-cmds reuse; `/if-rewind` manual.
- Settings: enable toggle, story upload, translator strictness, canon depth,
  "inject state on RP turns" toggle.
- Slash commands: `/if-cmd <raw>` (bypass translator; debug), `/if-state`
  (dump current state), `/if-rewind`.

**Out (post-v1):**
- LLM adjudication of VM failures.
- Retry-translation on parser error.
- Auto-sync on edit/delete.
- Glulx support.
- Multiple simultaneous games, save-slot UI, map rendering.

## Open items for planning

- Resolve extension folder location vs upstream `third-party/` gitignore for a
  bundled-in-fork build.
- Confirm exact `ifvms.js` / ZVM API (`save`/`restore` snapshot format,
  text-capture hook) when vendoring.
- Confirm `generateQuietPrompt` JSON-schema support for the translator output,
  or fall back to manual JSON parse with fail-open.
