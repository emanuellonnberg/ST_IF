import {
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles,
    generateQuietPrompt, generateRaw, eventSource, event_types,
} from '../../../script.js';
import { getContext, renderExtensionTemplateAsync, saveMetadataDebounced } from '../../extensions.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../slash-commands/SlashCommandArgument.js';

import { IFVM } from './vm.js';
import { translate } from './translator.js';
import { decideMove } from './companion.js';
import { runTurn } from './turn.js';
import { readState, initState, getActiveSnapshot, rewindTo, KEY, setCompanion, getCompanionSnapshot } from './state.js';
import { loadSettings, getSettings, wireSettingsUI, base64ToBytes } from './settings.js';

const vm = new IFVM();
const companionVM = new IFVM();

function buildDeps() {
    const ctx = getContext();
    const s = getSettings();
    return {
        vm,
        metadata: ctx.chatMetadata,
        translate: (text, status, strictness) =>
            translate(text, status, strictness, (prompt) =>
                generateQuietPrompt({ quietPrompt: prompt, responseLength: 80, skipWIAN: true })),
        setPrompt: (block) =>
            setExtensionPrompt(KEY, block, extension_prompt_types.IN_CHAT, getSettings().depth, false, extension_prompt_roles.SYSTEM),
        clearPrompt: () =>
            setExtensionPrompt(KEY, '', extension_prompt_types.NONE, 0),
        save: () => saveMetadataDebounced(),
        settings: { strictness: s.strictness, injectStateOnRp: s.injectStateOnRp, companionTracking: s.companionTracking },
        companionVM,
        companionMove: (playerText, playerRoom, companionRoom) =>
            decideMove(playerText, playerRoom, companionRoom, getSettings().companionBias,
                (prompt) => generateQuietPrompt({ quietPrompt: prompt, responseLength: 40, skipWIAN: true })),
        onNarratePlayerRoom: async ({ playerRoom, outputs }) => {
            const result = (outputs || []).join('\n').trim() || '(you wait)';
            let prose;
            try {
                prose = await generateRaw({
                    prompt: `You are a neutral narrator. In 2-3 sentences, vividly narrate the following happening to {{user}}, who is alone at "${playerRoom}". Do not mention {{char}}. Event:\n${result}`,
                    systemPrompt: 'You narrate interactive fiction scenes concisely and in third person.',
                    responseLength: 160,
                });
            } catch (e) {
                console.error('[ST_IF] player-room narration failed', e);
                return;   // fail-open: skip the extra block
            }
            await postComment(`*(${playerRoom})* ${prose}`);
        },
        debugLog: s.showRawOutput
            ? ({ outputs, cmds }) => toastr.info(
                (outputs.join('\n') || '(no output)'),
                `IF: ${cmds.join(', ')}`,
                { timeOut: 9000, extendedTimeOut: 5000, escapeHtml: true })
            : undefined,
    };
}

/**
 * Post text as a comment message: displayed to the user but excluded from the LLM
 * prompt — so the companion narrator never sees the player's-room block.
 */
async function postComment(text) {
    const ctx = getContext();
    await ctx.executeSlashCommandsWithOptions(`/comment ${text.replace(/\n/g, ' ')}`);
}

/** Dev-mode: surface the opening scene as a toast when "Show raw game output" is on. */
function showIntroIfDebug() {
    if (getSettings()?.showRawOutput && vm.loaded) {
        const intro = vm.getIntro();
        if (intro) toastr.info(intro, 'IF: opening scene', { timeOut: 12000, extendedTimeOut: 6000, escapeHtml: true });
    }
}

// The generation interceptor — must be global, matched by manifest "generate_interceptor".
globalThis.ST_IF_interceptor = async function (chat, _contextSize, _abort, type) {
    const s = getSettings();
    if (!s || !s.enabled) return;
    try {
        await runTurn(buildDeps(), chat, type);
    } catch (e) {
        console.error('[ST_IF] interceptor error', e);
    }
};

