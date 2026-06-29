/**
 * @fileoverview Hook system for the SimpleReader client.
 *
 * This module provides a typed, ordered, async-aware hook pipeline that
 * future features can plug into WITHOUT modifying the call sites. It is
 * intentionally separate from the existing cbReg event bus — cbReg is
 * a generic pub/sub used heavily throughout the codebase for module
 * coordination; the hook system is specifically for *transform pipelines*
 * where each registered hook can mutate a value before passing it on.
 *
 * == Why not just use cbReg? ==
 *
 * cbReg's `fire()` returns a Promise that resolves to the *last* callback's
 * return value (in chain mode), which works for simple cases but has two
 * problems for a real hook pipeline:
 *
 *   1. There is no way to distinguish "transform this value" hooks from
 *      "side-effect notification" hooks. A typo can silently turn a
 *      transform into a notification, eating the value.
 *   2. cbReg has no concept of "stop processing" — once a topic fires,
 *      every registered callback runs. A hook pipeline needs the ability
 *      to short-circuit (e.g. a `file:beforeProcess` hook that rejects
 *      an unsupported file type should skip downstream processing).
 *
 * The hook system here addresses both: hooks are explicitly typed as
 * "transform" (must return a value) or "intercept" (can abort), and the
 * pipeline stops on the first intercept.
 *
 * == Hook points reserved for future features (not yet wired up) ==
 *
 * The following hook names are reserved by the v2 refactor for planned
 * future features. They are NOT yet fired anywhere in the codebase —
 * registering a hook for them today is a no-op. When the corresponding
 * feature is implemented, the feature author is expected to:
 *
 *   1. Add a `hooks.run(...)` call at the appropriate point in the
 *      relevant module (e.g. file-handler.js, reader.js).
 *   2. Document the hook's contract (input type, expected return type)
 *      in this file's "Hook contracts" section below.
 *
 * Reserved hook names:
 *   - file:beforeProcess   — fired before a File is processed. Hook receives
 *                            { file: File } and may return a transformed
 *                            File (e.g. re-encoded) or null to abort.
 *   - file:afterProcess    — fired after a File is processed into book
 *                            data. Hook receives { bookData, file } and
 *                            may return transformed bookData.
 *                            (Note: this name collides with the existing
 *                            cbReg "fileAfter" event — they are DIFFERENT.
 *                            The cbReg event is a side-effect notification;
 *                            this hook is a transform. Renaming the cbReg
 *                            event is left for a future cleanup pass.)
 *   - reader:beforeRender  — fired before book content is rendered to the
 *                            DOM. Hook receives { bookData, contentEl }.
 *   - reader:afterRender   — fired after book content is rendered.
 *
 * == Existing cbReg events that should eventually migrate to hooks ==
 *
 * The existing `cbReg.add("fileBefore", ...)` / `cbReg.go("fileBefore", file)`
 * pattern in file-handler.js is conceptually a `file:beforeProcess` hook
 * but uses cbReg's chain mode. Migrating it to the hook system would
 * give us explicit abort semantics and better typing. This is left as
 * future work — the migration touches 4+ files and would need careful
 * testing of the bookshelf's fileBefore listener (which saves the file
 * to IndexedDB before downstream processing sees it).
 *
 * == Usage ==
 *
 *   import { hooks } from "./core/hooks.js";
 *
 *   // Register a transform hook (must return a value)
 *   const token = hooks.register("file:afterProcess", async (ctx) => {
 *       ctx.bookData.metadata.title = ctx.bookData.metadata.title.trim();
 *       return ctx;  // return the (possibly mutated) context
 *   });
 *
 *   // Run a hook pipeline
 *   const result = await hooks.run("file:afterProcess", { bookData, file });
 *
 *   // Unregister
 *   hooks.unregister(token);
 *
 * @module client/src/core/hooks
 */

/**
 * @typedef {Object} HookToken
 * @property {string} name - The hook name.
 * @property {number} priority - Lower = earlier in the pipeline. Defaults to 100.
 * @property {Function} fn - The hook function.
 * @property {boolean} once - If true, the hook auto-unregisters after one run.
 */

/**
 * @typedef {"transform"|"intercept"} HookKind
 * - "transform": the hook MUST return a value (the mutated context).
 *   Returning undefined is a bug and will be logged.
 * - "intercept": the hook MAY return false/null to abort the pipeline.
 *   Aborting prevents downstream hooks from running and causes run()
 *   to return the last non-abort value (or null if no hook ran).
 */

