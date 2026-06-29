/**
 * @fileoverview Jschardet adapter for detecting encoding
 *
 * @module shared/adapters/jschardet
 */

/**
 * @function getJschardet
 * @description Get the Jschardet module
 * @returns {Promise<Object>} The Jschardet module
 */
export const getJschardet = async () => {
    // Frontend or Web Worker: use global variable
    if (typeof self !== "undefined") {
        return self.jschardet; // self is available in both browsers and Workers
    }
    // Node.js environment — use the npm-installed jschardet package.
    // The path used to point at server/node_modules/jschardet/... but the server
    // directory has been archived in the v2 refactor. jschardet is now a
    // devDependency at the repo root.
    // The /* @vite-ignore */ comment prevents Vite from trying to bundle this
    // dynamic import (it is only ever reached in Node, never in the browser —
    // the browser branch above uses self.jschardet loaded as a classic script).
    const jschardet = await import(/* @vite-ignore */ "jschardet");
    return jschardet.default || jschardet;
};
