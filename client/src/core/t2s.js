/**
 * @fileoverview Traditional → Simplified Chinese conversion (T2S).
 *
 * Provides two mutually-exclusive conversion modes:
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
 *   - `t2s_mode`        : "off" | "light" | "heavy"   (default: "off")
 *   - `t2s_auto_detect` : boolean                      (default: true)
 *
 * Mode switching is mutually exclusive — selecting "light" disables
 * "heavy" and vice versa. Setting to "off" disables both.
 *
 * == Hook integration ==
 *
 * This module registers a `file:afterProcess` hook that:
 *   1. Reads the current T2S settings (from localStorage, since
 *      settings.js is the source of truth for runtime config).
 *   2. If `t2s_mode === "off"`, returns the bookData unchanged.
 *   3. If `t2s_auto_detect === true`, samples the bookData text to
 *      check whether it actually contains traditional characters.
 *      If not, skips conversion (saves the OpenCC load).
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
const SETTING_KEY_MODE = "t2s_mode";
const SETTING_KEY_AUTO_DETECT = "t2s_auto_detect";

/**
 * Read the current T2S settings. Reads directly from localStorage so
 * the hook works even before settings.js is fully initialized.
 *
 * @returns {{ mode: "off"|"light"|"heavy", autoDetect: boolean }}
 * @private
 */
function _readSettings() {
    let mode = "off";
    let autoDetect = true;
    try {
        const stored = localStorage.getItem(SETTING_KEY_MODE);
        if (stored === "light" || stored === "heavy") mode = stored;
        const ad = localStorage.getItem(SETTING_KEY_AUTO_DETECT);
        if (ad === "false" || ad === "0") autoDetect = false;
    } catch (_e) {
        // localStorage unavailable (SSR / restricted context).
    }
    return { mode, autoDetect };
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
    let out = "";
    for (const ch of text) {
        out += T2S_MAP[ch] ?? ch;
    }
    return out;
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
    const sampleSize = Math.min(text.length, 1000);
    const step = Math.max(1, Math.floor(text.length / sampleSize));
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
            parts.push(bookData.processedLines[i]);
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
    const { mode, autoDetect } = _readSettings();
    if (mode === "off") return ctx;

    // Auto-detect: skip if no traditional characters present.
    if (autoDetect) {
        const sample = _sampleForDetection(ctx.bookData);
        if (!containsTraditional(sample)) return ctx;
    }

    if (mode === "light") {
        await _walkAndConvert(ctx.bookData, convertLight);
    } else if (mode === "heavy") {
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
export function setMode(mode) {
    if (mode !== "off" && mode !== "light" && mode !== "heavy") {
        throw new Error(`[t2s] Invalid mode "${mode}". Must be "off", "light", or "heavy".`);
    }
    try {
        localStorage.setItem(SETTING_KEY_MODE, mode);
    } catch (e) {
        console.warn("[t2s] Failed to persist mode:", e);
    }
}

/**
 * Enable or disable auto-detection.
 * @param {boolean} enabled
 * @public
 */
export function setAutoDetect(enabled) {
    try {
        localStorage.setItem(SETTING_KEY_AUTO_DETECT, enabled ? "true" : "false");
    } catch (e) {
        console.warn("[t2s] Failed to persist auto-detect:", e);
    }
}

/**
 * Get the current mode. Reads from localStorage.
 * @returns {"off"|"light"|"heavy"}
 * @public
 */
export function getMode() {
    return _readSettings().mode;
}

/**
 * Get the current auto-detect setting.
 * @returns {boolean}
 * @public
 */
export function getAutoDetect() {
    return _readSettings().autoDetect;
}

// Export the raw map for tests that want to inspect it.
export const T2S_MAP_EXPORTED = T2S_MAP;
