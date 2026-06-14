# ST_IF Scenario Bundles — Design

**Status:** approved design, pre-plan
**Date:** 2026-06-14
**Builds on:** the bundled-world picker, the multi-NPC registry, and NPC effects + quests
(all merged). The demo cards `Tomas the Barkeep` / `Old Maeve` are the reference.

## Goal

Collapse the multi-step ST_IF setup (load world → `/if-npc add` → `/if-npc bind` →
`/if-quest add` → enable effects) into **one step**: loading a bundled world also seeds its
NPCs, quests, character cards, and effect setting from a manifest the world ships. Load "The
Adventurer's Rest" and Tomas + Maeve are placed, the quest is active, the cards are present,
and rewards are enabled — no slash commands.

## Core decisions (locked during brainstorming)

1. **Cards: ship AND reference.** A world bundles default card PNGs *and* the manifest
   references each by name, so a present card binds automatically and a user can still swap
   in their own (the missing/replacement flow still applies).
2. **effectSafety on load: auto-apply for bundled worlds.** Only bundled worlds ship a
   manifest (sidecar in `worlds/`), so they are trusted; the manifest's recommended
   `effectSafety` is applied and the user notified. An uploaded lone `.z5` has no manifest →
   nothing auto-seeds, nothing auto-changes.
3. **Idempotent seed:** only seed when the chat's NPC *and* quest registries are both empty,
   so reloading or a customised chat is never clobbered. A `/if-scenario reload` forces a
   reset when wanted.
4. **Never blocks:** a missing card seeds the NPC lightweight (narrator-voiced) + a clear
   replacement message; the scenario always loads and plays.

## Architecture

```
Load bundled world (picker → Load):
  applyStoryBytes(...)                                   (existing: VM + state reset)
  manifest = fetch worlds/<basename>.world.json          (none → behave as today)
  if getNpcs(md).length == 0 && getQuests(md).length == 0:
     plan = planSeed(manifest, existingCardNames())      (pure)
     for card in plan.cardsToImport: importCardPng(card) (create-API; dedupe by name)
     setNpcs(md, plan.npcs);  setQuests(md, plan.quests)
     if plan.effectSafety: settings.effectSafety = plan.effectSafety; save
     post summary + (plan.missing → replacement message)
```

### Components

- **`worlds/<basename>.world.json`** (sidecar manifest, bundled worlds only):
  ```json
  { "cards":  [{ "name": "Tomas the Barkeep", "file": "cards/tomas.png" }],
    "npcs":   [{ "name": "tomas", "room": "taproom", "blurb": "the gruff keeper", "card": "Tomas the Barkeep" }],
    "quests": [{ "id": "rats", "giver": "tomas", "goal": "clear the cellar rats",
                 "reward": { "effect": "grant", "amount": 10 }, "condition": "rats_done" }],
    "effectSafety": "safe" }
  ```
- **`worlds/cards/*.png`** — shipped card files (the vendored `Tomas the Barkeep.png` /
  `Old Maeve.png`).
- **`scenario.js`** (new, pure — no ST/VM imports): `parseManifest(text)` and
  `planSeed(manifest, existingCardNames)` → `{ cardsToImport:[{name,file}], npcs, quests,
  effectSafety, missing:[{npc,card}] }`. Cards to import = referenced cards not already
  present; `missing` = NPC cards that will still be absent after import (no shipped file).
- **`index.js`**: after `applyStoryBytes` for a bundled world, fetch the manifest, run
  `planSeed`, import cards (the create-API flow already used to make the demo cards), seed
  npcs/quests, apply `effectSafety`, post the summary + missing message. Guarded by the
  empty-registry idempotency check. `worlds.json` picker passes the world `file` so the
  basename → manifest path is derivable.
- **`/if-scenario`** slash command: `reload` (force re-seed from the manifest) / `list`
  (show the loaded scenario's NPCs/quests). Small escape hatch.
- **`worlds/README.md`** — document the manifest format.

## Card import

Reuse the create-character API used to mint the demo cards: `POST /api/characters/create`
with the card's fields, or import the shipped PNG. For shipping, the card PNGs carry their
own embedded V2 data, so import is "create from this PNG". Dedupe by `name`: skip any card
already in `getContext().characters`. After import, refresh the character list so binding by
name resolves.

## Missing-card UX

After import, any manifest NPC whose `card` is still not found:
- is seeded **lightweight** (no `card` → narrator voices it), and
- is listed in one posted message:
  > ⚠ NPC "tomas" expects card "Tomas the Barkeep" (not found). Bind a replacement:
  > `/if-npc bind tomas <your card>`

So the scenario loads and plays regardless; only the distinct *voice* waits on a card.

## Idempotency / lifecycle

- Seed only when both registries are empty (fresh chat). A reloaded or hand-edited chat keeps
  its NPCs/quests.
- `/if-scenario reload` clears the registries and re-runs `planSeed` (explicit reset).
- Switching to a different bundled world re-seeds only if the new chat's registries are empty
  (a new chat) — switching worlds mid-chat does not silently wipe NPCs.

## Error handling / edge cases

- **No manifest** (plain bundled world, or uploaded `.z5`) → no seeding; today's behaviour.
- **Malformed manifest** → `parseManifest` returns null → skip seeding + a console warning.
- **Card import fails / file absent** → that NPC falls to the missing-card path (lightweight +
  message); other NPCs still seed.
- **Registry non-empty** → skip auto-seed entirely (idempotency); summary notes it was skipped.
- **effectSafety only applied for bundled worlds** (manifests don't exist elsewhere), so an
  uploaded world can never flip the setting.
- **Quiet-gen / re-entry** — seeding posts messages but runs no LLM generation; no interceptor
  concerns.

## Testing strategy

- **Pure (`scenario.js`, node `--test`):** `parseManifest` (valid + junk → null); `planSeed`
  — cardsToImport = referenced − present; `missing` after a simulated failed import; npc/quest
  passthrough; effectSafety carried; empty/absent sections tolerated.
- **Integration:** a manifest fixture (the tavern's) → expected seed plan.
- **Live (in-app):** load the tavern → cards imported, NPCs + quest seeded, `effectSafety`
  safe, summary toast; play immediately (walk to Tomas, complete the rats quest, get paid);
  reload into a customised chat → registries not clobbered; delete a card then reload → the
  missing-card message appears and the NPC is narrator-voiced.

## Out of scope (this spec)

- Manifests for uploaded (non-bundled) worlds.
- A visual scenario-setup wizard (the picker Load + auto-seed suffices).
- Authoring manifests in-app (they are hand-written JSON shipped with a world).
- Dynamic/LLM-generated NPC placement (separate idea).
- Shipping cards as anything but PNGs.

## Success criteria

1. Loading "The Adventurer's Rest" seeds Tomas + Maeve (bound to their shipped cards), the
   rats quest (active), and sets effects to `safe` — with no slash commands.
2. A summary message states what was seeded.
3. If a referenced card is missing and unshipped, the NPC still loads (narrator-voiced) and a
   message gives the exact bind command.
4. Loading a world into a chat that already has NPCs/quests does not clobber them.
5. Worlds without a manifest, and uploaded `.z5` files, behave exactly as before.
