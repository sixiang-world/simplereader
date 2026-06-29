/**
 * @fileoverview String-aware boolean coercion used throughout the settings layer.
 *
 * (v2 refactor) Extracted from the original client/src/utils/base.js
 * monolith. The original base.js now re-exports from these submodules
 * so existing import paths continue to work unchanged.
 *
 * @module client/src/utils/base/toBool
 */

/**
 * Converts a value to a boolean
 * @public
 * @param {*} val - The value to convert
 * @param {boolean} [forceConvert=true] - Whether to force conversion
 * @returns {boolean} The converted boolean value
 */
export function toBool(val, forceConvert = true) {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
        const str = val.trim().toLowerCase();
        if (str === "true") return true;
        if (str === "false") return false;
    }
    return forceConvert ? Boolean(val) : val;
}
