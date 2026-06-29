/**
 * @fileoverview Generic function utilities: debounce, onReady, requestIdleCallback polyfill.
 *
 * (v2 refactor) Extracted from the original client/src/utils/base.js
 * monolith. The original base.js now re-exports from these submodules
 * so existing import paths continue to work unchanged.
 *
 * @module client/src/utils/base/func
 */

/**
 * Debounces a function
 * @public
 * @param {Function} func - The function to debounce
 * @param {number} wait - The wait time in milliseconds
 * @returns {Function} The debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const context = this;
        const later = () => {
            clearTimeout(timeout);
            func.apply(context, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}


/**
 * Adds a callback to be executed when the DOM is ready
 * @public
 * @param {Function} callback - The callback to execute
 */
export function onReady(callback) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", callback);
    } else {
        callback(); // Already loaded, just run it
    }
}


/**
 * Polyfill for requestIdleCallback because Safari does not support it
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback
 */
export function requestIdleCallbackPolyfill() {
    if (typeof window.requestIdleCallback === "undefined") {
        window.requestIdleCallback = function (cb) {
            const start = Date.now();
            return setTimeout(() => {
                cb({
                    didTimeout: false,
                    timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
                });
            }, 1);
        };

        window.cancelIdleCallback = function (id) {
            clearTimeout(id);
        };
    }
}
