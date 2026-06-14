# ST_IF Scenario Bundles — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** loading a bundled world auto-seeds its NPCs/quests/cards/effectSafety from a sidecar
manifest (idempotent, missing-card fallback). One-step setup.

**Spec:** `docs/superpowers/specs/2026-06-14-st-if-scenario-bundles-design.md`
**Branch:** `st-if-scenario-bundles` (on `release`).
**Test/Lint:** `node --test public/scripts/extensions/ST_IF/test/*.test.js` · eslint over the dir.

---

### Task 1 — scenario.js (pure, TDD)
Files: create `scenario.js`, `test/scenario.test.js`.
- `parseManifest(text)` → object or null (tolerates surrounding text; junk → null).
- `planSeed(manifest, existingCardNames)` → `{ cardsToImport, npcs, quests, effectSafety, missing }`:
  - `cardsToImport` = manifest.cards whose `name` ∉ existingCardNames.
  - `npcs` = manifest.npcs (as-is); `quests` = manifest.quests; `effectSafety` = manifest.effectSafety || null.
  - `missing` = npcs whose `card` is set AND not in existingCardNames AND not in cardsToImport names (i.e. referenced but unshipped) → `[{ npc, card }]`. (Cards being imported are assumed to resolve; a failed import is re-checked live in index.js.)
- Tolerate absent sections (`cards`/`npcs`/`quests` missing → []).
Tests: parse valid/junk; cardsToImport = referenced − present; missing = referenced-unshipped; passthrough npcs/quests/effectSafety; empty manifest.

### Task 2 — tavern manifest + shipped cards (already vendored)
Files: create `worlds/tavern.world.json`; `worlds/cards/tomas.png`, `worlds/cards/maeve.png` (done).
```json
{ "cards": [{ "name": "Tomas the Barkeep", "file": "cards/tomas.png" },
            { "name": "Old Maeve", "file": "cards/maeve.png" }],
  "npcs":  [{ "name": "tomas", "room": "taproom", "blurb": "the gruff keeper of the bar", "card": "Tomas the Barkeep" },
            { "name": "maeve", "room": "commonroom", "blurb": "a sly old regular who trades in rumours", "card": "Old Maeve" }],
  "quests":[{ "id": "rats", "giver": "tomas", "goal": "clear the cellar rats", "reward": { "effect": "grant", "amount": 10 }, "condition": "rats_done" }],
  "effectSafety": "safe" }
```

### Task 3 — index.js load wiring
- `importCardPng(file, name)`: fetch `worlds/cards/<file>`, POST to `/api/characters/import`
  (multipart `avatar` = the PNG blob, `file_type=png`) with the CSRF header; then refresh the
  character list (`ctx.getCharacters?.()`). Dedupe handled by planSeed.
- `seedScenario(worldFile)`: derive `<basename>.world.json`, fetch it; `parseManifest`; if
  none → return. Idempotency: only if `getNpcs(md).length===0 && getQuests(md).length===0`.
  Run `planSeed(manifest, existingCardNames())`; import `cardsToImport`; re-derive missing
  (cards that still aren't present after import); `setNpcs`/`setQuests`; if `effectSafety` →
  `getSettings().effectSafety = …; saveSettingsDebounced()`; `saveMetadataDebounced()`; post
  a summary comment + (missing → a `/if-npc bind` message). Bundled-only: called from the
  picker Load path (which knows the file), not the upload path.
- Picker Load handler: after `applyStoryBytes(label, bytes, id)`, `await seedScenario(file)`.
- `/if-scenario` command: `reload` (clear npcs+quests, re-run seedScenario for the loaded
  world file) | `list` (npcs + quests summary).

### Task 4 — README + tests
- Document the manifest format in `worlds/README.md`.
- Lint + full suite green.

### Task 5 — commit, push, PR. Live-test: load tavern → seeded; play.
