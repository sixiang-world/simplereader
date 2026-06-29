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
    const preset = getPreset(presetName);
    if (!preset) {
        console.warn(`[presets] Preset "${presetName}" not found.`);
        return { ...currentValues };
    }
    return { ...currentValues, ...preset };
}

/**
 * Resolve a preset name from URL parameters.
 *
 * The URL contract: `?scheme=NAME` selects a preset. NAME can be:
 *   - A preset name (URL-encoded, e.g. `?scheme=夜间阅读`)
 *   - A 1-based index into the sorted preset list (e.g. `?scheme=1`)
 *
 * Index-based selection is useful for sharing short URLs. The sort
 * order is alphabetical by preset name for determinism.
 *
 * @param {URLSearchParams} [urlParams] - Defaults to the current page's URL params.
 * @returns {string|null} The resolved preset name, or null if no ?scheme= param.
 */
export function resolvePresetFromURL(urlParams) {
    const params = urlParams ?? new URLSearchParams(window.location.search);
    const raw = params.get("scheme");
    if (!raw) return null;

    // Try as a name first.
    const presets = loadAllPresets();
    if (raw in presets) return raw;

    // Try as a 1-based index.
    const idx = parseInt(raw, 10);
    if (!isNaN(idx) && idx >= 1) {
        const names = Object.keys(presets).sort();
        if (idx <= names.length) return names[idx - 1];
    }

    console.warn(`[presets] URL ?scheme=${raw} did not match any preset.`);
    return null;
}
