// turn.js — orchestrate one chat turn. Pure: all ST/VM deps injected.
import { readState, recordTurn, getActiveSnapshot, setCompanion, getCompanionSnapshot, setTogether, readTogether, getFollowQueue, setFollowQueue, setRoomDescription, recordMapEdge, setInventoryText, getEdgesForRoom } from './state.js';
import { dirToRoom } from './exits.js';
import { translate as translateDefault } from './translator.js';
import { extractMoves, zone, detectShout } from './companion.js';
import { buildCanonBlock, buildApartCanonBlock } from './canon.js';
import { compactInventory } from './clean.js';

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

    // 5. STEP VM — recording learned map edges per step (move that changed rooms).
    const outputs = [];
    let prevLoc = statusForPrompt.location;
    for (const cmd of cmds) {
        outputs.push(vm.step(cmd));
        const nowLoc = vm.getStatus().location;
        const dir = extractMoves([cmd])[0];
        if (dir && nowLoc !== prevLoc) recordMapEdge(metadata, prevLoc, dir, nowLoc);
        prevLoc = nowLoc;
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
        const playerMoves = extractMoves(cmds);
        const playerDir = playerMoves.length ? playerMoves[playerMoves.length - 1] : null;

        let companionDir = null;
        const companionOutputs = [];
        let queue = getFollowQueue(metadata).slice();

        if (settings.companionAgency) {
            // The companion decides for itself: follow / stay / own-way.
            const decision = await deps.companionDecide(player.text, playerRoom, companionVM.getStatus().location, playerMoves);
            if (decision.action === 'follow') {
                for (const d of playerMoves) companionOutputs.push(companionVM.step(d));
                if (playerMoves.length) companionDir = playerMoves[playerMoves.length - 1];
            } else if (decision.action === 'move' && decision.direction) {
                companionDir = decision.direction;
                companionOutputs.push(companionVM.step(decision.direction));
            } // 'stay' → no step
            queue = [];   // agency mode does not use the trail queue
        } else {
            // Deterministic zones.
            const z = zone(settings.companionBias);
            if (z === 'glued') {
                for (const d of playerMoves) companionOutputs.push(companionVM.step(d));
                if (playerMoves.length) companionDir = playerMoves[playerMoves.length - 1];
                queue = [];
            } else if (z === 'trail') {
                queue.push(...playerMoves);
                if (queue.length) {
                    companionDir = queue.shift();
                    companionOutputs.push(companionVM.step(companionDir));
                }
            } else { // wander
                const d = await deps.companionMove(player.text, playerRoom, companionVM.getStatus().location);
                if (d) {
                    companionDir = d;
                    companionOutputs.push(companionVM.step(d));
                }
                queue = [];
            }
        }

        const companionScene = companionOutputs.length
            ? companionOutputs[companionOutputs.length - 1]
            : companionVM.step('look');
        const companionStatus = companionVM.getStatus();
        const together = playerRoom === companionStatus.location;

        if (together) {
            // While together, the companion shares the player's world (inherits puzzle
            // progress — unlocked doors, taken items); sync its VM to the player's snapshot.
            companionVM.restore(snapshot);
            setCompanion(metadata, { snapshot, summary: companionVM.getStatus() });
        } else {
            setCompanion(metadata, { snapshot: companionVM.save(), summary: companionStatus });
        }
        setFollowQueue(metadata, queue);
        setTogether(metadata, together);
        save();

        if (together) {
            const block = buildCanonBlock({ outputs, status, ranCommands: cmds.length > 0, injectStateOnRp: settings.injectStateOnRp, companionPresent: true });
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
