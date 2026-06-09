// settings.js — extension_settings.ST_IF defaults, UI wiring, story upload to base64.
import { extension_settings } from '../../extensions.js';
import { saveSettingsDebounced } from '../../../script.js';

export const MODULE = 'ST_IF';

export const defaultSettings = {
    enabled: false,
    injectStateOnRp: false,
    strictness: 'strict',
    depth: 1,
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

function bytesToBase64(bytes) {
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
    $('#st_if_strictness').val(s.strictness).on('change', function () {
        s.strictness = String($(this).val()); saveSettingsDebounced();
    });
    $('#st_if_depth').val(s.depth).on('input', function () {
        s.depth = Number($(this).val()); saveSettingsDebounced();
    });
    $('#st_if_story_name').text(s.storyName || 'none loaded');

    $('#st_if_story_upload').on('click', () => $('#st_if_story_file').trigger('click'));
    $('#st_if_story_file').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        const bytes = new Uint8Array(await file.arrayBuffer());
        s.storyName = file.name;
        s.storyBase64 = bytesToBase64(bytes);
        saveSettingsDebounced();
        $('#st_if_story_name').text(s.storyName);
        await onStoryLoaded(file.name, bytes);
        this.value = '';
    });
}
