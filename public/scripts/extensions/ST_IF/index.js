import {
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles,
    generateQuietPrompt, eventSource, event_types, saveSettingsDebounced, getRequestHeaders,
} from '../../../script.js';
import { getContext, renderExtensionTemplateAsync, saveMetadataDebounced } from '../../extensions.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../slash-commands/SlashCommandArgument.js';

import { IFVM } from './vm.js';
import { translate, buildRepairPrompt, parseCommand } from './translator.js';
import { decideMove, decideAgency, decideUse } from './companion.js';
import { runTurn } from './turn.js';
import { readState, initState, getActiveSnapshot, rewindTo, KEY, setCompanion, getCompanionSnapshot, getRoomDescription, setRoomDescription, getInventoryText, setInventoryText, getExitsForRoom, setExitsForRoom, getEdgesForRoom, readTogether, getWorldGraph, recordRoom, recordEdge, setAnchor, getNpcs, setNpcs, getQuests, setQuests, getMode, setMode, MODES } from './state.js';
import { loadSettings, getSettings, wireSettingsUI, base64ToBytes, bytesToBase64 } from './settings.js';
import { stripReasoning, compactInventory } from './clean.js';
import { extractExits, mergeExits, formatExitsLine } from './exits.js';
import { formatMap, planReplay, upconvertV1 } from './worldmap.js';
import { addNpc, removeNpc, bindCard, moveNpc, setFollow, setPatrol, deriveNpcName, presentNpcs, normalizeRoom } from './npc.js';
import { parseEffectProposal, validateEffect, effectVerb } from './effects.js';
import { addQuest, removeQuest, listQuests, resolveCompletion } from './quest.js';
import { parseManifest, planSeed } from './scenario.js';
import { buildOpeningBlock } from './canon.js';

const vm = new IFVM();
const companionVM = new IFVM();

// SillyTavern's `responseLength` override mutates a shared global (`amount_gen`) via a
// non-reentrant `TempResponseLength`. Two overlapping quiet generations stomp each
// other's token cap — e.g. a 40-token companion gen truncating a 160-token NPC reply.
// Serialize every ST_IF quiet generation through one promise chain so none overlap.
let _genChain = Promise.resolve();
function qgen(opts) {
    const run = _genChain.then(() => generateQuietPrompt(opts), () => generateQuietPrompt(opts));
    _genChain = run.then(() => {}, () => {});   // keep the chain alive past a failed gen
    return run;
}

