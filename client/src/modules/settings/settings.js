/**
 * @fileoverview Settings module for managing UI and style configurations.
 *
 * This module provides functionality for:
 * - Managing user interface settings (language, fonts, colors)
 * - Handling light/dark mode preferences
 * - Storing and retrieving settings from localStorage
 * - Creating and managing the settings menu interface
 * - Applying settings to the application in real-time
 *
 * The settings are organized into several categories:
 * - Font settings (system fonts, custom fonts, fallback fonts)
 * - Color settings (light/dark mode colors)
 * - UI settings (line height, font size, pagination)
 * - Language settings
 *
 * (v2 refactor) The SETTINGS_SCHEMA / MENU_SCHEMA definitions have been
 * extracted to ./settings/schema.js. The 100-line updateFontBaselineOffsets
 * listener has been extracted to ./settings/font-baseline.js. This file now
 * focuses on state management (load/save/apply/language) and the SettingsMenu
 * UI class.
 *
 * @module client/src/modules/features/settings
 * @requires client/src/config/index
 * @requires client/src/config/icons
 * @requires shared/core/callback/callback-registry
 * @requires client/src/modules/components/dropdown-selector
 * @requires client/src/modules/components/custom-custom-color-picker
 * @requires client/src/modules/components/popup-manager
 * @requires client/src/utils/base
 * @requires client/src/utils/helpers-settings
 * @requires client/src/utils/helpers-reader
 * @requires client/src/utils/helpers-ui
 * @requires client/src/modules/features/settings/schema
 * @requires client/src/modules/features/settings/font-baseline
 */

import * as CONFIG from "../../config/index.js";
import { ICONS } from "../../config/icons.js";
import { cbReg } from "../../../../shared/core/callback/callback-registry.js";
import { PopupManager } from "../../components/popup-manager.js";
import { isVariableDefined, toBool, setDeep } from "../../utils/base.js";
import { parseURLSettings } from "../../utils/url-settings.js";
import { resolvePresetFromURL, applyPreset, FACTORY_DEFAULT_MARKER } from "../../core/presets.js";
import { pullConfigResult, pushMergedConfig, isSyncEnabled, getSyncToken, buildPushPayload, recordLocalChange } from "../../core/config-sync.js";
import { normalizeSettingValue, normalizeSettings, readStoredSetting } from "../../core/setting-values.js";
import { applyPulledSettings } from "../../core/settings-state.js";
import { refreshShareButtonLabels } from "../../utils/label-refresh.js";
import { setRangeValue, setColorValue, setSelectorValue, setCheckboxValue, findFontIndex, changeLanguageSelectorItemLanguage, changeFontSelectorItemLanguage } from "../../utils/helpers/settings.js";
import { setTitle } from "../../utils/helpers/reader.js";
import { getCurrentDisplayLanguage } from "../../utils/helpers/ui.js";
import { SETTINGS_SCHEMA } from "../../config/schema/settings-schema.js";
import { updateFontBaselineOffsets as _updateFontBaselineOffsets } from "./font-baseline.js";
import { SettingsMenu } from "./settings-menu.js";


/**
 * Settings module for managing UI and style configurations.
 * @private
 * @namespace
 */
