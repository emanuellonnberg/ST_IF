# ST_IF demo / test worlds

Small, public-domain (CC0) Inform 6 sandbox worlds used as bundled demos and as the
integration-test story. They are *not* games — just maps that exercise movement, a dark
room + portable light, a switchable lamp, and takeable objects.

- `apartment.inf` / `apartment.z5` — a flat: Hallway hub, Kitchen, Living Room, Bedroom,
  dark Storage Closet; flashlight, floor lamp, mug. The Kitchen has a working cooking
  sim: open the cupboard, take the pot + spaghetti, `fill pot`, `put spaghetti in pot`,
  `put pot on stove`, `turn on stove`, then wait 8 turns for cooked pasta. `salt` the pot
  for a seasoned result; leave it on the heat too long (~4 more turns) and it boils dry and
  burns. Demonstrates Inform 6 timers (`StartTimer`/`time_out`) + a per-turn daemon.
  The Bathroom (ensuite, east of the Bedroom) has a laundry sim: load the dirty laundry +
  `detergent` into the washing machine, `turn on washer` (the door locks mid-cycle), wait
  out the wash, then dry the wet clothes on the radiator and `wear` them. The Living Room
  has a working `tv` (`change channel` to cycle programmes) and a `stereo` (`play jazz` /
  `play rock` / `play classical`), each with ambient per-turn output while on. Extras: a
  Kitchen `fridge` with ingredients (stir the `butter` through cooked spaghetti for a
  richer eat), a Bedroom `wardrobe` with a coat and slippers to `wear`, and a Bathroom
  `shower` you must turn on before you can `bathe`. A small needs loop ties it together:
  `dig` the Living Room houseplant to get your hands filthy (`status` to check), which the
  shower washes off — and pulling clean laundry on with dirty hands re-soils it. The
  Kitchen `coffee machine` brews into the mug (`brew coffee`, then `drink coffee`) and the
  Bedroom `bed` lets you `sleep`; both leave you `rested`. **Mochi** the cat follows you
  around the flat (`pet` her, `give milk to cat`) but won't go outside. A lockable **front
  door** (take the key, `unlock door with key`, then `out`) leads to a Landing with a
  mailbox letter, a Street, and a Corner Shop. Deeper cooking: `fry` an egg in the pot on
  the stove, and `wash` the dirty pot/mug at the tap after eating.
- `garden.inf` / `garden.z5` — outdoors: Porch hub, Lawn, Greenhouse, Pond, dark Toolshed;
  lantern, fountain, trowel.
- `tavern.inf` / `tavern.z5` — "The Adventurer's Rest", a classic-RPG tavern hub: a Common
  Room with taproom/kitchen and a dark cellar (needs a lantern), plus a deterministic
  economy the narrator weaves around — `gold` as the meter, order `ale` from the barkeep
  (sober → tipsy → cut off at roaring drunk), ladle `stew` to get fed, rent a bed to `rest`,
  and `gamble` dice or cards. `status` reports gold/drink/hunger/rest/day. A worked example
  of a larger authored hub (originally developed in the standalone `adventurer_tavern` repo).
  Includes `effects.h`, so registry NPCs can affect its `gold` meter: enable **NPC effects**
  in settings, `/if-npc add barkeep @ commonroom : a gruff innkeeper`, bind a card, and
  `/if-quest add rats giver=barkeep goal="clear the cellar" reward=gold 10 needs=rats_done` —
  the barkeep then pays the bounded reward (the LLM proposes, the engine validates, the VM
  grants real gold).
- `garden-glulx.ulx` — the garden compiled as **Glulx** (`inform6 -G`): the demo for ST_IF's
  second engine. Glulx stories (`.ulx`) run on the vendored Quixe interpreter through the same
  Glk plumbing as the Z-machine — load it from the picker or upload any `.ulx` file. (Blorb-
  wrapped `.gblorb` files are not unpacked yet.)
- `thornfield.inf` / `thornfield.z5` — "Thornfield Manor", a one-night **murder mystery**: Lord
  Ashcroft lies dead in his locked study and you are the detective. ~12 rooms with a real puzzle
  chain held as ground truth — a **locked study door** (spare key in the kitchen dresser), a wall
  **safe** opened by `dial 1888` (the year is on the drawing-room portrait and the library ledger),
  a **hidden passage** to the attic (`pull red book`), a **dark wine cellar** (carry the lit
  candelabra), and **five clues** to gather (vial, note, will, letters, dagger). `accuse <name>`
  once you have the evidence closes the case (the killer is Miss Vale). Includes `effects.h` (a
  `suspicion` meter + clue flags) for card-voiced, **patrolling** suspects via its scenario manifest.

## NPC items & movement

`effects.h` also gives NPCs a **giveable-item pool**: when an exchange warrants it the
game-master check can fire `give`/`take-item`, and the engine mints a **real Z-machine
object** into your hands (`xgive <word>`) — examinable, carryable, droppable — or removes one
you hold (`xtakeitem <word>`). Item names are a single lowercase token (e.g. the barkeep
hands you a `key`). Requires NPC effects enabled; `give` needs `safe`, `take-item` needs `open`.

