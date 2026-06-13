// settings.js — extension_settings.ST_IF defaults, UI wiring, story upload to base64.
import { extension_settings } from '../../extensions.js';
import { saveSettingsDebounced } from '../../../script.js';
import { zone } from './companion.js';

function updateBiasLabel(value) {
    const el = document.getElementById('st_if_bias_value');
    if (el) el.textContent = `${Number(value).toFixed(1)} — ${zone(value)}`;
}

export const MODULE = 'ST_IF';

export const defaultSettings = {
    enabled: false,
    injectStateOnRp: false,
    strictness: 'strict',
    depth: 1,
    showRawOutput: false,   // dev: surface raw VM output via toast
    companionTracking: false,
    companionBias: 0.7,     // 0 = wanders freely, 1 = stays glued to the player
    companionAgency: false, // LLM decides follow/stay/move instead of the deterministic zones
    showHud: true,          // floating exits/inventory strip above the chat input
    companionActs: false,            // companion may act on the world while together
    companionInitiative: 'need',     // asked | need | proactive
    companionActionSafety: 'safe',   // safe (verb allowlist) | open
    dynamicWorld: false,             // narrator invents rooms on blocked moves (expandable worlds)
    storyName: '',
    storyBase64: '',   // the .z5/.z8 bytes, base64
};

export function getSettings() {
    return extension_settings[MODULE];
}

export function loadSettings() {
    extension_settings[MODULE] = extension_settings[MODULE] ?? {};
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings[MODULE][key] === undefined) {
            extension_settings[MODULE][key] = defaultSettings[key];
        }
    }
}

export function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

export function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * @param {(name:string, bytes:Uint8Array)=>Promise<void>} onStoryLoaded called after a new story file is selected
 */
export function wireSettingsUI(onStoryLoaded) {
    const s = getSettings();

    $('#st_if_enabled').prop('checked', s.enabled).on('change', function () {
        s.enabled = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_inject_rp').prop('checked', s.injectStateOnRp).on('change', function () {
        s.injectStateOnRp = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_show_raw').prop('checked', s.showRawOutput).on('change', function () {
        s.showRawOutput = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_companion').prop('checked', s.companionTracking).on('change', function () {
        s.companionTracking = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_bias').val(s.companionBias).on('input', function () {
        s.companionBias = Number($(this).val()); updateBiasLabel(s.companionBias); saveSettingsDebounced();
    });
    updateBiasLabel(s.companionBias);
    $('#st_if_agency').prop('checked', s.companionAgency).on('change', function () {
        s.companionAgency = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_hud_toggle').prop('checked', s.showHud).on('change', function () {
        s.showHud = $(this).prop('checked'); saveSettingsDebounced();
        document.getElementById('st_if_hud')?.classList.toggle('st_if_hidden', !s.showHud);
    });
    $('#st_if_acts').prop('checked', s.companionActs).on('change', function () {
        s.companionActs = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_initiative').val(s.companionInitiative).on('change', function () {
        s.companionInitiative = String($(this).val()); saveSettingsDebounced();
    });
    $('#st_if_act_safety').val(s.companionActionSafety).on('change', function () {
        s.companionActionSafety = String($(this).val()); saveSettingsDebounced();
    });
    $('#st_if_dynamic_world').prop('checked', s.dynamicWorld).on('change', function () {
        s.dynamicWorld = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#st_if_strictness').val(s.strictness).on('change', function () {
        s.strictness = String($(this).val()); saveSettingsDebounced();
    });
    $('#st_if_depth').val(s.depth).on('input', function () {
        s.depth = Number($(this).val()); saveSettingsDebounced();
    });
    $('#st_if_story_name').text(s.storyName || 'none loaded');

    $('#st_if_story_upload').off('click.st_if').on('click.st_if', () => {
        const el = document.getElementById('st_if_story_file');
        if (el) el.click();   // native click reliably opens the picker for a hidden input
    });
    $('#st_if_story_file').off('change.st_if').on('change.st_if', async function () {
        const file = this.files?.[0];
        if (!file) return;
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            s.storyName = file.name;
            s.storyBase64 = bytesToBase64(bytes);
            saveSettingsDebounced();
            $('#st_if_story_name').text(s.storyName);
            await onStoryLoaded(file.name, bytes);
            toastr.success(`Loaded ${file.name}`, 'ST_IF');
        } catch (e) {
            console.error('[ST_IF] story load failed', e);
            toastr.error(String(e?.message || e), 'ST_IF: story load failed');
        } finally {
            this.value = '';
        }
    });
}
