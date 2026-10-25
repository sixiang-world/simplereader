/** SettingsMenu boundary. Public facade remains unchanged. */
import * as CONFIG from "../../config/index.js";
import { ICONS } from "../../config/icons.js";
import { cbReg } from "../../../../shared/core/callback/callback-registry.js";
import { getDropdownSelector } from "../../components/dropdown-selector.js";
import { getColorPicker } from "../../components/custom-color-picker.js";
import { PopupManager } from "../../components/popup-manager.js";
import { handleGlobalWheel, fetchVersionData } from "../../utils/base.js";
import { isSyncEnabled, getSyncToken, setSyncToken, validateSyncToken } from "../../core/config-sync.js";
import { createRangeItem, createColorItem, createSelectorItem, createFontSelectorItem, createCheckboxItem, createSeparatorItem, createSeparatorItemWithText, findFontIndex, handleSettingsClose } from "../../utils/helpers/settings.js";
import { updateVersionData } from "../../utils/helpers/ui.js";
import { SETTINGS_SCHEMA, MENU_SCHEMA } from "../../config/schema/settings-schema.js";

/**
 * Class representing the settings menu interface.
 * Manages the creation, display, and interaction of the settings modal dialog.
 * Handles tabs for general settings, theme customization, reader preferences, and about information.
 *
 * @class
 * @property {Object} #SETTINGS_MAP - Private constant containing a map of settings keys to their definitions
 * @property {Object} settingsObj - Reference to the main settings object containing actual settings values
 * @property {HTMLElement} settingsMenu - The main settings menu container element
 * @property {HTMLElement} overlay - The overlay element that dims the background
 * @property {string} defaultTab - The ID of the default tab to show
 */
export class SettingsMenu {
    /**
     * Private constant containing a map of settings keys to their definitions
     * @type {Object}
     */
    #SETTINGS_MAP = Object.fromEntries(SETTINGS_SCHEMA.map((def) => [def.key, def]));

    /** Color picker wrapper owned by this menu instance; destroyed in remove(). */
    #colorPicker = null;

    /** Set by remove() so the deferred picker initialization is skipped after teardown. */
    #colorPickerTornDown = false;

    /**
     * Creates an instance of SettingsMenu.
     * Initializes the menu with references to settings and default configurations.
     *
     * @constructor
     * @param {Object} settingsObj - The main settings object containing all settings values and methods
     */
    constructor(settingsObj) {
        this.settingsObj = settingsObj;
        this.settingsMenu = null;
        this.overlay = null;
        this.isShowing = false;

        // Ensure one tab is marked active in MENU_SCHEMA
        if (!MENU_SCHEMA.some((tab) => tab.active)) {
            MENU_SCHEMA.sort((a, b) => a.order - b.order)[0].active = true;
        }

        // Find the default tab (first active, otherwise first by order)
        const defaultTabObj =
            MENU_SCHEMA.find((tab) => tab.active) || MENU_SCHEMA.slice().sort((a, b) => a.order - b.order)[0];

        this.defaultTab = defaultTabObj.id;

        this.#init();
    }

    /**
     * Initializes and creates the settings menu interface.
     * Creates the complete modal dialog including:
     * - Main container and overlay
     * - Tab navigation
     * - Content sections for each tab
     * - Bottom row with reset button and version
     * Also sets up event listeners and initializes components like color pickers and dropdowns.
     *
     * @throws {Error} If required DOM elements cannot be created or initialized
     */
    #init() {
        // Create the settings menu main container and overlay
        this.settingsMenu = this.#createMainContainer();
        this.overlay = this.#createOverlay();

        // Create the settings menu elements
        const topRow = this.#createTopRow();
        const settingsContainer = this.#createSettingsContainer();
        const tabContainer = this.#createTabContainer();
        const settingsContent = this.#createSettingsContent();
        const bottomRow = this.#createBottomRow();

        // Append the elements to the settings menu
        settingsContainer.appendChild(tabContainer);
        settingsContainer.appendChild(settingsContent);
        this.settingsMenu.appendChild(topRow);
        this.settingsMenu.appendChild(settingsContainer);
        this.settingsMenu.appendChild(bottomRow);

        // Append the settings menu and overlay to the document body
        document.body.appendChild(this.overlay);
        document.body.appendChild(this.settingsMenu);

        // Initialize event listeners and components
        this.#initializeEventListeners();
        this.#initializeComponents();

