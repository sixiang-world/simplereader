/**
 * @fileoverview Preset manager for typography/layout presets.
 *
 * Reserved for the planned "排版预设快捷切换" feature:
 *   - Multiple named presets (e.g. "夜间阅读", "白天舒适", "极简")
 *   - Each preset is a partial settings object (subset of SETTINGS_SCHEMA keys)
 *   - URL parameter `?scheme=1` / `?scheme=夜间` switches to a preset
 *     at boot time, before applySettings() runs
 *   - Presets can be saved/loaded/deleted via this API
 *
 * This module is a STUB — it defines the public API surface and the
 * storage format, but does NOT yet wire into settings.js or the URL
 * parser. When the feature is implemented:
 *
 *   1. settings.js loadSettings() should call `applyPresetFromURL()`
 *      AFTER parseURLSettings() runs, so URL `?key=value` overrides
 *      take precedence over preset values.
 *   2. The settings menu should expose a "Presets" tab that calls
 *      savePreset() / loadPreset() / deletePreset().
 *
 * == Preset storage format ==
 *
 * Presets are stored in localStorage under the "reader_presets" key as
 * a JSON object:
 *
 *   {
 *     "夜间阅读": {
 *       "light_mainColor_active": "#1a1a2e",
 *       "light_fontColor": "#e0e0e0",
 *       "light_bgColor": "#0a0a0a",
 *       "p_fontSize": "1.2em",
 *       "p_lineHeight": "1.8em",
 *       ...
 *     },
 *     "白天舒适": { ... }
 *   }
 *
 * Each preset value uses the SAME string encoding as localStorage
 * settings (e.g. "1.2em" for ranges, "#hex" for colors, "true"/"false"
 * for checkboxes) so applySettings() can consume them directly.
 *
 * @module client/src/core/presets
 */

const STORAGE_KEY = "reader_presets";

/**
 * Built-in (factory) default presets.
 *
 * These are NOT stored in localStorage — they live in code so they
 * survive `localStorage.clear()` and can be referenced by URL
 * `?scheme=` params without needing the user to have saved them first.
 *
 * Currently exposed:
 *
 *   - `scheme=0` ("Default")        : Special — restore all settings to
 *                                     factory defaults. Handled in
 *                                     settings.js, NOT a preset lookup.
 *   - `scheme=1` ("Infinite Scroll"): Override the scroll-related
 *                                     settings to enable infinite-scroll
 *                                     mode + easy trigger + anonymous
 *                                     mode.
 *
 * The values use the same string encoding as user-saved presets
 * (e.g. "true"/"false" for booleans, "1.5em" for ranges).
 *
 * @constant
 * @type {Object<string, Object<string, string>>}
 * @private
 */
const FACTORY_DEFAULTS = {
    "Infinite Scroll": {
        // Keys MUST match SETTINGS_SCHEMA entries exactly so that
        // settings.js's saveSettings() persists them to localStorage
        // under the same key the schema's loadSettingWithFallback()
        // reads on the next boot. Using the wrong keys (e.g. the older
        // camelCase `p_infiniteScroll` style) means the preset values
        // are written into settings.values but never persisted, and
        // are silently overwritten on the next loadSettings() call.
        infinite_scroll_mode: "true",
        infinite_scroll_easy_mode: "true",
        anonymous_mode: "true",
    },
};

/**
 * Get a factory-default preset by name.
 *
 * Returns the preset values object for known factory names, or `null`
 * for unknown names. Does NOT consult localStorage — factory presets
 * always exist in code.
 *
 * @param {string} name - The preset name (e.g. "Infinite Scroll").
 * @returns {Object<string, string>|null} The preset values, or null.
 * @public
 */
export function getDefaultPreset(name) {
    if (typeof name !== "string" || name.length === 0) return null;
    return FACTORY_DEFAULTS[name] ? { ...FACTORY_DEFAULTS[name] } : null;
}

/**
 * List all factory-default preset names.
 *
 * Useful for UI that wants to display factory presets separately from
 * user-saved presets.
 *
 * @returns {string[]} Array of factory preset names.
 * @public
 */
export function listDefaultPresets() {
    return Object.keys(FACTORY_DEFAULTS);
}

/**
 * Load all presets from localStorage.
 * @returns {Object<string, Object<string, string>>} Map of preset name -> settings.
 */
export function loadAllPresets() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        // Reject non-plain-object values (arrays, primitives, null).
        // `typeof [] === "object"` would pass a naive check, so we also
        // verify it's not an Array and not null.
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            console.warn("[presets] Stored value is not a plain object, ignoring.");
            return {};
        }
        return parsed;
    } catch (e) {
        console.warn("[presets] Failed to load presets from localStorage:", e);
        return {};
    }
}

