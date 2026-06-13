# ST_IF Demo / Test Worlds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two small CC0 Inform-6 sandbox worlds (apartment + garden) that exercise every ST_IF feature, committed as source + compiled `.z5`, used as the integration-test story (dropping the copyrighted zork1 dependency) and loadable via a settings picker.

**Architecture:** A gitignored `tools/` holds the prebuilt `inform6.exe` + I6 library; `worlds/build.ps1` compiles `*.inf` → `*.z5`. The worlds use forced-VERBOSE prose with clearly-named exits, a dark room + portable light, a switchable lamp, and takeables. The integration tests and a settings picker consume the committed `.z5`s.

**Tech Stack:** Inform 6 (v6.44 prebuilt), vanilla ES modules, `node --test`, ESLint, PowerShell build script.

> **Toolchain is pre-validated:** the prebuilt `inform6.exe` (v6.44 Win32) + `inform6lib` compile in this environment, and the compiled `.z5` loads in our `vm.js` (proven during planning). Both `apartment.inf` and `garden.inf` below already compile clean and run.

---

## File structure

| Path | Responsibility |
|------|----------------|
| `public/scripts/extensions/ST_IF/tools/` | gitignored: `inform6.exe`, `inform6lib-master/` (build-time only) |
| `public/scripts/extensions/ST_IF/tools/.gitignore` | `*` + `!.gitignore` — never commit the binary/library |
| `public/scripts/extensions/ST_IF/worlds/apartment.inf` `garden.inf` | world source (CC0 header) |
| `public/scripts/extensions/ST_IF/worlds/apartment.z5` `garden.z5` | committed compiled stories |
| `public/scripts/extensions/ST_IF/worlds/worlds.json` | picker manifest |
| `public/scripts/extensions/ST_IF/worlds/build.ps1` | recompile `*.inf` → `*.z5` |
| `public/scripts/extensions/ST_IF/worlds/README.md` | what they are + how to rebuild |
| `turn.js` | broaden the darkness regex |
| `test/vm.integration.test.js` | zork1 cases → apartment.z5 |
| `settings.html` / `index.js` | bundled-world picker |

---

## Task 1: Toolchain + worlds scaffolding

**Files:**
- Create: `public/scripts/extensions/ST_IF/tools/.gitignore`
- Create: `public/scripts/extensions/ST_IF/worlds/build.ps1`

- [ ] **Step 1: Fetch the compiler + library into `tools/`**

Run (from the repo root):
```bash
mkdir -p public/scripts/extensions/ST_IF/tools
cd public/scripts/extensions/ST_IF/tools
curl -sL -o inform6.zip "https://github.com/DavidKinder/Inform6/releases/download/v6.44/inform644_win32.zip" && unzip -o inform6.zip && rm inform6.zip
curl -sL -o lib.zip "https://codeload.github.com/DavidGriffith/inform6lib/zip/refs/heads/master" && unzip -q -o lib.zip && rm lib.zip
ls inform6.exe inform6lib-master/parser.h
```
Expected: `inform6.exe` and `inform6lib-master/parser.h` present.

- [ ] **Step 2: gitignore the toolchain**

`tools/.gitignore`:
```
# Build-time Inform 6 compiler + library — fetched by worlds/build.ps1, never committed.
*
!.gitignore
```

- [ ] **Step 3: Write `worlds/build.ps1`**

```powershell
# Recompile every world: worlds/*.inf -> worlds/*.z5
$ErrorActionPreference = 'Stop'
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$inform = Join-Path $here '..\tools\inform6.exe'
$lib    = Join-Path $here '..\tools\inform6lib-master'
if (-not (Test-Path $inform)) { throw "inform6.exe not found in ../tools — see worlds/README.md" }
Get-ChildItem -Path $here -Filter *.inf | ForEach-Object {
    $out = Join-Path $here ($_.BaseName + '.z5')
    & $inform "+$lib" -v5 $_.FullName $out
    if ($LASTEXITCODE -ne 0) { throw "compile failed: $($_.Name)" }
    Write-Host "built $($_.BaseName).z5"
}
```

- [ ] **Step 4: Verify the toolchain compiles**

Run: `pwsh -File public/scripts/extensions/ST_IF/worlds/build.ps1`
Expected: no `.inf` files yet → it prints nothing and exits 0 (the next tasks add sources). If it errors on the missing compiler, re-run Step 1.

- [ ] **Step 5: Commit the scaffolding**

