# ST_IF NPC Effects + Quests — Design

**Status:** approved design, pre-plan
**Date:** 2026-06-14
**Builds on:** the multi-NPC registry, the companion-acts validation pattern, and the tavern
world (baked-in barkeep + `gold` economy).

## Goal

Let NPC interactions change **ground-truth game state** — grant/take gold, set quest flags —
so an LLM-voiced NPC can actually *reward* the player (and run quests), not just talk. The VM
stays the source of truth: the LLM **proposes** an effect, the engine **validates + bounds**
it, and the VM **executes** it (clamping the impossible). Quests sit on top: a giver, a goal,
a bounded reward, and completion grounded on a VM flag (or soft when none).

## Core tension this resolves

A pure LLM-voiced NPC can *say* "here's 10 gold" but it doesn't change the VM's `gold` — the
reward is fake. This feature gives NPC interactions a **validated channel into the VM**, so the
prose and the state agree and the number is the VM's, not the prose's.

## Core decisions (locked during brainstorming)

1. **Effects + quests designed together** (one spec).
2. **Effect model: LLM proposes, engine validates** (companion-acts generalized). Flexible,
   works for any NPC; the engine bounds amounts/allowlist/safety.
3. **Vocabulary: gold + flags** (items deferred — they need world-declared giveable objects).
4. **Quests are bounded:** the reward is the quest's *pre-defined* effect, not LLM-chosen, so
   payouts stay bounded even though the LLM paces completion.
5. **Grounding spectrum:** a quest may carry a `condition` flag (engine pays only when the flag
   is set — true ground truth) or be soft (LLM-judged, bounded reward).

## Architecture

```
NPC interaction (onNpcSpeak, after the NPC line):
  proposal = quiet LLM call → { effect: grant|take|flag|none, amount?, flag?, line? }
  eff = validateEffect(proposal, { safety, maxGrant, knownFlags })      ← engine bounds
  if eff: vm.applyWorldEdits([effectVerb(eff)])   → xgrant/xtake/xflag   ← VM executes/clamps
          record eff for canon ("you now have N gold" / "<flag> is set")

Quest completion (same proposal may carry questDone:<id>):
  q = quest by id, giver present, status active
  if q.condition and not vm flag(q.condition): ignore (not grounded yet)
  else fire q.reward (bounded), status = done, record canon
```

### Components

- **`worlds/effects.h`** (new shared include): the world effect surface.
  - **Flags (generic):** a flag table owned by the include. `xflag <name>` sets a named flag;
    `xflagq <name>` reports `0/1`. Works in any host that includes it.
  - **Gold (host-mapped):** `xgrant <n>` / `xtake <n>` call host hook `XE_AddGold(±n)`
    (clamped ≥ 0 by the host); `xgold` reports via `XE_Gold()`. `#Ifndef` stubs so a world
    without an economy compiles (grants no-op).
- **`effects.js`** (new, pure): `parseEffectProposal(json)`; `validateEffect(proposal, opts)`
  → the bounded effect or null (allowlist, `amount ≤ maxGrant`, sane flag, one-per-turn,
  safety `off|safe|open`); `effectVerb(eff)` → the `xgrant 10` / `xflag clear` string.
- **`npc.js` / a `quest.js`** (pure): quest registry ops `addQuest`, `removeQuest`,
  `listQuests`; `questsForGiver(quests, npcName)`; `questCanonLine(active)`; and
  `resolveCompletion(quests, questDoneId, flagIsSet)` → the quest to pay out, or null.
- **`state.js`:** `getQuests`/`setQuests` over `chatMetadata.ST_IF.quests` (seeded `[]`).
- **`canon.js`:** weave present-giver quest state + any just-fired effect line.
- **`index.js`:** `/if-quest` slash command; extend `onNpcSpeak` to do the proposal →
  validate → fire (effect and/or quest payout) → record; expose the bounds from settings.
- **`turn.js`:** already stashes the addressed NPC (`pendingNpcSpeak`); the effect pass rides
  that same path (effects only fire when an NPC is engaged).
- **`tavern.inf`:** include `effects.h`, implement `XE_AddGold`/`XE_Gold` on its `gold`, and
  ship one demo quest (the barkeep wants the cellar cleared → 10 gold).

## Data model

`chatMetadata.ST_IF.quests`:
```json
[ { "id": "rats", "giver": "barkeep", "goal": "clear the rats from the cellar",
    "reward": { "effect": "grant", "amount": 10 }, "condition": "cellar_clear",
    "status": "active" } ]
```
- `giver` is an NPC `name` (registry slug). `reward.effect` is `grant`/`take`/`flag`
  (+`amount` or `flag`). `condition` (optional) is a VM flag name that must be set to pay out.
  `status` is `active` | `done`.

