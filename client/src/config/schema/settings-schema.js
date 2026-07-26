/**
 * @fileoverview Schema definitions for the settings module.
 *
 * This module exports two pure-data constants:
 *   - SETTINGS_SCHEMA  : array of ~36 setting definitions
 *   - MENU_SCHEMA      : array of tab/section layout definitions
 *
 * Both are consumed by settings.js (state management) and
 * settings-menu.js (UI rendering). Extracting them into a dedicated
 * file keeps settings.js focused on state transitions.
 *
 * @module client/src/modules/features/settings/schema
 * @requires client/src/config/index
 * @requires client/src/utils/base
 */

import * as CONFIG from "../../config/index.js";
import { HSLToHex, hexToHSL, toBool } from "../../utils/base.js";

/**
 * Array of setting definitions used to configure the application's settings UI and logic.
 *
 * Each object in the array represents a single setting, and defines how it appears and behaves in the settings menu.
 * Common fields for each setting include:
 *   - key:         {string}    Unique identifier for the setting (used in storage and code)
 *   - type:        {string}    Type of setting input ('checkbox', 'range', 'color', 'select', 'font', etc.)
 *   - tab:         {string}    Name of the settings tab where the setting is grouped ('general', 'theme', etc.)
 *   - label:       {string}    Localization key or label to display in the UI
 *   - default:     {any}       Default value for this setting
 *   - options:     {Array}     (Optional) Array of option values for 'select' inputs
 *   - optionLabels:{Array}     (Optional) Array of display labels for select options
 *   - min:         {number}    (Optional) Minimum value (for range settings)
 *   - max:         {number}    (Optional) Maximum value (for range settings)
 *   - step:        {number}    (Optional) Step size (for range settings)
 *   - unit:        {string}    (Optional) Unit for range input (e.g., 'em', 'px', '%')
 *   - palette:     {Array}     (Optional) Array of color swatch values for color pickers
 *   - persist:     {boolean}   Whether to persist this setting in localStorage
 *   - hidden:      {boolean}   Whether to hide this setting in the UI (e.g., computed or system value)
 *   - bind:        {string|Array<string>}  Path(s) to runtime variable(s) this setting should update
 *   - inputRef:    {string}    (Optional) Label of another setting item whose input element should be used
 *                              for computing this setting’s value (useful for derived/computed values)
 *   - getValue:    {Function}  (Optional) Custom function to compute the value from the input (for derived settings)
 *   - onApply:     {Function}  (Optional) Custom function to run after this value is set (side effects, etc.)
 *
 * @constant
 * @type {Array<Object>}
 */
