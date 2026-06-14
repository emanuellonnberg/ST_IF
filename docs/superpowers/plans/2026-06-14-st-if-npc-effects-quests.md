# ST_IF NPC Effects + Quests — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** NPC interactions fire validated VM state changes (grant/take gold, set flags) +
quests (bounded reward, flag-gated or soft). VM stays ground truth.

**Spec:** `docs/superpowers/specs/2026-06-14-st-if-npc-effects-quests-design.md`
**Branch:** `st-if-npc-effects` (on `release`).
**Test/Lint:** `node --test public/scripts/extensions/ST_IF/test/*.test.js` · eslint over the dir.
**Compile:** `node worlds/gen_expanse.mjs` (unaffected) then `inform6 "+include_path=tools/inform6lib-master,worlds" -v5 worlds/<f>.inf worlds/<f>.z5`.

**Note:** the tavern retrofit edits the repo's `tavern.inf`; flag that it diverges from the
standalone `adventurer_tavern` repo (user mirrors back or treats the repo copy as canonical).

---

### Task 1 — effects.h (VM, build + smoke first)
Files: create `worlds/effects.h`; a tiny `worlds/effects-test.inf` host for the smoke (deleted after).
- Flag table (reuse expanse.h dict-word matching): `Array XE_Flag --> N; Global XE_nflag;`
  `xflag <name>` sets (dedup), `xflagq <name>` prints `1`/`0`.
- Gold hooks: `#Ifndef XE_AddGold; [ XE_AddGold n; ]; #Endif;` `#Ifndef XE_Gold; [ XE_Gold; return 0; ]; #Endif;`
  `xgrant <n>` → `XE_AddGold(n)`; `xtake <n>` → `XE_AddGold(-n)`; `xgold` → print `XE_Gold()`.
- Verbs `xflag`/`xflagq`/`xgrant`/`xtake`/`xgold` (topic grammar).
- Host smoke (`effects-test.inf` implements `XE_AddGold`/`XE_Gold` on a `Global g`): `xgrant 10`→g=10; `xtake 3`→7; `xtake 100`→0 (clamp in host); `xflag clear`; `xflagq clear`→1; `xflagq nope`→0. Driven via vm.js. Delete the test host after.

### Task 2 — effects.js (pure, TDD)
Files: create `effects.js`, `test/effects.test.js`.
- `parseEffectProposal(text)` → first JSON obj or null.
- `validateEffect(p, {safety='off', maxGrant=25})` → `{effect,amount?,flag?}` or null:
  effect ∈ {grant,take,flag}; grant/take amount int 1..maxGrant; flag `^[a-z][a-z0-9_]*$`;
  safety off→null always; safe→no `take`; open→all.
- `effectVerb(eff)` → `xgrant 10` | `xtake 5` | `xflag clear`.
Tests: each rule + each safety level + effectVerb formatting + parse junk → null.

### Task 3 — quest.js (pure, TDD)
Files: create `quest.js`, `test/quest.test.js`.
- `addQuest(list,q)` (replace by id; default status 'active'); `removeQuest`; `listQuests`.
- `questsForGiver(list,name)` → active quests with that giver.
- `questCanonLine(active)` → "Quests here: rats — clear the rats from the cellar (reward 10 gold) [active]." or ''.
- `resolveCompletion(list, questId, flagIsSet)` → the quest to pay (active, matches id; if it has `condition`, requires `flagIsSet`), else null.
Tests: ops; questsForGiver; canon line; resolveCompletion flag-gated vs soft, double-claim (done→null), absent id.

### Task 4 — state.js
- `initState` seeds `quests: []`. `getQuests`/`setQuests`. (npcs already present.)
Test: round-trip + default.

### Task 5 — canon.js
- `buildCanonBlock` accepts `questLine` + `effectLine`; append when present (both together + apart paths get `questLine`; effectLine on the main path).
Tests: appear only when provided.

### Task 6 — settings + turn.js
- settings: `effectSafety: 'off'` (off|safe|open), `maxGrant: 25`. UI select + number; deps.settings passthrough.
- turn.js: compute `questLine = questCanonLine(questsForGiver(getQuests(md), npcSlugForRoom?))` — actually quests reflect a PRESENT giver: `questsForGiver` over present NPCs' names; thread `questLine` into canon builders.

### Task 7 — index.js (/if-quest + onNpcSpeak effects)
- `/if-quest add <id> giver=<npc> goal="..." reward=<gold N|flag F> [needs=<flag>]` | list | remove.
- Extend `onNpcSpeak`: after the NPC line, a quiet call returns the proposal JSON; `validateEffect` (settings safety/maxGrant); if effect → `vm.applyWorldEdits([effectVerb])` + record an effect line; handle `questDone`: `resolveCompletion` (check `vm.step('xflagq <cond>')` for flag-gated) → fire the quest's reward effect once, mark done, persist quests. Record an effect/quest line into state for the next canon (`pendingEffectLine`), surfaced by turn.js next turn or appended to the NPC message.
- Wire `getQuests/setQuests`, settings bounds into buildDeps.

### Task 8 — tavern retrofit + demo quest
- `tavern.inf`: `Include "effects.h";` before Grammar; implement `[ XE_AddGold n; gold = gold + n; if (gold < 0) gold = 0; ];` and `[ XE_Gold; return gold; ];`. Add a minimal authored trigger that sets the `cellar_clear` flag (e.g. an action in the cellar), OR ship the demo quest soft. Rebuild tavern.z5.
- Seed nothing automatically; document `/if-npc add barkeep @ commonroom ...` + `/if-quest add rats giver=barkeep goal="clear the cellar" reward=gold 10 needs=cellar_clear` in the tavern README.

### Task 9 — tests, lint, commit per task, push, PR (base release). Live-verify the barkeep payout.
