/**
 * @fileoverview Environment detection: Safari, Firefox, Windows, macOS (browser + Node aware).
 *
 * (v2 refactor) Extracted from the original client/src/utils/base.js
 * monolith. The original base.js now re-exports from these submodules
 * so existing import paths continue to work unchanged.
 *
 * @module client/src/utils/base/env
 */

/**
 * Checks if the browser is Safari
 * @public
 * @returns {boolean} True if the browser is Safari, false otherwise
 */
export function isSafari() {
    const ua = navigator.userAgent;
    const isSafari = /^((?!chrome|chromium|android).)*safari/i.test(ua);
    return isSafari;
}


/**
 * Checks if the browser is Firefox-based
 * @public
 * @returns {boolean} True if the browser is Firefox-based, false otherwise
 */
export function isFirefoxBased() {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes("firefox") && !ua.includes("seamonkey");
}


/**
 * Detects if the current environment is Windows.
 * Supports both Node.js and browser environments.
 * @returns {boolean} True if running on Windows, false otherwise.
 */
export function isWindows() {
    // Node.js
    if (typeof process !== "undefined" && process.platform) {
        return process.platform === "win32";
    }
    // Browser
    if (typeof navigator !== "undefined") {
        return /Win/.test(navigator.platform) || /Windows/.test(navigator.userAgent);
    }
    // Fallback (unknown environment)
    return false;
}


/**
 * Detects if the current environment is macOS.
 * Supports both Node.js and browser environments.
 * @returns {boolean} True if running on macOS, false otherwise.
 */
export function isMac() {
    // Node.js
    if (typeof process !== "undefined" && process.platform) {
        return process.platform === "darwin";
    }
    // Browser
    if (typeof navigator !== "undefined") {
        return /Mac/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
    }
    // Fallback (unknown environment)
    return false;
}