/**
 * HookRegistry manages a collection of named hooks.
 *
 * Each hook name has a sorted list of {priority, fn, once} entries.
 * `run()` invokes them in priority order, threading the context through.
 */
class HookRegistry {
    constructor() {
        /** @type {Map<string, HookToken[]>} */
        this._hooks = new Map();
        /** @type {number} Counter for generating unique tokens. */
        this._nextId = 1;
    }

    /**
     * Register a hook.
     *
     * @param {string} name - The hook name (e.g. "file:afterProcess").
     * @param {Function} fn - The hook function. Receives the context,
     *                        must return the (possibly mutated) context
     *                        for transform hooks, or false/null to abort
     *                        for intercept hooks.
     * @param {Object} [opts]
     * @param {number} [opts.priority=100] - Lower runs earlier.
     * @param {boolean} [opts.once=false] - Auto-unregister after one run.
     * @returns {symbol} Opaque token for use with unregister().
     */
    register(name, fn, opts = {}) {
        const priority = opts.priority ?? 100;
        const once = opts.once ?? false;
        const token = Symbol(`hook_${this._nextId++}`);
        const entry = { name, priority, fn, once, token };
        const list = this._hooks.get(name) ?? [];
        list.push(entry);
        // Sort by priority (stable for equal priorities via insertion order)
        list.sort((a, b) => a.priority - b.priority);
        this._hooks.set(name, list);
        return token;
    }

    /**
     * Unregister a hook by its token.
     *
     * @param {symbol} token - The token returned by register().
     * @returns {boolean} True if a hook was removed.
     */
    unregister(token) {
        for (const [name, list] of this._hooks.entries()) {
            const idx = list.findIndex((e) => e.token === token);
            if (idx !== -1) {
                list.splice(idx, 1);
                if (list.length === 0) this._hooks.delete(name);
                return true;
            }
        }
        return false;
    }

    /**
     * Run a hook pipeline.
     *
     * Each registered hook is invoked in priority order with the current
     * context. For transform hooks, the return value replaces the context
     * for the next hook. For intercept hooks, returning false/null aborts
     * the pipeline.
     *
     * Hooks that throw are logged and skipped (the pipeline continues with
     * the previous context). This is intentional — a misbehaving hook
     * should not crash the host feature.
     *
     * @param {string} name - The hook name.
     * @param {*} initialCtx - The initial context passed to the first hook.
     * @returns {Promise<*>} The final context after all hooks have run,
     *                       or null if the pipeline was aborted.
     */
    async run(name, initialCtx) {
        const list = this._hooks.get(name);
        if (!list || list.length === 0) return initialCtx;

        let ctx = initialCtx;
        // Iterate over a snapshot so once-hooks can safely mutate the list.
        const snapshot = list.slice();
        for (const entry of snapshot) {
            try {
                const result = await entry.fn(ctx);
                if (result === false || result === null || result === undefined) {
                    // Intercept: abort the pipeline.
                    if (result === undefined) {
                        // Transform hook that forgot to return — log but don't abort.
                        console.warn(
                            `[hooks] Hook "${name}" (priority ${entry.priority}) returned undefined. ` +
                                `Transform hooks must return the (possibly mutated) context. ` +
                                `Treating as no-op.`
                        );
                        continue;
                    }
                    // Explicit abort
                    return null;
                }
                ctx = result;
            } catch (err) {
                console.error(`[hooks] Hook "${name}" threw:`, err);
                // Continue with the previous context.
            }
            if (entry.once) {
                this.unregister(entry.token);
            }
        }
        return ctx;
    }

    /**
     * List all registered hook names. Useful for debugging.
     * @returns {string[]}
     */
    names() {
        return Array.from(this._hooks.keys());
    }

    /**
     * Get the count of registered hooks for a name.
     * @param {string} name
     * @returns {number}
     */
    count(name) {
        return this._hooks.get(name)?.length ?? 0;
    }

    /**
     * Remove all hooks. Mainly for tests.
     */
    clear() {
        this._hooks.clear();
    }
}

/**
 * Singleton hook registry. Import this and call .register() / .run().
 * @type {HookRegistry}
 */
export const hooks = new HookRegistry();

// Export the class for tests that want a fresh instance.
export { HookRegistry };