```bash
git add public/scripts/extensions/ST_IF/tools/.gitignore public/scripts/extensions/ST_IF/worlds/build.ps1
git commit -m "build(ST_IF): Inform 6 toolchain scaffolding for demo worlds"
```

---

## Task 2: Broaden the darkness guard regex

The standard Inform 6 library reports darkness as **"It is pitch dark, and you can't see a thing."** — our companion dark-guard only matches `pitch black`/`grue`. Broaden it so the guard fires in our own worlds (and real games that phrase darkness differently).

**Files:**
- Modify: `public/scripts/extensions/ST_IF/turn.js`
- Modify: `public/scripts/extensions/ST_IF/test/turn.test.js`

- [ ] **Step 1: Write the failing test (append to `test/turn.test.js`)**

```javascript
function makeI6DarkVM(startRoom) {
    return {
        loaded: true, room: startRoom, steps: [], restores: [],
        step(cmd) {
            this.steps.push(cmd);
            if (cmd === 'west') { this.room = 'Darkness'; return 'Darkness\nIt is pitch dark, and you can\'t see a thing.'; }
            if (cmd === 'look') return `You are at ${this.room}.`;
            return `You ${cmd}.`;
        },
        save() { return this.room; },
        restore(r) { this.restores.push(r); this.room = r; },
        getStatus() { return { location: this.room, score: 0, moves: 0 }; },
    };
}

test('dark-guard fires on the standard Inform-6 "pitch dark" wording', async () => {
    const deps = makeDeps({ translate: async () => ['west'], vm: makeMovingVM() });
    deps.companionVM = makeI6DarkVM('Start');
    deps.settings = { strictness: 'strict', injectStateOnRp: false, companionTracking: true, companionBias: 0.8 };
    const { setCompanion } = await import('../state.js');
    setCompanion(deps.metadata, { snapshot: 'Start', summary: { location: 'Start' } });
    await runTurn(deps, [{ is_user: true, mes: 'I go west' }], 'normal');
    assert.equal(deps.companionVM.room, 'Start', 'refused to follow into I6 darkness');
    assert.ok(deps.companionVM.restores.includes('Start'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: FAIL — companion entered "Darkness" (regex didn't match).

- [ ] **Step 3: Broaden the regex in `turn.js`**

Replace the `DARK_OR_DEATH` constant in the companion block:
```javascript
        const DARK_OR_DEATH = /pitch (black|dark)|too dark to see|can't see a thing|grue|you have died|\*\*\*\*/i;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/turn.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite + lint + commit**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js` → PASS.
Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"` → clean.
```bash
git add public/scripts/extensions/ST_IF/turn.js public/scripts/extensions/ST_IF/test/turn.test.js
git commit -m "fix(ST_IF): dark-guard matches standard Inform-6 'pitch dark' wording"
```

---

## Task 3: Apartment world

**Files:**
- Create: `public/scripts/extensions/ST_IF/worlds/apartment.inf`
- Create (compiled): `public/scripts/extensions/ST_IF/worlds/apartment.z5`
- Modify: `public/scripts/extensions/ST_IF/test/vm.integration.test.js` (add an apartment smoke test)

- [ ] **Step 1: Write `worlds/apartment.inf`** (this exact source compiles clean and runs)

```inform6
! apartment.inf — ST_IF sandbox test world. Dedicated to the public domain (CC0).
! A small flat to walk around in: a hub hallway, four rooms (one dark), a
! portable flashlight, a switchable floor lamp, and takeable objects.
Constant Story "APARTMENT";
Constant Headline "^A small ST_IF sandbox apartment.^";
Include "Parser";
Include "VerbLib";

[ Initialise;
   location = Hallway;
   move mug to Kitchen;
   move flashlight to Hallway;
   move lamp to LivingRoom;
   "^You are home. Wander around and try things.^";
];

Object Hallway "Hallway"
  with description "A narrow hallway. The living room is east, the kitchen north, the bedroom south, and a closet door is west.",
       n_to Kitchen, e_to LivingRoom, s_to Bedroom, w_to Closet,
  has light;

Object Kitchen "Kitchen"
  with description "A small kitchen with a worn table. The hallway is south.",
       s_to Hallway,
  has light;

Object LivingRoom "Living Room"
  with description "A cosy living room with a couch. The hallway is west.",
       w_to Hallway,
  has light;

Object Bedroom "Bedroom"
  with description "A quiet bedroom with a made bed. The hallway is north.",
       n_to Hallway,
  has light;

Object Closet "Storage Closet"
  with description "A cramped storage closet, shelves to the ceiling. The hallway is east.",
       e_to Hallway;

Object mug "ceramic mug"
  with name 'mug' 'cup' 'ceramic', description "A plain ceramic mug.",
  has ;

Object flashlight "flashlight"
  with name 'flashlight' 'torch' 'light',
       description "A small flashlight.",
       before [;
         SwitchOn: give self light; "You switch the flashlight on.";
         SwitchOff: give self ~light; "You switch the flashlight off.";
       ],
  has switchable;

Object lamp "floor lamp"
  with name 'lamp' 'floor', description "A tall floor lamp.",
       before [;
         SwitchOn: give self light; "The lamp glows warmly.";
         SwitchOff: give self ~light; "The lamp goes dark.";
       ],
  has switchable static;

Include "Grammar";
```

