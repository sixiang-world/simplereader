/**
 * @fileoverview Traditional → Simplified Chinese conversion (T2S).
 *
 * Provides two mutually-exclusive checkbox settings:
 *
 *   - **light**: A pure-JS character-level lookup against a static
 *     JSON table (~800+ common one-to-one pairs). Fast, no network
 *     dependency. Does NOT do vocabulary conversion (詞彙→词汇).
 *
 *   - **heavy**: OpenCC Wasm. Vocabulary-level conversion with
 *     accurate one-to-many resolution. ~1MB lazy-loaded on first use.
 *
 * == Setting schema ==
 *
 * Controlled by two settings (defined in settings-schema.js):
 *   - `t2s_lite` : boolean  (default: true)  — char-level JSON map
 *   - `t2s_pro`  : boolean  (default: false) — OpenCC Wasm
 *
 * Both false = no conversion; either true = conversion + auto-detect.
 * If both are true (e.g. from an old share config), 	2s_lite wins.
 *
 * == Hook integration ==
 *
 * This module registers a `file:afterProcess` hook that:


 *   2. If both lite and pro are off, returns the bookData unchanged.
 *   3. Samples the bookData text to check whether it actually contains
 *      traditional characters. If not, skips conversion (saves OpenCC load).

 *   4. Otherwise, runs the configured converter on the bookData text
 *      content and returns the (mutated) bookData.
 *
 * == What gets converted ==
 *
 * The hook walks `bookData` looking for text content in:
 *   - `bookData.metadata.title` / `bookData.metadata.author`
 *   - `bookData.processedLines[]` — supports BOTH shapes:
 *       - plain HTML strings (legacy / build-time title & end page)
 *       - objects `{type, tag, content, dropCap?}` (modern client worker
 *         output from TextProcessorCore.process). The `.content` field
 *         is converted in place; if present, `.dropCap.content` is too.
 *   - `bookData.titles[]` — supports BOTH shapes:
 *       - arrays `[text, lineNumber, shortestTitle?, isCustomOnly?]`
 *         (FileProcessorCore output)
 *       - objects `{text, line, label?}` (EpubConverter output)
 *   - `bookData.footnotes[]` — objects with `.content` / `.text` /
 *     `.original` fields.
 *
 * HTML inside `processedLines[].content` is converted character-by-
 * character; the markup tags themselves are ASCII and won't be touched
 * by either converter.
 *
 * @module client/src/core/t2s
 */

import { hooks } from "./hooks.js";

// Light-mode mapping table. Loaded synchronously — it's only ~25KB.
// Using `import.meta.url`-relative path so Vite can bundle it.
import T2S_MAP from "./t2s-map.json" with { type: "json" };

// Heavy-mode loader (lazy).
import { getConverter as getOpenCCConverter } from "./t2s-opencc.js";

// localStorage keys (mirrors settings-schema.js).
const SETTING_KEY_LITE = "t2s_lite";
const SETTING_KEY_PRO = "t2s_pro";

/**
 * Read the current T2S settings. Reads directly from localStorage so
 * the hook works even before settings.js is fully initialized.
 *
 * Both false = no conversion; either true = conversion + auto-detect.
 * If both are true (e.g. from an old share config), lite wins.
 *
 * @returns {{ lite: boolean, pro: boolean }}
 * @private
 */
function _readSettings() {
    let lite = true;   // default: lite on
    let pro = false;
    try {
        const storedLite = localStorage.getItem(SETTING_KEY_LITE);
        if (storedLite === "false" || storedLite === "0") lite = false;
        const storedPro = localStorage.getItem(SETTING_KEY_PRO);
        if (storedPro === "true" || storedPro === "1") pro = true;
        // If both are true (e.g. old share config), lite wins
        if (lite && pro) pro = false;
    } catch (_e) {
        // localStorage unavailable (SSR / restricted context).
    }
    return { lite, pro };
}

/**
 * Convert a string using light-mode character mapping.
 *
 * Walks the input character-by-character, replacing each char that
 * exists in T2S_MAP with its simplified form. Non-mapped characters
 * (including ASCII, markup tags, punctuation) pass through unchanged.
 *
 * @param {string} text
 * @returns {string}
 * @public
 */
export function convertLight(text) {
    if (typeof text !== "string" || text.length === 0) return text;
    // Build an array of parts and join at the end. This avoids the
    // potential O(n²) of repeated string += concatenation on engines
    // that don't optimize it (and is faster even on V8 for large texts).
    const parts = new Array(text.length);
    let i = 0;
    for (const ch of text) {
        parts[i++] = T2S_MAP[ch] ?? ch;
    }
    return parts.join("");
}

/**
 * Convert a string using heavy-mode OpenCC.
 *
 * Lazy-loads OpenCC on first call. If OpenCC fails to load (network
 * error, CDN unreachable), falls back to light mode and logs a warning.
 *
 * @param {string} text
 * @returns {Promise<string>}
 * @public
 */
