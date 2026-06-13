// vm.js — wrapper over the ifvms ZVM. No SillyTavern imports.
//
// ifvms (BSD) renders no text itself: it drives a Glk (glkapi, MIT) which drives
// a GlkOte display + Dialog. This file supplies an in-memory headless GlkOte and
// Dialog so the VM can run with no DOM/terminal, exposing a small synchronous
// interface. State snapshots use ZVM's autosave mechanism (do_autosave /
// do_autorestore), captured in-memory via the Dialog and serialized to base64.
//
// The interface (load/step/save/restore/getStatus/loaded) is STABLE — downstream
// modules depend only on it, never on ifvms internals.

import { createGlk } from './lib/glkapi.js';
import ZVM from './lib/zvm.js';
import ZVMDispatch from './lib/dispatch.js';

const METRICS = {
    buffercharheight: 1, buffercharwidth: 1, buffermarginx: 0, buffermarginy: 0,
    graphicsmarginx: 0, graphicsmarginy: 0, gridcharheight: 1, gridcharwidth: 1,
    gridmarginx: 0, gridmarginy: 0, height: 50, inspacingx: 0, inspacingy: 0,
    outspacingx: 0, outspacingy: 0, width: 80,
};

/**
 * Minimal in-memory GlkOte: captures buffer-window text into a string and
 * grid-window (status line) text into rows, and feeds line input on demand.
 * Implements the GlkOte protocol that glkapi calls (see glkote-term for the
 * reference terminal implementation).
 */
class HeadlessGlkOte {
    constructor() {
        this.interface = null;
        this.generation = 0;
        this.current_metrics = METRICS;
        this.buffer = '';
        this.gridlines = {};
        this.bufWindowId = null;
        this.gridWindowId = null;
        this.lineWindowId = null;
        this.lineRequested = false;
    }

    getinterface() { return this.interface; }

    init(iface) {
        if (!iface || !iface.accept) throw new Error('ST_IF GlkOte: missing accept()');
        this.interface = iface;
        // Kicks the VM: runs until the first glk_select (input request).
        this._send('init', null, this.current_metrics);
    }

    update(data) {
        if (data.type === 'error') throw new Error('ST_IF Glk error: ' + data.message);
        if (data.type === 'pass') return;
        if (data.type !== 'update' && data.type !== 'exit') return;
        if (data.gen <= this.generation) { this.generation = data.gen; } else this.generation = data.gen;

        if (data.windows != null) this._updateWindows(data.windows);
        if (data.content != null && data.content.length) this._updateContent(data.content);
        if (data.input != null) this._updateInputs(data.input);
    }

    _updateWindows(windows) {
        windows.forEach((w) => {
            if (w.type === 'buffer') this.bufWindowId = w.id;
            if (w.type === 'grid') this.gridWindowId = w.id;
        });
    }

    _updateContent(content) {
        content.forEach((win) => {
            if (win.id === this.gridWindowId) {
                const lines = this.gridlines[win.id] || [];
                (win.lines || []).forEach((ln) => { lines[ln.line || 0] = this._lineText(ln.content); });
                this.gridlines[win.id] = lines;
                return;
            }
            (win.text || []).forEach((ln) => {
                if (!ln.append) this.buffer += '\n';
                this.buffer += this._lineText(ln.content);
            });
        });
    }

    _lineText(content) {
        if (!content) return '';
        let out = '';
        for (let i = 0; i < content.length; i++) {
            if (typeof content[i] === 'string') { i++; out += content[i]; } else if (content[i] && typeof content[i].text === 'string') out += content[i].text;
        }
        return out;
    }

    _updateInputs(inputs) {
        this.lineRequested = false;
        inputs.forEach((inp) => {
            if (inp.type === 'line') { this.lineRequested = true; this.lineWindowId = inp.id; }
        });
    }

    _send(type, win, val) {
        const res = { type, gen: this.generation };
        if (win) res.window = win.id;
        if (type === 'init') { res.metrics = val; res.support = []; }
        if (type === 'line') res.value = val;
        this.interface.accept(res);
    }

    // GlkOte protocol no-ops (no terminal handlers to manage).
    cancel_inputs() {}
    update_windows() {}
    update_content() {}
    update_inputs() {}
    attach_handlers() {}
    detach_handlers() {}
    disable() {}
    exit() {}
    log() {}
    warning() {}
    error(msg) { throw new Error('ST_IF Glk error: ' + msg); }
    save_allstate() { return { metrics: this.current_metrics }; }
    restore_allstate(s) { if (s && s.metrics) this.current_metrics = s.metrics; }

    // Harness API.
    takeBuffer() { const b = this.buffer; this.buffer = ''; return b; }
    sendLine(cmd) { this._send('line', { id: this.lineWindowId }, cmd); }
    statusText() { return (this.gridlines[this.gridWindowId] || []).join('\n'); }
}

/** In-memory Dialog: captures the autosave snapshot instead of writing to disk. */
class HeadlessDialog {
    constructor(snapshot) { this.streaming = false; this._snap = snapshot ?? null; }
    autosave_write(_sig, snapshot) { this._snap = snapshot; }
    autosave_read(_sig) { return this._snap; }
    log() {}
}

