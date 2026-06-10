// turn.js — orchestrate one chat turn. Pure: all ST/VM deps injected.
import { readState, recordTurn, getActiveSnapshot, setCompanion, setTogether, getFollowQueue, setFollowQueue, setRoomDescription } from './state.js';
import { translate as translateDefault } from './translator.js';
import { extractMoves, zone } from './companion.js';
import { buildCanonBlock, buildApartCanonBlock } from './canon.js';

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

    // 1. GUARDS — always clear stale injection so a skipped turn can't leak last turn's canon.
    clearPrompt();
    if (SKIP_TYPES.has(type)) return;
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
        if (deps.debugLog && reuseOutputs.length) deps.debugLog({ outputs: reuseOutputs, status, cmds: lastTurn.cmds ?? [] });
        return;
    }

    // 3. SNAPSHOT before stepping (swipe-safety / rewind anchor).
    const snapBefore = getActiveSnapshot(metadata) ?? vm.save();

    // 4. TRANSLATE.
    const statusForPrompt = vm.getStatus();
    const cmds = await translate(player.text, statusForPrompt, settings.strictness);

    // 5. STEP VM.
    const outputs = [];
    for (const cmd of cmds) outputs.push(vm.step(cmd));
    const status = vm.getStatus();

    // Capture the current room description for the persistent display:
    // update on a room change (the move output IS the new room) or an explicit look.
    const movedRoom = status.location !== statusForPrompt.location;
    const lookish = cmds.some((c) => /^(look|l|examine room)$/i.test(String(c).trim()));
    if ((movedRoom || lookish) && outputs.length) {
        setRoomDescription(metadata, outputs[outputs.length - 1]);
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
            const block = buildApartCanonBlock({
                companionRoom: companionStatus.location,
                companionScene,
                playerLocation: playerRoom,
                playerDir,
                companionDir,
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