- [ ] **Step 2: Compile it**

Run: `pwsh -File public/scripts/extensions/ST_IF/worlds/build.ps1`
Expected: prints `built apartment.z5`; `worlds/apartment.z5` exists (~80 KB).

- [ ] **Step 3: Write a smoke test (append to `test/vm.integration.test.js`)**

```javascript
const apt = new Uint8Array(readFileSync(new URL('../worlds/apartment.z5', import.meta.url)));

test('apartment world: starts in the hallway and moves to named rooms', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    assert.equal(vm.getStatus().location, 'Hallway');
    assert.match(vm.step('east'), /Living Room/);
    assert.match(vm.step('west'), /Hallway/);
    assert.match(vm.step('west'), /pitch dark/i, 'closet is dark without a light');
});

test('apartment world: inventory query reflects a taken object', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('take flashlight');
    assert.match(vm.query('inventory'), /flashlight/i);
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test public/scripts/extensions/ST_IF/test/vm.integration.test.js`
Expected: PASS (the apartment loads, moves, darkens, inventories).

- [ ] **Step 5: Commit (source + compiled story)**

```bash
git add public/scripts/extensions/ST_IF/worlds/apartment.inf public/scripts/extensions/ST_IF/worlds/apartment.z5 public/scripts/extensions/ST_IF/test/vm.integration.test.js
git commit -m "feat(ST_IF): apartment sandbox world (CC0) + smoke test"
```

---

## Task 4: Garden world

**Files:**
- Create: `public/scripts/extensions/ST_IF/worlds/garden.inf`
- Create (compiled): `public/scripts/extensions/ST_IF/worlds/garden.z5`

- [ ] **Step 1: Write `worlds/garden.inf`** (compiles clean and runs)

```inform6
! garden.inf — ST_IF sandbox test world. Dedicated to the public domain (CC0).
! An outdoor counterpart to the apartment: a porch hub, four areas (one dark
! toolshed), a portable lantern, a switchable fountain, and takeables.
Constant Story "GARDEN";
Constant Headline "^A small ST_IF sandbox garden.^";
Include "Parser";
Include "VerbLib";

[ Initialise;
   location = Porch;
   move trowel to Greenhouse;
   move lantern to Porch;
   move fountain to Pond;
   "^A bright afternoon in the garden.^";
];

Object Porch "Porch"
  with description "A wooden porch. The lawn lies north, the greenhouse east, and a toolshed stands west.",
       n_to Lawn, e_to Greenhouse, w_to Toolshed,
  has light;

Object Lawn "Lawn"
  with description "A wide lawn. A path leads south to the porch and east to a pond.",
       s_to Porch, e_to Pond,
  has light;

Object Pond "Pond"
  with description "A still pond ringed with reeds. The lawn is west.",
       w_to Lawn,
  has light;

Object Greenhouse "Greenhouse"
  with description "A glass greenhouse, warm and humid. The porch is west.",
       w_to Porch,
  has light;

Object Toolshed "Toolshed"
  with description "A dim toolshed cluttered with tools. The porch is east.",
       e_to Porch;

Object trowel "garden trowel"
  with name 'trowel' 'garden', description "A rusty trowel.",
  has ;

Object lantern "lantern"
  with name 'lantern' 'lamp' 'light',
       description "An oil lantern.",
       before [;
         SwitchOn: give self light; "The lantern flares to life.";
         SwitchOff: give self ~light; "You shutter the lantern.";
       ],
  has switchable;

Object fountain "garden fountain"
  with name 'fountain' 'switch' 'valve', description "A small fountain with a brass valve.",
       before [;
         SwitchOn: "The fountain bubbles to life.";
         SwitchOff: "The fountain stills.";
       ],
  has switchable static;

Include "Grammar";
```

