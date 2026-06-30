/**
 * @fileoverview OpenCC loader for heavy-mode traditional→simplified
 * Chinese conversion.
 *
 * OpenCC (https://github.com/BYVoid/OpenCC) is the de-facto standard
 * library for Chinese conversion with vocabulary-level accuracy.
 * The `opencc-js` package (https://github.com/nk2028/opencc-js)
 * provides a browser-compatible UMD build that bundles the dictionary
 * data (~560KB minified).
 *
 * This module lazily loads OpenCC on first use — it does NOT block app
 * boot. The script is fetched on demand from a CDN (jsDelivr) and
 * cached for the session. Subsequent calls reuse the cached instance.
 *
 * == Why lazy loading? ==
 *
 * The opencc-js full bundle is ~560KB. Loading it eagerly would add
 * ~560KB to the initial page weight and ~100-300ms of parse time.
 * Most users never need trad→simp conversion. Lazy loading keeps the
 * common path fast.
 *
 * == CDN fallback ==
 *
 * If the CDN is unreachable, conversion will fail gracefully (the hook
 * falls back to light mode, which is character-level only). This is
 * documented in the t2s module's contract.
 *
 * == Configuration ==
 *
 * We use OpenCC.Converter({ from: 'tw', to: 'cn' }) which performs:
 *   - Character-level conversion (same as light mode)
 *   - Vocabulary-level conversion (e.g. 詞彙 → 词汇, 軟體 → 软件)
 *   - Idiom conversion (e.g. 一網打盡 → 一网打尽)
 *
 * @module client/src/core/t2s-opencc
 */

// CDN URL for the opencc-js package. We use jsDelivr as it has good
// global availability. The version is pinned for reproducibility.
//
// URL selection notes (P0-5 fix):
//   - The package is `opencc-js` (NOT `opencc-wasm` — the file overview
//     comment above mentions opencc-wasm, but the actual npm package we
//     load is opencc-js, which is the de-facto browser build of OpenCC).
//   - Version 1.0.5 (the previously-pinned version) does NOT exist on
//     npm. The actual published versions are 0.0.x, 0.1.x, 0.2.0, and
//     1.3.2 (latest as of 2024-12). Pinning a non-existent version made
//     the loader always 404, so heavy mode always fell back to light.
//   - The file path is `dist/umd/full.js`, NOT `dist/umd/index.js`.
//     The umd/ directory contains three files: t2cn.js, cn2t.js, full.js.
//     Only full.js bundles the dictionary data and exports the full
//     OpenCC.Converter factory. The other two are partial builds that
//     only do one direction and need a separate dictionary fetch.
//   - Verified 200 OK + ~559KB size + exports `Converter` as of 2024-12.
const OPENCC_JS_CDN = "https://cdn.jsdelivr.net/npm/opencc-js@1.3.2/dist/umd/full.js";

/** @type {Promise<any>|null} Cached loader promise. */
let _loaderPromise = null;

/** @type {any|null} Cached converter instance. */
let _converter = null;

/**
 * Browser-friendly dynamic import shim. Uses `import()` if available,
 * falls back to injecting a `<script>` tag for legacy environments.
 *
 * The opencc-js UMD bundle exposes a global `OpenCC` after the script
 * loads. We wrap it in a Promise for ergonomics.
 *
 * @returns {Promise<any>} Resolves to the OpenCC namespace.
 * @private
 */
async function _loadOpenCC() {
    // Try dynamic import first (works for ESM-aware bundlers + Vite's
    // import-attribute transpilation). The @vite-ignore comment tells
    // Vite not to try to bundle this URL at build time — it's a runtime
    // fetch from a CDN.
    if (typeof globalThis.import === "function") {
        try {
            const mod = await import(/* @vite-ignore */ OPENCC_JS_CDN);
            if (mod && (mod.Converter || mod.default)) {
                return mod.default ?? mod;
            }
        } catch (_e) {
            // Fall through to script-tag injection.
        }
    }

    // Fallback: inject a script tag and wait for `window.OpenCC`.
    return new Promise((resolve, reject) => {
        if (typeof document === "undefined") {
            reject(new Error("[t2s-opencc] No DOM available to inject script"));
            return;
        }
        if (typeof globalThis.OpenCC !== "undefined") {
            resolve(globalThis.OpenCC);
            return;
        }
        const script = document.createElement("script");
        script.src = OPENCC_JS_CDN;
        script.async = true;
        script.onload = () => {
            if (typeof globalThis.OpenCC === "undefined") {
                reject(new Error("[t2s-opencc] Script loaded but OpenCC global not found"));
                return;
            }
            resolve(globalThis.OpenCC);
        };
        script.onerror = () => reject(new Error(`[t2s-opencc] Failed to load script from ${script.src}`));
        document.head.appendChild(script);
    });
}

/**
 * Get a converter instance, creating it lazily on first call.
 *
 * @param {Object} [opts]
 * @param {string} [opts.direction="t2s"] - Conversion direction. Either
 *        "t2s" (Traditional → Simplified) or "s2t" (Simplified → Traditional).
 * @returns {Promise<{convert: (text: string) => string}>}
 *          An object with a `convert(text)` method. Returns a
 *          passthrough converter on failure.
 * @public
 */
export async function getConverter(opts = {}) {
    const direction = opts.direction ?? "t2s";

    if (_converter && _converter._direction === direction) {
        return _converter;
    }

    if (!_loaderPromise) {
        _loaderPromise = _loadOpenCC().catch((err) => {
            console.warn("[t2s-opencc] Failed to load OpenCC Wasm:", err.message);
            _loaderPromise = null; // Allow retry on next call.
            throw err;
        });
    }

    const OpenCC = await _loaderPromise;

    // opencc-js API:
    //   OpenCC.Converter({ from: 'cn'|'tw'|'hk'|'jp', to: 'cn'|'tw'|'hk'|'jp' })
    // For t2s: from 'tw' (or 'hk') to 'cn'.
    // For s2t: from 'cn' to 'tw'.
    const fromRegion = direction === "s2t" ? "cn" : "tw";
    const toRegion = direction === "s2t" ? "tw" : "cn";

    const raw = OpenCC.Converter({ from: fromRegion, to: toRegion });
    _converter = {
        _direction: direction,
        /**
         * Convert a string.
         * @param {string} text
         * @returns {string}
         */
        convert(text) {
            try {
                return raw(text);
            } catch (err) {
                console.warn("[t2s-opencc] Conversion error:", err);
                return text; // Passthrough on error.
            }
        },
    };
    return _converter;
}

/**
 * Check whether OpenCC is available (already loaded or loadable).
 *
 * This is used by tests to skip heavy-mode tests when OpenCC cannot
 * be loaded (e.g. in CI environments without network access).
 *
 * @param {number} [timeoutMs=2000] - Max time to wait for the loader.
 * @returns {Promise<boolean>}
 * @public
 */
export async function isAvailable(timeoutMs = 2000) {
    // Race the converter-load promise against a timeout. The previous
    // implementation created an AbortController but never wired its signal
    // to anything (getConverter doesn't accept a signal), so the abort
    // was dead code. The Promise.race timeout is the actual cancellation
    // mechanism — kept it, removed the dead AbortController.
    try {
        await Promise.race([
            getConverter({ direction: "t2s" }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
        ]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Reset all cached state. Mainly for tests.
 * @public
 */
export function _reset() {
    _loaderPromise = null;
    _converter = null;
}