Registry NPCs can also **move**. `/if-npc move <name> <room>` relocates one (room `away` hides
them everywhere); `/if-npc follow <name>` makes an NPC travel to your room on every move
(`/if-npc follow <name> off` stops it). Followers are counted present — and voiced — wherever
you go. With NPC effects on, the game-master check can also drive this: an NPC you're talking to
may decide to **follow** or **leave** on its own (`npcMove`), so the narrator can have a companion
join or slip away in-fiction.

NPCs can **patrol** a route on their own: `/if-npc patrol <name> <room> <room> ...` sets a loop the
NPC walks one step at a time **whenever you change room** (lingering in one room freezes them, so
you can talk). It cycles back to the start; `/if-npc patrol <name>` with no rooms clears it. A
scenario manifest can ship a patrol per NPC — give the npc entry a `"patrol": ["roomA","roomB",...]`
and set its `room` to the first stop. Following overrides a patrol. Great for suspects drifting
around a manor.

**Quickest add:** stand in the room and `/if-npc here Tomas the Barkeep` — drops that card into
your current room, bound, with the address-name auto-derived from the card (its first word, e.g.
`tomas`). The full card name stays as the display/voice; you just address them as `tomas`.

**Greetings.** The first time you walk into a room holding a card-bound NPC you have not met,
that NPC introduces itself with a short line (a one-time greeting fired after the narrator's
turn) — unless you addressed someone the same turn, in which case that reply takes precedence.

**Physical interaction.** A present registry NPC is also given a real Z-machine **body** each turn
(`effects.h` NPC pool), so the parser can act on them: `examine maeve`, `give key to maeve`,
`show coin to tomas`. Items you give really transfer to the NPC (and stay with them even when they
leave the room). Dialogue still flows through the card (the body is just the handle); combat is not
modelled. The engine's `x*` verbs are all `meta`, so this per-turn materialisation never advances
the world clock (cooking timers etc. are safe).

## Scenario manifests (one-step setup)

A bundled world may ship a sidecar `<basename>.world.json` that auto-seeds its NPCs, quests,
character cards, and the NPC-effects setting when the world is loaded from the picker — so you
don't have to run `/if-npc` and `/if-quest` by hand. Seeding only runs on a **fresh chat**
(empty NPC + quest registries) and never clobbers a customised one; `/if-scenario reload`
forces a reset, `/if-scenario list` shows what's loaded. Shipped cards live in `cards/`; a
referenced card that isn't present (and isn't shipped) leaves the NPC narrator-voiced with a
`/if-npc bind` hint. An optional `narrator` card is imported and suggested as the active
character for clean, faithful narration (the bundled `cards/narrator.png`, "The Storyteller").
Example (`tavern.world.json`):

    {
      "narrator": { "name": "The Storyteller", "file": "cards/narrator.png" },
      "cards":  [{ "name": "Tomas the Barkeep", "file": "cards/tomas.png" }],
      "npcs":   [{ "name": "tomas", "room": "taproom", "blurb": "the gruff keeper", "card": "Tomas the Barkeep" }],
      "quests": [{ "id": "rats", "giver": "tomas", "goal": "clear the cellar rats",
                   "reward": { "effect": "grant", "amount": 10 }, "condition": "rats_done" }],
      "effectSafety": "safe"
    }

## Narration modes

ST_IF narrates through whatever character card is active plus an injected `[GAME]` canon block.
`/if-mode` switches the narrator's stance for the current chat (persisted in chat metadata):

- `narrate` (default) — faithful play: describe only what the engine reports; invent nothing.
- `build` — world-creation: at the edges of the known world the narrator may introduce new
  rooms/objects/exits that fit the setting (implies dynamic-world growth for this chat). The HUD
  shows a `🛠 build` badge while active. **Only effective in an expandable world** (the `*-expanse`
  demos); in a fixed world like the tavern the build directive is suppressed (it would invite the
  narrator to invent rooms the VM can't track), so it behaves like `narrate` and `/if-mode build`
  says as much.
- `gm` — lively play: besides faithful narration the narrator briefly voices the minor background
  characters present and drives pacing/hooks (registered card NPCs still speak for themselves).
  HUD badge `🎲 gm`. Works in any world.

On a freshly loaded game the narrator's first message is grounded in the real **opening scene**
(the VM's starting room), so it opens where the story actually starts instead of guessing.

`cards/narrator.png` ("The Storyteller") is a neutral, CC0 narrator card tuned for this contract
— load it for clean ground-truth narration, or use any character card for flavoured narration.

## Rebuilding

The compiler is not committed. Fetch it once into `../tools/`:

    cd ../tools
    curl -sL -o i.zip https://github.com/DavidKinder/Inform6/releases/download/v6.44/inform644_win32.zip && unzip -o i.zip && rm i.zip
    curl -sL -o l.zip https://codeload.github.com/DavidGriffith/inform6lib/zip/refs/heads/master && unzip -q -o l.zip && rm l.zip

Then: `pwsh -File build.ps1` (compiles every `*.inf` → `*.z5`).
