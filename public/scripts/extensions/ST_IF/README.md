# ST_IF — Interactive Fiction engine for SillyTavern

Bolts a real Z-machine interactive-fiction game onto normal SillyTavern chat.
Each turn, your natural-language prose is evaluated; if it maps to a meaningful
in-game action, that action runs against an embedded Z-machine VM (the canonical
game engine). The VM's output plus a status-line block is injected into the chat
prompt as ground truth, and the normal narrator LLM writes rich prose around it.

The game layer is **additive, not a gate**: pure-roleplay turns that don't map to
a game action flow through untouched, and chat reacts as it always does.

## How it works

```
Player prose ──▶ generate_interceptor
                   ├─ translate prose → 0+ parser commands (a side LLM call)
                   ├─ run commands in the Z-machine VM (canonical)
                   ├─ persist VM snapshot in chat metadata
                   └─ inject [VM output + status line] as SYSTEM canon
                 ──▶ narrator LLM dresses the canon in character
```

Three turn types fall out of one pipeline:

| Player prose | Commands | Result |
|---|---|---|
| "creep north, grab lantern" | `north`, `take lantern` | canon injected, narrator honors it |
| "I smile and ask for rumors" | (none) | normal chat, no game effect |
| "open the locked vault" | `open vault` → "It's locked." | canon = refusal; narrator must honor it |

## Install

This extension ships under `public/scripts/extensions/ST_IF/` and is auto-discovered
as a built-in extension — no separate install step. Open SillyTavern → Extensions
to find **Interactive Fiction (ST_IF)**.

## Using it

1. Obtain a Z-machine story file (`.z3` / `.z5` / `.z8`) — e.g. Inform-compiled
   games from the [IF Archive](https://www.ifarchive.org/). Colossal Cave
   Adventure (`Advent.z5`) is a good first game.
2. In the ST_IF settings panel, click **Load story file** and pick it.
3. Tick **Enable for this session**.
4. Start chatting. Describe what your character does; the game responds.

The story file is stored (base64) in your extension settings; game state is stored
per-chat in chat metadata, so each chat has its own playthrough and branching a
chat forks the game state with it.

## Settings

- **Enable for this session** — master on/off.
- **Inject game state on pure roleplay turns** — when on, the status line is added
  even on turns with no game action (keeps the narrator grounded); when off,
  pure-RP turns are completely untouched.
- **Translator strictness** — *Strict* fires only on clear physical actions (the
  game stays invisible until you act); *Loose* maps more verbs.
- **Canon injection depth** — how deep in the chat the canon block is injected.
- **Current room** — a persistent read-only box in the drawer showing your location,
  the room's prose (which names exits/items), and score/moves. It updates when you
  move or `look`, keeps the description through non-move actions (e.g. `take`), and
  survives reloads — unlike the transient debug toast.
- **Companion location tracking** — give `{{char}}` its own location (see below).

The narration is **character-forward**: the game text is treated as the *setting*, and
`{{char}}` reacts, speaks, and acts within it (rather than the narrator transcribing the
room and dropping the character). When you and the companion are together, `{{char}}` is
kept present in the scene.
- **Companion stays near player** — how strongly the companion follows you vs wanders.
- **Show raw game output (debug)** — when on, the raw VM output of each action
  (and the opening scene on load) is surfaced as a toast. The default is
  narrator-only (raw IF text stays hidden, shaping the narrator's prose); this
  toggle is for development/inspection.

## Companion location tracking

Optionally, the chat character (`{{char}}`) gets its **own location** in the world,
separate from you. Enable **Companion location tracking** in the panel.

- The companion is a **position-only marker**: it moves around the same map but never
  takes or changes objects, so the two of you never desync the world.
- The **"Companion stays near player"** slider sets one of three deterministic zones,
  driven by your *actual* move directions (not a blind guess):
  - **Glued** (≥ 0.66): the companion mirrors every move you make and stays in your room.
  - **Trail** (0.34–0.65): it follows one room behind, consuming your moves one per turn —
    so you briefly separate, then it catches up.
  - **Wander** (≤ 0.33): it ignores you and roams on its own (a small LLM call picks a
    direction).
- When you separate, the canon names the departure direction — "{{user}} headed north as
  you parted", and the player-room note says "{{char}} has just left, heading <dir>".
- **Companion can choose (agency)** — optional toggle. Off = the deterministic zones
  above. On = the companion decides for itself each turn (follow you, hang back, or go
  its own way), and the slider becomes its *clinginess lean*: high = sticks with you but
  can break off when the scene calls for it, low = independent. Costs one extra LLM call
  per turn; same "can't reunite from afar" limitation.
- When you're in the **same room**, play is the normal shared scene.
- When you're **apart**, the narrator grounds in the companion's room and does **not**
  know what you're doing elsewhere (real separation/reunion drama). Your own room is
  narrated in a separate **comment message** — visible to you, but excluded from the
  companion's prompt so they stay unaware.

Cost note: an *apart* turn can make up to four LLM calls (translate, companion intent,
your-room narration, companion reply). It's opt-in and the companion starts beside you,
so cost only grows when you deliberately separate.

Limitations: the companion never manipulates world objects (position only); giving it
full independent play would desync the shared world (a Z-machine models one protagonist).
Glued/Trail *keep* you together or trail an existing path — they do **not reunite from
afar**: if you wander off and then crank the slider up while rooms apart, the companion
can't navigate back (there's no learned map yet). It re-converges once you're adjacent
again.

## Slash commands

- `/if-cmd <command>` — send a raw parser command straight to the VM (debug;
  bypasses the translator).
- `/if-state` — print the current status line (location / score / moves).
- `/if-rewind <messageIndex>` — rewind the game to before the action at that
  message.

## v1 limitations

- **VM is law:** if the parser refuses an action, that refusal is canon — there is
  no LLM "soft adjudication" of failed actions yet.
- **No structured exits/inventory:** a Z-machine exposes no machine-readable world
  model, so the injected state is the VM's text output + the status line
  (location / score / moves), not a synthetic exits/inventory list.
- **Swipe handling** reuses the turn's cached commands (no re-step); **rewind on
  delete** is manual via `/if-rewind`.

## Internals

- `vm.js` — wrapper over the vendored ifvms ZVM with an in-memory headless GlkOte;
  exposes `load / step / save / restore / getStatus`.
- `translator.js`, `canon.js`, `state.js`, `turn.js` — pure, runtime-independent
  modules (dependencies injected), unit-tested with `node --test`.
- `lib/` — vendored, ESM-wrapped `glkapi.js` (MIT) + ifvms ZVM + dispatch (BSD).

Design spec and implementation plan:
`docs/superpowers/specs/2026-06-09-st-if-interactive-fiction-design.md` and
`docs/superpowers/plans/2026-06-09-st-if-interactive-fiction.md`.

Run the tests:

```
node --test public/scripts/extensions/ST_IF/test/*.test.js
```