function parseStatus(text) {
    const line = (text || '').split('\n').find((l) => l.trim().length > 0) || '';
    const scoreMatch = line.match(/Score:\s*(-?\d+)/i);
    const movesMatch = line.match(/(?:Moves|Turns):\s*(\d+)/i);
    const cells = line.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    return {
        location: cells[0] || line.trim(),
        score: scoreMatch ? Number(scoreMatch[1]) : null,
        moves: movesMatch ? Number(movesMatch[1]) : null,
    };
}

/** Strip the echoed command line and trailing parser prompt from step output. */
function cleanOutput(text, command) {
    let t = text.replace(/\r/g, '');
    // Drop a leading echo of the command (parser echoes the typed line).
    const lines = t.split('\n');
    while (lines.length && lines[0].trim() === '') lines.shift();
    if (lines.length && lines[0].trim().toLowerCase() === command.trim().toLowerCase()) lines.shift();
    t = lines.join('\n');
    // Drop a trailing ">" prompt.
    t = t.replace(/\n*>\s*$/, '');
    return t.trim();
}

export class IFVM {
    constructor() {
        this._story = null;
        this._glkote = null;
        this._vm = null;
        this._loaded = false;
        this._intro = '';
    }

    _boot(storyBytes, snapshot) {
        const Glk = createGlk();
        const glkote = new HeadlessGlkOte();
        const dialog = new HeadlessDialog(snapshot);
        const vm = new ZVM();
        const options = {
            vm, Glk, GlkOte: glkote, Dialog: dialog, GiDispa: new ZVMDispatch(),
            do_vm_autosave: snapshot ? 1 : 0,
        };
        // Always hand the VM its OWN copy of the bytes: ZVM keeps a live reference
        // to the story buffer for dynamic memory, so two VM instances sharing one
        // ArrayBuffer would corrupt each other (the player and companion VMs do).
        vm.prepare(new Uint8Array(storyBytes), options);
        Glk.init(options);   // synchronously runs the VM to its first input request
        this._glkote = glkote;
        this._dialog = dialog;
        this._vm = vm;
        this._loaded = true;
        const boot = glkote.takeBuffer();   // opening scene (fresh load) or redraw (restore)
        if (!snapshot) this._intro = cleanOutput(boot, '');
    }

    /** Load a story file. bytes: Uint8Array of a .z3/.z5/.z8 file. Resets all state. */
    async load(bytes) {
        this._story = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        this._boot(this._story, null);
        // Force VERBOSE mode so re-entering a visited room still prints the full
        // description (Z-machine defaults to BRIEF: name-only on return). The
        // confirmation ("Maximum verbosity.") is discarded; the intro was already
        // captured during _boot.
        this.ensureVerbose();
    }

    /** The opening scene text captured at load (empty after a restore). */
    getIntro() { return this._intro; }

    /**
     * Re-assert VERBOSE mode. The flag lives in game memory, so restoring a
     * snapshot whose lineage predates verbose-forcing silently reverts to BRIEF
     * (name-only room descriptions on revisit). Idempotent; call after restoring
     * a stored snapshot.
     */
    ensureVerbose() {
        try { this.step('verbose'); } catch { /* game without a verbose verb — ignore */ }
    }

    /** Run one parser command, return the cleaned text the VM emitted. */
    step(command) {
        if (!this._loaded) throw new Error('ST_IF: no story loaded');
        this._glkote.takeBuffer();
        this._glkote.sendLine(String(command));
        return cleanOutput(this._glkote.takeBuffer(), String(command));
    }

    /**
     * Run a command and roll the VM back: returns the command's output with zero
     * net game effect (the restore rewinds everything, move counter included).
     * Used for read-only queries like 'inventory'.
     */
    query(command) {
        if (!this._loaded) throw new Error('ST_IF: no story loaded');
        const snap = this.save();
        const out = this.step(command);
        this.restore(snap);
        return out;
    }

    /**
     * Push engine world-edit meta-commands (xroom/xdesc/xobj/xodesc) into the VM
     * in order. Each is a normal step that mutates the pool's dynamic memory.
     * Never throws on a single bad command; returns the concatenated output.
     */
    applyWorldEdits(cmds) {
        let out = '';
        for (const c of cmds) {
            try { out += this.step(c) + '\n'; } catch { out += `[edit failed: ${c}]\n`; }
        }
        return out;
    }

    /**
     * True if the loaded story includes the expanse pool (understands `xroom`).
     * Probed with zero net effect via save/restore. Plain stories reject the verb.
     */
    isExpandable() {
        if (!this._loaded) return false;
        const snap = this.save();
        const out = this.step('xroom north probe');
        this.restore(snap);
        return /xroom ok|no-free-room/i.test(out);
    }

    /** Serialize full VM state to a base64 string. */
    save() {
        if (!this._loaded) throw new Error('ST_IF: no story loaded');
        this._vm.do_autosave(1);
        return btoa(JSON.stringify(this._dialog._snap));
    }

    /** Restore VM state from a base64 string produced by save(). */
    restore(snapshot) {
        const snap = JSON.parse(atob(snapshot));
        this._boot(this._story, snap);
    }

    /** Read the status line: { location, score, moves }. */
    getStatus() {
        if (!this._loaded) throw new Error('ST_IF: no story loaded');
        return parseStatus(this._glkote.statusText());
    }

    /** True once a story is loaded and runnable. */
    get loaded() { return this._loaded; }
}
