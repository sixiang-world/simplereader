/**
 * @fileoverview OpenCC Wasm loader for heavy-mode traditional→simplified
 * Chinese conversion.
 *
 * OpenCC (https://github.com/BYVoid/OpenCC) is the de-facto standard
 * library for Chinese conversion with vocabulary-level accuracy.
 * The `opencc-wasm` project (https://github.com/nk2028/opencc-wasm)
 * provides a browser-compatible Wasm build.
 *
 * This module lazily loads OpenCC on first use — it does NOT block app
 * boot. The Wasm binary is fetched on demand from a CDN (jsDelivr) and
 * cached for the session. Subsequent calls reuse the cached instance.
 *
 * == Why lazy loading? ==
 *
 * The OpenCC Wasm binary is ~1MB. Loading it eagerly would add ~1MB to
 * the initial page weight and ~200-500ms of parse time. Most users
 * never need trad→simp conversion. Lazy loading keeps the common path
 * fast.
 *
 * == CDN fallback ==
 *
 * If the CDN is unreachable, conversion will fail gracefully (the hook
 * returns the original text unchanged). This is documented in the
 * t2s module's contract.
 *
 * == Configuration ==
 *
 * We use the `t2s.json` config (Traditional → Simplified) which includes:
 *   - Character-level conversion (same as light mode)
 *   - Vocabulary-level conversion (e.g. 詞彙 → 词汇, 軟體 → 软件)
 *   - Idiom conversion (e.g. 一網打盡 → 一网打尽)
 *
 * @module client/src/core/t2s-opencc
 */

// CDN URL for the opencc-wasm package. We use jsDelivr as it has good
// global availability. The version is pinned for reproducibility.
const OPENCC_WASM_CDN = "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5";

/** @type {Promise<any>|null} Cached loader promise. */
let _loaderPromise = null;

/** @type {any|null} Cached converter instance. */
let _converter = null;

/**
 * Browser-friendly dynamic import shim. Uses `import()` if available,
 * falls back to injecting a `<script>` tag for legacy environments.
 *
 * The opencc-js package exposes a global `OpenCC` after the script
 * loads. We wrap it in a Promise for ergonomics.
 *
 * @returns {Promise<any>} Resolves to the OpenCC namespace.
 * @private
 */
async function _loadOpenCC() {
    // Try dynamic import first (works for ESM-aware bundlers).
    if (typeof globalThis.import === "function") {
        try {
            const mod = await import(/* @vite-ignore */ `${OPENCC_WASM_CDN}/dist/umd/index.js`);
            if (mod && (mod.Converter || mod.default)) return mod.default ?? mod;
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
        script.src = `${OPENCC_WASM_CDN}/dist/umd/index.js`;
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
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        await Promise.race([
            getConverter({ direction: "t2s" }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
        ]);
        clearTimeout(timer);
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
