// turn.js — orchestrate one chat turn. Pure: all ST/VM deps injected.
import { readState, recordTurn, getActiveSnapshot, setCompanion, getCompanionSnapshot, setTogether, readTogether, getFollowQueue, setFollowQueue, setRoomDescription, getRoomDescription, recordMapEdge, setInventoryText, getEdgesForRoom, getExitsForRoom, recordRoom, recordEdge, getGrownRooms, cellOfRoom, roomAtCell } from './state.js';
import { dirToRoom } from './exits.js';
import { translate as translateDefault } from './translator.js';
import { extractMoves, zone, detectShout, validateAction } from './companion.js';
import { buildCanonBlock, buildApartCanonBlock } from './canon.js';
import { compactInventory } from './clean.js';
import { parseRoomJson, sanitizeRoom, buildMetaCommands, blockedMove, directionSuggested, addCell, validateConnections } from './worldgen.js';
import { reverseDir } from './worldmap.js';

// xlinkn resolves the token "origin" to the root room; records keep "Origin".
const slug = (name) => (name === 'Origin' ? 'origin' : name);

const SKIP_TYPES = new Set(['quiet', 'impersonate']);

function lastUserMessage(chat) {
    const last = chat[chat.length - 1];
    if (!last || !last.is_user) return null;
    return { text: last.mes ?? '', index: chat.length - 1 };
}

/**
 * @param {object} deps  see deps contract in the plan
 * @param {Array} chat   live chat array
 * @param {string} type  generation type
 */
