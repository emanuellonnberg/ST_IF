// vm.js — wrapper over the ifvms ZVM. No SillyTavern imports.
//
// STATUS: interface stub. The real implementation lands in the "Glk harness"
// spike (see the plan). ifvms (MIT) renders no text itself — it drives a full
// Glk (glkapi) -> GlkOte display + Dialog. A working wrapper must supply a
// headless GlkOte + Dialog. Until then these methods throw so any accidental
// use surfaces loudly rather than silently no-opping.
//
// The interface below is STABLE — downstream modules (turn.js, index.js) depend
// only on it, never on ifvms internals.

const NOT_IMPLEMENTED = 'ST_IF: VM wrapper not implemented yet (Glk harness spike pending)';

export class IFVM {
    /** Load a story file. bytes: Uint8Array of a .z5/.z8 file. Resets all state. */
    // eslint-disable-next-line no-unused-vars
    async load(bytes) { throw new Error(NOT_IMPLEMENTED); }

    /** Run one parser command, return the text the VM emitted in response. */
    // eslint-disable-next-line no-unused-vars
    step(command) { throw new Error(NOT_IMPLEMENTED); }

    /** Serialize full VM state to a base64 string (snapshot-backed). */
    save() { throw new Error(NOT_IMPLEMENTED); }

    /** Restore VM state from a base64 string produced by save(). */
    // eslint-disable-next-line no-unused-vars
    restore(snapshot) { throw new Error(NOT_IMPLEMENTED); }

    /** Read the status line. Returns { location: string, score: number|null, moves: number|null }. */
    getStatus() { throw new Error(NOT_IMPLEMENTED); }

    /** True once a story is loaded and runnable. */
    get loaded() { return false; }
}