/** Load the configured story into the VM and seed per-chat state if absent. */
async function ensureStoryLoaded() {
    const s = getSettings();
    if (!s || !s.storyBase64) return;
    if (!vm.loaded) await vm.load(base64ToBytes(s.storyBase64));
    const ctx = getContext();
    if (!readState(ctx.chatMetadata)) {
        initState(ctx.chatMetadata, s.storyName, vm.save());
        saveMetadataDebounced();
        showIntroIfDebug();
    } else {
        // Resume: restore this chat's canonical snapshot.
        const snap = getActiveSnapshot(ctx.chatMetadata);
        if (snap) vm.restore(snap);
    }

    // Companion VM mirrors the same story; seed/restore its own position.
    if (!companionVM.loaded) await companionVM.load(base64ToBytes(s.storyBase64));
    const st = readState(ctx.chatMetadata);
    if (st) {
        const csnap = getCompanionSnapshot(ctx.chatMetadata);
        if (csnap) companionVM.restore(csnap);
        if (!st.companion) {
            setCompanion(ctx.chatMetadata, { snapshot: companionVM.save(), summary: companionVM.getStatus() });
            saveMetadataDebounced();
        }
    }
}

/** /if-cmd advances the VM outside the turn pipeline; persist the new snapshot. */
function persistAfterRaw(ctx) {
    const s = readState(ctx.chatMetadata);
    if (s) {
        s.snapshot = vm.save();
        s.summary = vm.getStatus();
        saveMetadataDebounced();
    }
}

function registerSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-cmd',
        helpString: 'Send a raw parser command directly to the IF VM (bypasses the translator).',
        unnamedArgumentList: [new SlashCommandArgument('parser command', [ARGUMENT_TYPE.STRING], true, false, '')],
        returns: ARGUMENT_TYPE.STRING,
        callback: async (_args, value) => {
            if (!vm.loaded) return 'No story loaded.';
            const out = vm.step(String(value));
            persistAfterRaw(getContext());
            return out;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-state',
        helpString: 'Show the current IF game status line.',
        returns: ARGUMENT_TYPE.STRING,
        callback: async () => {
            if (!vm.loaded) return 'No story loaded.';
            const st = vm.getStatus();
            return `Location: ${st.location} | Score: ${st.score} | Moves: ${st.moves}`;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-rewind',
        helpString: 'Rewind the IF game to before the action at the given message index.',
        unnamedArgumentList: [new SlashCommandArgument('message index', [ARGUMENT_TYPE.NUMBER], true, false, '')],
        returns: ARGUMENT_TYPE.STRING,
        callback: async (_args, value) => {
            const ctx = getContext();
            const snap = rewindTo(ctx.chatMetadata, Number(value));
            if (!snap) return `No game turn recorded at message ${value}.`;
            vm.restore(snap);
            saveMetadataDebounced();
            return `Rewound to before message ${value}.`;
        },
    }));
}

jQuery(async () => {
    const html = await renderExtensionTemplateAsync('ST_IF', 'settings');
    $('#extensions_settings2').append(html);
    loadSettings();
    wireSettingsUI(async (name) => {
        // New story chosen: reset VM + state for the current chat.
        const ctx = getContext();
        const s = getSettings();
        await vm.load(base64ToBytes(s.storyBase64));
        initState(ctx.chatMetadata, name, vm.save());
        await companionVM.load(base64ToBytes(s.storyBase64));
        setCompanion(ctx.chatMetadata, { snapshot: companionVM.save(), summary: companionVM.getStatus() });
        saveMetadataDebounced();
        showIntroIfDebug();
    });
    registerSlashCommands();
    eventSource.on(event_types.CHAT_CHANGED, ensureStoryLoaded);
    await ensureStoryLoaded();
    console.log('[ST_IF] ready');
});