function buildDeps() {
    const ctx = getContext();
    const s = getSettings();
    return {
        vm,
        metadata: ctx.chatMetadata,
        translate: (text, status, strictness) =>
            translate(text, status, strictness, (prompt) =>
                qgen({ quietPrompt: prompt, responseLength: 200, skipWIAN: true })),
        // Repair a single parser-rejected command into an acceptable one (turn.js calls
        // this only when the VM reports a parse failure). Budget covers a reasoning
        // model's hidden thinking before the one-line answer.
        repairCommand: (text, status, failedCmd, failureText) =>
            qgen({ quietPrompt: buildRepairPrompt(text, status, failedCmd, failureText), responseLength: 120, skipWIAN: true })
                .then((raw) => parseCommand(raw)),
        setPrompt: (block) => {
            console.debug('[ST_IF] canon injected:\n' + block);
            setExtensionPrompt(KEY, block, extension_prompt_types.IN_CHAT, getSettings().depth, false, extension_prompt_roles.SYSTEM);
        },
        clearPrompt: () =>
            setExtensionPrompt(KEY, '', extension_prompt_types.NONE, 0),
        save: () => saveMetadataDebounced(),
        settings: { strictness: s.strictness, injectStateOnRp: s.injectStateOnRp, companionTracking: s.companionTracking, companionBias: s.companionBias, companionAgency: s.companionAgency, companionActs: s.companionActs, companionActionSafety: s.companionActionSafety, dynamicWorld: s.dynamicWorld, growthMode: s.growthMode, effectSafety: s.effectSafety, maxGrant: s.maxGrant },
        // Invent a room when the player walks into the void (dynamic-world mode).
        // Returns the raw model string; turn.js parses/sanitises it. skipWIAN keeps
        // World Info out but leaves the character card / scenario in context for theme.
        generateRoom: (dir, status, _playerText, existing = []) => {
            const known = existing.length ? ` Existing rooms you may connect to by exact name: ${existing.join(', ')}.` : '';
            return qgen({
                quietPrompt: `[The player is at "${status.location}" and moves ${dir} into a place that does not exist yet. Invent a room that fits the current story, setting, and tone. Give it a ONE-WORD name. In the description, name one or two onward exits as concrete ways to go (e.g. "a door leads north") so the world can keep growing.${known} You may optionally connect an exit to an existing room. Respond with ONLY JSON, no prose: {"name":"oneword","description":"2-3 vivid sentences mentioning the exits","objects":[{"name":"one or two word noun","description":"short","takeable":true}],"connections":[{"dir":"east","to":"existingroomname"}]}. Use 0-3 objects (simple lowercase nouns); connections may be empty.]`,
                responseLength: 220,
                skipWIAN: true,
            });
        },
        companionVM,
        companionUse: (playerText, scene, playerCmds) =>
            decideUse(playerText, scene, playerCmds, getSettings().companionInitiative,
                (prompt) => qgen({ quietPrompt: prompt, responseLength: 160, skipWIAN: true })),
        companionMove: (playerText, playerRoom, companionRoom) =>
            decideMove(playerText, playerRoom, companionRoom, getSettings().companionBias,
                (prompt) => qgen({ quietPrompt: prompt, responseLength: 160, skipWIAN: true })),
        companionDecide: (playerText, playerRoom, companionRoom, playerMoves) =>
            decideAgency(playerText, playerRoom, companionRoom, playerMoves, getSettings().companionBias,
                (prompt) => qgen({ quietPrompt: prompt, responseLength: 160, skipWIAN: true })),
        onNpcSpeak: async ({ npc, playerText, room, greet }) => {
            const ctx = getContext();
            const brief = readState(ctx.chatMetadata)?.scenarioBrief;
            const briefLine = brief ? ` Background everyone here knows: ${brief}` : '';
            const REPLY_RULE = 'answer the player helpfully and in character — volunteer a relevant detail, observation, or hook from what you know rather than merely deflecting; 1-3 lines of dialogue and a small action. Do not narrate the player or the wider scene.';
            // A greeting is fired when the player first walks in; otherwise it's a reply.
            const task = greet
                ? 'The player has just walked in and you have not spoken yet. Greet and briefly introduce yourself in character'
                : `The player said: "${playerText}". Reply in character`;
            const card = (ctx.characters || []).find((c) => c.name === npc.card || c.avatar === npc.card);
            if (!card) {
                // Bound card not in the character list: don't go silent — voice the NPC
                // lightly from its blurb so the scene keeps moving (no avatar).
                console.warn('[ST_IF] NPC card not found, voicing from blurb:', npc.card);
                const persona = npc.blurb || `a figure known as ${npc.name}`;
                try {
                    const r = await qgen({
                        quietPrompt: `[You are ${npc.name}, ${persona}.${briefLine} You are at "${room}". ${task} as ${npc.name} — ${REPLY_RULE}]`,
                        responseLength: 160, skipWIAN: true,
                    });
                    postNpcMessage({ name: npc.name }, stripReasoning(r));
                } catch (e) { console.error('[ST_IF] NPC blurb fallback failed', e); }
                return;
            }
            const persona = [card.description, card.personality].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 1200);
            let reply;
            try {
                reply = await qgen({
                    quietPrompt: `[You are ${card.name}, an NPC the player is speaking with. ${persona}${briefLine}\nYou are at "${room}". ${task} as ${card.name} — ${REPLY_RULE}]`,
                    responseLength: 160,
                    skipWIAN: true,
                });
            } catch (e) {
                console.error('[ST_IF] NPC speak failed', e);
                return;
            }
            postNpcMessage(card, stripReasoning(reply));
            if (!greet) await maybeFireEffect({ npc, playerText, room, reply });   // a passive greeting fires no effects
        },
        onNarratePlayerRoom: async ({ playerRoom, outputs, companionDir }) => {
            const result = (outputs || []).join('\n').trim() || '(you wait)';
            const leftNote = companionDir ? ` {{char}} has just left, heading ${companionDir}.` : '';
            let prose;
            try {
                prose = await qgen({
                    quietPrompt: `[Narrate, in 2-3 vivid third-person sentences, the following happening to {{user}}, who is alone at "${playerRoom}".${leftNote} Do not voice {{char}}. Event:\n${result}]`,
                    responseLength: 160,
                    skipWIAN: true,
                });
            } catch (e) {
                console.error('[ST_IF] player-room narration failed', e);
                return;   // fail-open: skip the extra block
            }
            postComment(`*(${playerRoom})* ${stripReasoning(prose)}`);
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
 * prompt (coreChat filters out is_system messages) — so the companion narrator never
 * sees the player's-room block. Built as a message object directly rather than via
 * `/comment`, because the slash-command parser treats `|`, `{{`, `/` etc. in the text
 * as command syntax and truncates it (the model's `<|channel>` tokens contain `|`).
 */
function postComment(text) {
    const ctx = getContext();
    const message = {
        name: 'IF Narrator',
        is_user: false,
        is_system: true,
        send_date: ctx.getMessageTimeStamp ? ctx.getMessageTimeStamp() : new Date().toISOString(),
        mes: String(text ?? '').trim(),
        extra: { type: 'comment', isSmallSys: false },
    };
    ctx.chat.push(message);
    ctx.addOneMessage(message);
    if (typeof ctx.saveChat === 'function') ctx.saveChat();
}

/** Post an NPC's line as a normal (in-prompt) message under the card's name + avatar. */
function postNpcMessage(card, text) {
    const ctx = getContext();
    const message = {
        name: card.name,
        is_user: false,
        is_system: false,
        force_avatar: card.avatar ? `/thumbnail?type=avatar&file=${encodeURIComponent(card.avatar)}` : undefined,
        send_date: ctx.getMessageTimeStamp ? ctx.getMessageTimeStamp() : new Date().toISOString(),
        mes: String(text ?? '').trim(),
        extra: {},
    };
    ctx.chat.push(message);
    ctx.addOneMessage(message);
    if (typeof ctx.saveChat === 'function') ctx.saveChat();
}

/**
 * After an NPC speaks, optionally let the interaction change ground-truth state:
 * the LLM proposes an effect, the engine bounds it, the VM (effects.h) executes it.
 * Quest payouts use the quest's pre-set reward (not LLM-chosen) and are flag-gated.
 */
async function maybeFireEffect({ npc, playerText, room, reply }) {
    const s = getSettings();
    if (!s.effectSafety || s.effectSafety === 'off') return;
    if (typeof vm.applyWorldEdits !== 'function') return;
    const ctx = getContext();
    const md = ctx.chatMetadata;
    const quests = getQuests(md).filter((q) => q.giver === npc.name && q.status === 'active');
    const questText = quests.length
        ? ` Active quests from ${npc.name}: ${quests.map((q) => `${q.id} (${q.goal}${q.condition ? `, needs flag ${q.condition}` : ''})`).join('; ')}.`
        : '';
    let proposal;
    try {
        const raw = await qgen({
            quietPrompt: `[Game-master check for NPC "${npc.name}" at "${room}". Player said: "${playerText}". ${npc.name} replied: "${String(reply).slice(0, 300)}".${questText} Does this interaction change game state? Respond ONLY JSON: {"effect":"grant"|"take"|"flag"|"give"|"take-item"|"none","amount":<int>,"flag":"<name>","item":"<one lowercase word>","questDone":"<quest id or empty>","npcMove":"follow"|"leave"|""}. "give" = the NPC hands the player a physical item (set "item"); "take-item" = the NPC takes one back. "npcMove":"follow" if ${npc.name} agrees/decides to travel with the player, "leave" if they depart, else "". Be conservative — "none"/"" unless it clearly happened.]`,
            responseLength: 160,
            skipWIAN: true,
        });
        proposal = parseEffectProposal(raw);
    } catch (e) {
        console.error('[ST_IF] effect proposal failed', e);
        return;
    }
    if (!proposal) return;

    let fired = null;            // the verb actually executed
    let line = null;             // canon description for next turn

    // Quest completion pays the quest's OWN reward (bounded), flag-gated if it has a condition.
    const qid = String(proposal.questDone || '').trim();
    if (qid) {
        const flagSet = (q) => !q.condition || /^\s*1/.test(vm.query ? vm.query(`xflagq ${q.condition}`) : '0');
        const q = resolveCompletion(getQuests(md), qid, true);   // existence/active
        if (q && flagSet(q)) {
            fired = effectVerb({ effect: q.reward.effect, amount: q.reward.amount, flag: q.reward.flag });
            setQuests(md, getQuests(md).map((x) => (x.id === q.id ? { ...x, status: 'done' } : x)));
            line = `Quest "${q.id}" complete — ${npc.name} grants the reward (${q.reward.effect === 'flag' ? `flag ${q.reward.flag}` : `${q.reward.amount} gold`}).`;
        }
    }
    // Otherwise an ad-hoc effect, bounded by validateEffect.
    if (!fired) {
        const eff = validateEffect(proposal, { safety: s.effectSafety, maxGrant: s.maxGrant });
        if (eff) {
            fired = effectVerb(eff);
            line = eff.effect === 'flag' ? `(${npc.name} marks "${eff.flag}".)`
                : eff.effect === 'give' ? `${npc.name} hands you a ${eff.item} — it is yours now.`
                : eff.effect === 'take-item' ? `${npc.name} takes the ${eff.item} back.`
                : `${npc.name} ${eff.effect === 'take' ? 'takes' : 'hands over'} ${eff.amount} gold.`;
        }
    }
    // GM-driven movement of the speaking NPC — registry-level, benign: only the NPC
    // you're talking to, only follow/leave. Fires alongside or instead of a VM effect.
    let moveLine = null;
    const mv = String(proposal.npcMove || '').trim().toLowerCase();
    if (mv === 'follow') {
        setNpcs(md, moveNpc(setFollow(getNpcs(md), npc.name, true), npc.name, normalizeRoom(room)));
        moveLine = `${npc.name} falls into step with you.`;
    } else if (mv === 'leave' || mv === 'depart') {
        setNpcs(md, moveNpc(setFollow(getNpcs(md), npc.name, false), npc.name, 'away'));
        moveLine = `${npc.name} takes their leave.`;
    }

    // Apply the VM effect (if any); a world without effects.h rejects it.
    let total = '';
    if (fired) {
        const out = vm.applyWorldEdits([fired]);
        if (/bad|miss|unknown/i.test(out)) { fired = null; line = null; }   // world lacks effects.h / bad verb
    }
    if (!fired && !moveLine) return;

    const st = readState(md);
    if (st) {
        if (fired) {
            st.snapshot = vm.save();
            st.summary = vm.getStatus();
            if (/^xgrant\b|^xtake\b/.test(fired)) {   // gold verbs only (not xtakeitem/xgive/xflag)
                try { const g = vm.query ? vm.query('xgold').trim() : ''; if (/^\d+$/.test(g)) total = ` You now have ${g} gold.`; } catch { /* no economy */ }
            }
            // An item handoff changed the player's inventory — refresh the HUD's 🎒 now
            // (this fires on GENERATION_ENDED, between turns, so nothing else will).
            try { setInventoryText(md, compactInventory(vm.query('inventory'))); } catch { /* no inventory verb */ }
        }
        const parts = [fired ? (line + total) : null, moveLine].filter(Boolean);
        if (parts.length) st.pendingEffectLine = parts.join(' ');
    }
    saveMetadataDebounced();
    renderHud();
}

/** Update the persistent "Current room" box from this chat's state. */
function renderRoomPanel() {
    const el = document.getElementById('st_if_room');
    if (!el) return;
    const ctx = getContext();
    const s = readState(ctx.chatMetadata);
    if (!s) { el.textContent = '(no game loaded)'; return; }
    const loc = s.summary?.location ?? '?';
    const desc = getRoomDescription(ctx.chatMetadata);
    const bits = [];
    if (s.summary?.score !== null && s.summary?.score !== undefined) bits.push(`Score ${s.summary.score}`);
    if (s.summary?.moves !== null && s.summary?.moves !== undefined) bits.push(`Moves ${s.summary.moves}`);
    el.textContent = `${loc}${desc ? `\n\n${desc}` : ''}${bits.length ? `\n\n${bits.join(' · ')}` : ''}`;
}

/** Render the floating HUD strip (location · exits · inventory [· companion]). */
function renderHud() {
    let el = document.getElementById('st_if_hud');
    if (!el) {
        const form = document.getElementById('send_form');
        if (!form) return;
        el = document.createElement('div');
        el.id = 'st_if_hud';
        el.innerHTML = '<span class="st_if_hud_pin" title="Collapse/expand">📍</span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_loc"></span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_exits"></span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_inv"></span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_comp"></span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_npc"></span>' +
            '<span class="st_if_hud_seg" id="st_if_hud_mode"></span>';
        form.parentElement.insertBefore(el, form);
        el.querySelector('.st_if_hud_pin').addEventListener('click', () => el.classList.toggle('st_if_collapsed'));
    }
    const cfg = getSettings();
    const ctx = getContext();
    const s = readState(ctx.chatMetadata);
    el.classList.toggle('st_if_hidden', !cfg?.showHud || !s);
    if (!s) return;
    const room = s.summary?.location ?? '?';
    el.querySelector('#st_if_hud_loc').textContent = room;
    const merged = mergeExits(getExitsForRoom(ctx.chatMetadata, room) ?? [], getEdgesForRoom(ctx.chatMetadata, room));
    const exitsLine = formatExitsLine(merged);
    el.querySelector('#st_if_hud_exits').textContent = exitsLine ? `· Exits: ${exitsLine}` : '';
    const inv = getInventoryText(ctx.chatMetadata);
    el.querySelector('#st_if_hud_inv').textContent = inv ? `· 🎒 ${inv}` : '';
    const compRoom = s.companion?.summary?.location;
    const apart = cfg?.companionTracking && compRoom && !readTogether(ctx.chatMetadata);
    el.querySelector('#st_if_hud_comp').textContent = apart ? `· 👥 ${compRoom}` : '';
    const present = presentNpcs(getNpcs(ctx.chatMetadata), room);
    el.querySelector('#st_if_hud_npc').textContent = present.length ? `· 👤 ${present.map((n) => n.name).join(', ')}` : '';
    const mode = getMode(ctx.chatMetadata);
    el.querySelector('#st_if_hud_mode').textContent = mode === 'build' ? '· 🛠 build' : mode === 'gm' ? '· 🎲 gm' : '';
}

// GENERATION_ENDED also fires for OUR OWN quiet extraction call, which would
// re-trigger extraction before the cache write lands (observed: duplicate
// identical requests; a persistent parse failure would loop forever and hammer
// the backend). Guard with an in-flight flag and a once-per-room+desc attempt
// marker — a failed parse retries only when the room or its description changes.
let exitsExtractionInFlight = false;
let exitsLastAttemptKey = null;

/** Fire-and-forget: extract exits for the current room if not cached yet. */
function ensureExitsExtracted() {
    const ctx = getContext();
    const s = readState(ctx.chatMetadata);
    const room = s?.summary?.location;
    const desc = getRoomDescription(ctx.chatMetadata);
    if (!room || !desc || exitsExtractionInFlight) return;
    if (getExitsForRoom(ctx.chatMetadata, room, desc) !== undefined) return;
    const attemptKey = `${room}::${desc.length}`;
    if (exitsLastAttemptKey === attemptKey) return;
    exitsLastAttemptKey = attemptKey;
    exitsExtractionInFlight = true;
    extractExits(desc, (prompt) => qgen({ quietPrompt: prompt, responseLength: 220, skipWIAN: true }))
        .then((exits) => {
            if (exits === null) return;            // parse failure — retry on next room/desc change
            setExitsForRoom(ctx.chatMetadata, room, exits, desc);
            saveMetadataDebounced();
            renderHud();
        })
        .catch((e) => console.warn('[ST_IF] exits extraction failed', e))
        .finally(() => { exitsExtractionInFlight = false; });
}

/** Apply freshly-loaded story bytes: store, (re)seed state, render. Shared by upload + picker. */
async function applyStoryBytes(name, bytes, id, file) {
    const ctx = getContext();
    const s = getSettings();
    s.storyName = name;
    s.storyId = id || '';          // base-world id for export/import (bundled worlds only)
    s.storyFile = file || '';      // bundled world filename — lets a fresh chat re-seed its scenario
    s.storyBase64 = bytesToBase64(bytes);
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
    seedOpeningCanon();
    $('#st_if_story_name').text(name);
}

/**
 * Ground the narrator's first generation in the real opening scene of a freshly
 * loaded game, so it opens where the story actually starts instead of guessing.
 * Sets the canon extension prompt; the first real turn overwrites it.
 */
function seedOpeningCanon() {
    try {
        const ctx = getContext();
        const s = readState(ctx.chatMetadata);
        if (!s || (s.history && s.history.length)) return;   // only before the first turn
        const intro = getRoomDescription(ctx.chatMetadata) || vm.getIntro();
        const block = buildOpeningBlock(intro, vm.getStatus());
        setExtensionPrompt(KEY, block, extension_prompt_types.IN_CHAT, getSettings().depth, false, extension_prompt_roles.SYSTEM);
    } catch (e) { console.warn('[ST_IF] opening seed failed', e); }
}

/** Trigger a browser download of `text` as `filename`. */
function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

/** Export the current chat's grown world as a downloadable JSON file (graph v3). */
function exportWorld() {
    const ctx = getContext();
    const graph = getWorldGraph(ctx.chatMetadata);
    if (!graph.rooms.length) { toastr.info('No grown rooms to export yet.', 'ST_IF'); return; }
    const story = getSettings().storyId || 'expanse';
    const payload = { format: 'st_if_world', version: 3, story, rooms: graph.rooms, edges: graph.edges, anchors: graph.anchors || {} };
    const safe = String(getSettings().storyName || story).replace(/[^\w.-]+/g, '_');
    downloadText(`world-${safe}.json`, JSON.stringify(payload, null, 2));
    toastr.success(`Exported ${graph.rooms.length} room(s).`, 'ST_IF');
}

/** Find a bundled world's file by its id from the worlds manifest. */
async function bundledWorldFile(id) {
    try {
        const worlds = await (await fetch('/scripts/extensions/ST_IF/worlds/worlds.json')).json();
        return worlds.find((w) => w.id === id)?.file ?? null;
    } catch { return null; }
}

/** Rebuild a shared world: load its base story, then replay the graph into it. */
async function importWorld(payload) {
    if (!payload || payload.format !== 'st_if_world' || !Array.isArray(payload.rooms)) {
        throw new Error('Not a valid ST_IF world file.');
    }
    const story = payload.story || 'expanse';
    // v1 (tree) -> graph; v2 (graph, no anchors) -> add empty anchors; v3 as-is.
    const graph = Array.isArray(payload.edges)
        ? { rooms: payload.rooms, edges: payload.edges, anchors: payload.anchors || {} }
        : { ...upconvertV1(payload.rooms), anchors: {} };
    const file = story === 'expanse' ? 'expanse.z5' : await bundledWorldFile(story);
    if (!file) throw new Error(`Unknown base world "${story}" — cannot import.`);
    const bytes = new Uint8Array(await (await fetch(`/scripts/extensions/ST_IF/worlds/${file}`)).arrayBuffer());
    await applyStoryBytes(`${story} (imported)`, bytes, story);   // fresh base + reset state
    const editOut = vm.applyWorldEdits(planReplay(graph));        // xnew/xlinkn don't move the player
    const partial = /no-free-room/i.test(editOut);
    // Persist the rebuilt world + re-seed the graph so /if-map and re-export work.
    const ctx = getContext();
    const st = readState(ctx.chatMetadata);
    st.snapshot = vm.save();
    st.summary = vm.getStatus();
    setRoomDescription(ctx.chatMetadata, vm.query ? vm.query('look') : '');
    for (const r of graph.rooms) recordRoom(ctx.chatMetadata, r);
    for (const e of graph.edges) recordEdge(ctx.chatMetadata, e);
    for (const [s, c] of Object.entries(graph.anchors)) setAnchor(ctx.chatMetadata, s, c);
    setCompanion(ctx.chatMetadata, { snapshot: vm.save(), summary: vm.getStatus() });
    saveMetadataDebounced();
    renderRoomPanel(); renderHud();
    return { count: graph.rooms.length, partial };
}

const WORLDS_URL = '/scripts/extensions/ST_IF/worlds/';

/** Import a shipped card PNG (with embedded V2 data) into the character list. */
async function importCardPng(file) {
    const ctx = getContext();
    const headers = (typeof getRequestHeaders === 'function') ? getRequestHeaders() : {};
    const csrf = headers['X-CSRF-Token'] || headers['x-csrf-token'];
    const blob = await (await fetch(`${WORLDS_URL}${file}`)).blob();
    const fd = new FormData();
    fd.append('avatar', blob, file.split('/').pop());
    fd.append('file_type', 'png');
    await fetch('/api/characters/import', { method: 'POST', headers: csrf ? { 'X-CSRF-Token': csrf } : {}, body: fd });
    if (typeof ctx.getCharacters === 'function') await ctx.getCharacters();   // refresh the list
}

/**
 * Seed a bundled world's NPCs/quests/cards/effectSafety from its sidecar manifest
 * (worlds/<basename>.world.json). Idempotent: only seeds a fresh chat unless forced.
 */
async function seedScenario(worldFile, { force = false } = {}) {
    if (!worldFile) return;
    const base = String(worldFile).replace(/\.[^.]+$/, '');
    let manifest;
    try {
        const res = await fetch(`${WORLDS_URL}${base}.world.json`);
        if (!res.ok) return;                                  // no manifest → behave as before
        manifest = parseManifest(await res.text());
    } catch { return; }
    if (!manifest) return;
    const md = getContext().chatMetadata;
    if (!readState(md)) return;
    // Shared world facts every NPC knows — refreshed on every load (even resume), so NPC
    // replies are grounded in the scenario's background, not just the card persona.
    readState(md).scenarioBrief = manifest.brief || '';
    if (!force && (getNpcs(md).length || getQuests(md).length)) return;   // never clobber
    if (force) { setNpcs(md, []); setQuests(md, []); }

    const names = () => (getContext().characters || []).map((c) => c.name);
    const plan = planSeed(manifest, names());
    for (const card of plan.cardsToImport) {
        try { await importCardPng(card.file); } catch (e) { console.warn('[ST_IF] card import failed', card, e); }
    }
    // Re-derive missing after import (a failed import leaves the card absent).
    const have = new Set(names());
    const missing = plan.npcs.filter((n) => n.card && !have.has(n.card)).map((n) => ({ npc: n.name, card: n.card }));

    setNpcs(md, plan.npcs);
    setQuests(md, plan.quests);
    if (plan.effectSafety) { getSettings().effectSafety = plan.effectSafety; saveSettingsDebounced(); }
    readState(md).scenarioFile = worldFile;
    saveMetadataDebounced();
    renderHud();

    let msg = `*(scenario)* Loaded: ${plan.npcs.length} NPC(s), ${plan.quests.length} quest(s)${plan.effectSafety ? `, NPC effects: ${plan.effectSafety}` : ''}.`;
    if (missing.length) {
        msg += '\n' + missing.map((m) => `⚠ NPC "${m.npc}" expects card "${m.card}" (not found) — bind a replacement: /if-npc bind ${m.npc} <your card>`).join('\n');
    }
    if (plan.narrator && have.has(plan.narrator) && getContext().name2 !== plan.narrator) {
        msg += `\n🎙 Narrator card "${plan.narrator}" is ready — for clean, faithful narration, run this scenario in a chat with that card.`;
    }
    postComment(msg);
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
        renderRoomPanel();
        renderHud();
        // exits extraction is deferred to GENERATION_ENDED — a quiet LLM call here
        // would race the main generation on a single-slot backend.
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
        readState(ctx.chatMetadata).summary = vm.getStatus();   // so the room panel shows location immediately
        setRoomDescription(ctx.chatMetadata, vm.getIntro());
        saveMetadataDebounced();
        showIntroIfDebug();
    } else {
        // Resume: restore this chat's canonical snapshot. Old save lineages may
        // predate verbose-forcing (the flag lives in game memory), so re-assert it.
        const snap = getActiveSnapshot(ctx.chatMetadata);
        if (snap) { vm.restore(snap); vm.ensureVerbose(); }
    }

    // Companion VM mirrors the same story; seed/restore its own position.
    if (!companionVM.loaded) await companionVM.load(base64ToBytes(s.storyBase64));
    const st = readState(ctx.chatMetadata);
    if (st) {
        const csnap = getCompanionSnapshot(ctx.chatMetadata);
        if (csnap) { companionVM.restore(csnap); companionVM.ensureVerbose(); }
        if (!st.companion) {
            setCompanion(ctx.chatMetadata, { snapshot: companionVM.save(), summary: companionVM.getStatus() });
            saveMetadataDebounced();
        }
    }

    renderRoomPanel();
    renderHud();
    ensureExitsExtracted();
    seedOpeningCanon();
    // Auto-seed the bundled scenario on a fresh chat (idempotent: seedScenario no-ops
    // if the NPC/quest registries are already populated). So you no longer have to
    // re-load from the picker every new chat — just start one.
    const wf = getSettings().storyFile;
    if (wf) { try { await seedScenario(wf); } catch (e) { console.warn('[ST_IF] auto-seed failed', e); } }
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
        name: 'if-npc',
        helpString: 'Manage in-world NPCs: here <card name> (drop a card into the current room, auto-named+bound) | add <name> @ <room> : <blurb> | bind <name> <card> | move <name> <room> | follow <name> [off] | patrol <name> <room> <room> ... | list | remove <name>.',
        unnamedArgumentList: [new SlashCommandArgument('subcommand + args', [ARGUMENT_TYPE.STRING], false, false, '')],
        returns: ARGUMENT_TYPE.STRING,
        callback: async (_args, value) => {
            const md = getContext().chatMetadata;
            if (!readState(md)) return 'No story loaded.';
            const v = String(value ?? '').trim();
            const sub = (v.split(/\s+/)[0] || 'list').toLowerCase();
            const rest = v.slice(sub.length).trim();
            let list = getNpcs(md);
            if (sub === 'add') {
                const m = rest.match(/^(\S+)\s*@\s*(\S+)\s*:?\s*(.*)$/);
                if (!m) return 'Usage: /if-npc add <name> @ <room> : <blurb>';
                list = addNpc(list, { name: m[1].toLowerCase(), room: normalizeRoom(m[2]), blurb: m[3] || '' });
                setNpcs(md, list); saveMetadataDebounced();
                return `Added NPC "${m[1].toLowerCase()}" in ${normalizeRoom(m[2])}.`;
            }
            if (sub === 'here') {
                // Shortcut: drop a character card into the CURRENT room, bound, with an
                // address-name derived from the card (first word). Display stays the card name.
                const cardName = rest.trim();
                if (!cardName) return 'Usage: /if-npc here <card name>   (drops that card into your current room)';
                if (!vm.loaded) return 'No story loaded.';
                const name = deriveNpcName(cardName);
                if (!name) return 'Could not derive an address name from that card.';
                const loc = vm.getStatus().location;
                const room = normalizeRoom(loc);
                const card = (getContext().characters || []).find((c) => c.name === cardName);
                const blurb = card ? [card.description, card.personality].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
                list = bindCard(addNpc(list, { name, room, blurb }), name, cardName);
                setNpcs(md, list); saveMetadataDebounced(); renderHud();
                const warn = card ? '' : ` (card "${cardName}" not in your character list yet — narrator-voiced until imported)`;
                return `Added "${name}" (card: ${cardName}) in ${loc} — address them as "${name}"${warn}.`;
            }
            if (sub === 'bind') {
                const m = rest.match(/^(\S+)\s+(.+)$/);
                if (!m) return 'Usage: /if-npc bind <name> <card name>   (use - to unbind)';
                list = bindCard(list, m[1].toLowerCase(), m[2].trim());
                setNpcs(md, list); saveMetadataDebounced();
                return `Bound "${m[1].toLowerCase()}" to card "${m[2].trim()}".`;
            }
            if (sub === 'remove') {
                list = removeNpc(list, rest.toLowerCase());
                setNpcs(md, list); saveMetadataDebounced();
                return `Removed "${rest.toLowerCase()}".`;
            }
            if (sub === 'move') {
                const m = rest.match(/^(\S+)\s+(.+)$/);
                if (!m) return 'Usage: /if-npc move <name> <room>   (room "away" = present nowhere)';
                list = moveNpc(list, m[1].toLowerCase(), normalizeRoom(m[2]));
                setNpcs(md, list); saveMetadataDebounced(); renderHud();
                return `Moved "${m[1].toLowerCase()}" to ${normalizeRoom(m[2])}.`;
            }
            if (sub === 'follow') {
                const m = rest.match(/^(\S+)(?:\s+(off|stop|no))?\s*$/i);
                if (!m) return 'Usage: /if-npc follow <name> [off]';
                const on = !m[2];
                list = setFollow(list, m[1].toLowerCase(), on);
                if (on) list = moveNpc(list, m[1].toLowerCase(), vm.getStatus().location);   // join you now
                setNpcs(md, list); saveMetadataDebounced(); renderHud();
                return `"${m[1].toLowerCase()}" ${on ? 'now follows you' : 'stays put'}.`;
            }
            if (sub === 'patrol') {
                const parts = rest.split(/\s+/).filter(Boolean);
                const name = (parts.shift() || '').toLowerCase();
                if (!name) return 'Usage: /if-npc patrol <name> <room> <room> ...   (no rooms clears it)';
                list = setPatrol(list, name, parts);
                setNpcs(md, list); saveMetadataDebounced(); renderHud();
                const n = list.find((x) => x.name === name);
                return n?.patrol ? `"${name}" now patrols: ${n.patrol.join(' → ')}.` : `Cleared "${name}"'s patrol.`;
            }
            if (!list.length) return 'No NPCs yet. /if-npc add <name> @ <room> : <blurb>';
            return list.map((n) => `${n.name} @ ${n.room}${n.follows ? ' (following)' : ''}${n.patrol ? ` (patrol: ${n.patrol.join('→')})` : ''}${n.card ? ` (card: ${n.card})` : ''} — ${n.blurb}`).join('\n');
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-quest',
        helpString: 'Manage quests: add <id> giver=<npc> goal="..." reward=<gold N|flag F> [needs=<flag>] | list | remove <id>.',
        unnamedArgumentList: [new SlashCommandArgument('subcommand + args', [ARGUMENT_TYPE.STRING], false, false, '')],
        returns: ARGUMENT_TYPE.STRING,
        callback: async (_args, value) => {
            const md = getContext().chatMetadata;
            if (!readState(md)) return 'No story loaded.';
            const v = String(value ?? '').trim();
            const sub = (v.split(/\s+/)[0] || 'list').toLowerCase();
            const rest = v.slice(sub.length).trim();
            let list = getQuests(md);
            if (sub === 'add') {
                const id = (rest.match(/^(\S+)/) || [])[1];
                const giver = (rest.match(/giver=(\S+)/) || [])[1];
                const goal = (rest.match(/goal="([^"]*)"/) || [])[1] || (rest.match(/goal=(\S+)/) || [])[1] || '';
                const rg = rest.match(/reward=gold\s+(\d+)/i);
                const rf = rest.match(/reward=flag\s+(\S+)/i);
                const needs = (rest.match(/needs=(\S+)/) || [])[1];
                if (!id || !giver || (!rg && !rf)) return 'Usage: /if-quest add <id> giver=<npc> goal="..." reward=<gold N|flag F> [needs=<flag>]';
                const reward = rg ? { effect: 'grant', amount: Number(rg[1]) } : { effect: 'flag', flag: rf[1] };
                list = addQuest(list, { id, giver: giver.toLowerCase(), goal, reward, condition: needs });
                setQuests(md, list); saveMetadataDebounced();
                return `Added quest "${id}" from ${giver.toLowerCase()}.`;
            }
            if (sub === 'remove') {
                list = removeQuest(list, rest);
                setQuests(md, list); saveMetadataDebounced();
                return `Removed quest "${rest}".`;
            }
            if (!list.length) return 'No quests. /if-quest add <id> giver=<npc> goal="..." reward=gold 10';
            return listQuests(list).map((q) => `${q.id} [${q.status}] giver=${q.giver} — ${q.goal} → ${q.reward.effect === 'flag' ? `flag ${q.reward.flag}` : `${q.reward.amount} gold`}${q.condition ? ` (needs ${q.condition})` : ''}`).join('\n');
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-scenario',
        helpString: 'Scenario bundle: \'reload\' re-seeds NPCs/quests from the world manifest (resets them); \'list\' shows what\'s loaded.',
        unnamedArgumentList: [new SlashCommandArgument('reload | list', [ARGUMENT_TYPE.STRING], false, false, '')],
        returns: ARGUMENT_TYPE.STRING,
        callback: async (_args, value) => {
            const md = getContext().chatMetadata;
            const st = readState(md);
            if (!st) return 'No story loaded.';
            const sub = (String(value ?? '').trim().split(/\s+/)[0] || 'list').toLowerCase();
            if (sub === 'reload') {
                if (!st.scenarioFile) return 'No bundled scenario to reload (load one from the picker).';
                await seedScenario(st.scenarioFile, { force: true });
                return `Reloaded scenario from ${st.scenarioFile}.`;
            }
            const npcs = getNpcs(md), quests = getQuests(md);
            return `Scenario: ${st.scenarioFile || '(none)'}\nNPCs: ${npcs.map((n) => n.name).join(', ') || '(none)'}\nQuests: ${quests.map((q) => `${q.id}[${q.status}]`).join(', ') || '(none)'}`;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-mode',
        helpString: 'Narration mode: \'narrate\' (faithful play), \'build\' (extend the world at its edges), or \'gm\' (lively — voices minor NPCs, drives pacing). No argument reports the current mode. Persists with this chat.',
        unnamedArgumentList: [new SlashCommandArgument('narrate | build | gm', [ARGUMENT_TYPE.STRING], false, false, '')],
        returns: ARGUMENT_TYPE.STRING,
        callback: async (_args, value) => {
            const md = getContext().chatMetadata;
            if (!readState(md)) return 'No story loaded.';
            const want = String(value ?? '').trim().toLowerCase();
            if (!want) return `Mode: ${getMode(md)} (options: ${MODES.join(', ')}).`;
            if (!MODES.includes(want)) return `Unknown mode "${want}". Options: ${MODES.join(', ')}.`;
            setMode(md, want);
            saveMetadataDebounced();
            renderHud();
            if (want === 'build') {
                const canGrow = vm.loaded && typeof vm.isExpandable === 'function' && vm.isExpandable();
                return canGrow
                    ? 'Mode: build — the narrator may now invent new rooms/objects/exits at the edges of the world.'
                    : 'Mode: build set — but THIS world is not expandable, so new rooms cannot persist; it behaves like narrate here. Load an expandable world for world-building.';
            }
            if (want === 'gm') return 'Mode: gm — lively play: the narrator voices minor background NPCs and drives pacing/hooks (registered card NPCs still speak for themselves).';
            return 'Mode: narrate — faithful play; the narrator describes only what exists.';
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'if-map',
        helpString: 'Show a tree of the rooms the narrator has grown this chat.',
        returns: ARGUMENT_TYPE.STRING,
        callback: async () => {
            const map = formatMap(getWorldGraph(getContext().chatMetadata));
            postComment('*(map)*\n```\n' + map + '\n```');
            return 'Map posted.';
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
            vm.ensureVerbose();
            saveMetadataDebounced();
            return `Rewound to before message ${value}.`;
        },
    }));
}

jQuery(async () => {
    const html = await renderExtensionTemplateAsync('ST_IF', 'settings');
    $('#extensions_settings2').append(html);
    loadSettings();
    wireSettingsUI(async (name, bytes) => {
        // New story chosen via upload: reset VM + state for the current chat.
        await applyStoryBytes(name, bytes);
    });
    try {
        const worlds = await (await fetch('/scripts/extensions/ST_IF/worlds/worlds.json')).json();
        const sel = $('#st_if_world_select');
        for (const w of worlds) sel.append($('<option>').val(w.file).attr('data-id', w.id || '').text(w.name));
        $('#st_if_world_load').on('click', async () => {
            const file = String(sel.val());
            if (!file) return;
            const opt = sel.find('option:selected');
            const label = opt.text();
            const id = opt.attr('data-id') || '';
            try {
                const bytes = new Uint8Array(await (await fetch(`/scripts/extensions/ST_IF/worlds/${file}`)).arrayBuffer());
                await applyStoryBytes(label, bytes, id, file);
                await seedScenario(file);                 // auto-seed NPCs/quests/cards from the manifest
                toastr.success(`Loaded ${label}`, 'ST_IF');
            } catch (e) {
                console.error('[ST_IF] world load failed', e);
                toastr.error(String(e?.message || e), 'ST_IF: world load failed');
            }
        });
    } catch (e) {
        console.warn('[ST_IF] no bundled worlds manifest', e);
    }
    $('#st_if_world_export').on('click', () => exportWorld());
    $('#st_if_world_import').off('click.st_if').on('click.st_if', () => {
        const el = document.getElementById('st_if_world_import_file');
        if (el) el.click();
    });
    $('#st_if_world_import_file').off('change.st_if').on('change.st_if', async function () {
        const file = this.files?.[0];
        if (!file) return;
        try {
            const payload = JSON.parse(await file.text());
            const { count, partial } = await importWorld(payload);
            if (partial) toastr.warning(`Imported ${count} room(s); pool filled before the rest.`, 'ST_IF');
            else toastr.success(`Imported a world of ${count} room(s).`, 'ST_IF');
        } catch (err) {
            console.error('[ST_IF] world import failed', err);
            toastr.error(String(err?.message || err), 'ST_IF: import failed');
        } finally {
            this.value = '';
        }
    });
    registerSlashCommands();
    eventSource.on(event_types.CHAT_CHANGED, ensureStoryLoaded);
    eventSource.on(event_types.GENERATION_ENDED, async () => {
        renderHud();
        ensureExitsExtracted();
        // A card-bound NPC the player addressed speaks AFTER the narrator's turn.
        const st = readState(getContext().chatMetadata);
        const pend = st?.pendingNpcSpeak;
        if (pend) {
            st.pendingNpcSpeak = null;
            try { await buildDeps().onNpcSpeak(pend); } catch (e) { console.error('[ST_IF] npc speak', e); }
        }
        // First-encounter greeting (only when you didn't also address someone this turn).
        const greet = st?.pendingNpcGreet;
        if (greet && !pend) {
            st.pendingNpcGreet = null;
            try { await buildDeps().onNpcSpeak({ ...greet, greet: true }); } catch (e) { console.error('[ST_IF] npc greet', e); }
        } else if (greet) {
            st.pendingNpcGreet = null;
        }
    });
    await ensureStoryLoaded();
    renderRoomPanel();
    console.log('[ST_IF] ready');
});
