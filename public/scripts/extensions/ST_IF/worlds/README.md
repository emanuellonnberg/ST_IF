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

## Rebuilding

The compiler is not committed. Fetch it once into `../tools/`:

    cd ../tools
    curl -sL -o i.zip https://github.com/DavidKinder/Inform6/releases/download/v6.44/inform644_win32.zip && unzip -o i.zip && rm i.zip
    curl -sL -o l.zip https://codeload.github.com/DavidGriffith/inform6lib/zip/refs/heads/master && unzip -q -o l.zip && rm l.zip

Then: `pwsh -File build.ps1` (compiles every `*.inf` → `*.z5`).