## Effect proposal + validation

After the NPC speaks, a quiet LLM call returns JSON (or none):
```json
{ "effect": "grant", "amount": 10, "questDone": "rats", "line": "Good work — here's coin." }
```
`validateEffect` enforces:
- `effect ∈ {grant, take, flag, none}`; unknown → dropped.
- `grant`/`take`: `amount` integer `1..maxGrant` (a setting, default e.g. 25).
- `flag`: name matches `^[a-z][a-z0-9_]*$`.
- **one effect per turn**; nothing fires under `safety: off`; `safe` = grant/flag only (no
  `take`); `open` = all.
- A `questDone` only pays if the quest exists, its giver is present, it is `active`, and
  (if it has a `condition`) the VM flag is set (`xflagq`).

The fired effect is recorded so `canon.js` states the new truth next — e.g.
*"The barkeep slides 10 gold across; you now have 30."*

## Quests

- **Placement:** `/if-quest add <id> giver=<npc> goal="…" reward=<gold N|flag F> [needs=<flag>]`
  · `/if-quest list` · `/if-quest remove <id>`. Per-chat, persisted in `chatMetadata`.
- **Reflected in canon:** active quests whose `giver` is present are added to the canon block
  (*"barkeep's quest: clear the cellar — reward 10 gold — status: active"*), so the NPC raises
  and acknowledges it naturally.
- **Completion:**
  - *flag-gated:* `condition` flag must be set (by authored world logic, or by a prior
    validated LLM `xflag` proposal that then persists as a VM fact) — engine pays out only
    then. True ground truth.
  - *soft:* no `condition` → the LLM proposes `questDone`; engine pays the **pre-set** reward
    (bounded).
- **Payout:** fire `reward` via the effect path once, set `status:'done'`, record canon. The
  reward amount is the quest's, never LLM-chosen.

## Error handling / edge cases

- **No NPC engaged** → no proposal call, no effects (effects ride `onNpcSpeak`).
- **Malformed/none proposal** → no effect; turn proceeds.
- **Over-cap / disallowed effect** → dropped by `validateEffect` (the NPC may still *say*
  something, but nothing fires).
- **`safety: off`** (default-safe choice) → effects never fire; NPCs are talk-only, exactly
  like before this feature.
- **World without `effects.h`** → `xgrant`/`xflag` are unknown verbs; `applyWorldEdits` reports
  a miss; the engine treats the effect as not-fired. NPCs still talk.
- **Quest condition flag never set** → quest stays `active`; no payout (correct).
- **Double-claim** → `status:'done'` guard; a second `questDone` is ignored.
- **Quiet-gen re-entry** → the proposal call is a SKIP_TYPE quiet call, like the NPC line and
  player-room narration; never re-runs the VM turn.

## Testing strategy

- **Pure (`effects.js`, `quest.js`, node `--test`):** `validateEffect` (allowlist, cap, flag
  format, one-per-turn, each safety level); `effectVerb` formatting; quest registry ops;
  `questsForGiver`; `resolveCompletion` (flag-gated vs soft, double-claim, absent giver);
  `questCanonLine`.
- **VM (`effects.h`, via `vm.js`):** `xgrant`/`xtake` clamp at 0 and adjust the host meter;
  `xflag`/`xflagq` round-trip; unknown-flag query returns 0. Verified on a tiny test host that
  includes `effects.h` (and on `tavern.z5` once retrofitted).
- **canon.js:** the quest line + effect line appear only when provided.
- **Live (in-app):** the barkeep pays a bounded reward when warranted; a flag-gated quest pays
  only after its flag is set; `safety: off` fires nothing.

## Out of scope (this spec)

- **Item effects** (give/take objects) — deferred (need world-declared giveable objects).
- NPCs *taking* the initiative to start fights / move the player — effects are reactive to an
  engaged NPC.
- A quest-log UI panel (slash command + canon reflection suffice).
- LLM authoring quests itself (quests are placed via `/if-quest`).
- Multi-step / branching quests (single goal + reward in this version).

## Success criteria

1. A bounded `safety` setting gates whether NPC effects fire at all (default off = today's
   behaviour).
2. An engaged NPC can grant/take gold within the cap and set flags, executed by the VM, and the
   next canon reflects the new state.
3. `/if-quest` manages a per-chat quest registry; a present giver's active quests appear in
   canon and the NPC reflects them.
4. A flag-gated quest pays its **pre-set** reward only once the condition flag is set; a soft
   quest pays on LLM-judged completion — both with bounded, VM-executed rewards.
5. Worlds without `effects.h` (and `safety: off`) behave exactly as before.
