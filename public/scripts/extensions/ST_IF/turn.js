// turn.js — orchestrate one chat turn. Pure: all ST/VM deps injected.
import { readState, recordTurn, getActiveSnapshot } from './state.js';
import { translate as translateDefault } from './translator.js';
import { buildCanonBlock } from './canon.js';

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
        const block = buildCanonBlock({
            outputs: lastTurn.outputs ?? [],
            status,
            ranCommands: (lastTurn.cmds ?? []).length > 0,
            injectStateOnRp: settings.injectStateOnRp,
        });
        if (block) setPrompt(block);
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

    // 7. INJECT canon.
    const block = buildCanonBlock({
        outputs,
        status,
        ranCommands: cmds.length > 0,
        injectStateOnRp: settings.injectStateOnRp,
    });
    if (block) setPrompt(block);
}