const SETTINGS_SCHEMA = [
    // ==== General Tab ====
    {
        key: "ui_language",
        type: "select",
        tab: "general",
        label: "setting_ui_language",
        bind: "CONFIG.RUNTIME_VARS.STYLE.ui_LANG",
        default: CONFIG.RUNTIME_VARS.STYLE.ui_LANG_default,
        options: ["auto", ...Object.keys(CONFIG.CONST_UI.LANGUAGE_MAPPING)],
        optionLabels: [CONFIG.RUNTIME_VARS.STYLE.ui_language_text, ...Object.values(CONFIG.CONST_UI.LANGUAGE_MAPPING)],
        persist: true,
    },
    {
        key: "show_filter_bar",
        type: "checkbox",
        tab: "general",
        label: "setting_show_filter_bar",
        bind: "CONFIG.CONST_CONFIG.SHOW_FILTER_BAR",
        default: CONFIG.CONST_CONFIG.SHOW_FILTER_BAR_DEFAULT,
        persist: true,
    },
    {
        key: "show_helper_btn",
        type: "checkbox",
        tab: "general",
        label: "setting_show_helper_btn",
        bind: "CONFIG.CONST_CONFIG.SHOW_HELPER_BTN",
        default: CONFIG.CONST_CONFIG.SHOW_HELPER_BTN_DEFAULT,
        persist: true,
    },
    {
        key: "enable_custom_cursor",
        type: "checkbox",
        tab: "general",
        label: "setting_enable_custom_cursor",
        bind: "CONFIG.CONST_CONFIG.ENABLE_CUSTOM_CURSOR",
        default: CONFIG.CONST_CONFIG.ENABLE_CUSTOM_CURSOR_DEFAULT,
        persist: true,
    },
    {
        key: "show_book_title",
        type: "checkbox",
        tab: "general",
        label: "setting_show_book_title",
        bind: "CONFIG.CONST_CONFIG.SHOW_BOOK_TITLE",
        default: CONFIG.CONST_CONFIG.SHOW_BOOK_TITLE_DEFAULT,
        persist: true,
        onApply: function (value) {
            // `this` is bound to the settings singleton at call time
            // (see applySchema() in settings.js). The setTitle helper
            // is injected as `this._setTitle` to avoid a circular import
            // between schema.js (this file) and helpers-reader.js.
            if (typeof this._setTitle === "function") {
                if (value) {
                    this._setTitle(CONFIG.VARS.BOOK_AND_AUTHOR?.bookName || "");
                } else {
                    this._setTitle("");
                }
            }
        },
    },
    {
        key: "auto_open_last_book",
        type: "checkbox",
        tab: "general",
        label: "setting_auto_open_last_book",
        bind: "CONFIG.CONST_CONFIG.AUTO_OPEN_LAST_BOOK",
        default: CONFIG.CONST_CONFIG.AUTO_OPEN_LAST_BOOK_DEFAULT,
        persist: true,
    },
    {
        key: "infinite_scroll_mode",
        type: "checkbox",
        tab: "general",
        label: "setting_infinite_scroll_mode",
        note: true,
        bind: "CONFIG.CONST_CONFIG.INFINITE_SCROLL_MODE",
        default: CONFIG.CONST_CONFIG.INFINITE_SCROLL_MODE_DEFAULT,
        persist: true,
        mutualExclusiveWith: "continuous_scroll_mode",
        onApply: function (value) {
            if (value) {
                this.values.continuous_scroll_mode = false;
            }
        },
    },
    {
        key: "infinite_scroll_easy_mode",
        type: "checkbox",
        tab: "general",
        label: "setting_infinite_scroll_easy_mode",
        note: true,
        bind: "CONFIG.CONST_CONFIG.INFINITE_SCROLL_EASY_MODE",
        default: CONFIG.CONST_CONFIG.INFINITE_SCROLL_EASY_MODE_DEFAULT,
        persist: true,
    },
    {
        key: "anonymous_mode",
        type: "checkbox",
        tab: "general",
        label: "setting_anonymous_mode",
        note: true,
        bind: "CONFIG.CONST_CONFIG.ANONYMOUS_MODE",
        default: CONFIG.CONST_CONFIG.ANONYMOUS_MODE_DEFAULT,
        persist: true,
        onApply: function (value) {
            const dz = CONFIG.DOM_ELEMENT.DROPZONE_TEXT;
            if (!dz) return;
            dz.classList.toggle("dropzone-anonymous", value);
        },
    },
    {
        key: "log_mode",
        type: "checkbox",
        tab: "general",
        label: "setting_log_mode",
        note: true,
        bind: "CONFIG.CONST_CONFIG.LOG_MODE",
        default: CONFIG.CONST_CONFIG.LOG_MODE_DEFAULT,
        persist: true,
        hidden: true, // Experimental — UI entry removed; default is false
    },
    {
        key: "continuous_scroll_mode",
        type: "checkbox",
        tab: "general",
        label: "setting_continuous_scroll_mode",
        note: true,
        bind: "CONFIG.CONST_CONFIG.CONTINUOUS_SCROLL_MODE",
        default: CONFIG.CONST_CONFIG.CONTINUOUS_SCROLL_MODE_DEFAULT,
        persist: true,
        mutualExclusiveWith: "infinite_scroll_mode",
        onApply: function (value) {
            if (value) {
                this.values.infinite_scroll_mode = false;
            }
        },
    },
    {
        key: "show_line_numbers",
        type: "checkbox",
        tab: "general",
        label: "setting_show_line_numbers",
        bind: "CONFIG.CONST_CONFIG.SHOW_LINE_NUMBERS",
        default: CONFIG.CONST_CONFIG.SHOW_LINE_NUMBERS_DEFAULT,
        persist: true,
    },

    // ==== Theme Tab (Light) ====
    {
        key: "light_mainColor_active",
        type: "color",
        tab: "theme",
        label: "setting_light_mainColor_active",
        bind: "CONFIG.RUNTIME_VARS.STYLE.mainColor_active",
        default: CONFIG.RUNTIME_VARS.STYLE.mainColor_active_default,
        palette: ["#2F5086"],
        persist: true,
    },
    {
        key: "light_mainColor_inactive",
        type: "color",
        tab: "theme",
        label: "setting_light_mainColor_inactive",
        bind: "CONFIG.RUNTIME_VARS.STYLE.mainColor_inactive",
        default: CONFIG.RUNTIME_VARS.STYLE.mainColor_inactive_default,
        hidden: true, // auto-calculated via getValue, not shown in UI
        persist: true,
        inputRef: "setting_light_mainColor_active",
        getValue: function ($input) {
            // Always derive from the "active" color input
            const mainColorActive = $input.val() || this.defaults.light_mainColor_active;
            const mainColorInactive = HSLToHex(...hexToHSL(mainColorActive, 1.5));
            return mainColorInactive;
        },
    },
    {
        key: "light_fontColor",
        type: "color",
        tab: "theme",
        label: "setting_light_fontColor",
        bind: "CONFIG.RUNTIME_VARS.STYLE.fontColor",
        default: CONFIG.RUNTIME_VARS.STYLE.fontColor_default,
        palette: ["black"],
        persist: true,
    },
    {
        key: "light_bgColor",
        type: "color",
        tab: "theme",
        label: "setting_light_bgColor",
        bind: "CONFIG.RUNTIME_VARS.STYLE.bgColor",
        default: CONFIG.RUNTIME_VARS.STYLE.bgColor_default,
        palette: ["#FDF3DF"],
        persist: true,
    },

    // ==== Theme Tab (Dark) ====
    {
        key: "dark_mainColor_active",
        type: "color",
        tab: "theme",
        label: "setting_dark_mainColor_active",
        bind: "CONFIG.RUNTIME_VARS.STYLE.darkMode_mainColor_active",
        default: CONFIG.RUNTIME_VARS.STYLE.darkMode_mainColor_active_default,
        palette: ["#6096BB"],
        persist: true,
    },
    {
        key: "dark_mainColor_inactive",
        type: "color",
        tab: "theme",
        label: "setting_dark_mainColor_inactive",
        bind: "CONFIG.RUNTIME_VARS.STYLE.darkMode_mainColor_inactive",
        default: CONFIG.RUNTIME_VARS.STYLE.darkMode_mainColor_inactive_default,
        hidden: true, // auto-calculated via getValue, not shown in UI
        persist: true,
        inputRef: "setting_dark_mainColor_active",
        getValue: function ($input) {
            // Always derive from the "active" color input
            const mainColorActive = $input.val() || this.defaults.dark_mainColor_active;
            const mainColorInactive = HSLToHex(...hexToHSL(mainColorActive, 0.5));
            return mainColorInactive;
        },
    },
    {
        key: "dark_fontColor",
        type: "color",
        tab: "theme",
        label: "setting_dark_fontColor",
        bind: "CONFIG.RUNTIME_VARS.STYLE.darkMode_fontColor",
        default: CONFIG.RUNTIME_VARS.STYLE.darkMode_fontColor_default,
        palette: ["#F2E6CE"],
        persist: true,
    },
    {
        key: "dark_bgColor",
        type: "color",
        tab: "theme",
        label: "setting_dark_bgColor",
        bind: "CONFIG.RUNTIME_VARS.STYLE.darkMode_bgColor",
        default: CONFIG.RUNTIME_VARS.STYLE.darkMode_bgColor_default,
        palette: ["#0D1018"],
        persist: true,
    },

    // ==== Content-Style Tab ====
    {
        key: "title_font",
        type: "select-font",
        tab: "content-style",
        label: "setting_title_font",
        bind: [
            "CONFIG.RUNTIME_VARS.STYLE.title_font",
            "CONFIG.RUNTIME_VARS.STYLE.fontFamily_title",
            "CONFIG.RUNTIME_VARS.STYLE.fontFamily_title_zh",
            "CONFIG.RUNTIME_VARS.STYLE.fontFamily_title_en",
        ],
        default: `${CONFIG.RUNTIME_VARS.STYLE.fontFamily_title}, ${CONFIG.RUNTIME_VARS.STYLE.fontFamily_ui}`,
        persist: true,
        getValue: function ($input) {
            const selected = $input.closest(".select").children(".select-options").children(".is-selected").attr("rel");
            return `${selected}, ${CONFIG.RUNTIME_VARS.STYLE.fontFamily_ui}` || this.defaults.title_font;
        },
    },
    {
        key: "body_font",
        type: "select-font",
        tab: "content-style",
        label: "setting_body_font",
        bind: [
            "CONFIG.RUNTIME_VARS.STYLE.body_font",
            "CONFIG.RUNTIME_VARS.STYLE.fontFamily_body",
            "CONFIG.RUNTIME_VARS.STYLE.fontFamily_body_zh",
            "CONFIG.RUNTIME_VARS.STYLE.fontFamily_body_en",
        ],
        default: `${CONFIG.RUNTIME_VARS.STYLE.fontFamily_body}, ${CONFIG.RUNTIME_VARS.STYLE.fontFamily_ui}`,
        persist: true,
        getValue: function ($input) {
            const selected = $input.closest(".select").children(".select-options").children(".is-selected").attr("rel");
            return `${selected}, ${CONFIG.RUNTIME_VARS.STYLE.fontFamily_ui}` || this.defaults.body_font;
        },
    },
    {
        key: "p_fontSize",
        type: "range",
        tab: "content-style",
        label: "setting_p_fontSize",
        bind: "CONFIG.RUNTIME_VARS.STYLE.p_fontSize",
        default: CONFIG.RUNTIME_VARS.STYLE.p_fontSize_default,
        min: 1,
        max: 3,
        step: 0.5,
        unit: "em",
        persist: true,
        onApply: function (value) {
            const match = value.match(/^([\d.]+)([a-z%]+)?$/i);
            const num = match ? parseFloat(match[1]) : 1;
            const unit = match && match[2] ? match[2] : "em";

            CONFIG.RUNTIME_VARS.STYLE.footnote_fontSize = `${(num * 2) / 3}${unit}`;
        },
    },
    {
        key: "p_lineHeight",
        type: "range",
        tab: "content-style",
        label: "setting_p_lineHeight",
        bind: "CONFIG.RUNTIME_VARS.STYLE.p_lineHeight",
        default: CONFIG.RUNTIME_VARS.STYLE.p_lineHeight_default,
        min: 1,
        max: 3,
        step: 0.5,
        unit: "em",
        persist: true,
    },
    {
        key: "p_paragraphSpacing",
        type: "range",
        tab: "content-style",
        label: "setting_p_paragraphSpacing",
        bind: "CONFIG.RUNTIME_VARS.STYLE.p_paragraphSpacing",
        default: CONFIG.RUNTIME_VARS.STYLE.p_paragraphSpacing_default,
        min: 1,
        max: 3,
        step: 0.5,
        unit: "em",
        persist: true,
    },
    {
        key: "p_paragraphIndent",
        type: "checkbox",
        tab: "content-style",
        label: "setting_p_paragraphIndent",
        bind: "CONFIG.RUNTIME_VARS.STYLE.p_paragraphIndent",
        default: toBool(CONFIG.RUNTIME_VARS.STYLE.p_paragraphIndent_default, false),
        persist: true,
        onApply: function (value) {
            CONFIG.RUNTIME_VARS.STYLE.p_paragraphIndent_value = value
                ? CONFIG.RUNTIME_VARS.STYLE.p_paragraphIndent_value_true
                : CONFIG.RUNTIME_VARS.STYLE.p_paragraphIndent_value_false;
        },
    },
    {
        key: "p_textAlign",
        type: "checkbox",
        tab: "content-style",
        label: "setting_p_textAlign",
        bind: "CONFIG.RUNTIME_VARS.STYLE.p_textAlign",
        default: toBool(CONFIG.RUNTIME_VARS.STYLE.p_textAlign_default, false),
        persist: true,
        onApply: function (value) {
            CONFIG.RUNTIME_VARS.STYLE.p_textAlign_value = value
                ? CONFIG.RUNTIME_VARS.STYLE.p_textAlign_value_true
                : CONFIG.RUNTIME_VARS.STYLE.p_textAlign_value_false;
        },
    },

    // ==== Reader Tab ====
    {
        key: "show_toc",
        type: "checkbox",
        tab: "reader",
        label: "setting_show_toc",
        bind: "CONFIG.CONST_CONFIG.SHOW_TOC_AREA",
        default: CONFIG.CONST_CONFIG.SHOW_TOC_AREA_DEFAULT,
        persist: true,
    },
    {
        key: "toc_width",
        type: "range",
        tab: "reader",
        label: "setting_toc_width",
        bind: "CONFIG.RUNTIME_VARS.STYLE.sidebar__splitview__sidebar__inner__width",
        default: CONFIG.RUNTIME_VARS.STYLE.sidebar__splitview__sidebar__inner__width__default,
        min: 50,
        max: 100,
        step: 10,
        unit: "%",
        persist: true,
    },
    {
        key: "main_content_width",
        type: "range",
        tab: "reader",
        label: "setting_main_content_width",
        bind: "CONFIG.RUNTIME_VARS.STYLE.sidebar__splitview__content__inner__width",
        default: CONFIG.RUNTIME_VARS.STYLE.sidebar__splitview__content__inner__width__default,
        min: 50,
        max: 100,
        step: 10,
        unit: "%",
        persist: true,
    },
    {
        key: "show_content_boundary_lines",
        type: "checkbox",
        tab: "reader",
        label: "setting_show_content_boundary_lines",
        bind: "CONFIG.RUNTIME_VARS.STYLE.sidebar__splitview__show__content__boundary__lines",
        default: toBool(CONFIG.RUNTIME_VARS.STYLE.sidebar__splitview__show__content__boundary__lines, false),
        persist: true,
    },
    {
        key: "pagination_bottom",
        type: "range",
        tab: "reader",
        label: "setting_pagination_bottom",
        bind: "CONFIG.RUNTIME_VARS.STYLE.ui_paginationBottom",
        default: CONFIG.RUNTIME_VARS.STYLE.ui_paginationBottom_default,
        min: 1,
        max: 30,
        step: 1,
        unit: "px",
        persist: true,
    },
    {
        key: "pagination_opacity",
        type: "range",
        tab: "reader",
        label: "setting_pagination_opacity",
        bind: "CONFIG.RUNTIME_VARS.STYLE.ui_paginationOpacity",
        default: CONFIG.RUNTIME_VARS.STYLE.ui_paginationOpacity_default,
        min: 0,
        max: 1,
        step: 0.1,
        unit: "",
        persist: true,
    },

    // ==== Shortcuts Tab ====
    {
        key: "arrow_left",
        type: "checkbox",
        tab: "shortcuts",
        label: "setting_arrow_left",
        bind: "CONFIG.CONST_CONFIG.SHORTCUTS.arrow_left",
        default: CONFIG.CONST_CONFIG.SHORTCUTS.arrow_left_default,
        persist: true,
    },
    {
        key: "arrow_right",
        type: "checkbox",
        tab: "shortcuts",
        label: "setting_arrow_right",
        bind: "CONFIG.CONST_CONFIG.SHORTCUTS.arrow_right",
        default: CONFIG.CONST_CONFIG.SHORTCUTS.arrow_right_default,
        persist: true,
    },
    {
        key: "page_up",
        type: "checkbox",
        tab: "shortcuts",
        label: "setting_page_up",
        bind: "CONFIG.CONST_CONFIG.SHORTCUTS.page_up",
        default: CONFIG.CONST_CONFIG.SHORTCUTS.page_up_default,
        persist: true,
    },
    {
        key: "page_down",
        type: "checkbox",
        tab: "shortcuts",
        label: "setting_page_down",
        bind: "CONFIG.CONST_CONFIG.SHORTCUTS.page_down",
        default: CONFIG.CONST_CONFIG.SHORTCUTS.page_down_default,
        persist: true,
    },
    {
        key: "esc",
        type: "checkbox",
        tab: "shortcuts",
        label: "setting_esc",
        bind: "CONFIG.CONST_CONFIG.SHORTCUTS.esc",
        default: CONFIG.CONST_CONFIG.SHORTCUTS.esc_default,
        persist: true,
    },

    // ==== T2S (Traditional -> Simplified Chinese) ====
    // Two mutually exclusive checkboxes:
    //   - t2s_lite : character-level JSON map (fast, no network)
    //   - t2s_pro  : OpenCC Wasm (vocabulary-level, ~1MB lazy-loaded)
    // Enabling one disables the other automatically.
    // Both off = no conversion; either on = auto-detect traditional chars.
    {
        key: "t2s_lite",
        type: "checkbox",
        tab: "general",
        label: "setting_t2s_lite",
        note: true,
        bind: "CONFIG.CONST_CONFIG.T2S_LITE",
        default: CONFIG.CONST_CONFIG.T2S_LITE_DEFAULT,
        persist: true,
        mutualExclusiveWith: "t2s_pro",
        onApply: function (value) {
            if (value) {
                this.values.t2s_pro = false;
            }
        },
    },
    {
        key: "t2s_pro",
        type: "checkbox",
        tab: "general",
        label: "setting_t2s_pro",
        note: true,
        bind: "CONFIG.CONST_CONFIG.T2S_PRO",
        default: CONFIG.CONST_CONFIG.T2S_PRO_DEFAULT,
        persist: true,
        mutualExclusiveWith: "t2s_lite",
        onApply: function (value) {
            if (value) {
                this.values.t2s_lite = false;
            }
        },
    },

    // ==== Config Sync ====
    // Not a real SETTINGS_SCHEMA input — the UI is a custom text field
    // rendered via the virtual item "__config_sync_token" in MENU_SCHEMA.
    // We still list it here so schemaMap has an entry and generateConfigURL
    // knows about it, but it is marked hidden so the generic renderer skips it.
    {
        key: "config_sync_token",
        type: "hidden",
        tab: "general",
        label: "setting_config_sync_token",
        hidden: true,
        persist: false, // Handled manually by config-sync.js
        default: "",
        bind: "CONFIG.RUNTIME_VARS.STYLE.ui_sync_token",
    },
]
/**
 * Array of menu schema definitions describing the UI layout of the settings menu.
 *
 * Each object in the array represents a single tab in the settings menu, and
 * defines its display order, label, and the sections/items to render.
 *
 * @constant
 * @type {Array<Object>}
 */