/**
 * Save all presets to localStorage.
 * @param {Object<string, Object<string, string>>} presets
 */
function persistPresets(presets) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    } catch (e) {
        console.error("[presets] Failed to persist presets to localStorage:", e);
    }
}

/**
 * Get a single preset by name.
 * @param {string} name - The preset name.
 * @returns {Object<string, string>|null} The preset's settings, or null if not found.
 */
export function getPreset(name) {
    return loadAllPresets()[name] ?? null;
}

/**
 * Save or overwrite a preset.
 * @param {string} name - The preset name.
 * @param {Object<string, string>} settings - Partial settings object
 *        (keys must match SETTINGS_SCHEMA entries).
 */
export function savePreset(name, settings) {
    const presets = loadAllPresets();
    presets[name] = settings;
    persistPresets(presets);
}

/**
 * Delete a preset by name.
 * @param {string} name - The preset name.
 * @returns {boolean} True if the preset existed and was deleted.
 */
export function deletePreset(name) {
    const presets = loadAllPresets();
    if (!(name in presets)) return false;
    delete presets[name];
    persistPresets(presets);
    return true;
}

/**
 * List all preset names.
 * @returns {string[]}
 */
export function listPresets() {
    return Object.keys(loadAllPresets());
}

/**
 * Apply a preset by name to a settings values object.
 *
 * This is a PURE function — it does NOT touch localStorage or call
 * applySettings(). The caller (settings.js) is responsible for taking
 * the returned values object and feeding it into applySettings().
 *
 * The merge strategy is "preset overrides existing values, but does
 * NOT delete keys that aren't in the preset". This lets a preset be
 * a partial override (e.g. only colors) without nuking unrelated
 * settings (e.g. fonts).
 *
 * @param {Object<string, string>} currentValues - The current settings.values.
 * @param {string} presetName - The preset name to apply.
 * @returns {Object<string, string>} A new values object with preset values merged in.
 *          Returns a shallow copy of currentValues if the preset doesn't exist.
 */
export function applyPreset(currentValues, presetName) {
    // Check user-saved presets first, then fall back to factory defaults.
    const preset = getPreset(presetName) ?? getDefaultPreset(presetName);
    if (!preset) {
        console.warn(`[presets] Preset "${presetName}" not found.`);
        return { ...currentValues };
    }
    return { ...currentValues, ...preset };
}

/**
 * Special marker returned by {@link resolvePresetFromURL} when the URL
 * contains `?scheme=0`. The caller (settings.js) should detect this
 * value and reload factory defaults from SETTINGS_SCHEMA rather than
 * looking up a preset.
 *
 * @constant
 * @type {string}
 * @public
 */
export const FACTORY_DEFAULT_MARKER = "__factory_default__";

/**
 * Resolve a preset name from URL parameters.
 *
 * The URL contract: `?scheme=NAME` selects a preset. NAME can be:
 *   - `"0"`            → restore all settings to factory defaults
 *                        (returns {@link FACTORY_DEFAULT_MARKER}).
 *   - A preset name    → resolved via localStorage first, then factory
 *                        defaults (URL-encoded, e.g. `?scheme=夜间阅读`,
 *                        `?scheme=Infinite Scroll`).
 *   - A 1-based index  → resolves into the sorted user-saved preset
 *                        list (factory presets are NOT in the index
 *                        list — they are addressable by name only).
 *
 * Index-based selection is useful for sharing short URLs. The sort
 * order is alphabetical by preset name for determinism.
 *
 * @param {URLSearchParams} [urlParams] - Defaults to the current page's URL params.
 * @returns {string|null} The resolved preset name, {@link FACTORY_DEFAULT_MARKER}
 *                        for scheme=0, or null if no ?scheme= param.
 * @public
 */
export function resolvePresetFromURL(urlParams) {
    const params = urlParams ?? new URLSearchParams(window.location.search);
    const raw = params.get("scheme");
    if (!raw) return null;

    // Special: scheme=0 → factory default marker.
    if (raw === "0") return FACTORY_DEFAULT_MARKER;

    // Try as a user-saved preset name first.
    const userPresets = loadAllPresets();
    if (raw in userPresets) return raw;

    // Try as a factory-default preset name (e.g. "Infinite Scroll").
    if (getDefaultPreset(raw)) return raw;

    // Try as a 1-based index into the user-saved preset list.
    const idx = parseInt(raw, 10);
    if (!isNaN(idx) && idx >= 1) {
        const names = Object.keys(userPresets).sort();
        if (idx <= names.length) return names[idx - 1];
    }

    console.warn(`[presets] URL ?scheme=${raw} did not match any preset.`);
    return null;
}
