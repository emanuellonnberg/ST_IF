# ST_IF World Graph Connections — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** grown rooms form a graph (loops) via a JS coordinate grid (auto-connect on
cell collision) + LLM-named links; records/export/replay become graph-aware.

**Spec:** `docs/superpowers/specs/2026-06-14-st-if-world-graph-connections-design.md`
**Branch:** `st-if-world-graph` (on `release`, which has PR #5 + #6).

**Compile:** `cd public/scripts/extensions/ST_IF && ./tools/inform6.exe "+include_path=tools/inform6lib-master,worlds" -v5 worlds/expanse.inf worlds/expanse.z5` (run `node worlds/gen_expanse.mjs` first).
**Test:** `node --test public/scripts/extensions/ST_IF/test/*.test.js`  •  **Lint:** eslint over the dir.

**Key refinement:** room names are single-token (the shipped `xroom` copies only word 3, so
multi-word names already truncate — enforce single-token in `sanitizeRoom` so records and the
VM agree, fixing a latent replay mismatch and keeping `xlinkn` parsing positional).

**Root reference:** the root room is referenced as `Origin` in records/edges; `xlinkn`
special-cases the token `origin` → the host's root object (`XP_root`, set by the seed). Authored-world roots are out of scope (deferred).

---

### Task 1 — worldgen grid helpers + single-token names + prompt
Files: `worldgen.js`, `test/worldgen.test.js`.
- `sanitizeRoom`: room `name` → single lowercase token (`ascii(name).toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,nameMax)` ; fallback `room`). Objects unchanged (≤2 words).
- Add `cellDelta(dir)` → `{dx,dy,dz}`; `addCell(cell,dir)` → `{x,y,z}`.
- Add `validateConnections(conns, existingNames, takenDirs)` → array of `{dir,to}` where `to` is in `existingNames` (exact), `dir` is a compass word not in `takenDirs`, no dup dirs, `to !==` self.
- `generateRoom` prompt (in `index.js`, Task 7) will pass existing names; worldgen stays pure.
Tests: single-token name; cellDelta for 6 dirs; addCell; validateConnections drops misses/dupes/taken.

### Task 2 — expanse.h: `xnew` + `xlinkn`
Files: `worlds/gen_expanse.mjs` → regen `expanse.h`; compile.
- `Global XP_root = 0;` set by the seed (`expanse.inf` Initialise: `XP_root = Origin;`).
- `XP_WordIsOrigin(wx)` — char-compare typed word to `origin`.
- `XP_FindRoom(wx)` — return the room whose name matches the typed word: if `XP_WordIsOrigin` → `XP_root`; else first `BlankRoom` whose `used` and `XP_WordEq(wx, XP_RNm)` matches; else 0.
- `xnew <name>`: claim a free `BlankRoom`, copy word 2 → its name buffer, mark used, set `XP_lastroom`, **no link**. Prints `xnew ok` / `xnew no-free-room`.
- `xlinkn <fromword> <dir> <toword>`: `f = XP_FindRoom(2)`, `code = XP_DirCode(3)`, `t = XP_FindRoom(4)`; if any 0 → `xlinkn miss`; else `XP_LinkExits(f, t, code)`; `xlinkn ok`.
Smoke (node): `xnew a`, `xnew b`, `xlinkn a north b` → from a, north→b, south→a; `xlinkn a east origin` links to root.

### Task 3 — state.js graph records
Files: `state.js`.
- `initState`: `grownRooms: { rooms: [], edges: [] }`.
- `recordRoom(metadata, {name,x,y,z,description,objects})`; `recordEdge(metadata,{from,dir,to})` (dedup undirected); `getWorldGraph(metadata)` → `{rooms,edges}` (default empty); `roomAtCell(metadata,{x,y,z})` → room or null; `cellOfRoom(metadata,name)` → cell or null (Origin → {0,0,0}).
- Keep `getGrownRooms` returning `graph.rooms` for back-compat where used.

### Task 4 — worldmap.js graph rewrite
Files: `worldmap.js`, `test/worldmap.test.js`.
- `formatMap(graph)` → BFS spine from Origin + `↺ <dir> → <name>` lines for non-spine edges.
- `planReplay(graph)` → for each room (not Origin): `xnew name`,`xdesc`,`xobj…`; then for each edge: `xlinkn from dir to`.
- `upconvertV1(rooms)` → `{rooms,edges}`: assign coords by walking the tree from Origin via `cellDelta`; edges = the parent links.
Tests: formatMap with a loop; planReplay order for a looped graph; upconvert a v1 tree.

### Task 5 — turn.js grid + links
Files: `turn.js`.
- In the growth block: `fromCell = cellOfRoom(metadata, fromRoom) ?? {0,0,0}`; `target = addCell(fromCell, dir)`.
- `const occ = roomAtCell(metadata, target)`. If `occ`: `vm.applyWorldEdits(['xlinkn ' + slug(fromRoom) + ' ' + dir + ' ' + slug(occ)])`; `recordEdge`; step dir. (No generation.)
- Else: generate (existing path) with `deps.generateRoom(dir, status, player.text, existingNames)`; create via `xroom`; `recordRoom({...room, ...target})`; `recordEdge(from,dir,name)`; validate + apply `room.connections` via `xlinkn` + `recordEdge`; step dir.
- `slug(name)` = the single-token name (Origin → `origin`).

### Task 6 — index.js wiring
Files: `index.js`, `settings.html` (none).
- `generateRoom` dep: include existing room names in the prompt; ask for optional `connections: [{dir,to}]`.
- Export: build v2 `{format,version:2,story,rooms,edges}` from `getWorldGraph`.
- Import: accept v2 (replay graph); v1 → `upconvertV1` then replay. Re-seed graph records.
- `/if-map`: `formatMap(getWorldGraph(...))`.

### Task 7 — integration tests
Files: `test/vm.integration.test.js`.
- Square loop: `xroom`/`xnew` a 4-room ring, assert the closing `xlinkn` to Origin makes N-E-S-W return home.
- Cross-link: two rooms + `xlinkn` tunnel → both ways.
- Graph round-trip: build a looped graph, `planReplay` into a fresh expanse, assert all rooms + edges reachable.

### Task 8 — finish
Lint, full suite, commit per task, push, open PR (base `release`).