const MENU_SCHEMA = [
    {
        id: "content-style",
        order: 1,
        active: true, // Default active tab
        content: [
            {
                section: "setting_separator_font",
                order: 1,
                items: ["title_font", "body_font", "p_fontSize"],
            },
            {
                section: "setting_separator_paragraph",
                order: 2,
                items: ["p_lineHeight", "p_paragraphSpacing", "p_paragraphIndent", "p_textAlign"],
            },
        ],
    },
    {
        id: "theme",
        order: 2,
        content: [
            {
                section: "setting_separator_light",
                order: 1,
                items: ["light_mainColor_active", "light_fontColor", "light_bgColor"],
            },
            {
                section: "setting_separator_dark",
                order: 2,
                items: ["dark_mainColor_active", "dark_fontColor", "dark_bgColor"],
            },
        ],
    },
    {
        id: "reader",
        order: 3,
        content: [
            {
                section: "setting_separator_toc",
                order: 1,
                items: ["show_toc", "toc_width"],
            },
            {
                section: "setting_separator_main_content",
                order: 2,
                items: ["main_content_width", "show_content_boundary_lines"],
            },
            {
                section: "setting_separator_pagination",
                order: 4,
                items: ["pagination_bottom", "pagination_opacity"],
            },
        ],
    },
    {
        id: "general",
        order: 5,
        content: [
            {
                section: "setting_separator_ui",
                order: 1,
                items: ["ui_language", "show_filter_bar", "show_book_title", "show_helper_btn", "enable_custom_cursor"],
            },
            {
                section: "setting_separator_behavior",
                order: 2,
                items: ["auto_open_last_book", "infinite_scroll_mode", "infinite_scroll_easy_mode", "continuous_scroll_mode", "anonymous_mode"],
            },
            {
                section: "setting_separator_reading_mode",
                order: 3,
                items: ["show_line_numbers"],
            },
            {
                section: "setting_separator_t2s",
                order: 4,
                items: ["t2s_lite", "t2s_pro"],
            },
            {
                section: "setting_separator_sync",
                order: 5,
                items: ["__config_sync_token"],
            },
            {
                section: "setting_separator_share",
                order: 6,
                items: ["__config_share_url"],
            },
        ],
    },
    {
        id: "shortcuts",
        order: 4,
        content: [
            {
                section: "setting_separator_shortcuts",
                order: 1,
                items: ["arrow_left", "arrow_right", "page_up", "page_down", "esc"],
            },
        ],
    },
    {
        id: "about",
        order: 100,
        custom: true, // Custom/manual tab, not from SETTINGS_SCHEMA
    },
];

export { SETTINGS_SCHEMA, MENU_SCHEMA };







