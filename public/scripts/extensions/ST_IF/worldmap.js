// worldmap.js — pure helpers for the grown-room graph: render a map, plan a replay,
// upconvert a v1 (tree) export. A graph is { rooms:[{name,x,y,z,description,objects}],
// edges:[{from,dir,to}] }. The root room is "Origin" at (0,0,0).
import { buildMetaCommands, addCell } from './worldgen.js';

const REVERSE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };

export function reverseDir(dir) {
    return REVERSE[String(dir).toLowerCase()] ?? dir;
}

/** Indented spine tree (DFS from Origin) plus a "loops:" section for non-spine edges. */
export function formatMap(graph) {
    const { rooms = [], edges = [] } = graph ?? {};
    void rooms;
    const adj = {};
    const push = (a, dir, b) => (adj[a] ??= []).push({ dir, to: b });
    for (const e of edges) { push(e.from, e.dir, e.to); push(e.to, reverseDir(e.dir), e.from); }

    const lines = ['Origin'];
    const visited = new Set(['Origin']);
    const spine = new Set();                       // unordered "a|b" pairs that form the tree
    const dfs = (room, depth) => {
        for (const { dir, to } of adj[room] ?? []) {
            if (visited.has(to)) continue;
            visited.add(to);
            spine.add([room, to].sort().join('|'));
            lines.push('  '.repeat(depth) + `${dir} → ${to}`);
            dfs(to, depth + 1);
        }
    };
    dfs('Origin', 0);

    const loops = [];
    const seen = new Set();
    for (const e of edges) {
        const key = [e.from, e.to].sort().join('|');
        if (spine.has(key) || seen.has(key)) continue;
        seen.add(key);
        loops.push(`  ${e.from} ${e.dir} → ${e.to}`);
    }
    if (loops.length) lines.push('loops:', ...loops);
    return lines.join('\n');
}

/** Navigation-free replay: create every room, then link every edge. */
export function planReplay(graph) {
    const { rooms = [], edges = [] } = graph ?? {};
    const cmds = [];
    for (const r of rooms) {
        cmds.push(`xnew ${r.name}`);
        cmds.push(...buildMetaCommands(null, r).slice(1));   // reuse xdesc/xobj/xodesc lines (drop the xroom line)
    }
    for (const e of edges) cmds.push(`xlinkn ${e.from} ${e.dir} ${e.to}`);
    return cmds;
}

/** Upconvert a v1 (tree) export — [{from,dir,name,description,objects}] — into a graph. */
export function upconvertV1(records) {
    const rooms = [];
    const edges = [];
    const cellByName = { Origin: { x: 0, y: 0, z: 0 } };
    for (const rec of records ?? []) {
        const cell = addCell(cellByName[rec.from] ?? { x: 0, y: 0, z: 0 }, rec.dir);
        cellByName[rec.name] = cell;
        rooms.push({ name: rec.name, x: cell.x, y: cell.y, z: cell.z, description: rec.description, objects: rec.objects ?? [] });
        edges.push({ from: rec.from, dir: rec.dir, to: rec.name });
    }
    return { rooms, edges };
}
