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
