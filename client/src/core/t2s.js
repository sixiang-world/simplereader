/** Single offline OpenCC display transform. Parsed caches always retain originals. */
import { hooks } from "./hooks.js";
import { getConverter } from "./t2s-opencc.js";
let _settingsProvider = null;

export function readT2SEnabled(storage = localStorage) {
    const current = storage.getItem("t2s_enabled");
    if (current !== null) return current === "true" || current === "1";
    const lite = storage.getItem("t2s_lite");
    const pro = storage.getItem("t2s_pro");
    return (lite !== "false" && lite !== "0") || pro === "true" || pro === "1";
}

async function _fileAfterProcessHook(ctx) {
    if (!ctx?.bookData) return ctx;
    const effective = _settingsProvider?.();
    const enabled = effective == null ? readT2SEnabled() : effective.enabled ?? (effective.lite || effective.pro);
    if (!enabled) return ctx;
    try {
        const converter = await getConverter();
        const bookData = structuredClone(ctx.bookData);
        await _walkAndConvert(bookData, text => converter.convert(text));
        return { ...ctx, bookData };
    } catch (error) {
        console.warn("[t2s] Conversion unavailable; displaying original text", error);
        return ctx;
    }
}

async function _convertImageBlockText(html, convertFn) {
    if (!html) return html;
    // Convert figcaption text content
    html = await _replaceAsync(html, /(<figcaption[^>]*>)([\s\S]*?)(<\/figcaption>)/gi,
        async (_m, open, inner, close) => open + (await convertFn(inner)) + close);
    // Convert alt and title attribute values
    html = await _replaceAsync(html, /\b(alt|title)="([^"]*)"/gi,
        async (_m, attr, val) => `${attr}="${await convertFn(val)}"`);
    return html;
}

/**
 * Async-aware String.replace with a callback that returns a Promise.
 * @param {string} str
 * @param {RegExp} regex
 * @param {(match: string, ...groups: string[]) => Promise<string>} replacer
 * @returns {Promise<string>}
 * @private
 */
async function _replaceAsync(str, regex, replacer) {
    const parts = [];
    let lastIndex = 0;
    for (const match of str.matchAll(regex)) {
        parts.push(str.slice(lastIndex, match.index));
        parts.push(await replacer(...match));
        lastIndex = match.index + match[0].length;
    }
    parts.push(str.slice(lastIndex));
    return parts.join("");
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
                // Image blocks: convert only the human-readable text
                // (figcaption text, alt attributes) and skip base64 data URLs.
                if (line.type === "image") {
                    if (typeof line.content === "string") {
                        line.content = await _convertImageBlockText(line.content, convertFn);
                    }
                    continue;
                }
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

    if (bookData.footnoteMap) {
        for (const [key, text] of Object.entries(bookData.footnoteMap)) {
            if (typeof text === "string") bookData.footnoteMap[key] = await convertFn(text);
        }
    }
    return bookData;
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
export function registerT2SHook(settingsProvider = null) {
    _settingsProvider = settingsProvider;
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
    _settingsProvider = null;
    if (_hookToken) {
        hooks.unregister(_hookToken);
        _hookToken = null;
    }
}

