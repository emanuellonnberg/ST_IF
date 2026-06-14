# ST_IF Multi-NPC Registry — Design

**Status:** approved design, pre-plan
**Date:** 2026-06-14
**Builds on:** the single-card narrator model + the companion second-VM concept, and the
canon-injection / quiet-generation / attributed-message machinery already in the extension.

## Goal

Populate ST_IF worlds with **NPCs that live in rooms**: when the player is in an NPC's room,
the NPC is present in the scene; lightweight NPCs are voiced by the existing narrator, and
NPCs bound to a SillyTavern character card speak in that card's own voice (and avatar) when
addressed. NPCs are stationary and talk-only in this version.

## Core decisions (locked during brainstorming)

1. **MVP behaviour: stationary residents.** NPCs live in fixed rooms; no wandering, no
   world-acting (both deferred, mirroring how the companion's movement/acts came later).
2. **Tiered fidelity (both built now):**
   - *Lightweight* — an NPC is a name + blurb; the narrator voices it via canon. No second
     generation.
   - *Card-bound* — a key NPC is bound to a real ST character card and speaks in its own
     voice/avatar when addressed.
3. **Architecture: custom persona routing (single chat)** — NOT ST group chats. ST_IF already
   owns the turn via the interceptor; we vary the injected persona rather than cede turn
   control to ST's group orchestrator. This unifies both tiers behind one mechanism and
   reuses the existing canon + quiet-gen + attributed-message pipeline.
4. **Orthogonal to the companion feature** (companion = `{{char}}`'s position; NPCs = fixed
   residents) and works in authored *and* grown worlds (`npc.room` is a room slug).

## Architecture

```
TURN:
  player prose ──► translator ──► VM.step ──► canon (existing)
  present = npcs where npc.room == player's room slug
  canon += "Present here: <name> — <blurb>"  for each present NPC        (Tier 1)

  if an addressed NPC has a bound card:                                   (Tier 2)
     narrator canon += "<name> will speak for themselves; do not voice them."
     (after the narrator generation)
     reply = generateQuietPrompt(card persona + room + player msg + canon)
     post reply as a chat message  { name:<card>, force_avatar:<card avatar>, mes:reply }
```

### Components

- **`npc.js`** (new, pure — no ST/VM imports):
  - registry ops on a plain array: `addNpc`, `removeNpc`, `bindCard`, `listNpcs`.
  - `presentNpcs(npcs, roomSlug)` → NPCs in that room.
  - `npcCanonLine(present)` → the "Present here: …" canon string (or '').
  - `addressedNpc(playerText, present)` → the present card-bound NPC the message addresses
    (name mention, or talk/ask/tell/say/greet toward them), else null.
- **`state.js`** — `getNpcs(metadata)`, `setNpcs(metadata, list)` over
  `chatMetadata.ST_IF.npcs` (default `[]`; seeded `[]` in `initState`).
- **`canon.js`** — `buildCanonBlock` (and the apart variant) accept an optional
  `npcLine` / `npcSpeakingFor` and weave them into the block.
- **`turn.js`** — compute `present`, pass `npcLine` to the canon builder; if an addressed
  card NPC exists, set the "don't voice them" cue and signal `deps.onNpcSpeak(...)`.
- **`index.js`** — slash command `/if-npc`; `deps.onNpcSpeak({ npc, playerText, room, canon })`
  loads the card persona from `getContext().characters` and posts the attributed message.

## Data model

`chatMetadata.ST_IF.npcs`:
```json
[ { "name": "barkeep", "room": "tavern", "blurb": "a gruff innkeeper who has seen it all",
    "card": "Gruff Innkeeper" } ]
```
`name` is a single token (matches room/slug conventions); `room` is a world room slug;
`blurb` is free text; `card` (optional) is the bound character's name/avatar reference.

## Placement (slash commands)

- `/if-npc add <name> @ <room> : <blurb>` — add or update a lightweight NPC.
- `/if-npc bind <name> <card name>` — bind a character card (Tier 2). Unbind: `bind <name> -`.
- `/if-npc list` — list NPCs, rooms, and binds.
- `/if-npc remove <name>` — remove.

(A settings-panel editor is a later nicety; slash commands are the MVP, consistent with the
existing `/if-cmd`, `/if-map`, etc.)

## Tier 1 — lightweight (narrator-voiced)

Each turn, `present = presentNpcs(getNpcs(md), playerRoomSlug)`. The canon block gains a line
naming present NPCs and their blurbs, so the narrator includes them in the scene. No extra
generation, no attribution — they share the narrator's voice. This alone makes worlds feel
inhabited.

## Tier 2 — card-bound (own voice/avatar)

When a present NPC has a `card` and `addressedNpc(playerText, present)` returns it:

1. **Narrator generation** runs as usual but its canon carries
   *"<name> is here and will answer for themselves — narrate the scene/action but don't put
   words in their mouth."* (prevents the narrator double-voicing the NPC).
2. **After the narrator turn**, `onNpcSpeak` builds the NPC reply with a quiet generation:
   - load the bound card from `getContext().characters` (description + personality →
     persona text);
   - prompt: *"You are <name>. <persona>. You are in <room>. The player said: '<text>'.
     Ground-truth this turn: <canon>. Reply in character, 1–3 lines of dialogue/action."*
3. **Post the reply as a normal (in-prompt) chat message** attributed to the NPC:
   `{ name: <card display name>, force_avatar: <card avatar>, is_user: false, mes: reply }`,
   then `addOneMessage` + `saveChat`. The UI shows the NPC speaking in its own voice/avatar,
   and future turns see the line.

If the bound card can't be found, fall back to Tier 1 (narrator voices it) — never break the
turn.

## Error handling / edge cases

- **No NPCs / none present** → no canon line, no routing; behaves exactly as today.
- **Multiple present NPCs** → all listed in canon (Tier 1). For Tier 2, only the single
  *addressed* card NPC speaks per turn (stationary residents → usually one addressed at a
  time); others remain narrator-voiced. (Multi-speaker turns are out of scope.)
- **Addressed lightweight NPC (no card)** → narrator voices the reply (Tier 1); no quiet gen.
- **Bound card missing/renamed** → fall back to Tier 1 + a console warning.
- **Quiet generation re-entry** → `onNpcSpeak`'s quiet call re-enters the interceptor; it is a
  SKIP_TYPE-guarded quiet call exactly like the existing player-room narration, so it never
  re-runs the VM or clobbers canon.
- **NPC room slug not in the world** → the NPC is simply never "present"; harmless.

## Testing strategy

- **Pure (`npc.js`, node `--test`):** `addNpc`/`removeNpc`/`bindCard`/`listNpcs`;
  `presentNpcs` for a room; `npcCanonLine` formatting; `addressedNpc` detection
  (name mention, talk/ask verbs, ignores absent or non-card NPCs).
- **state.js:** `getNpcs`/`setNpcs` round-trip; `initState` seeds `[]`.
- **canon.js:** the present-NPC line + the "don't voice" cue appear in the built block when
  provided, absent otherwise.
- **Live (manual / in-app):** the `/if-npc` commands; a lightweight NPC voiced in-scene; a
  card-bound NPC replying in its own avatar when addressed — verified in the running app like
  the other generation paths.

## Out of scope (this spec)

- NPC movement / pathing (stationary only).
- NPCs acting on the world (using objects) — like the deferred companion-acts, a follow-up.
- Multiple NPCs speaking in one turn.
- LLM auto-placing NPCs in grown rooms.
- A settings-panel NPC editor (slash commands suffice for now).
- ST group-chat integration (explicitly rejected in favour of custom routing).

## Success criteria

1. `/if-npc add`/`bind`/`list`/`remove` manage a per-chat NPC registry.
2. Entering an NPC's room makes the narrator include that NPC in the scene (Tier 1).
3. Addressing a card-bound NPC produces a reply in that card's voice, posted under its own
   name/avatar, while the narrator avoids double-voicing it (Tier 2).
4. NPCs work in authored and grown worlds, with the companion feature on or off.
5. With no NPCs, behaviour is identical to today.