export async function convertHeavy(text) {
    if (typeof text !== "string" || text.length === 0) return text;
    try {
        const conv = await getOpenCCConverter({ direction: "t2s" });
        return conv.convert(text);
    } catch (err) {
        console.warn("[t2s] Heavy mode failed, falling back to light:", err.message);
        return convertLight(text);
    }
}

/**
 * Heuristic: does this text contain traditional Chinese characters?
 *
 * Samples up to 1000 chars and checks if any of them are in T2S_MAP
 * as a key (i.e. a traditional-only character). If at least one is
 * found, returns true.
 *
 * Used by the auto-detect path to skip conversion for books that are
 * already in simplified form.
 *
 * @param {string} text
 * @returns {boolean}
 * @public
 */
export function containsTraditional(text) {
    if (typeof text !== "string" || text.length === 0) return false;
    // Sample up to 1000 chars spread across the text.
    //
    // The step calculation ensures we visit at most ~1000 characters
    // regardless of input size:
    //   - text.length <= 1000: step = 1, visit all chars (≤1000 visits)
    //   - text.length > 1000: step = ceil(length/1000), visit ~1000 chars
    //
    // The previous formula (Math.floor(length/sampleSize)) had an edge
    // case where text.length in [1001, 1999] produced step=1, causing
    // up to 1999 iterations instead of the documented ~1000.
    const targetSamples = Math.min(text.length, 1000);
    const step = Math.max(1, Math.ceil(text.length / targetSamples));
    for (let i = 0; i < text.length; i += step) {
        if (T2S_MAP[text[i]]) return true;
    }
    return false;
}

/**
 * Walk a bookData object and apply a string-converter to all text fields.
 *
 * This is the workhorse for the `file:afterProcess` hook. It mutates
 * `bookData` in place (the hook contract allows mutation).
 *
 * @param {Object} bookData - The book data object from file-processor.
 * @param {(s: string) => string | Promise<string>} convertFn - Converter.
 * @returns {Promise<Object>} The same bookData (mutated).
 * @private
 */
async function _walkAndConvert(bookData, convertFn) {
    if (!bookData || typeof bookData !== "object") return bookData;

    // Metadata
    if (bookData.metadata) {
        if (typeof bookData.metadata.title === "string") {
            bookData.metadata.title = await convertFn(bookData.metadata.title);
        }
        if (typeof bookData.metadata.author === "string") {
            bookData.metadata.author = await convertFn(bookData.metadata.author);
        }
    }

    // Processed HTML lines. Entries can be either:
    //   - Plain strings (legacy / build-time title & end page HTML)
    //   - Objects with a `.content` string field (modern client worker output;
    //     see TextProcessorCore.process which returns {type, tag, content, ...}).
    //     Some paragraph objects also have a `.dropCap.content` field for the
    //     drop-cap letter, which should also be converted.
    if (Array.isArray(bookData.processedLines)) {
        for (let i = 0; i < bookData.processedLines.length; i++) {
            const line = bookData.processedLines[i];
            if (typeof line === "string") {
                bookData.processedLines[i] = await convertFn(line);
            } else if (line && typeof line === "object") {
                if (typeof line.content === "string") {
                    line.content = await convertFn(line.content);
                }
                // dropCap.content is the initial letter(s) rendered as a
                // drop cap. It may contain a trad char so convert it too.
                if (line.dropCap && typeof line.dropCap.content === "string") {
                    line.dropCap.content = await convertFn(line.dropCap.content);
                }
            }
        }
    }

    // TOC titles. The title entries come in two shapes:
    //   - Arrays: [text, lineNumber, shortestTitle, isCustomOnly]
    //     (used by FileProcessorCore.processChunkStatic)
    //   - Objects: { text, line, ... }
    //     (used by EpubConverter; also defensive against future shape changes)
    if (Array.isArray(bookData.titles)) {
        for (const t of bookData.titles) {
            if (Array.isArray(t)) {
                // [text, lineNumber, shortestTitle?, isCustomOnly?]
                if (typeof t[0] === "string") t[0] = await convertFn(t[0]);
                if (typeof t[2] === "string") t[2] = await convertFn(t[2]);
            } else if (t && typeof t === "object") {
                if (typeof t.text === "string") t.text = await convertFn(t.text);
                if (typeof t.label === "string") t.label = await convertFn(t.label);
                if (typeof t.line === "string") t.line = await convertFn(t.line);
            }
        }
    }

    // Footnotes
    if (Array.isArray(bookData.footnotes)) {
        for (const f of bookData.footnotes) {
            if (f && typeof f === "object") {
                if (typeof f.text === "string") f.text = await convertFn(f.text);
                if (typeof f.content === "string") f.content = await convertFn(f.content);
                if (typeof f.original === "string") f.original = await convertFn(f.original);
            }
        }
    }

    return bookData;
}