        // Show the first tab by default
        this.switchTab(this.defaultTab);
    }

    /**
     * Shows the settings menu modal and its overlay.
     * If the menu hasn't been initialized yet, initializes it first.
     *
     * @param {boolean} [showAnimation=true] - Whether to show the animation when showing the menu
     * @throws {Error} If menu initialization fails
     */
    show(showAnimation = true) {
        this.isShowing = true;
        if (!this.settingsMenu) {
            this.#init();
        }

        if (!showAnimation) {
            this.settingsMenu.classList.add("no-animation");
            this.overlay.classList.add("no-animation");
        } else {
            this.settingsMenu.classList.remove("no-animation");
            this.overlay.classList.remove("no-animation");
        }

        // Show the menu
        this.settingsMenu.style.display = "flex";
        this.settingsMenu.style.zIndex = "10001";
        // this.settingsMenu.style.visibility = "visible";
        this.settingsMenu.classList.remove("hide");
        this.settingsMenu.classList.add("show");
        CONFIG.VARS.IS_SETTINGS_MENU_SHOWN = true;

        // Show the overlay
        this.overlay.style.display = "block";
        this.overlay.style.zIndex = "10000";
        // this.overlay.style.visibility = "visible";
        this.overlay.classList.remove("hide");
        this.overlay.classList.add("show");

        // Add ESC key listener
        document.addEventListener("click", this.#handleClose);
        document.addEventListener("keydown", this.#handleClose, true);

        // Refresh the share URL input with current settings
        const shareInput = document.getElementById("config-share-url");
        if (shareInput) {
            shareInput.value = this.settingsObj.generateConfigURL();
        }

        // Refresh the sync-token panel so it reflects the persisted token
        // (discards any unsaved edits left in the input from a prior session).
        this.settingsObj.refreshSyncTokenUI();

        // Add global wheel event handler
        // Disable page scrolling when settings menu is open
        document.body.style.overflow = "hidden";
        document.addEventListener("wheel", this.#handleGlobalWheel, { passive: false });

        requestAnimationFrame(() => {
            this.isShowing = false;
        });
    }

    /**
     * Hides the settings menu modal and its overlay.
     * Resets the menu's visibility state and removes focus from settings button.
     *
     * @param {boolean} [showAnimation=true] - Whether to show the animation when hiding the menu
     */
    hide(showAnimation = true) {
        // Hide the menu
        if (this.settingsMenu) {
            if (!showAnimation) {
                this.settingsMenu.classList.add("no-animation");
            } else {
                this.settingsMenu.classList.remove("no-animation");
            }

            this.settingsMenu.classList.remove("show");
            this.settingsMenu.classList.add("hide");
            // this.settingsMenu.style.display = "none";
            // this.settingsMenu.style.zIndex = "-1";
            // this.settingsMenu.style.visibility = "hidden";

            const tempMenu = this.settingsMenu;
            setTimeout(() => {
                if (tempMenu) {
                    tempMenu.style.display = "none";
                    tempMenu.style.zIndex = "-1";
                    // tempMenu.style.visibility = "hidden";
                }
            }, 150);
        }
        CONFIG.VARS.IS_SETTINGS_MENU_SHOWN = false;

        // Hide the overlay
        if (this.overlay) {
            if (!showAnimation) {
                this.overlay.classList.add("no-animation");
            } else {
                this.overlay.classList.remove("no-animation");
            }

            this.overlay.classList.remove("show");
            this.overlay.classList.add("hide");
            // this.overlay.style.display = "none";
            // this.overlay.style.zIndex = "-1";
            // this.overlay.style.visibility = "hidden";

            const tempOverlay = this.overlay;
            setTimeout(() => {
                if (tempOverlay) {
                    tempOverlay.style.display = "none";
                    tempOverlay.style.zIndex = "-1";
                    // tempOverlay.style.visibility = "hidden";
                }
            }, 150);
        }

        // Manually remove focus from settings button
        const settingsBtn = CONFIG.DOM_ELEMENT.SETTINGS_BUTTON;
        if (settingsBtn) {
            settingsBtn.blur();
        }

        // Remove global wheel event handler
        // Enable page scrolling when settings menu is closed
        document.body.style.overflow = "";
        document.removeEventListener("wheel", this.#handleGlobalWheel, { passive: false });

        // Remove handleClose event listeners
        document.removeEventListener("click", this.#handleClose);
        document.removeEventListener("keydown", this.#handleClose, true);
    }

    /**
     * Removes the settings menu and its event listeners from the DOM.
     * Cleans up all resources associated with the menu.
     */
    remove() {
        // Release the color picker resources (observers + third-party
        // document/window listeners) before dropping the DOM they served.
        // Show/hide intentionally keeps instances alive; only a real menu
        // rebuild/teardown destroys them.
        this.#colorPickerTornDown = true;
        this.#colorPicker?.destroy();
        this.#colorPicker = null;

        // Remove the menu
        if (this.settingsMenu) {
            this.settingsMenu.remove();
            this.settingsMenu = null;
        }

        // Remove the overlay
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }

        // Remove event listeners
        document.removeEventListener("click", this.#handleClose);
        document.removeEventListener("keydown", this.#handleClose, true);

        // Reset any other state if necessary
        CONFIG.VARS.IS_SETTINGS_MENU_SHOWN = false;
    }

    /**
     * Switches the active tab in the settings menu
     * @param {string} tabId - The ID of the tab to switch to
     */
    switchTab(tabId) {
        document.querySelectorAll(".tab-button").forEach((btn) => btn.classList.remove("active"));
        document.querySelector(`[data-tab="${tabId}"]`).classList.add("active");

        document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
        document.getElementById(tabId).classList.add("active");
    }

    /**
     * Creates the main container for the settings menu.
     * @returns {HTMLElement} The created settings menu container element
     */
    #createMainContainer() {
        const menu = document.createElement("div");
        menu.setAttribute("id", "settings-menu");
        menu.className = "settings-modal";
        menu.style.display = "none";
        // menu.style.visibility = "hidden";
        menu.style.zIndex = "-1";

        this.#addScrollHandler(menu);
        return menu;
    }

    /**
     * Adds a scroll handler to the settings menu container.
     * @param {HTMLElement} container - The settings menu container element
     */
    #addScrollHandler(container) {
        container.addEventListener(
            "wheel",
            (e) => {
                // Prevent event from bubbling up to the document
                e.stopPropagation();
                e.preventDefault();

                // Get the current scrolling target element
                const target = e.target;

                // Check if the target element is within a scrollable container
                const scrollableParent = target.closest(
                    ".settings-tabs, .settings-content, .tab-content.active, .select-options"
                );

                if (scrollableParent) {
                    // Check if there is a dropdown open
                    const dropdowns = document.querySelectorAll(".select-options[style*='display: block']");
                    if (dropdowns.length > 0) {
                        const isInsideDropdown = target.closest(".select-options");

                        // Prevent scrolling if the target is not within the open dropdown
                        if (!isInsideDropdown) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        }
                    }

                    // Get the actual element to scroll (if within settings-content, use its first tab-content.active)
                    const scrollTarget = scrollableParent.classList.contains("settings-content")
                        ? scrollableParent.querySelector(".tab-content.active") || scrollableParent
                        : scrollableParent;

                    // Calculate the new scroll position
                    const newScrollTop = scrollTarget.scrollTop + e.deltaY;

                    // Apply the scroll
                    scrollTarget.scrollTop = newScrollTop;
                }
            },
            { passive: false }
        );
    }

    /**
     * Creates the overlay element for the settings menu.
     * @returns {HTMLElement} The created overlay element
     */
    #createOverlay() {
        const overlay = document.createElement("div");
        overlay.setAttribute("id", "settings-overlay");
        overlay.className = "settings-overlay";
        overlay.style.display = "none";
        // overlay.style.visibility = "hidden";
        overlay.style.zIndex = "-1";

        overlay.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                e.stopPropagation();
            },
            { passive: false }
        );

        return overlay;
    }

    /**
     * Creates the settings container for the settings menu.
     * @returns {HTMLElement} The created settings container element
     */
    #createSettingsContainer() {
        const container = document.createElement("div");
        container.className = "settings-container";
        return container;
    }

    /**
     * Creates the tab container for the settings menu.
     * @returns {HTMLElement} The created tab container element
     */
    #createTabContainer() {
        const tabContainer = document.createElement("div");
        tabContainer.className = "settings-tabs";

        [...MENU_SCHEMA]
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .forEach((tabDef) => {
                if (tabDef.hidden) return; // skip hidden tabs
                const tabButton = document.createElement("button");
                tabButton.className = "tab-button";
                tabButton.setAttribute("data-tab", tabDef.id);
                tabButton.setAttribute("id", `setting-tab-${tabDef.id}`);
                tabButton.setAttribute("type", "button");
                tabButton.setAttribute("aria-label", tabDef.id);
                tabButton.addEventListener("click", () => this.switchTab(tabDef.id));
                tabContainer.appendChild(tabButton);
            });

        return tabContainer;
    }

    /**
     * Creates the content section for the settings menu.
     * @returns {HTMLElement} The created settings content element
     */
    #createSettingsContent() {
        const content = document.createElement("div");
        content.className = "settings-content";

        [...MENU_SCHEMA]
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .forEach((tabDef) => {
                if (tabDef.hidden) return; // skip hidden tabs
                // Handle custom tabs (like "about") here if needed, e.g.:
                if (tabDef.custom) {
                    content.appendChild(this.#createAboutTab());
                } else {
                    content.appendChild(this.#createTabFromSchema(tabDef));
                }
            });

        return content;
    }

    /**
     * Generates a tab element and its settings items from MENU_SCHEMA and SETTINGS_SCHEMA.
     * @param {Object} tabDef - Tab definition from MENU_SCHEMA.
     * @returns {HTMLElement} The generated tab content element.
     */
    #createTabFromSchema(tabDef) {
        const tab = document.createElement("div");
        tab.id = tabDef.id;
        tab.className = "tab-content" + (tabDef.active ? " active" : "");

        if (!tabDef.content) return tab;

        // Sort sections by order
        const sections = [...tabDef.content].sort((a, b) => (a.order || 0) - (b.order || 0));

        for (const section of sections) {
            // Add section separator
            if (section.section !== undefined && section.section !== null) {
                if (section.section === "") {
                    tab.appendChild(createSeparatorItem());
                } else {
                    tab.appendChild(createSeparatorItemWithText(section.section));
                }
            }
            if (!section.items) continue;

            // Sort items by order
            const items = [...section.items].sort((a, b) => (a.order || 0) - (b.order || 0));

            for (const itemId of items) {
                // Virtual items: itemId starts with "__" and is NOT a SETTINGS_SCHEMA key.
                // These are dispatched to dedicated creators before the schema lookup below,
                // so the schema-map lookup never throws on them. See MENU_SCHEMA docs for
                // the full list of virtual items.
                if (itemId === "__config_share_url") {
                    tab.appendChild(this.#createShareURLItem());
                    continue;
                }
                if (itemId === "__config_sync_token") {
                    tab.appendChild(this.#createSyncTokenItem());
                    continue;
                }

                const def = this.#SETTINGS_MAP[itemId];
                // Skip undefined items and hidden items, UNLESS the item is
                // gated behind a CONFIG feature flag that is currently enabled
                // (e.g. log_mode behind CONFIG.CONST_CONFIG.LOG_MODE_UI_ENABLED).
                if (!def) continue;
                if (def.hidden && !(def.featureFlag && CONFIG.CONST_CONFIG[def.featureFlag])) continue;

                // Choose the right UI helper
                let el = null;
                switch (def.type) {
                    case "checkbox":
                        let checkboxCallback = this.settingsObj.saveSettings.bind(this.settingsObj);

                        // Handle mutual exclusion: before saveSettings reads the DOM,
                        // uncheck the sibling checkbox so its DOM state is correct.
                        if (def.mutualExclusiveWith) {
                            const siblingDef = this.settingsObj.schemaMap[def.mutualExclusiveWith];
                            if (siblingDef) {
                                const siblingLabel = siblingDef.inputRef || siblingDef.label;
                                const originalCallback = checkboxCallback;
                                checkboxCallback = () => {
                                    const siblingEl = document.getElementById(siblingLabel);
                                    if (siblingEl && siblingEl.checked) {
                                        siblingEl.checked = false;
                                        siblingEl.style.setProperty("--checked", "0");
                                    }
                                    originalCallback();
                                };
                            }
                        }

                        el = createCheckboxItem(
                            def.label,
                            this.settingsObj.values[def.key],
                            checkboxCallback,
                            def.note || false
                        );
                        break;
                    case "select":
                        el = createSelectorItem(def.label, def.options, def.optionLabels, def.note || false);
                        break;
                    case "select-font":
                        const fontSelectorArray = createFontSelectorItem(def.label);
                        const language = !CONFIG.RUNTIME_VARS.RESPECT_USER_LANG_SETTING
                            ? CONFIG.RUNTIME_VARS.STYLE.ui_LANG
                            : this.settingsObj.values.ui_language;
                        // Use index 1 for zh, else 0
                        const langIdx = language === "zh" ? 1 : 0;
                        el = fontSelectorArray[langIdx] || fontSelectorArray[0];
                        break;
                    case "color":
                        el = createColorItem(
                            def.label,
                            this.settingsObj.values[def.key],
                            def.palette || [],
                            this.settingsObj.saveSettings.bind(this.settingsObj)
                        );
                        break;
                    case "range":
                        let parsed = parseFloat(this.settingsObj.values[def.key]);
                        if (Number.isInteger(def.step) || String(def.step) === "1") {
                            parsed = Math.round(parsed);
                        }
                        el = createRangeItem(
                            def.label,
                            parsed,
                            {
                                min: def.min,
                                max: def.max,
                                step: def.step,
                                unit: def.unit,
                            },
                            this.settingsObj.saveSettings.bind(this.settingsObj)
                        );
                        break;
                    default:
                        // fallback
                        continue;
                }
                if (el) tab.appendChild(el);
            }
        }
        return tab;
    }

    /**
     * Creates the about tab for the settings menu.
     * @returns {HTMLElement} The created about tab element
     */
    #createAboutTab() {
        const tab = document.createElement("div");
        tab.id = "about";
        tab.className = "tab-content";

        tab.innerHTML = `
            <div class="about-container prevent-select">
                <img class="about-icon" src="./client/images/icon256.png" alt="Logo">
                <h2 class="about-title" id="settingLabel-about_title"></h2>
                <button id="settingLabel-about_version_date" class="about-version noIndent about-btn">v${CONFIG.RUNTIME_VARS.APP_VERSION} (${CONFIG.RUNTIME_VARS.APP_VERSION_DATE})</button>

                <hr class="about-divider">

                <!-- Repository info -->
                <div class="about-content">
                    <div class="about-info-row">
                        <span class="about-info-label" id="settingLabel-about_current_repo"></span>
                        <span class="about-info-value">
                            <a href="https://github.com/sixiang-world/simplereader" target="_blank" class="about-link">sixiang-world/simplereader</a>
                            <span class="about-tag tag-fork">Fork</span>
                        </span>
                    </div>
                    <div class="about-info-row">
                        <span class="about-info-label" id="settingLabel-about_upstream"></span>
                        <span class="about-info-value">
                            <a href="https://github.com/henryxrl/SimpleTextReader" target="_blank" class="about-link">henryxrl/SimpleTextReader</a>
                            <span class="about-tag tag-original">Original</span>
                        </span>
                    </div>
                    <div class="about-info-row">
                        <span class="about-info-label" id="settingLabel-about_enhanced"></span>
                        <span class="about-info-value">
                            <a href="https://github.com/cataerogong/SimpleTextReader" target="_blank" class="about-link">cataerogong/SimpleTextReader</a>
                            <span class="about-tag tag-enhance">Enhance</span>
                        </span>
                    </div>
                </div>

                <hr class="about-divider">

                <!-- Browser extensions -->
                <div class="about-content">
                    <div class="about-info-row">
                        <span class="about-info-label" id="settingLabel-about_extensions"></span>
                        <span class="about-info-note" id="settingLabel-about_extensions_note"></span>
                    </div>
                    <div class="about-info-row">
                        <span class="about-btns">
                            <button class="about-btn">
                                ${ICONS.CHROME}
                                <a href="https://chrome.google.com/webstore/detail/%E6%98%93%E7%AC%BA/dbanahlbopbjpgdkecmclbbonhpohcaf" target="_blank" class="about-link">Chrome</a>
                            </button>
                            <span class="about-btn-separator">|</span>
                            <button class="about-btn">
                                ${ICONS.FIREFOX}
                                <a href="https://addons.mozilla.org/firefox/addon/yijian/" target="_blank" class="about-link">Firefox</a>
                            </button>
                            <span class="about-btn-separator">|</span>
                            <button class="about-btn">
                                ${ICONS.EDGE}
                                <a href="https://microsoftedge.microsoft.com/addons/detail/pabihehbdhldbdliffaddllmjlknmpak" target="_blank" class="about-link">Edge</a>
                            </button>
                        </span>
                    </div>
                </div>

                <hr class="about-divider">

                <!-- Footer -->
                <div class="about-content">
                    <div class="about-info-row">
                        <span class="about-info-label" id="settingLabel-about_copyright"></span>
                        <span class="about-info-value">
                            <a href="https://github.com/henryxrl" target="_blank" class="about-link">Henry Xu</a>
                        </span>
                    </div>
                    <div class="about-info-row" style="font-size:0.8rem;opacity:0.6;">
                        <span>MIT Licensed — original by henryxrl</span>
                    </div>
                </div>
            </div>
        `;

        return tab;
    }

    /**
     * Creates the top row of the settings menu.
     * This creates a spacer element at the top of the settings modal.
     * @returns {HTMLElement} The created top row element
     */
    #createTopRow() {
        const topRow = document.createElement("div");
        topRow.setAttribute("id", "settings-top-row");
        return topRow;
    }

    /**
     * Creates the bottom row for the settings menu.
     * @returns {HTMLElement} The created bottom row element
     */
    #createBottomRow() {
        const bottomRow = document.createElement("div");
        bottomRow.id = "settings-bottom-row";

        bottomRow.appendChild(this.#createResetButton());
        bottomRow.appendChild(this.#createVersionDisplay());

        return bottomRow;
    }

    /**
     * Creates the reset button for the settings menu.
     * @returns {HTMLElement} The created reset button element
     */
    #createResetButton() {
        const resetButton = document.createElement("button");
        resetButton.setAttribute("id", "settings-reset-btn");
        resetButton.setAttribute("aria-label", "settings-reset-btn");
        resetButton.addEventListener("click", (e) => {
            this.settingsObj.loadDefaultSettings();
            this.settingsObj.saveSettings(true, true);
            cbReg.go("updateFontBaselineOffsets");
            // cbReg.go("refreshBookList", {
            //     hardRefresh: false,
            //     sortBookshelf: true,
            // });
            cbReg.go("updateFilterBar");
            cbReg.go("startBookshelfLoop");

            PopupManager.showNotification({
                iconName: "SETTINGS",
                text: CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_settingsReset,
                zIndex: 10005,
            });
        });
        return resetButton;
    }

    /**
     * Creates the version display for the settings menu.
     * @returns {HTMLElement} The created version display element
     */
    #createVersionDisplay() {
        const versionDisplay = document.createElement("button");
        versionDisplay.id = "settings-version-display";
        versionDisplay.className = "about-btn";
        versionDisplay.textContent = `v${CONFIG.RUNTIME_VARS.APP_VERSION}`;
        return versionDisplay;
    }

    /**
     * Creates the "Share Config" URL item for the general tab.
     * Renders a read-only input with the current config URL and a copy button.
     * @returns {HTMLElement} The share URL item element
     */
    #createShareURLItem() {
        const isZh = CONFIG.RUNTIME_VARS.STYLE.ui_LANG === "zh";
        const copyText = isZh ? "复制" : "Copy";
        const copiedText = isZh ? "✓ 已复制" : "✓ Copied!";

        const wrapper = document.createElement("div");
        wrapper.className = "share-url-wrapper";

        // Inner container constrained to the same width as other setting items
        const inner = document.createElement("div");
        inner.className = "share-url-inner";

        const input = document.createElement("input");
        input.type = "text";
        input.id = "config-share-url";
        input.readOnly = true;
        input.value = this.settingsObj.generateConfigURL();
        inner.appendChild(input);

        const copyBtn = document.createElement("button");
        copyBtn.className = "share-url-copy-btn";
        // Stash both labels as data-* attributes so setLanguage() can refresh
        // them in-place when the user switches language while the settings
        // menu is open (Issue-12). Without this, the button keeps showing the
        // language that was active when #createShareURLItem() first ran.
        copyBtn.id = "config-share-url-copy-btn";
        copyBtn.dataset.copyText = copyText;
        copyBtn.dataset.copiedText = copiedText;
        // "is-copied" flag tracks whether the button is currently in the
        // "✓ Copied" transient state, so a language switch mid-countdown
        // updates the right label (copied vs idle) instead of clobbering
        // the transient with the idle label.
        copyBtn.dataset.isCopied = "false";
        copyBtn.textContent = copyText;
        // Track pending "copied" reset timer so rapid double-clicks don't leave
        // the button stuck on "✓ Copied" forever. The bug: the second click
        // captures `orig` = copiedText (since the first click already changed
        // textContent), and the second setTimeout restores to copiedText.
        let copiedResetTimer = null;
        copyBtn.addEventListener("click", async () => {
            // Always reset the label first so consecutive clicks give clear feedback.
            if (copiedResetTimer !== null) {
                clearTimeout(copiedResetTimer);
                copiedResetTimer = null;
            }
            let copied = false;
            try {
                await navigator.clipboard.writeText(input.value);
                copied = true;
            } catch {
                // Clipboard API can fail on non-HTTPS origins, insecure
                // contexts, or older browsers. Fall back to the deprecated
                // execCommand path so the share URL is still copied.
                try {
                    input.removeAttribute("readonly");
                    input.select();
                    input.setSelectionRange(0, input.value.length);
                    copied = document.execCommand("copy");
                    input.setAttribute("readonly", "");
                    input.blur();
                } catch {
                    copied = false;
                }
            }
            if (copied) {
                copyBtn.textContent = copyBtn.dataset.copiedText;
                copyBtn.dataset.isCopied = "true";
                copiedResetTimer = setTimeout(() => {
                    copyBtn.textContent = copyBtn.dataset.copyText;
                    copyBtn.dataset.isCopied = "false";
                    copiedResetTimer = null;
                }, 2000);
            } else {
                // Last-ditch: select the input so the user can manually Ctrl+C.
                input.select();
            }
        });
        inner.appendChild(copyBtn);

        wrapper.appendChild(inner);

        return wrapper;
    }

    /**
     * Creates the "Config Sync" token input item for the general tab.
     * Renders a text input for the sync token with validation feedback.
     * @returns {HTMLElement} The sync token item element
     */
    #createSyncTokenItem() {
        const isZh = CONFIG.RUNTIME_VARS.STYLE.ui_LANG === "zh";
        const placeholder = isZh ? "输入令牌以启用多设备同步" : "Enter token to enable multi-device sync";
        const saveText = isZh ? "保存" : "Save";
        const savedEnabledText = isZh ? "✓ 已启用" : "✓ Enabled";
        const savedDisabledText = isZh ? "✓ 已禁用" : "✓ Disabled";
        const hintText = isZh
            ? "仅支持字母、数字和下划线（4-64 位）"
            : "Letters, digits, and underscores only (4-64 chars)";

        const wrapper = document.createElement("div");
        wrapper.className = "sync-token-wrapper";

        // Inner container constrained to the same width as other setting items
        const inner = document.createElement("div");
        inner.className = "sync-token-inner";

        // Input row (label moved to placeholder, hint moved to title)
        const inputRow = document.createElement("div");
        inputRow.className = "sync-token-input-row";

        const input = document.createElement("input");
        input.type = "text";
        input.id = "config-sync-token";
        input.className = "sync-token-input";
        input.placeholder = placeholder;
        input.title = hintText;
        input.value = getSyncToken() || "";
        input.setAttribute("autocomplete", "off");
        input.setAttribute("spellcheck", "false");
        inputRow.appendChild(input);

        // Save button — initial state reflects whether a token is already saved
        const saveBtn = document.createElement("button");
        saveBtn.className = "sync-token-save-btn";
        const _hasToken = !!getSyncToken();
        saveBtn.textContent = _hasToken ? savedEnabledText : saveText;
        if (_hasToken) saveBtn.dataset.savedState = "enabled";
        inputRow.appendChild(saveBtn);

        inner.appendChild(inputRow);

        // Hint / validation message (hidden by default, only shown on error)
        const hint = document.createElement("div");
        hint.className = "sync-token-hint";
        hint.id = "config-sync-token-hint";
        hint.textContent = hintText;
        inner.appendChild(hint);

        // Action row: manual Pull / Push buttons (sync is on-demand, not auto)
        const pullText = isZh ? "拉取" : "Pull";
        const pushText = isZh ? "推送" : "Push";
        const pullingText = isZh ? "拉取中…" : "Pulling…";
        const pushingText = isZh ? "推送中…" : "Pushing…";
        const okText = isZh ? "✓ 完成" : "✓ Done";
        const failText = isZh ? "✗ 失败" : "✗ Failed";
        const disabledHint = isZh ? "（先保存令牌）" : " (save token first)";

        const actionRow = document.createElement("div");
        actionRow.className = "sync-token-action-row";

        const pullBtn = document.createElement("button");
        pullBtn.className = "sync-token-action-btn sync-token-pull-btn";
        pullBtn.textContent = pullText;
        actionRow.appendChild(pullBtn);

        const pushBtn = document.createElement("button");
        pushBtn.className = "sync-token-action-btn sync-token-push-btn";
        pushBtn.textContent = pushText;
        actionRow.appendChild(pushBtn);

        const status = document.createElement("span");
        status.className = "sync-token-status";
        actionRow.appendChild(status);

        inner.appendChild(actionRow);
        const syncLimit = document.createElement("small");
        syncLimit.textContent = isZh
            ? "多设备请依次拉取、修改、推送；同时推送仍可能覆盖更改。"
            : "Pull, edit and push one device at a time; simultaneous pushes can overwrite changes.";
        inner.appendChild(syncLimit);

        wrapper.appendChild(inner);

        const setActionStatus = (text, kind) => {
            status.textContent = text;
            status.classList.remove("sync-token-status-ok", "sync-token-status-err");
            if (kind === "ok") status.classList.add("sync-token-status-ok");
            else if (kind === "err") status.classList.add("sync-token-status-err");
        };

        const withBusy = async (btn, busyText, fn) => {
            if (!isSyncEnabled()) {
                setActionStatus(disabledHint, "err");
                return;
            }
            const original = btn.textContent;
            btn.disabled = true;
            btn.textContent = busyText;
            try {
                await fn();
            } finally {
                btn.disabled = false;
                btn.textContent = original;
            }
        };

        pullBtn.addEventListener("click", () => {
            withBusy(pullBtn, pullingText, async () => {
                const { ok, changedKeys } = await this.settingsObj.syncPull();
                if (ok) {
                    setActionStatus(
                        changedKeys.length > 0
                            ? `${okText} (${changedKeys.length})`
                            : okText,
                        "ok"
                    );
                } else {
                    setActionStatus(failText, "err");
                }
            });
        });

        pushBtn.addEventListener("click", () => {
            withBusy(pushBtn, pushingText, async () => {
                const { ok } = await this.settingsObj.syncPush();
                setActionStatus(ok ? okText : failText, ok ? "ok" : "err");
            });
        });

        const validateAndSave = () => {
            const raw = input.value;
            const result = validateSyncToken(raw);

            if (!result.valid) {
                hint.classList.add("sync-token-error");
                hint.textContent = isZh
                    ? `格式错误：${hintText}`
                    : `Invalid: ${hintText}`;
                return;
            }

            hint.classList.remove("sync-token-error");
            hint.textContent = hintText;

            // Empty string = disable sync
            const token = raw.trim() || null;
            setSyncToken(token);

            // Visual feedback on save button — persistent until user edits again
            saveBtn.textContent = token ? savedEnabledText : savedDisabledText;
            saveBtn.dataset.savedState = token ? "enabled" : "disabled";
            setActionStatus("", null);
        };

        saveBtn.addEventListener("click", validateAndSave);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") validateAndSave();
        });
        // Reset button to "Save" when user starts editing again
        input.addEventListener("input", () => {
            if (saveBtn.dataset.savedState) {
                saveBtn.textContent = saveText;
                delete saveBtn.dataset.savedState;
            }
        });

        return wrapper;
    }

    /**
     * Initializes event listeners for the settings menu.
     */
    #initializeEventListeners() {
        document.getElementById("settings-version-display").addEventListener("click", () => {
            this.switchTab("about");
            this.fetchAndUpdateVersionData();
        });

        document.getElementById("settingLabel-about_version_date").addEventListener("click", () => {
            this.hide(false);
            this.fetchAndUpdateVersionData();
            PopupManager.showChangelogPopup({
                version: CONFIG.RUNTIME_VARS.APP_VERSION,
                changelog: CONFIG.RUNTIME_VARS.APP_CHANGELOG,
                previousVersions: CONFIG.CONST_CONFIG.CHANGELOG_SHOW_PREVIOUS_VERSIONS,
                forceShow: true,
                willClose: () => {
                    this.show(false);
                },
            });
        });
    }

    /**
     * Initializes components for the settings menu.
     */
    #initializeComponents() {
        setTimeout(() => {
            if (this.#colorPickerTornDown) return;
            this.#colorPicker = getColorPicker({
                callbackOnInput: () => {
                    // cbReg.go("updateAllBookCovers");
                    this.settingsObj.saveSettings(false, false, true);
                },
                callbackOnChange: () => {
                    this.settingsObj.saveSettings(false, false, true);
                },
            });
        }, 200);

        this.#initializeInputValues();
        this.#initializeSelectors();
    }

    /**
     * Initializes input values for the settings menu (needed for range items).
     */
    #initializeInputValues() {
        document.getElementById("setting_p_lineHeight").value = parseFloat(this.settingsObj.values.p_lineHeight);
        document.getElementById("setting_p_paragraphSpacing").value = parseFloat(
            this.settingsObj.values.p_paragraphSpacing
        );
        document.getElementById("setting_p_fontSize").value = parseFloat(this.settingsObj.values.p_fontSize);
        document.getElementById("setting_toc_width").value = parseInt(this.settingsObj.values.toc_width);
        document.getElementById("setting_main_content_width").value = parseInt(
            this.settingsObj.values.main_content_width
        );
        document.getElementById("setting_pagination_bottom").value = parseFloat(
            this.settingsObj.values.pagination_bottom
        );
        document.getElementById("setting_pagination_opacity").value = parseFloat(
            this.settingsObj.values.pagination_opacity
        );
    }

    /**
     * Initializes selectors for the settings menu (needed for dropdown items).
     */
    #initializeSelectors() {
        // Language selector
        const languageIndex =
            this.settingsObj.values.ui_language === "auto" || !this.settingsObj.respectUserLangSetting
                ? 0
                : Object.keys(CONFIG.CONST_UI.LANGUAGE_MAPPING).indexOf(this.settingsObj.values.ui_language) + 1;
        getDropdownSelector(
            $("#setting_ui_language"),
            languageIndex,
            [
                {
                    func: this.settingsObj.saveSettings.bind(this.settingsObj),
                    params: [true, true],
                },
                // {
                //     func: cbReg.go.bind(cbReg),
                //     params: [
                //         "refreshBookList",
                //         {
                //             hardRefresh: false,
                //             sortBookshelf: true,
                //         },
                //     ],
                // },
                {
                    func: cbReg.go.bind(cbReg),
                    params: ["updateFilterBar"],
                },
            ],
            {
                $parent: $("#settings-menu"),
            }
        );

        // Title font and body font selectors
        const titleFontConfig = this.#createFontSelectorConfig(
            "#setting_title_font",
            this.settingsObj.values.title_font
        );
        const bodyFontConfig = this.#createFontSelectorConfig("#setting_body_font", this.settingsObj.values.body_font);
        getDropdownSelector(
            titleFontConfig.element,
            titleFontConfig.index,
            titleFontConfig.callbacks,
            titleFontConfig.options
        );
        getDropdownSelector(
            bodyFontConfig.element,
            bodyFontConfig.index,
            bodyFontConfig.callbacks,
            bodyFontConfig.options
        );
    }

    /**
     * Create font selector configuration
     * @param {string} element - The element to create the font selector for
     * @param {string} fontValue - The font value to set
     * @returns {Object} The font selector configuration
     */
    #createFontSelectorConfig(element, fontValue) {
        return {
            element: $(`${element}`),
            index: findFontIndex(fontValue),
            callbacks: [
                {
                    func: this.settingsObj.saveSettings.bind(this.settingsObj),
                    params: [false, false],
                },
                {
                    func: cbReg.go.bind(cbReg),
                    params: [
                        "updateAllBookCoversAfterFontsLoaded",
                        // { message: `${element} => ${fontValue}` }
                    ],
                },
                {
                    func: cbReg.go.bind(cbReg),
                    params: ["startBookshelfLoop"],
                },
            ],
            options: {
                groupClassResolver: (label) => {
                    return label === CONFIG.RUNTIME_VARS.STYLE.ui_font_group_custom_en ||
                        label === CONFIG.RUNTIME_VARS.STYLE.ui_font_group_custom_zh
                        ? "custom-font"
                        : "";
                },
                actionButtons: [
                    {
                        className: "delete-button",
                        html: ICONS.DELETE_BOOK,
                        onClick: (value, text, e, $element, currentDropdownSelector) => {
                            if ($element.data("group") !== "custom") return;
                            // Find and save the other dropdown selectors
                            const $currentSelect = currentDropdownSelector.$selectElement;
                            const $allSelects = $(".select-hidden"); // All hidden select elements
                            const $otherSelects = $allSelects.not($currentSelect); // Exclude the current select

                            // Remove the option from the current dropdown
                            const removed = currentDropdownSelector.removeItem(value);

                            // If the option item is successfully removed, handle the other dropdowns
                            if (removed) {
                                // For each other dropdown,emove the same option
                                $otherSelects.each(function () {
                                    const otherDropdownSelector = $(this).data("dropdownSelector");
                                    if (otherDropdownSelector) {
                                        otherDropdownSelector.removeItem(value);
                                    }
                                });

                                // Trigger the delete font event
                                cbReg.go("deleteCustomFont", {
                                    fontFamily: value,
                                });
                            }
                        },
                        shouldShow: (value, text, $element) => {
                            return $element.hasClass("optgroup-option") && $element.attr("data-group") === "custom";
                        },
                    },
                    {
                        className: "loading-button",
                        html: ICONS.LOADING,
                        shouldShow: (value, text, $element) => {
                            return $element.hasClass("optgroup-option") && $element.attr("data-status") === "loading";
                        },
                    },
                ],
                $parent: $("#settings-menu"),
            },
        };
    }

    /**
     * Updates the version UI for the settings menu.
     * @param {string} version - The version number
     * @param {string} date - The date of the version
     */
    updateVersionUI(version, date) {
        document.getElementById("settingLabel-about_version_date").textContent = `v${version} (${date})`;
        document.getElementById("settings-version-display").textContent = `v${version}`;
    }

    /**
     * Fetches the version data and updates the version UI for the settings menu.
     */
    fetchAndUpdateVersionData() {
        fetchVersionData().then((versionData) => {
            updateVersionData(versionData);
            this.updateVersionUI(CONFIG.RUNTIME_VARS.APP_VERSION, CONFIG.RUNTIME_VARS.APP_VERSION_DATE);
        });
    }

    /**
     * Handles closing events for the settings menu (click outside or ESC key).
     * @param {Event} e - The event object (either mouse click or keydown)
     */
    #handleClose = (e) => {
        // Don't close the settings menu if it's in the process of being shown
        if (this.isShowing) {
            return;
        }

        // If it's a keydown event, check if it's the Escape key
        if (e.type === "keydown") {
            if (e.key !== "Escape") return;
            e.stopPropagation();
        }

        // Handle the close event
        const actions = handleSettingsClose(e, e.type === "keydown");
        if (actions) {
            if (actions.shouldSave) {
                this.settingsObj.saveSettings();
            }

            if (actions.shouldHide) {
                // Check if there are any open dropdowns
                const openDropdowns = document.querySelectorAll('.select-options[style*="display: block"]');
                if (openDropdowns.length > 0) {
                    // Close all open dropdowns
                    openDropdowns.forEach((dropdown) => {
                        dropdown.style.display = "none";
                        const parent = dropdown.closest(".select");
                        if (parent) {
                            const styledElement = parent.querySelector(".select-styled");
                            if (styledElement) {
                                styledElement.classList.remove("active");
                            }
                        }
                    });
                    // Do not close the settings menu
                    return;
                }

                // Check if there is an open color picker
                if (actions.closedColorPicker) {
                    // Do not close the settings menu, because the color picker was just closed
                    return;
                }

                // If there are no open dropdowns or color picker, close the settings menu
                this.hide();
            }

            // Only remove the keydown event listener when Escape key is pressed
            if (e.type === "keydown") {
                const hasOpenDropdown =
                    document.querySelectorAll('.select-options[style*="display: block"]').length > 0;
                if (!actions.closedColorPicker && !hasOpenDropdown) {
                    document.removeEventListener("keydown", this.#handleClose, true);
                }
            }
        } else if (e.type === "keydown") {
            // Remove the keydown event listener when Escape key is pressed but no action is taken
            document.removeEventListener("keydown", this.#handleClose, true);
        }
    };

    /**
     * Handles global wheel events to prevent scrolling when the settings menu is open.
     * @param {WheelEvent} e - The wheel event object
     */
    #handleGlobalWheel = (e) => {
        if (CONFIG.VARS.IS_SETTINGS_MENU_SHOWN) {
            handleGlobalWheel(e, document.getElementById("settings-menu"));
        }
    };
}
