/**
 * @fileoverview OpenCC loader for heavy-mode traditional/simplified
 * Chinese conversion.
 *
 * OpenCC (https://github.com/BYVoid/OpenCC) is the de-facto standard
 * library for Chinese conversion with vocabulary-level accuracy.
 * The `opencc-js` package (https://github.com/nk2028/opencc-js)
 * provides a browser-compatible UMD build that bundles the dictionary
 * data (~1MB).
 *
 * This module lazily loads OpenCC on first use — it does NOT block app
 * boot. The script file is served from the app's own `client/lib/opencc/`
 * directory, fetched on demand via a dynamic `<script>` tag. Subsequent
 * calls reuse the cached instance.
 *
 * == Why lazy loading? ==
 *
 * The opencc-js bundle is ~1MB. Loading it eagerly would add ~1MB to the
 * initial page weight. Most users never need trad→simp conversion, so
 * lazy loading keeps the common path fast.
 *
 * == Local vs CDN ==
 *
 * The file was downloaded from jsDelivr CDN. It is hosted locally (under
 * `client/lib/opencc/`) to avoid browser tracking-prevention blocking
 * third-party CDN requests. The file is updated manually by re-downloading
 * when a newer version of opencc-js is desired.
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

// Local path to the opencc-js UMD bundle.
// In dev, Vite serves the path as-is from the repo root.
// In production, postbuild-copy-lib copies client/lib/ into dist/.
// The path is relative to index.html (repo root).
const OPENCC_JS_PATH = "./client/lib/opencc/full.js";

/** @type {Promise<any>|null} Cached loader promise. */
let _loaderPromise = null;

/** @type {any|null} Cached converter instance. */
let _converter = null;

/**
 * Lazy-load OpenCC by injecting a `<script>` tag.
 *
 * The opencc-js UMD bundle exposes a global `OpenCC` after the script
 * loads. We wrap it in a Promise for ergonomics.
 *
 * Note: We do NOT use dynamic `import()` here because the UMD bundle is
 * a classic script (not an ES module), and `import()` on a non-module
 * script either fails or returns an empty module object depending on the
 * browser. Script-tag injection is the reliable approach.
 *
 * @returns {Promise<any>} Resolves to the OpenCC namespace.
 * @private
 */
async function _loadOpenCC() {
    return new Promise((resolve, reject) => {
        // Already available (e.g. injected via bookmarklet or extension)
        if (typeof globalThis.OpenCC !== "undefined") {
            resolve(globalThis.OpenCC);
            return;
        }

        const script = document.createElement("script");
        script.src = OPENCC_JS_PATH;
        script.async = true;
        script.onload = () => {
            if (typeof globalThis.OpenCC === "undefined") {
                reject(
                    new Error(
                        "[t2s-opencc] Script loaded but OpenCC global not found"
                    )
                );
                return;
            }
            resolve(globalThis.OpenCC);
        };
        script.onerror = () =>
            reject(
                new Error(
                    `[t2s-opencc] Failed to load script from ${script.src}`
                )
            );
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
            console.warn(
                "[t2s-opencc] Failed to load OpenCC:",
                err.message
            );
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
        await Promise.race([
            getConverter({ direction: "t2s" }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), timeoutMs)
            ),
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