- [ ] **Step 2: Compile + smoke-check**

Run: `pwsh -File public/scripts/extensions/ST_IF/worlds/build.ps1`
Expected: prints `built apartment.z5` and `built garden.z5`.
Run: `node -e 'import("./public/scripts/extensions/ST_IF/vm.js").then(async ({IFVM})=>{const fs=await import("fs");const vm=new IFVM();await vm.load(new Uint8Array(fs.readFileSync("public/scripts/extensions/ST_IF/worlds/garden.z5")));console.log(vm.getStatus().location, /Greenhouse/.test(vm.step("east")));})'`
Expected: `Porch true`.

- [ ] **Step 3: Commit**

```bash
git add public/scripts/extensions/ST_IF/worlds/garden.inf public/scripts/extensions/ST_IF/worlds/garden.z5
git commit -m "feat(ST_IF): garden sandbox world (CC0)"
```

---

## Task 5: Integration tests use the apartment (drop zork1 hard dependency)

**Files:**
- Modify: `public/scripts/extensions/ST_IF/test/vm.integration.test.js`

The verbose-on-return and query/restore behaviours were proven against zork1 but should not *require* a copyrighted file. Re-point them at the committed apartment world; keep the zork1 skip-guard for optional extra coverage.

- [ ] **Step 1: Add apartment versions of the verbose + ensureVerbose tests**

Append to `test/vm.integration.test.js`:
```javascript
test('apartment: forces verbose so a revisited room shows the full description', async () => {
    const vm = new IFVM();
    await vm.load(apt);
    vm.step('east');                 // Living Room
    const back = vm.step('west');    // re-enter Hallway (already visited)
    assert.match(back, /narrow hallway/i, 'full description on return');
    assert.ok(back.trim().length > 40, 'not a brief name-only line');
});

test('apartment: ensureVerbose repairs a brief-lineage snapshot', async () => {
    const a = new IFVM();
    await a.load(apt);
    a.step('brief');
    const briefSnap = a.save();
    const b = new IFVM();
    await b.load(apt);
    b.restore(briefSnap);
    b.ensureVerbose();
    b.step('east');
    const back = b.step('west');
    assert.match(back, /narrow hallway/i);
});
```

- [ ] **Step 2: Run to verify they pass**

Run: `node --test public/scripts/extensions/ST_IF/test/vm.integration.test.js`
Expected: PASS — the apartment versions run with no fixture skip (`worlds/apartment.z5` is committed).

- [ ] **Step 3: Full suite + commit**

Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js` → PASS.
```bash
git add public/scripts/extensions/ST_IF/test/vm.integration.test.js
git commit -m "test(ST_IF): integration coverage runs on the committed apartment world"
```

---

## Task 6: Bundled-world picker

**Files:**
- Create: `public/scripts/extensions/ST_IF/worlds/worlds.json`
- Create: `public/scripts/extensions/ST_IF/worlds/README.md`
- Modify: `public/scripts/extensions/ST_IF/settings.html`
- Modify: `public/scripts/extensions/ST_IF/index.js`

- [ ] **Step 1: Manifest `worlds/worlds.json`**

```json
[
    { "name": "Apartment (sandbox)", "file": "apartment.z5" },
    { "name": "Garden (sandbox)", "file": "garden.z5" }
]
```

- [ ] **Step 2: `worlds/README.md`**

```markdown
# ST_IF demo / test worlds

Small, public-domain (CC0) Inform 6 sandbox worlds used as bundled demos and as the
integration-test story. They are *not* games — just maps that exercise movement, a dark
room + portable light, a switchable lamp, and takeable objects.

- `apartment.inf` / `apartment.z5` — a flat: Hallway hub, Kitchen, Living Room, Bedroom,
  dark Storage Closet; flashlight, floor lamp, mug.
- `garden.inf` / `garden.z5` — outdoors: Porch hub, Lawn, Greenhouse, Pond, dark Toolshed;
  lantern, fountain, trowel.

## Rebuilding

The compiler is not committed. Fetch it once into `../tools/`:

    cd ../tools
    curl -sL -o i.zip https://github.com/DavidKinder/Inform6/releases/download/v6.44/inform644_win32.zip && unzip -o i.zip && rm i.zip
    curl -sL -o l.zip https://codeload.github.com/DavidGriffith/inform6lib/zip/refs/heads/master && unzip -q -o l.zip && rm l.zip

