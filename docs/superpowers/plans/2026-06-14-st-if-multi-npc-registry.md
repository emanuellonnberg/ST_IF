# ST_IF Multi-NPC Registry — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** NPCs in rooms — lightweight ones narrator-voiced via canon, card-bound ones speak
in their own voice/avatar when addressed (custom routing). Stationary + talk-only.

**Spec:** `docs/superpowers/specs/2026-06-14-st-if-multi-npc-registry-design.md`
**Branch:** `st-if-npc-registry` (on `release`).
**Test:** `node --test public/scripts/extensions/ST_IF/test/*.test.js` (exclude untracked `tavern.test.js`). **Lint:** eslint over the dir.

---

### Task 1 — npc.js (pure, TDD)
Files: create `npc.js`, `test/npc.test.js`.
- `addNpc(list, {name,room,blurb})` → new list (replace by name); `removeNpc(list,name)`;
  `bindCard(list,name,card)` (card `-`/'' unbinds); `listNpcs(list)`.
- `presentNpcs(list, roomSlug)` → entries with `room===roomSlug` (case-insensitive on slug).
- `npcCanonLine(present)` → `"Present here: barkeep — a gruff innkeeper; hazel — a shy maid."` or ''.
- `addressedNpc(text, present)` → the present **card-bound** NPC the text addresses: a word-boundary name mention, or a talk/ask/tell/say/greet/speak verb plus the name; else null. Lightweight NPCs never returned (they have no card).
Tests: each op; present filter; canon line formatting/empty; addressed by name + by verb; ignores absent / non-card NPCs.

### Task 2 — state.js
- `initState` seeds `npcs: []`.
- `getNpcs(metadata)` (default `[]`), `setNpcs(metadata, list)`.
Test (`state.test.js`): round-trip + default.

### Task 3 — canon.js
- `buildCanonBlock(opts)` accepts `npcLine` (string) and `npcSpeakingFor` (name|null);
  when present, append a "Present here: …" line and, if `npcSpeakingFor`, the cue
  `"<name> is here and will answer for themselves — narrate the scene but don't voice them."`
- Mirror into `buildApartCanonBlock` minimally (npcLine only).
Tests (`canon.test.js`): line appears when provided, absent otherwise; cue gated on `npcSpeakingFor`.

### Task 4 — turn.js
- After canon assembly inputs are known: `const present = presentNpcs(getNpcs(metadata), status.location);`
  `const npcLine = npcCanonLine(present);`
  `const speaker = addressedNpc(player.text, present);`  // card-bound, present, addressed
  Pass `npcLine` + `npcSpeakingFor: speaker?.name ?? null` into the canon builders (both
  together and apart paths where a block is built).
- After setting the prompt, if `speaker` and `deps.onNpcSpeak`: call
  `await deps.onNpcSpeak({ npc: speaker, playerText: player.text, room: status.location, canon: outputs.join('\n') })`.
- Guard: only on real turns (already after SKIP_TYPES guard).

### Task 5 — index.js
- `/if-npc` slash command: `add <name> @ <room> : <blurb>` | `bind <name> <card>` |
  `list` | `remove <name>`. Parse, mutate via npc.js ops, `setNpcs`, `saveMetadataDebounced`.
- `deps.onNpcSpeak`: find the card in `getContext().characters` by `npc.card` (name match);
  if none → console.warn + return (Tier-1 fallback). Build persona from
  `description`+`personality`; `generateQuietPrompt` the reply; post a message
  `{ name: card.name, force_avatar: <card avatar path>, is_user:false, mes: stripReasoning(reply), send_date }`,
  `ctx.chat.push` + `ctx.addOneMessage` + `ctx.saveChat()`.
- Add `onNpcSpeak` to `buildDeps`.

### Task 6 — tests + lint
- Run pure suites (npc/state/canon) green; full suite (excl tavern) green; eslint clean.

### Task 7 — commit per task, push, PR (base release). Live-verify `/if-npc` + a card NPC in-app.