/**
 * Sample a representative slice of the bookData text content for
 * auto-detection. Combines the first few processed lines + the title.
 *
 * processedLines entries can be either:
 *   - Plain strings (legacy / build-time title & end page HTML)
 *   - Objects {type, tag, content, ...} (modern client worker output;
 *     see TextProcessorCore.process)
 *
 * We extract the `.content` field from object entries. Pushing the raw
 * object into the parts array would produce "[object Object]" after
 * join(" "), causing containsTraditional to always return false and
 * auto-detect to silently skip conversion for trad books.
 *
 * @param {Object} bookData
 * @returns {string}
 * @private
 */
function _sampleForDetection(bookData) {
    const parts = [];
    if (bookData?.metadata?.title) parts.push(bookData.metadata.title);
    if (Array.isArray(bookData?.processedLines)) {
        // First 20 lines is enough for detection.
        for (let i = 0; i < Math.min(20, bookData.processedLines.length); i++) {
            const line = bookData.processedLines[i];
            if (typeof line === "string") {
                parts.push(line);
            } else if (line && typeof line === "object" && typeof line.content === "string") {
                // Modern TextProcessorCore.process output shape — extract
                // the .content field which holds the actual HTML/text.
                parts.push(line.content);
            }
            // Entries that are neither string nor {content:string} are
            // silently skipped — they don't contribute detectable text.
        }
    }
    return parts.join(" ");
}

/**
 * The file:afterProcess hook handler.
 *
 * Reads current settings, decides whether to convert, and applies the
 * chosen converter to the bookData text fields.
 *
 * @param {Object} ctx - Hook context: `{ bookData, file }`.
 * @returns {Promise<Object>} The (possibly mutated) context.
 * @private
 */
async function _fileAfterProcessHook(ctx) {
    if (!ctx || !ctx.bookData) return ctx;
    const { lite, pro } = _readSettings();
    // Both off = no conversion
    if (!lite && !pro) return ctx;

    // Auto-detect is implicit when either mode is enabled.
    // Skip if no traditional characters present.
    const sample = _sampleForDetection(ctx.bookData);
    if (!containsTraditional(sample)) return ctx;

    if (lite) {
        await _walkAndConvert(ctx.bookData, convertLight);
    } else if (pro) {
        await _walkAndConvert(ctx.bookData, convertHeavy);
    }

    return ctx;
}

/** @type {symbol|null} Hook registration token. */
let _hookToken = null;

/**
 * Register the T2S hook with the hook registry.
 *
 * Call this once at app boot. The hook will read the current settings
 * on every file:afterProcess invocation, so the user can switch modes
 * at runtime without re-registering.
 *
 * Safe to call multiple times — re-registration replaces the previous
 * token.
 *
 * @public
 */
export function registerT2SHook() {
    if (_hookToken) {
        hooks.unregister(_hookToken);
        _hookToken = null;
    }
    _hookToken = hooks.register("file:afterProcess", _fileAfterProcessHook, {
        priority: 100,
    });
    return _hookToken;
}

/**
 * Unregister the T2S hook. Mainly for tests.
 * @public
 */
export function unregisterT2SHook() {
    if (_hookToken) {
        hooks.unregister(_hookToken);
        _hookToken = null;
    }
}

/**
 * Set the T2S mode (mutually exclusive).
 *
 * This is the canonical way to switch modes — it writes the setting
 * to localStorage so it persists across sessions, and the hook reads
 * the same key.
 *
 * @param {"off"|"light"|"heavy"} mode
 * @public
 */
export function setLite(enabled) {
    if (enabled) {
        // Lite enabled -> ensure pro is off
        try { localStorage.setItem(SETTING_KEY_PRO, "false"); } catch (_) {}
    }
    try {
        localStorage.setItem(SETTING_KEY_LITE, enabled ? "true" : "false");
    } catch (e) {
        console.warn("[t2s] Failed to persist lite mode:", e);
    }
}

/**
 * Enable or disable pro mode.
 * @param {boolean} enabled
 * @public
 */
export function setPro(enabled) {
    if (enabled) {
        // Pro enabled -> ensure lite is off
        try { localStorage.setItem(SETTING_KEY_LITE, "false"); } catch (_) {}
    }
    try {
        localStorage.setItem(SETTING_KEY_PRO, enabled ? "true" : "false");
    } catch (e) {
        console.warn("[t2s] Failed to persist pro mode:", e);
    }
}

/**
 * Check if lite mode is enabled.
 * @returns {boolean}
 * @public
 */
export function isLite() {
    return _readSettings().lite;
}

/**
 * Check if pro mode is enabled.
 * @returns {boolean}
 * @public
 */
export function isPro() {
    return _readSettings().pro;
}

// Export the raw map for tests that want to inspect it.
export const T2S_MAP_EXPORTED = T2S_MAP;