Then: `pwsh -File build.ps1` (compiles every `*.inf` → `*.z5`).
```

- [ ] **Step 3: Picker UI in `settings.html`** — after the "Load story file" block:

```html
            <label for="st_if_world_select">Bundled demo world</label>
            <div class="flex-container">
                <select id="st_if_world_select" class="text_pole"></select>
                <div id="st_if_world_load" class="menu_button">Load</div>
            </div>
```

- [ ] **Step 4: Wire the picker in `index.js`**

Add a shared loader (next to the `wireSettingsUI` callback) so the picker and the file-upload share one path. First, factor the existing new-story logic into a function; add near the other helpers:
```javascript
/** Apply freshly-loaded story bytes: store, (re)seed state, render. Shared by upload + picker. */
async function applyStoryBytes(name, bytes) {
    const ctx = getContext();
    const s = getSettings();
    s.storyName = name;
    s.storyBase64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
    saveSettingsDebounced();
    await vm.load(bytes);
    initState(ctx.chatMetadata, name, vm.save());
    readState(ctx.chatMetadata).summary = vm.getStatus();
    setRoomDescription(ctx.chatMetadata, vm.getIntro());
    await companionVM.load(bytes);
    setCompanion(ctx.chatMetadata, { snapshot: companionVM.save(), summary: companionVM.getStatus() });
    saveMetadataDebounced();
    showIntroIfDebug();
    renderRoomPanel();
    renderHud();
    ensureExitsExtracted();
    $('#st_if_story_name').text(name);
}
```

Then populate the select and wire Load inside the `jQuery(async () => { ... })` init, after `wireSettingsUI(...)`:
```javascript
    try {
        const worlds = await (await fetch('/scripts/extensions/ST_IF/worlds/worlds.json')).json();
        const sel = $('#st_if_world_select');
        for (const w of worlds) sel.append($('<option>').val(w.file).text(w.name));
        $('#st_if_world_load').on('click', async () => {
            const file = String(sel.val());
            if (!file) return;
            try {
                const bytes = new Uint8Array(await (await fetch(`/scripts/extensions/ST_IF/worlds/${file}`)).arrayBuffer());
                await applyStoryBytes(sel.find('option:selected').text(), bytes);
                toastr.success(`Loaded ${sel.find('option:selected').text()}`, 'ST_IF');
            } catch (e) {
                console.error('[ST_IF] world load failed', e);
                toastr.error(String(e?.message || e), 'ST_IF: world load failed');
            }
        });
    } catch (e) {
        console.warn('[ST_IF] no bundled worlds manifest', e);
    }
```

(If the existing `wireSettingsUI` story-upload callback duplicates the seeding logic, replace its body with `await applyStoryBytes(name, bytes);` for DRY — both now share `applyStoryBytes`.)

- [ ] **Step 5: Lint + full suite**

Run: `node node_modules/eslint/bin/eslint.js "public/scripts/extensions/ST_IF/**/*.js"` → clean.
Run: `node --test public/scripts/extensions/ST_IF/test/*.test.js` → PASS.

- [ ] **Step 6: Manual verification (ST runtime)**

Run: hard-refresh ST, open the ST_IF drawer.
Verify:
1. "Bundled demo world" select lists Apartment + Garden; click **Load** on Apartment → green toast, the room panel/HUD show "Hallway".
2. Play: walk to the Living Room and `turn on lamp`; take the flashlight, switch it on, enter the closet (lit). Without the flashlight, the closet is dark.
3. With companion tracking on, split off and try to enter the dark closet → she refuses (dark-guard).
Expected: all behave; no console errors.

- [ ] **Step 7: Commit**

```bash
git add public/scripts/extensions/ST_IF/worlds/worlds.json public/scripts/extensions/ST_IF/worlds/README.md public/scripts/extensions/ST_IF/settings.html public/scripts/extensions/ST_IF/index.js
git commit -m "feat(ST_IF): bundled-world picker + worlds manifest/README"
```

---

## Verification summary

- **Unit (node --test):** darkness-guard matches the Inform-6 wording; apartment + garden load/move/darken/inventory through the real VM; integration coverage (verbose, ensureVerbose) runs on the committed apartment with no fixture skip.
- **Manual (ST runtime):** the picker loads bundled worlds; in-world play exercises lamp/flashlight/dark-room/companion-refusal.

## Open items

- More worlds later: drop a `.inf`, run `build.ps1`, add a `worlds.json` entry.
- The compiler/library stay gitignored; `worlds/README.md` documents the one-time fetch.