const settings = {
    /*
     * Module state
     */
    enabled: false,
    settingsMenu: null,

    /*
     * Config-sync: keys the user has modified in this session.
     * Pulls never override these keys — the user's in-session change
     * always wins for them. Reset on page reload.
     */
    _userInteractedKeys: new Set(),

    /*
     * Language settings
     */
    browser_LANG: localStorage.getItem("browser_LANG") ?? "zh",
    respectUserLangSetting: null,

    /*
     * Settings from schema
     */
    defaults: Object.fromEntries(SETTINGS_SCHEMA.map((item) => [item.key, item.default])),
    values: Object.fromEntries(SETTINGS_SCHEMA.map((item) => [item.key, item.default])),
    types: Object.fromEntries(SETTINGS_SCHEMA.map((item) => [item.key, item.type])),
    // Pre-built key → def lookup so generateConfigURL is O(n) instead of O(n²).
    // Each call previously did SETTINGS_SCHEMA.find() per key (~50 keys × ~50 schema
    // entries = 2500 ops) on every applySettings() / saveSettings().
    schemaMap: Object.fromEntries(SETTINGS_SCHEMA.map((item) => [item.key, item])),

    /**
     * Loads a user setting from localStorage, falling back to an alternate key or the default value.
     * Handles checkbox types by converting stored values to boolean.
     *
     * @public
     * @method loadSettingWithFallback
     * @memberof settings
     * @instance
     * @param {string} key - The primary localStorage key to retrieve.
     * @param {string|null} [key_alt=null] - An optional alternate key to use if the primary key is not found.
     * @returns {*} The resolved setting value, using the following priority:
     *  1. Value from localStorage under `key`
     *  2. Value from localStorage under `key_alt` (if provided)
     *  3. Default value from the settings schema
     *  Checkbox types are automatically converted to boolean.
     */
    loadSettingWithFallback(key, key_alt = null) {
        const def = this.schemaMap[key];
        return readStoredSetting(localStorage, def, key_alt);
    },

    /**
     * Saves a user setting based on the value of an input element, with optional unit and per-setting value computation.
     * Supports checkboxes, range sliders, color pickers, selects, and custom logic via the schema's `getValue` function.
     * Falls back to the default value if the input is empty or invalid.
     *
     * @public
     * @method saveSettingFromInput
     * @memberof settings
     * @instance
     * @param {string} key - The setting key to save.
     * @param {jQuery} $input - The jQuery input element from which to read the value.
     * @param {string} [unit=""] - An optional unit string to append to the value (e.g., "em", "%").
     * @returns {*} The final saved value (after applying unit, computation, or default fallback).
     */
    saveSettingFromInput(key, $input, unit = "") {
        const sanitizedUnit = unit ?? "";
        // (v2 refactor) Use the pre-built schemaMap (O(1) lookup) instead of
        // SETTINGS_SCHEMA.find() (O(n) linear scan). The schemaMap was
        // explicitly built for this purpose — see the comment near its
        // definition above.
        const def = this.schemaMap[key];
        let value;

        // 1. Prefer per-schema getValue function if defined
        if (def && typeof def.getValue === "function") {
            value = def.getValue.call(this, $input);
        } else {
            // 2. Fallback to built-in logic by type
            switch (this.types[key]) {
                case "checkbox":
                    value = $input.is(":checked");
                    break;
                case "range":
                    value = $input.val() + sanitizedUnit;
                    break;
                case "color":
                case "select":
                case "select-font":
                    value = $input.val();
                    break;
                default:
                    value = $input.val() + sanitizedUnit;
                    break;
            }
        }
        if (value === undefined || value === null || value === sanitizedUnit) {
            value = this.defaults[key];
        }
        value = normalizeSettingValue(def, value) ?? this.defaults[key];
        if (def.persist) localStorage.setItem(key, value);
        return value;
    },

    /**
     * Loads user settings from local storage or falls back to default values.
     * Settings include:
     * - UI language (if user language setting is respected)
     * - Paragraph line height and font size
     * - Light mode colors (main active/inactive, font, background)
     * - Dark mode colors (main active/inactive, font, background)
     * - Title and body fonts
     * - Pagination position and opacity
     * - Auto-open last book
     *
     * @public
     * @method loadSettings
     * @memberof settings
     * @instance
     */
    loadSettings() {
        // Special case: respectUserLangSetting (not in manifest)
        this.respectUserLangSetting =
            toBool(localStorage.getItem("respectUserLangSetting"), false) ??
            toBool(document.documentElement.getAttribute("respectUserLangSetting"));

        // Loop through all settings from schema
        for (const def of SETTINGS_SCHEMA) {
            // Special case: language selection (ui_language) depends on respectUserLangSetting
            if (def.key === "ui_language") {
                if (this.respectUserLangSetting) {
                    this.values[def.key] = this.loadSettingWithFallback(def.key, "UILang");
                }
            } else {
                // All other settings from schema
                this.values[def.key] = this.loadSettingWithFallback(def.key);
            }
        }

        // Preset override via ?scheme= URL parameter.
        //
        // Runs BEFORE parseURLSettings() so individual URL params (?key=value)
        // take precedence over preset values. This matches the spec:
        //   ?scheme=NAME&p_fontSize=2em
        // should apply the preset, then override p_fontSize to 2em.
        //
        // Resolution rules (see client/src/core/presets.js):
        //   - ?scheme=0       → restore factory defaults from SETTINGS_SCHEMA
        //   - ?scheme=NAME    → resolve user-saved or factory preset by name
        //   - ?scheme=N (1+)  → resolve N-th user-saved preset (alphabetical)
        //
        // The merge is SHALLOW: preset keys override existing values, but
        // non-preset keys are preserved. This lets a preset be a partial
        // override (e.g. only colors) without nuking unrelated settings.
        const presetName = resolvePresetFromURL(new URLSearchParams(window.location.search));
        if (presetName === FACTORY_DEFAULT_MARKER) {
            // Restore all settings to factory defaults from SETTINGS_SCHEMA.
            // This is NOT a preset lookup — it creates a fresh default values
            // object. URL ?key=value overrides (applied below) will then
            // take precedence over the restored defaults.
            for (const def of SETTINGS_SCHEMA) {
                if (def.key === "ui_language") continue; // handled below
                this.values[def.key] = this.defaults[def.key];
            }
        } else if (presetName) {
            // Apply named preset as a shallow merge over current values.
            this.values = { ...this.values, ...normalizeSettings(SETTINGS_SCHEMA, applyPreset(this.values, presetName)) };
        }

        // URL parameter override: schema-driven, properly typed, memory-only.
        // Runs AFTER preset application so individual URL params (?key=value)
        // take precedence over preset values.
        for (const [key, value] of Object.entries(
            parseURLSettings(SETTINGS_SCHEMA, new URLSearchParams(window.location.search))
        )) {
            this.values[key] = value;
        }

        // Special case: ui_language URL override also needs to activate the language live
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has("ui_language")) {
            this.respectUserLangSetting = true;
            // If "auto", resolve to the actual browser language; CSS only knows "zh"/"en".
            // IMPORTANT: keep this.values.ui_language as the *original* URL value
            // (e.g. "auto") so generateConfigURL can faithfully reproduce the URL.
            // Store the resolved language code in _resolved_ui_language for
            // applySettings to consume.
            const lang = this.values.ui_language === "auto"
                ? (navigator.language.startsWith("zh") ? "zh" : "en")
                : this.values.ui_language;
            this.setLanguage(lang, false);
            // Sync WEB_LANG so the pending updateUILanguage event (fired after this
            // in enable()) uses the URL-overridden value, not the original browser one.
            CONFIG.RUNTIME_VARS.WEB_LANG = lang;
            this._resolved_ui_language = lang;
        }

        // Recalculate hidden getValue-dependent settings after URL overrides.
        // Hidden settings like light_mainColor_inactive derive from a sibling setting
        // (e.g. light_mainColor_active) via getValue, but URL overrides only update
        // the source key, leaving the derived value stale in localStorage.
        const labelToKey = Object.create(null);
        for (const def of SETTINGS_SCHEMA) {
            if (def.label) labelToKey[def.label] = def.key;
        }
        for (const def of SETTINGS_SCHEMA) {
            if (def.hidden && typeof def.getValue === "function" && def.inputRef) {
                const sourceKey = labelToKey[def.inputRef];
                if (sourceKey && this.values[sourceKey] !== undefined) {
                    const $mockInput = { val: () => this.values[sourceKey] };
                    this.values[def.key] = def.getValue.call({ defaults: this.defaults }, $mockInput);
                }
            }
        }
    },

    /**
     * Persist specific keys' values to localStorage. Called after a
     * sync pull merge to ensure the merged values survive a page
     * reload (otherwise loadSettings would read stale localStorage
     * values and the next pull would be redundant).
     *
     * @public
     * @method persistSyncedKeys
     * @param {string[]} keys - The keys to persist.
     */
    persistSyncedKeys(keys) {
        for (const key of keys) {
            const def = this.schemaMap[key];
            if (def && def.persist) {
                try {
                    localStorage.setItem(key, this.values[key]);
                } catch (e) {
                    console.warn(`[settings] Failed to persist synced key '${key}':`, e);
                }
            }
        }
    },

    /**
     * Sync the current `this.values` back into the settings-panel form
     * controls (range sliders, color pickers, checkboxes, font selectors,
     * and the language selector). This is the reverse of saveSettings —
     * it makes the UI reflect the in-memory values.
     *
     * Used after a sync pull merges new values, and after loadDefaultSettings.
     *
     * @param {string[]|Set<string>|null} [keys=null] - Only sync these keys.
     *        If null/empty, syncs all schema keys.
     * @public
     */
    syncValuesToForm(keys = null) {
        const keySet = Array.isArray(keys)
            ? new Set(keys)
            : (keys instanceof Set ? keys : null);

        // Language selector has special handling via respectUserLangSetting.
        if (!keySet || keySet.has("ui_language")) {
            if (this.respectUserLangSetting) {
                setSelectorValue(
                    "setting_ui_language",
                    Object.keys(CONFIG.CONST_UI.LANGUAGE_MAPPING).indexOf(this.values.ui_language) + 1
                );
            } else {
                setSelectorValue("setting_ui_language", 0);
            }
        }

        for (const def of SETTINGS_SCHEMA) {
            if (def.hidden) continue;
            if (def.key === "ui_language") continue;
            if (keySet && !keySet.has(def.key)) continue;
            if (def.type === "range") {
                setRangeValue(def.label, this.values[def.key]);
            } else if (def.type === "checkbox") {
                setCheckboxValue(def.label, this.values[def.key]);
            } else if (def.type === "color") {
                setColorValue(def.label, this.values[def.key]);
            } else if (def.type === "select-font") {
                setSelectorValue(def.label, findFontIndex(this.values[def.key]));
            }
        }
    },

    /**
     * Refresh the sync-token panel UI from the persisted token state.
     *
     * Re-reads the token from localStorage and re-renders the input value,
     * save-button label/state, hint, and action status. Called on settings
     * menu show() so that any unsaved edits typed into the input (which
     * persist because the panel DOM is kept alive via show/hide) are
     * discarded in favour of the actually-saved token.
     *
     * @public
     */
    refreshSyncTokenUI() {
        const input = document.getElementById("config-sync-token");
        if (!input) return;
        const saveBtn = document.querySelector(".sync-token-save-btn");
        const hint = document.getElementById("config-sync-token-hint");
        const status = document.querySelector(".sync-token-status");

        const isZh = CONFIG.RUNTIME_VARS.STYLE.ui_LANG === "zh";
        const saveText = isZh ? "保存" : "Save";
        const savedEnabledText = isZh ? "✓ 已启用" : "✓ Enabled";
        const hintText = isZh
            ? "仅支持字母、数字和下划线（4-64 位）"
            : "Letters, digits, and underscores only (4-64 chars)";

        const token = getSyncToken();
        // Restore the saved token, discarding any unsaved in-input edits.
        input.value = token || "";

        if (saveBtn) {
            if (token) {
                saveBtn.textContent = savedEnabledText;
                saveBtn.dataset.savedState = "enabled";
            } else {
                saveBtn.textContent = saveText;
                delete saveBtn.dataset.savedState;
            }
        }
        if (hint) {
            hint.classList.remove("sync-token-error");
            hint.textContent = hintText;
        }
        if (status) {
            status.textContent = "";
            status.classList.remove("sync-token-status-ok", "sync-token-status-err");
        }
    },

    /**
     * Apply pulled sync data: merge into current values using field-level
     * LWW, persist changed keys, re-render the UI. This is the core
     * "process the returned change-status → local update → render" step
     * for the manual pull action.
     *
     * @param {Object|null} syncData - V2-format sync object from pullOnBoot.
     * @returns {string[]} The keys that actually changed (empty if none).
     * @public
     */
    applySyncPull(syncData) {
        // protectedKeys are consumed by the pure state transition; no DOM imports there.
        return applyPulledSettings(this, syncData, SETTINGS_SCHEMA);
    },

    /** Update both preference semantics and the currently resolved UI language. */
    applyLanguagePreference(preference) {
        this.respectUserLangSetting = preference !== "auto";
        this._resolved_ui_language = preference === "auto"
            ? (CONFIG.VARS.IS_BOOK_OPENED ? (CONFIG.VARS.IS_EASTERN_LAN ? "zh" : "en") : this.browser_LANG)
            : preference;
        localStorage.setItem("respectUserLangSetting", String(this.respectUserLangSetting));
        document.documentElement.setAttribute("respectUserLangSetting", String(this.respectUserLangSetting));
        this.setLanguage(this._resolved_ui_language, false);
        CONFIG.RUNTIME_VARS.WEB_LANG = this._resolved_ui_language;
    },

    /**
     * Manual pull action: fetch the synced config from textdb and apply it.
     * Returns the change-status so the caller (e.g. the token panel button)
     * can render feedback.
     *
     * @returns {Promise<{ok: boolean, changedKeys: string[]}>}
     * @public
     */
    async syncPull() {
        if (!isSyncEnabled()) return { ok: false, changedKeys: [] };
        try {
            const result = await pullConfigResult();
            if (result.status === "error") return { ok: false, changedKeys: [] };
            if (result.status === "missing") return { ok: true, changedKeys: [] };
            const changedKeys = this.applySyncPull(result.data);
            return { ok: true, changedKeys };
        } catch (e) {
            console.warn("[settings] syncPull failed:", e.message);
            return { ok: false, changedKeys: [] };
        }
    },

    /**
     * Manual push action: build a payload from current values (with field
     * timestamps) and POST it to textdb.
     *
     * @returns {Promise<{ok: boolean}>}
     * @public
     */
    async syncPush() {
        if (!isSyncEnabled()) return { ok: false };
        try {
            const payload = buildPushPayload(this.values);
            const ok = await pushMergedConfig(payload, { schema: SETTINGS_SCHEMA });
            return { ok };
        } catch (e) {
            console.warn("[settings] syncPush failed:", e.message);
            return { ok: false };
        }
    },

    /**
     * Resets all settings to their default values.
     * This includes:
     * - UI language (if language setting is enabled)
     * - Text styling (line height, font size)
     * - Light mode colors (main colors, font color, background)
     * - Dark mode colors
     * - Font families
     * - Pagination settings
     * - Auto-open last book
     *
     * Note: This function only loads the default values into memory,
     * it does not save them to localStorage or apply them to the UI.
     * Use saveSettings() to persist changes.
     *
     * @public
     * @method loadDefaultSettings
     * @memberof settings
     * @instance
     */
    loadDefaultSettings() {
        // console.log("loadDefaultSettings");

        // Special case: respectUserLangSetting (not in manifest)
        this.respectUserLangSetting = CONFIG.RUNTIME_VARS.RESPECT_USER_LANG_SETTING_DEFAULT;

        // Clear URL-resolved language cache so applySettings doesn't keep using
        // a stale URL override after the user resets to defaults.
        this._resolved_ui_language = null;

        // Loop through all settings from schema
        for (const def of SETTINGS_SCHEMA) {
            // Special case: language selection (ui_language) depends on respectUserLangSetting
            if (def.key === "ui_language") {
                if (this.respectUserLangSetting) {
                    this.values.ui_language = this.defaults.ui_language;
                }
                continue;
            }

            // All other settings from schema
            this.values[def.key] = this.defaults[def.key];
        }

        // Sync settings to UI
        this.syncValuesToForm();
    },

    /**
     * Generates a full URL with all current settings as query parameters.
     * The generated URL can be used to reproduce the exact settings state.
     * Range values have their unit stripped (the URL parser re-appends it).
     * @returns {string} The full config URL
     */
    generateConfigURL() {
        // Build a Set of known setting keys so we can preserve unknown query
        // params (e.g. ?book=xxx, ?token=yyy) that are not part of SETTINGS_SCHEMA
        // but were present on the incoming URL. This avoids the share URL silently
        // dropping context the original URL was carrying.
        const knownKeys = new Set(Object.keys(this.schemaMap));
        const preservedParams = [];
        try {
            const incoming = new URLSearchParams(window.location.search);
            for (const [k, v] of incoming.entries()) {
                if (!knownKeys.has(k)) {
                    // Preserve non-setting query params so the share URL
                    // round-trip keeps book/bookmarks/hash params intact.
                    // Duplicate keys (e.g. ?book=a&book=b) are preserved;
                    // URLSearchParams handles duplicates natively.
                    preservedParams.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
                }
            }
        } catch {
            // window.location.search may be unavailable in some sandboxed contexts;
            // fall through silently with no preserved params.
        }

        const params = [];
        const keys = Object.keys(this.values).sort();
        for (const key of keys) {
            const def = this.schemaMap[key];
            // Skip hidden/computed settings — they cannot be URL-overridden
            if (def?.hidden) continue;

            // Skip ui_language when the user has the "auto" setting active
            // (respectUserLangSetting === false). In that case this.values.ui_language
            // is the resolved browser language (e.g. "zh"), but emitting it in the
            // share URL would force *every* recipient onto that language instead of
            // letting their own browser auto-detect. The user picked "auto", so the
            // shared URL should preserve that semantic — which we do by *not*
            // emitting the param at all (no override = browser default).
            if (key === "ui_language" && !this.respectUserLangSetting) continue;

            const val = this.values[key];
            const type = this.types[key];
            if (type === "checkbox") {
                params.push(`${encodeURIComponent(key)}=${encodeURIComponent(val ? "true" : "false")}`);
            } else if (type === "range") {
                const num = parseFloat(val);
                if (!isNaN(num)) {
                    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(num))}`);
                }
            } else if (val !== undefined && val !== null && val !== "") {
                params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
            }
        }

        const allParams = [...preservedParams, ...params];
        // Preserve hash so anchors like #chapter-3 survive a share round-trip.
        const hash = window.location.hash || "";
        const base = window.location.origin + window.location.pathname;
        if (allParams.length > 0) {
            return `${base}?${allParams.join("&")}${hash}`;
        }
        return `${base}${hash}`;
    },

    /**
     * Applies the current settings to the application's configuration.
     * Updates all style-related configuration variables including:
     * - UI language (if enabled)
     * - Text styling (line height, font size)
     * - Light mode colors (main colors, font color, background)
     * - Dark mode colors
     * - Font families for different elements
     * - Pagination settings
     * - Auto-open last book
     *
     * Also handles the special case for dark mode, where it updates
     * the active color settings based on the current theme.
     *
     * @public
     * @method applySettings
     * @memberof settings
     * @instance
     * @param {boolean} [colorOnly=false] - Whether to only apply color settings
     */
    applySettings(colorOnly = false) {
        // Hide footnotes
        cbReg.go("footnotes:hide");

        for (const def of SETTINGS_SCHEMA) {
            if (def.hidden && typeof def.getValue === "function" && def.inputRef) {
                const source = SETTINGS_SCHEMA.find((item) => item.label === def.inputRef);
                if (source) this.values[def.key] = def.getValue.call(this, { val: () => this.values[source.key] });
            }
            if (def.mutualExclusiveWith && this.values[def.key] === true) {
                this.values[def.mutualExclusiveWith] = false;
            }
        }

        // Helper: applies schema-based settings, can be filtered by type or key
        const applySchema = (filter) => {
            for (const def of SETTINGS_SCHEMA) {
                if (filter && !filter(def)) continue;

                // 1. Handle variable binding
                if (def.bind) {
                    const binds = Array.isArray(def.bind) ? def.bind : [def.bind];
                    for (const bindPath of binds) {
                        // Example: "CONFIG.RUNTIME_VARS.STYLE.p_fontSize"
                        // We'll use a simple `eval` here for direct path (or use a utility function for deep object set in prod)
                        try {
                            // eval(`${bindPath} = this.values[def.key]`);
                            setDeep(CONFIG, bindPath.replace(/^CONFIG\./, ""), this.values[def.key]);
                        } catch (e) {
                            console.warn(`Failed to bind setting '${def.key}' to '${bindPath}':`, e);
                        }
                    }
                }
                // 2. Handle onApply (side-effects/derived vars)
                if (typeof def.onApply === "function") {
                    try {
                        def.onApply.call(this, this.values[def.key]);
                    } catch (e) {
                        console.warn(`Failed to call onApply for setting '${def.key}':`, e);
                    }
                }
            }
        };

        // Helper: applies dark mode styles
        const applyDarkModeStyles = () => {
            CONFIG.RUNTIME_VARS.STYLE.mainColor_active = CONFIG.RUNTIME_VARS.STYLE.darkMode_mainColor_active;
            CONFIG.RUNTIME_VARS.STYLE.mainColor_inactive = CONFIG.RUNTIME_VARS.STYLE.darkMode_mainColor_inactive;
            CONFIG.RUNTIME_VARS.STYLE.fontColor = CONFIG.RUNTIME_VARS.STYLE.darkMode_fontColor;
            CONFIG.RUNTIME_VARS.STYLE.bgColor = CONFIG.RUNTIME_VARS.STYLE.darkMode_bgColor;
        };

        if (colorOnly) {
            applySchema((def) => def.type === "color");
            if (CONFIG.RUNTIME_VARS.STYLE.ui_Mode === "dark") {
                applyDarkModeStyles();
            }
            return;
        }

        // Special case: respectUserLangSetting (not in manifest)
        CONFIG.RUNTIME_VARS.RESPECT_USER_LANG_SETTING = this.respectUserLangSetting;
        if (this.respectUserLangSetting) {
            // Prefer the URL-resolved language (handles ui_language=auto case where
            // this.values.ui_language is still "auto" but we want CSS to receive
            // the resolved "zh"/"en" code). Falls back to the schema value when no
            // URL override is active.
            CONFIG.RUNTIME_VARS.STYLE.ui_LANG = this.values.ui_language === "auto"
                ? (CONFIG.VARS.IS_BOOK_OPENED ? (CONFIG.VARS.IS_EASTERN_LAN ? "zh" : "en") : this.browser_LANG)
                : this.values.ui_language;
        }

        // Apply all settings except ui_language
        applySchema((def) => def.key !== "ui_language");

        // Theme adjustments (mode-specific), and other non-schema code
        if (CONFIG.RUNTIME_VARS.STYLE.ui_Mode === "dark") {
            applyDarkModeStyles();
        }

        if (
            toBool(CONFIG.RUNTIME_VARS.STYLE.sidebar__splitview__show__content__boundary__lines, false) &&
            CONFIG.RUNTIME_VARS.STYLE.sidebar__splitview__content__inner__width !== "100%"
        ) {
            CONFIG.DOM_ELEMENT.CONTENT_CONTAINER.classList.add("has-custom-width");
        } else {
            CONFIG.DOM_ELEMENT.CONTENT_CONTAINER.classList.remove("has-custom-width");
        }

        // Update font baseline offsets
        cbReg.go("updateFontBaselineOffsets");

        // Apply filter bar visibility
        cbReg.go("toggleFilterBar");

        // Apply infinite scroll mode
        cbReg.go("toggleInfiniteScroll");

        // Apply continuous scroll (flow) mode
        cbReg.go("toggleContinuousScroll");

        // Apply show line numbers
        cbReg.go("toggleShowLineNumbers");

        // Apply reader mode (book/log/auto)
        cbReg.go("applyReaderMode");

        // Apply TOC area visibility
        cbReg.go("toggleTOCArea");

        // Apply help button visibility
        cbReg.go("toggleHelpBtn");

        // Apply custom cursor visibility
        cbReg.go("toggleCustomCursor");
    },

    /**
     * Saves the current settings to local storage and applies them.
     * Retrieves values from UI elements and saves them to:
     * - Local storage for persistence
     * - Current settings object for immediate use
     *
     * The function handles:
     * - UI language selection
     * - Text styling (line height, font size)
     * - Color schemes for both light and dark modes
     * - Font selections
     * - Pagination settings
     *
     * @public
     * @method saveSettings
     * @memberof settings
     * @instance
     * @param {boolean} [toSetLanguage=false] - Whether to set the language based on the current settings
     * @param {boolean} [forceSetLanguage=false] - Whether to forcefully set the language regardless of user settings
     * @param {boolean} [colorOnly=false] - Whether to only save color settings
     */
    saveSettings(toSetLanguage = false, forceSetLanguage = false, colorOnly = false) {
        // console.log("saveSettings", { toSetLanguage, forceSetLanguage });

        // Snapshot current values so we can detect which keys actually
        // changed. Changed keys are:
        //   1. Added to _userInteractedKeys (protects against sync pull
        //      reverting them).
        //   2. Timestamped via recordLocalChange() (field-level LWW).
        const oldValues = { ...this.values };

        // Helper: update values from schema
        const updateValuesFromInputs = (filterType = null) => {
            // Loop through all settings from schema
            for (const def of SETTINGS_SCHEMA) {
                if (filterType && def.type !== filterType) continue;
                if (!filterType && def.key === "ui_language") continue;
                const inputLabel = def.inputRef || def.label; // Prefer inputRef if present
                this.values[def.key] = this.saveSettingFromInput(def.key, $(`#${inputLabel}`), def.unit);
            }
        };

        // Helper: detect changed keys, mark them as protected + timestamped
        const recordChangedKeys = () => {
            for (const def of SETTINGS_SCHEMA) {
                const key = def.key;
                if (this.values[key] !== oldValues[key]) {
                    this._userInteractedKeys.add(key);
                    recordLocalChange(key);
                }
            }
        };

        if (colorOnly) {
            updateValuesFromInputs("color");
            recordChangedKeys();
            this.applySettings(true);
            cbReg.go("updateAllBookCovers", { colorOnly: colorOnly });
            return;
        }

        // Special case: respectUserLangSetting (not in manifest)
        const selectedLang =
            $("#setting_ui_language")
                .closest(".select")
                .children(".select-options")
                .children(".is-selected")
                .attr("rel") || this.defaults.ui_language;
        if (selectedLang === "auto") {
            this.respectUserLangSetting = false;
            this.values.ui_language = "auto";
        } else {
            this.respectUserLangSetting = true;
            this.values.ui_language = selectedLang;
        }
        if (this.respectUserLangSetting) {
            this.values.ui_language =
                $("#setting_ui_language")
                    .closest(".select")
                    .children(".select-options")
                    .children(".is-selected")
                    .attr("rel") || this.defaults.ui_language;
        }

        // Update all other values
        updateValuesFromInputs();

        // When the user manually changes ui_language via the settings UI, the
        // URL-resolved cache is stale (or no URL override was active to begin
        // with). Reset it so applySettings falls back to this.values.ui_language.
        // If the user picked "auto", applySettings needs the resolved browser
        // language rather than the literal "auto" string.
        if (this.values.ui_language === "auto") {
            this._resolved_ui_language =
                (CONFIG.VARS.IS_EASTERN_LAN ? "zh" : "en");
        } else {
            this._resolved_ui_language = this.values.ui_language;
        }

        // Save language settings to local storage
        if (forceSetLanguage || (this.respectUserLangSetting && toSetLanguage)) {
            let lang = this.respectUserLangSetting
                ? this.values.ui_language || CONFIG.RUNTIME_VARS.STYLE.ui_LANG
                : this.browser_LANG;
            this.setLanguage(lang, true);
            if (!this.respectUserLangSetting && !CONFIG.VARS.INIT) {
                lang = CONFIG.VARS.IS_EASTERN_LAN ? "zh" : "en";
                this.setLanguage(lang, false);
            }
            changeLanguageSelectorItemLanguage($("#setting_ui_language"), lang);
            changeFontSelectorItemLanguage($("#setting_title_font"), lang);
            changeFontSelectorItemLanguage($("#setting_body_font"), lang);
        }

        localStorage.setItem("respectUserLangSetting", this.respectUserLangSetting);
        document.documentElement.setAttribute("respectUserLangSetting", this.respectUserLangSetting);
        if (this.respectUserLangSetting) {
            localStorage.setItem("UILang", this.values.ui_language);
        }

        this.applySettings();

        // Trigger updateAllBookCovers event
        cbReg.go("updateAllBookCovers", { colorOnly: colorOnly });

        // Refresh the share URL input with updated settings.
        // Only do this when the settings menu is actually visible — saveSettings
        // is also called from the menu-close handler (handleSettingsClose with
        // shouldSave: true), in which case the share URL field is about to be
        // hidden anyway and regenerating the URL is wasted work.
        if (CONFIG.VARS.IS_SETTINGS_MENU_SHOWN) {
            const shareInput = document.getElementById("config-share-url");
            if (shareInput) {
                shareInput.value = this.generateConfigURL();
            }
        }

        // Settings changes are recorded (timestamped + protected) so that a
        // later manual syncPush/syncPull has accurate field timestamps.
        // Sync itself is NOT auto-triggered — the user pulls/pushes on
        // demand via the token panel buttons.
        recordChangedKeys();
    },

    /**
     * Sets the UI language and updates related elements
     *
     * @public
     * @method setLanguage
     * @memberof settings
     * @instance
     * @param {string} lang - Language code ('en' or 'zh')
     * @param {boolean} saveToLocalStorage - Whether to save language preference
     */
    setLanguage(lang, saveToLocalStorage = true, consoleLog = false) {
        // console.log("setLanguage", { lang, saveToLocalStorage });
        if (saveToLocalStorage) {
            CONFIG.RUNTIME_VARS.WEB_LANG = lang;
            localStorage.setItem("UILang", lang);
        }

        CONFIG.RUNTIME_VARS.STYLE.ui_LANG = lang;
        document.documentElement.setAttribute("data-lang", CONFIG.RUNTIME_VARS.STYLE.ui_LANG);
        // Force update the CSS variables cache
        CONFIG.RUNTIME_VARS.STYLE.refresh();

        const isDefaultTitle =
            document.title === CONFIG.RUNTIME_VARS.STYLE.ui_title_zh ||
            document.title === CONFIG.RUNTIME_VARS.STYLE.ui_title_en;
        if (isDefaultTitle) {
            setTitle();
        }

        // Reset all hardcoded elements' language
        const elements = {
            darkModeButton: CONFIG.DOM_ELEMENT.DARK_MODE_ACTUAL_BUTTON,
            bookshelfButton: CONFIG.DOM_ELEMENT.BOOKSHELF_BUTTON,
            settingsButton: CONFIG.DOM_ELEMENT.SETTINGS_BUTTON,
            helpButton: CONFIG.DOM_ELEMENT.HELP_BUTTON,
            dropZone: CONFIG.DOM_ELEMENT.DROPZONE,
            tocSplitviewDivider: CONFIG.DOM_ELEMENT.TOC_SPLITVIEW_DIVIDER,
            tocSplitviewToggle: CONFIG.DOM_ELEMENT.TOC_SPLITVIEW_TOGGLE,
            scrollTopButton: CONFIG.DOM_ELEMENT.SCROLL_TOP_BUTTON,
            scrollBottomButton: CONFIG.DOM_ELEMENT.SCROLL_BOTTOM_BUTTON,
            removeBookButtons: CONFIG.DOM_ELEMENT.REMOVE_BOOK_BUTTONS,
            bookInfoButtons: CONFIG.DOM_ELEMENT.BOOK_INFO_BUTTONS,
            bookCoverContainers: CONFIG.DOM_ELEMENT.BOOK_COVER_CONTAINERS,
        };

        if (isVariableDefined(elements.darkModeButton)) {
            elements.darkModeButton.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_modeToggle;
        }
        if (isVariableDefined(elements.bookshelfButton)) {
            elements.bookshelfButton.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_goToBookshelf;
        }
        if (isVariableDefined(elements.settingsButton)) {
            elements.settingsButton.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_settings;
        }
        if (isVariableDefined(elements.helpButton)) {
            elements.helpButton.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_help;
        }
        // if (isVariableDefined(elements.dropZone)) {
        //     elements.dropZone.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_dropZone;
        // }
        if (isVariableDefined(elements.tocSplitviewDivider)) {
            elements.tocSplitviewDivider.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_divider;
        }
        if (isVariableDefined(elements.tocSplitviewToggle)) {
            elements.tocSplitviewToggle.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_toggleButton;
        }
        // console.log("CONFIG.VARS.IS_BOOK_OPENED", CONFIG.VARS.IS_BOOK_OPENED);
        if (!CONFIG.VARS.IS_BOOK_OPENED) {
            if (isVariableDefined(elements.scrollTopButton)) {
                elements.scrollTopButton.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_bookshelf_scrollTop;
            }
            if (isVariableDefined(elements.scrollBottomButton)) {
                elements.scrollBottomButton.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_bookshelf_scrollBottom;
            }
            if (isVariableDefined(elements.removeBookButtons)) {
                elements.removeBookButtons.forEach((el) => {
                    el.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_removeBook;
                });
            }
            if (isVariableDefined(elements.bookInfoButtons)) {
                elements.bookInfoButtons.forEach((el) => {
                    el.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_bookInfo;
                });
            }
            if (isVariableDefined(elements.bookCoverContainers)) {
                elements.bookCoverContainers.forEach((el) => {
                    el.dataset.title = CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_book_altClick;
                });
            }
        }

        // Update tooltips content
        cbReg.go("updateCustomTooltip");

        // Refresh share-URL copy button labels if the settings menu is
        // currently open (Issue-12). Imported from label-refresh.js so the
        // same implementation is shared with test/test-issue-12.mjs.
        refreshShareButtonLabels(
            document.getElementById("config-share-url-copy-btn"),
            lang
        );

        if (consoleLog) {
            console.log(`Language set to "${lang}".`);
        }
    },

    /**
     * Enables the settings functionality.
     * When enabled, the module will:
     * - Load saved settings or defaults
     * - Apply the settings to the application
     * - Initialize the settings menu
     *
     * Only performs these actions if the module is not already enabled.
     *
     * @public
     * @method enable
     * @memberof settings
     * @instance
     * @returns {Object} The settings instance for method chaining
     */
    enable() {
        if (!this.enabled) {
            this.enabled = true;
            // Inject setTitle so the schema's show_book_title onApply
            // callback (defined in ./settings/schema.js) can call it
            // via this._setTitle without a circular import.
            this._setTitle = setTitle;
            if (!CONFIG.VARS.CUSTOM_FONTS_LOADED) {
                CONFIG.VARS.CUSTOM_FONTS = JSON.parse(localStorage.getItem("custom_fonts")) || {};
            }
            this.loadSettings();
            this.applySettings();
            if (!this.settingsMenu) {
                this.settingsMenu = new SettingsMenu(this);
            }
            CONFIG.VARS.SETTINGS_INITIALIZED = true;
            // console.log("Module <Settings> enabled.");

            // Listen to the updateUILanguage event
            cbReg.add("updateUILanguage", (e) => {
                const { lang, saveToLocalStorage } = e;
                this.setLanguage(lang, saveToLocalStorage);
                changeLanguageSelectorItemLanguage($("#setting_ui_language"), lang);
                changeFontSelectorItemLanguage($("#setting_title_font"), lang);
                changeFontSelectorItemLanguage($("#setting_body_font"), lang);
            });

            // Listen to the loadSettings event
            cbReg.add("loadSettings", () => {
                this.loadSettings();
            });

            // Listen to the applySettings event
            cbReg.add("applySettings", () => {
                this.applySettings();
            });

            // Listen to the hideSettingsMenu event
            cbReg.add("hideSettingsMenu", () => {
                if (this.settingsMenu) {
                    this.settingsMenu.hide();
                }
            });

            // Listen to the customFontsLoaded event
            cbReg.add("customFontsLoaded", () => {
                if (this.settingsMenu) {
                    this.settingsMenu.remove();
                    this.settingsMenu = null;
                    this.settingsMenu = new SettingsMenu(this);
                }
            });

            // (v2 refactor) The 100-line body of this listener has been
            // extracted to ./settings/font-baseline.js. The wrapper
            // cbReg.add(...) is kept here so the event subscription stays
            // co-located with the rest of the settings module's event wiring.
            cbReg.add("updateFontBaselineOffsets", () => _updateFontBaselineOffsets(this));

            // Trigger updateUILanguage event
            cbReg.go("updateUILanguage", {
                lang: CONFIG.RUNTIME_VARS.WEB_LANG,
                saveToLocalStorage: true,
            });
            // Use the language of the book if a book is already opened
            cbReg.go("updateUILanguage", {
                lang: getCurrentDisplayLanguage(),
                saveToLocalStorage: false,
            });

            if (window.fetchVersionDataPromise) {
                window.fetchVersionDataPromise.then(() => {
                    // Update the version UI for the settings menu
                    this.settingsMenu.updateVersionUI(
                        CONFIG.RUNTIME_VARS.APP_VERSION,
                        CONFIG.RUNTIME_VARS.APP_VERSION_DATE
                    );

                    // Show the changelog popup
                    PopupManager.showChangelogPopup({
                        version: CONFIG.RUNTIME_VARS.APP_VERSION,
                        changelog: CONFIG.RUNTIME_VARS.APP_CHANGELOG,
                        previousVersions: CONFIG.CONST_CONFIG.CHANGELOG_SHOW_PREVIOUS_VERSIONS,
                        forceShow: CONFIG.CONST_CONFIG.CHANGELOG_FORCE_SHOW,
                    });
                });
            }
        }
        return this;
    },

    /**
     * Disables the settings functionality.
     * When disabled, the module will:
     * - Remove the settings menu from DOM
     * - Remove the settings button
     * - Set enabled state to false
     *
     * Only performs these actions if the module is currently enabled.
     *
     * @public
     * @method disable
     * @memberof settings
     * @instance
     * @returns {Object} The settings instance for method chaining
     */
    disable() {
        if (this.enabled) {
            if (this.settingsMenu) {
                this.settingsMenu.remove();
                this.settingsMenu = null;
            }
            $("#setting-btn").remove();
            this.enabled = false;
            console.log("Module <Settings> disabled.");
        }
        return this;
    },

    /**
     * Initializes the settings module by creating the settings button.
     * Creates a button with:
     * - SVG icon for settings
     * - Click handler to toggle settings menu
     * - Tooltip with settings label
     * - Proper positioning in the button wrapper
     *
     * The button is created with all necessary event listeners and
     * visual elements, ready to be used for opening/closing the settings menu.
     *
     * @public
     * @method init
     * @memberof settings
     * @instance
     */
    init() {
        const $button =
            $(`<div id="setting-btn" class="btn-icon hasTitle" data-title="${CONFIG.RUNTIME_VARS.STYLE.ui_tooltip_settings}">
            ${ICONS.SETTINGS}
            </div>`);

        $button.on("click", () => {
            (() => {
                // setSvgPathLength($button.get(0));
                if (!this.settingsMenu) {
                    this.settingsMenu = new SettingsMenu(this);
                }

                if (CONFIG.VARS.IS_SETTINGS_MENU_SHOWN) {
                    this.settingsMenu.hide();
                } else {
                    this.settingsMenu.show();
                }
            })();
        });

        // Insert the button at the end
        // $button.appendTo($("#main-btn-wrapper"));
        // Insert the button before the last icon
        // const $icons = $("#main-btn-wrapper").children();
        // if ($icons.length > 0) {
        //     $button.insertBefore($icons.last()); // Insert before the last icon
        // } else {
        //     $("#main-btn-wrapper").append($button); // If no icons exist, just append
        // }
        // Insert the button after the "darkmode-toggle-btn"
        $("#darkmode-toggle-btn").after($button);

        // .hide();
    },
};

/**
 * Initializes the settings module
 * @public
 */
export function initSettings() {
    // Enable settings functionality
    if (CONFIG.RUNTIME_CONFIG.ENABLE_SETTINGS) {
        settings.enable();
        settings.init();
    }
}

// Export the settings singleton so other modules (e.g. app.js's config-sync
// wiring) can access settings.values and call settings.applySettings() after
// a sync pull. Without this export, `(await import('./settings.js')).settings`
// is undefined and sync merges are silently skipped.
export { settings };