export async function runTurn(deps, chat, type) {
    const { vm, metadata, setPrompt, clearPrompt, save, settings } = deps;
    const translate = deps.translate ?? ((t, s, str) => translateDefault(t, s, str, deps.generate));

    // 1. GUARDS. Quiet/impersonate generations happen mid-turn (translator, companion
    // intent, player-room narration, exits extraction) and re-enter this interceptor:
    // they must NOT touch the canon the main generation is using — return untouched.
    if (SKIP_TYPES.has(type)) return;
    // Real turn: clear stale injection so a skipped turn can't leak last turn's canon.
    clearPrompt();
    if (!vm?.loaded) return;
    if (!readState(metadata)) return;
    const player = lastUserMessage(chat);
    if (!player) return;

    const state = readState(metadata);
    const lastTurn = state.history[state.history.length - 1];

    // 2. SWIPE / regen on the same message → reuse cached commands, do not re-step.
    if ((type === 'swipe' || type === 'regenerate') && lastTurn && lastTurn.msgIndex === player.index) {
        const status = vm.getStatus();
        const reuseOutputs = lastTurn.outputs ?? [];
        const block = buildCanonBlock({
            outputs: reuseOutputs,
            status,
            ranCommands: (lastTurn.cmds ?? []).length > 0,
            injectStateOnRp: settings.injectStateOnRp,
            companionActionCmd: lastTurn.companionCmd ?? null,
        });
        if (block) setPrompt(block);
        // Swipes rebuild fresh prompt copies: if the pair is apart, hide the
        // player's action from the companion prompt on this pass too.
        if (settings.companionTracking && !readTogether(metadata)) {
            const playerShouted = detectShout(player.text);
            chat[player.index] = {
                ...chat[player.index],
                mes: playerShouted
                    ? `*From somewhere beyond this room, you hear a voice shouting:* ${player.text}`
                    : '*They are somewhere else, out of your sight; you cannot tell what they are doing.*',
            };
        }
        if (deps.debugLog && reuseOutputs.length) deps.debugLog({ outputs: reuseOutputs, status, cmds: lastTurn.cmds ?? [] });
        return;
    }

    // 3. SNAPSHOT before stepping (swipe-safety / rewind anchor).
    const snapBefore = getActiveSnapshot(metadata) ?? vm.save();

    // 4. TRANSLATE.
    const statusForPrompt = vm.getStatus();
    const cmds = await translate(player.text, statusForPrompt, settings.strictness);

    // 5. STEP VM — collecting the commands that actually changed the player's room
    // (any form: 'north', 'enter window', 'climb tree'), and learning compass edges.
    const outputs = [];
    const playerMoveCmds = [];
    let prevLoc = statusForPrompt.location;
    for (const cmd of cmds) {
        outputs.push(vm.step(cmd));
        const nowLoc = vm.getStatus().location;
        if (nowLoc !== prevLoc) {
            playerMoveCmds.push(cmd);
            const dir = extractMoves([cmd])[0];
            if (dir) recordMapEdge(metadata, prevLoc, dir, nowLoc);
        }
        prevLoc = nowLoc;
    }

    // 5b. DYNAMIC WORLD GROWTH — if the last move hit a wall and the story is
    // expandable, ask the LLM to invent the room there, materialise it via the
    // pool meta-commands, then walk in (its description becomes this turn's canon).
    // Single-protagonist by design (the companion VM is not grown); see the spec.
    if (settings.dynamicWorld && deps.generateRoom && cmds.length && typeof vm.isExpandable === 'function') {
        const lastCmd = cmds[cmds.length - 1];
        const dir = blockedMove(lastCmd, outputs[outputs.length - 1] ?? '');
        const fromRoom = vm.getStatus().location;
        // In "guided" mode only grow a direction the room's prose hints at (reusing
        // the cached exit extraction); "anywhere" grows on any wall.
        const mayGrow = settings.growthMode !== 'guided'
            || directionSuggested(getExitsForRoom(metadata, fromRoom), dir);
        if (dir && mayGrow && vm.isExpandable()) {
            try {
                const target = addCell(cellOfRoom(metadata, fromRoom) ?? { x: 0, y: 0, z: 0 }, dir);
                const occupant = roomAtCell(metadata, target);
                if (occupant) {
                    // GRID AUTO-CONNECT: the neighbour cell already holds a room — link to it
                    // (a loop) instead of generating a new dead-end. No LLM call.
                    const out = vm.applyWorldEdits([`xlinkn ${slug(fromRoom)} ${dir} ${slug(occupant)}`]);
                    if (!/miss/i.test(out)) {
                        recordEdge(metadata, { from: fromRoom, dir, to: occupant });
                        outputs.push(vm.step(dir));
                        playerMoveCmds.push(lastCmd);
                        recordMapEdge(metadata, fromRoom, dir, vm.getStatus().location);
                    }
                } else {
                    // GENERATE a new room at the empty cell.
                    const existing = ['Origin', ...getGrownRooms(metadata).map((r) => r.name)];
                    const raw = await deps.generateRoom(dir, vm.getStatus(), player.text, existing);
                    const parsed = parseRoomJson(raw) ?? {};
                    const room = sanitizeRoom(parsed);
                    const editOut = vm.applyWorldEdits(buildMetaCommands(dir, room));
                    if (!/no-free-room|no-room/i.test(editOut)) {
                        recordRoom(metadata, { name: room.name, x: target.x, y: target.y, z: target.z, description: room.description, objects: room.objects });
                        recordEdge(metadata, { from: fromRoom, dir, to: room.name });
                        // LLM-NAMED LINKS: connect the new room to existing rooms it declared.
                        for (const c of validateConnections(parsed.connections, existing, [reverseDir(dir)])) {
                            const lo = vm.applyWorldEdits([`xlinkn ${room.name} ${c.dir} ${slug(c.to)}`]);
                            if (!/miss/i.test(lo)) recordEdge(metadata, { from: room.name, dir: c.dir, to: c.to });
                        }
                        outputs.push(vm.step(dir));            // re-issue: arrival is the new canon
                        playerMoveCmds.push(lastCmd);
                        recordMapEdge(metadata, fromRoom, dir, vm.getStatus().location);
                    }
                }
            } catch (e) {
                if (deps.debugLog) deps.debugLog({ note: 'worldgen failed', error: String(e) });
            }
        }
    }

    const status = vm.getStatus();

    // Capture the current room description for the persistent display:
    // update on a room change (the move output IS the new room) or an explicit look.
    const movedRoom = status.location !== statusForPrompt.location;
    const lookish = cmds.some((c) => /^(look|l|examine room)$/i.test(String(c).trim()));
    if ((movedRoom || lookish) && outputs.length) {
        setRoomDescription(metadata, outputs[outputs.length - 1]);
    }

    // Exact inventory for the HUD — vm.query is side-effect-free; fail open.
    if (cmds.length && typeof vm.query === 'function') {
        try {
            setInventoryText(metadata, compactInventory(vm.query('inventory')));
        } catch { /* HUD-only data — never block the turn */ }
    }

    // 6. PERSIST canonical snapshot + history (store outputs for swipe reuse).
    const snapshot = vm.save();
    recordTurn(metadata, {
        msgIndex: player.index,
        snapBefore,
        snapshot,
        summary: status,
        cmds,
    });
    // recordTurn keeps cmds; stash outputs on the same history entry for swipe reuse.
    const justAdded = readState(metadata).history.slice(-1)[0];
    justAdded.outputs = outputs;
    save();

    // 7. COMPANION (position-only second marker), if tracking is on.
    if (settings.companionTracking && deps.companionVM?.loaded) {
        const companionVM = deps.companionVM;
        // The live companion VM can silently diverge from persisted state (page
        // reloads, init-order races where the restore was skipped) — observed as
        // the companion teleporting back to the game's start room. The persisted
        // snapshot is the source of truth: re-sync the VM before acting on it.
        const storedCsnap = getCompanionSnapshot(metadata);
        if (storedCsnap) companionVM.restore(storedCsnap);
        const playerRoom = status.location;
        // Follow keys on the commands that actually changed the player's room —
        // 'enter window' counts just as much as 'north'. Compass tokens are still
        // extracted for direction cues where they exist.
        const lastDirOf = (list) => {
            for (let i = list.length - 1; i >= 0; i--) {
                const d = extractMoves([list[i]])[0];
                if (d) return d;
            }
            return null;
        };
        const playerDir = lastDirOf(playerMoveCmds);

        let companionDir = null;
        const companionOutputs = [];
        let refusedDark = false;
        let queue = getFollowQueue(metadata).slice();

        // A companion move whose outcome is darkness or death is rolled back: she
        // is position-only and could never recover (can't pick up a light, can't
        // resurrect) — so she refuses the step instead, in character.
        const DARK_OR_DEATH = /pitch (black|dark)|too dark to see|can't see a thing|grue|you have died|\*\*\*\*/i;
        const safeStep = (cmd) => {
            const snap = companionVM.save();
            const out = companionVM.step(cmd);
            if (DARK_OR_DEATH.test(out)) {
                companionVM.restore(snap);
                refusedDark = true;
                return null;
            }
            return out;
        };
        const followAll = (cmdList) => {
            const followed = [];
            for (const c of cmdList) {
                const out = safeStep(c);
                if (out === null) break;          // stop at the edge of the dark
                companionOutputs.push(out);
                followed.push(c);
            }
            return lastDirOf(followed);
        };

        if (settings.companionAgency) {
            // The companion decides for itself: follow / stay / own-way.
            const decision = await deps.companionDecide(player.text, playerRoom, companionVM.getStatus().location, playerMoveCmds);
            if (decision.action === 'follow') {
                companionDir = followAll(playerMoveCmds);
            } else if (decision.action === 'move' && decision.direction) {
                const out = safeStep(decision.direction);
                if (out !== null) {
                    companionDir = decision.direction;
                    companionOutputs.push(out);
                }
            } // 'stay' → no step
            queue = [];   // agency mode does not use the trail queue
        } else {
            // Deterministic zones.
            const z = zone(settings.companionBias);
            if (z === 'glued') {
                companionDir = followAll(playerMoveCmds);
                queue = [];
            } else if (z === 'trail') {
                queue.push(...playerMoveCmds);
                if (queue.length) {
                    const c = queue.shift();
                    const out = safeStep(c);
                    if (out === null) {
                        queue = [];               // the rest of the trail leads through the dark
                    } else {
                        companionOutputs.push(out);
                        companionDir = extractMoves([c])[0] ?? null;
                    }
                }
            } else { // wander
                const d = await deps.companionMove(player.text, playerRoom, companionVM.getStatus().location);
                if (d) {
                    const out = safeStep(d);
                    if (out !== null) {
                        companionDir = d;
                        companionOutputs.push(out);
                    }
                }
                queue = [];
            }
        }

        let companionScene = companionOutputs.length
            ? companionOutputs[companionOutputs.length - 1]
            : companionVM.step('look');
        if (refusedDark) {
            companionScene += '\nThe way onward is pitch dark; {{char}} refuses to go further without a light.';
        }
        const companionStatus = companionVM.getStatus();
        const together = playerRoom === companionStatus.location;

        // 7b. COMPANION ACTION — while together she may act on the CANONICAL world.
        let companionActionCmd = null;
        let canonSnap = snapshot;
        if (together && settings.companionActs && deps.companionUse) {
            const decision = await deps.companionUse(player.text, getRoomDescription(metadata) || outputs.join('\n'), cmds);
            const actCmd = validateAction(decision?.command, settings.companionActionSafety);
            if (actCmd) {
                const preSnap = vm.save();
                const out = vm.step(actCmd);
                if (/you have died|\*\*\*\*/i.test(out)) {
                    vm.restore(preSnap);                  // her action would kill the avatar — dropped
                } else {
                    companionActionCmd = actCmd;
                    outputs.push(out);
                    // The world changed after the canonical persist — re-persist.
                    const s2 = readState(metadata);
                    canonSnap = vm.save();
                    s2.snapshot = canonSnap;
                    s2.summary = vm.getStatus();
                    const last = s2.history[s2.history.length - 1];
                    if (last) { last.outputs = outputs; last.companionCmd = actCmd; }
                }
            }
        }

        if (together) {
            // While together, the companion shares the player's world (inherits puzzle
            // progress — unlocked doors, taken items); sync its VM to the player's snapshot.
            companionVM.restore(canonSnap);
            setCompanion(metadata, { snapshot: canonSnap, summary: companionVM.getStatus() });
        } else {
            setCompanion(metadata, { snapshot: companionVM.save(), summary: companionStatus });
        }
        setFollowQueue(metadata, queue);
        setTogether(metadata, together);
        save();

        if (together) {
            const statusForCanon = companionActionCmd ? vm.getStatus() : status;
            const block = buildCanonBlock({ outputs, status: statusForCanon, ranCommands: cmds.length > 0, injectStateOnRp: settings.injectStateOnRp, companionPresent: true, companionActionCmd });
            if (block) setPrompt(block);
        } else {
            const playerShouted = detectShout(player.text);
            // If the companion's room has a learned edge to the player's room,
            // the shout has a knowable direction.
            const shoutDir = dirToRoom(getEdgesForRoom(metadata, companionStatus.location), playerRoom);
            // Rewrite the user's last message IN THE PROMPT COPY (interceptors get
            // shallow copies of the chat; the saved chat is untouched). The model
            // mirrors whatever the final message says no matter what the canon
            // forbids — so the companion's prompt must contain only what actually
            // reaches her room: a heard shout, or nothing.
            chat[player.index] = {
                ...chat[player.index],
                mes: playerShouted
                    ? `*From ${shoutDir ? `the ${shoutDir}` : 'somewhere beyond this room'}, you hear a voice shouting:* ${player.text}`
                    : '*They are somewhere else, out of your sight; you cannot tell what they are doing.*',
            };
            const block = buildApartCanonBlock({
                companionRoom: companionStatus.location,
                companionScene,
                playerLocation: playerRoom,
                playerDir,
                companionDir,
                playerShouted,
                shoutDir,
            });
            setPrompt(block);
            if (deps.onNarratePlayerRoom) {
                await deps.onNarratePlayerRoom({ playerRoom, outputs, cmds, msgIndex: player.index, companionDir });
            }
        }
        if (deps.debugLog && cmds.length) deps.debugLog({ outputs, status, cmds });
        return;
    }

    // 7b. No companion tracking — original single-marker canon.
    const block = buildCanonBlock({
        outputs,
        status,
        ranCommands: cmds.length > 0,
        injectStateOnRp: settings.injectStateOnRp,
    });
    if (block) setPrompt(block);
    if (deps.debugLog && cmds.length) deps.debugLog({ outputs, status, cmds });
}
