// worldmap.js — pure helpers for the grown-room map: render a tree, plan a replay.
// A record is { from, dir, name, description, objects }. The root room is "Origin".
import { buildMetaCommands } from './worldgen.js';

const REVERSE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };

export function reverseDir(dir) {
    return REVERSE[String(dir).toLowerCase()] ?? dir;
}

/** Dir sequence from Origin to `target` (empty for Origin, null if unreachable). */
export function pathToRoom(records, target) {
    if (target === 'Origin') return [];
    const byName = {};
    for (const r of records) byName[r.name] = r;     // last wins on duplicate names
    const path = [];
    const seen = new Set();
    let cur = target;
    while (cur !== 'Origin') {
        const r = byName[cur];
        if (!r || seen.has(cur)) return null;        // unknown room or a cycle
        seen.add(cur);
        path.push(r.dir);
        cur = r.from;
    }
    return path.reverse();
}

/** Multi-line indented tree of the grown world, rooted at Origin. */
export function formatMap(records) {
    const byParent = {};
    for (const r of records) (byParent[r.from] ??= []).push({ dir: r.dir, name: r.name });
    const lines = ['Origin'];
    const seen = new Set();
    const walk = (room, indent) => {
        if (seen.has(room)) return;                  // guard duplicate-name cycles
        seen.add(room);
        for (const c of byParent[room] ?? []) {
            lines.push('  '.repeat(indent) + `${c.dir} → ${c.name}`);
            walk(c.name, indent + 1);
        }
    };
    walk('Origin', 0);
    return lines.join('\n');
}

/**
 * Ordered VM commands that rebuild the world from a fresh seed: for each record,
 * navigate the cursor to its `from` (up to Origin via reverse dirs, then down),
 * then materialise it. Records are in creation order, so every `from` already exists.
 */
export function planReplay(records) {
    const cmds = [];
    let cursor = 'Origin';
    for (const rec of records) {
        const up = (pathToRoom(records, cursor) ?? []).slice().reverse().map(reverseDir);
        const down = pathToRoom(records, rec.from) ?? [];
        cmds.push(...up, ...down);                    // navigate cursor -> rec.from
        cmds.push(...buildMetaCommands(rec.dir, rec));
        cursor = rec.from;
    }
    return cmds;
}
