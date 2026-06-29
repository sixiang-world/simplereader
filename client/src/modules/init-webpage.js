/**
 * @fileoverview Webpage initialization script
 *
 * This script runs FIRST (loaded by index.html as a classic module before
 * app.js) to set the document language and theme attributes BEFORE first
 * paint, preventing FOUC (flash of unstyled content). It also injects the
 * SVG sprite so icon-rendered UI doesn't flash unstyled.
 *
 * The script respects user language settings if the `respectUserLangSetting`
 * flag is set to true. Otherwise, it defaults to the browser's language.
 *
 * The script also checks if the page was opened as no-UI mode from the
 * browser extension, and sets the `openedAsNoUI` attribute on the HTML
 * document element accordingly.
 *
 * (v2 refactor) Removed ~155 lines of @deprecated loadFontsInBackground
 * code — the real implementation lives in app.js. The unused
 * setupReaderUISplitViewParams function was also removed.
 *
 * @module client/src/modules/features/init-webpage
 * @requires client/src/config/icons
 * @requires client/src/utils/base
 */

import { createSvgSprite } from "../config/icons.js";
import { toBool } from "../utils/base.js";

/**
 * Toggle console.time
 */
window.consoleTime = false;

/**
 * Initialize the webpage
 */
(function () {
    if (window.consoleTime) console.time("[time] Initialize Webpage");
    setupLanguageSettings();
    setupUITheme();
    setupSVGSprite();
    if (window.consoleTime) console.timeEnd("[time] Initialize Webpage");

    if (window.consoleTime) console.time("[time][background] Load Fonts and Check No-UI Mode");
    checkAndSetNoUIMode()
        .then(() => {
            if (window.consoleTime) console.timeEnd("[time][background] Load Fonts and Check No-UI Mode");
        })
        .catch((error) => {
            console.error("[ERROR] Initializing failed:", error);
        });
})();

/**
 * Setup language settings
 */
function setupLanguageSettings() {
    /**
     * Flag to determine if user language settings should be respected
     * If not, then the book's language will be used
     */
    const respectUserLangSetting = toBool(localStorage.getItem("respectUserLangSetting"), false) ?? false;
    document.documentElement.setAttribute("respectUserLangSetting", respectUserLangSetting);
    // console.log("Respect user language settings: ", document.documentElement.getAttribute("respectUserLangSetting"));

    /**
     * Get the browser's language settings
     */
    const browser_LANGs = navigator.languages || [navigator.userLanguage] || [navigator.browserLanguage] || [
            navigator.language,
        ] || ["zh"];
    // const browser_LANG = browser_LANGs.includes("zh") ? "zh" : navigator.language.split("-")[0];
    const browser_LANG = browser_LANGs.includes("zh") ? "zh" : "en";
    localStorage.setItem("browser_LANG", browser_LANG);
    console.log("Browser language: ", browser_LANG);

    /**
     * Get the user's preferred language from local storage or use the browser's language
     */
    const user_LANG = localStorage.getItem("UILang") || browser_LANG;
    const webLANG = respectUserLangSetting ? user_LANG : browser_LANG;

    /**
     * Set the web language attribute on the HTML document element
     */
    document.documentElement.setAttribute("lang", webLANG);
    document.documentElement.setAttribute("webLANG", webLANG);
    document.documentElement.setAttribute("data-lang", webLANG);
    console.log("App set to language: ", webLANG);
}

/**
 * Setup UI theme
 */
function setupUITheme() {
    const uiMode = toBool(localStorage.getItem("UIMode"), false) ?? true;
    const theme = uiMode ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Create SVG sprite
 */
function setupSVGSprite() {
    document.body.insertBefore(createSvgSprite(), document.body.firstChild);
}

/**
 * Check if the page was opened as no-UI mode from extension
 * @async
 * @returns {Promise<boolean>}
 */
async function checkAndSetNoUIMode() {
    /**
     * Get the API object
     */
    const api = typeof chrome !== "undefined" ? chrome : typeof browser !== "undefined" ? browser : null;

    /**
     * Wait for the storage API to be available
     * @param {number} maxAttempts - Maximum number of attempts to check for storage API
     * @param {number} delayMs - Delay in milliseconds between attempts
     * @returns {Promise<boolean>}
     */
    const _waitForStorage = async (maxAttempts = 10, delayMs = 100) => {
        for (let i = 0; i < maxAttempts; i++) {
            if (api?.storage?.local) return true;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return false;
    };

    /**
     * Check if the page was opened as no-UI mode from extension
     * @returns {Promise<boolean>}
     */
    const _checkOpenedAsNoUI = async () => {
        // Wait for storage API to be available
        const storageAvailable = await _waitForStorage();
        if (!storageAvailable) return false;

        const result = await new Promise((resolve) => {
            api.storage.local.get(["openedAsNoUI"], (res) =>
                resolve(api.runtime.lastError ? false : !!res.openedAsNoUI)
            );
        });

        return result;
    };

    /**
     * Check if the page was opened as no-UI mode from extension
     * @returns {Promise<boolean>}
     */
    const openedAsNoUI = await _checkOpenedAsNoUI();
    document.documentElement.setAttribute("openedAsNoUI", openedAsNoUI);
}
