# ST_IF — Demo / Test Worlds

**Date:** 2026-06-12
**Status:** Design approved, pending implementation plan
**Builds on:** the ST_IF extension
**Target repo:** `emanuellonnberg/ST_IF` (branch `st-if-companion`)

## Summary

Author two small, freely-licensed Z-machine "sandbox" worlds — not puzzle games, just
maps you walk around in that exercise every ST_IF feature (movement, light/dark,
takeable objects, a switch that changes room state). They double as: (1) the committed
integration-test story (replacing the copyrighted `zork1` dependency, so those tests run
on a clean clone) and (2) bundled demo worlds loadable from the settings panel.

## The worlds

Two themes, identical mechanic coverage, ~5 rooms each, authored in **Inform 6**, dedicated
to the **public domain (CC0)** via a header in each source file.

- **`apartment.z5`** — Hallway (hub) · Living Room · Kitchen · Bedroom · Storage Closet (dark).
- **`garden.z5`** — Porch (hub) · Lawn · Greenhouse · Toolshed (dark) · Pond.

Each world deliberately includes:

| Mechanic | ST_IF feature it exercises | Concrete element |
|----------|----------------------------|------------------|
| Multi-exit hub + 5 rooms | movement, follow/zones, exits-extraction, map edges, companion-apart | hub room with 3–4 exits |
| One **dark** room + a portable light source | dark-guard, light/dark, companion `light`/`take` | the dark room is pitch-black until the **flashlight/lantern** is brought in lit |
| A fixed **switch or lamp** | companion *acts* (use things), room state change | `turn on lamp` lights the hub/living room |
| Several **takeable** objects | inventory HUD, `take`, carrying between rooms | flashlight, book, key, mug (apartment) / lantern, trowel, seed packet, watering can (garden) |
| Exits named in plain prose | exits-extraction quality | "A door leads north to the kitchen." |

Room descriptions are written verbose-friendly so the LLM exits-extraction reads them
cleanly. The worlds run under our existing forced-VERBOSE mode.

## Build toolchain (build-time only — never shipped to users)

- The official **Inform 6 v6.44 Win32 build** (`inform644_win32.zip`, prebuilt `inform6.exe`)
  and the **Inform 6 library** are fetched into a **gitignored `tools/`** directory.
- A `worlds/build.ps1` compiles each `*.inf` → `*.z5` (`inform6 +<libdir> -v5 <src> <out>`).
- We commit the **`.inf` source and the compiled `.z5`**; users never compile. The compiler
  binary and library are not committed (gitignored).

## File layout

`public/scripts/extensions/ST_IF/worlds/`:
- `apartment.inf`, `garden.inf` — source (CC0 header)
- `apartment.z5`, `garden.z5` — committed compiled stories
- `worlds.json` — `[{ "name": "Apartment", "file": "apartment.z5" }, ...]` for the picker
- `README.md` — what they are + how to rebuild (toolchain + build.ps1)

The `test/fixtures/.gitignore` only covers `fixtures/`, so `worlds/*.z5` commit normally.

## Test integration

The three `zork1`-dependent integration tests in `vm.integration.test.js` are rewritten to
use `worlds/apartment.z5` (committed, deterministic — our world), so they run on a clean
clone with **no skip needed**. Assertions target known apartment facts: a named start room,
a known exit round-trip showing the full (verbose) description, `query('inventory')` after
taking a known object, and the dark-closet behaviour. The existing `zork1` skip-guard may
remain for extra optional coverage.

## Demo picker

`settings.html` gains a **"Bundled worlds"** `<select>` + a **Load** button. `index.js`:
- on init, fetches `worlds/worlds.json` and populates the select;
- on **Load**, fetches the chosen `.z5` from the extension path, converts to base64, and runs
  it through the **existing** story-load path (`storyBase64`/`storyName` in settings →
  `initState` → seed room description → render). Identical to a manual upload, just sourced
  from a bundled file.

Fails gracefully: missing/oversized fetch → a toast, no crash.

## Components

| Area | Change | Tested |
|------|--------|--------|
| `worlds/*.inf` + `*.z5` | the two authored worlds | integration (real `.z5`) |
| `worlds/build.ps1`, `worlds/README.md`, gitignored `tools/` | reproducible build | manual (recompile) |
| `vm.integration.test.js` | zork1 tests → apartment.z5 | unit/integration |
| `settings.html` / `index.js` | bundled-world picker + load | manual |

## Risks

- **Toolchain in this environment is unproven.** Fetching and running the prebuilt
  `inform6.exe` (and the library) here is the one unvalidated step. The plan's first task
  is a compiler spike (compile a trivial `.inf`); if the sandbox can't run it, pivot:
  author the `.inf` here and compile via the Borogove online I6 compiler (or the user's
  machine), committing the resulting `.z5`. The rest of the plan is unaffected.

## Out of scope

- More than two worlds (easy to add later via `worlds.json`).
- Puzzles/scoring/win conditions — these are sandboxes.
- A visual map. The HUD already shows location/exits.
