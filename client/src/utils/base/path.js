/**
 * @fileoverview Object path utilities: snake_to_camel, setDeep (dot/bracket path setter).
 *
 * (v2 refactor) Extracted from the original client/app/utils/base.js
 * monolith. The original base.js now re-exports from these submodules
 * so existing import paths continue to work unchanged.
 *
 * @module client/app/utils/base/path
 */

/**
 * Converts a snake_case string to camelCase.
 *
 * @param {string} str - The snake_case input string.
 * @returns {string} The converted camelCase string.
 *
 * @example
 *   snakeToCamel("pagination_bottom"); // returns "paginationBottom"
 *   snakeToCamel("some_long_snake_case"); // returns "someLongSnakeCase"
 */
export function snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}


/**
 * Sets a deeply nested property on an object, given a dot/bracket notation path.
 *
 * @param {Object} obj - The object to set the property on.
 * @param {string|string[]} path - The path to the property (dot/bracket notation or array of keys).
 * @param {*} value - The value to set.
 * @returns {boolean} True if set successfully, false if failed.
 *
 * @example
 * setDeep(CONFIG, 'CONST_CONFIG.SHOW_FILTER_BAR', true);
 * setDeep(CONFIG, ['CONST_CONFIG', 'SHOW_FILTER_BAR'], true);
 * setDeep(window, 'foo.bar[2].baz', 123);
 */
export function setDeep(obj, path, value) {
    if (typeof path === "string") {
        // Split dot/bracket notation into keys, e.g. a.b[1].c => ['a','b','1','c']
        path = path
            .replace(/\[(\w+)\]/g, ".$1") // convert [key] to .key
            .replace(/^\./, "") // remove leading dot
            .split(".");
    }
    if (!Array.isArray(path)) return false;
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        // If prop doesn't exist or isn't an object, create plain object
        if (!(key in cur) || (typeof cur[key] !== "object" && typeof cur[key] !== "function")) {
            cur[key] = {};
        }
        cur = cur[key];
    }
    cur[path[path.length - 1]] = value;
    return true;
}
