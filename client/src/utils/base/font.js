/**
 * @fileoverview Font baseline offset computation used by the settings module.
 *
 * (v2 refactor) Extracted from the original client/src/utils/base.js
 * monolith. The original base.js now re-exports from these submodules
 * so existing import paths continue to work unchanged.
 *
 * @module client/src/utils/base/font
 */

import { getSizePrecise } from "./dom.js";
import { isMac, isFirefoxBased } from "./env.js";

/**
 * Computes the vertical and horizontal offsets for font alignment based on baseline offsets.
 * @param {string} fontName - The CSS font-family name (should match the key in baselineOffsets).
 * @param {number|string|HTMLElement|Array<number|string|HTMLElement>} fontSizeOrElement - Font size as a number, CSS string (e.g., "18px"), or HTMLElement to extract from, or an array of these.
 * @param {Object} baselineOffsets - Mapping: { fontFamily: normalizedOffset }.
 * @returns {Object|Array<Object>} Object with { fontSizeValue, fontSizeUnit, baselineOffset, verticalOffset, horizontalOffset } or an array of these.
 *    - fontSizeValue: Numeric font size.
 *    - fontSizeUnit: Unit (e.g., "px").
 *    - baselineVerticalOffset: Normalized vertical baseline offset (usually per 1 fontSize).
 *    - baselineHorizontalOffset: Normalized horizontal baseline offset (usually per 1 fontSize).
 *    - verticalOffset: The actual pixel vertical offset to apply (baselineVerticalOffset * fontSizeValue), or 0 if not found.
 *    - horizontalOffset: The actual pixel horizontal offset to apply (baselineHorizontalOffset * fontSizeValue), or 0 if not found.
 */
export function getFontOffsets(fontName, fontSizeOrElement, baselineOffsets) {
    // Helper for one item
    function calcOne(fsOrEl) {
        let fontSizeValue = 0;
        let fontSizeUnit = "px";
        // Clean font name: trim and remove quotes if present
        const key = (fontName || "").trim().replace(/^['"]|['"]$/g, "");

        // 1. Parse font size from number, string, or HTMLElement
        if (typeof fsOrEl === "number") {
            fontSizeValue = fsOrEl;
        } else if (typeof fsOrEl === "string") {
            const match = fsOrEl.match(/^([\d.]+)([a-z%]+)$/i);
            if (match) {
                fontSizeValue = parseFloat(match[1]);
                fontSizeUnit = match[2];
            }
        } else if (fsOrEl instanceof HTMLElement) {
            const fontSize = getComputedStyle(fsOrEl).getPropertyValue("font-size");
            const match = fontSize.match(/^([\d.]+)([a-z%]+)$/i);
            if (match) {
                fontSizeValue = parseFloat(match[1]);
                fontSizeUnit = match[2];
            }
        }

        // 1.5. Convert em to px
        if (fontSizeUnit === "em") {
            fontSizeValue = getSizePrecise(`${fontSizeValue}${fontSizeUnit}`);
            fontSizeUnit = "px";
        }

        // 2. Find offset
        const baselineOffset = baselineOffsets?.[key] ?? { vertical: 0, horizontal: 0 };
        const baselineVerticalOffset = baselineOffset.vertical;
        const baselineHorizontalOffset = baselineOffset.horizontal;

        // 3. Compute actual pixel offset
        let verticalOffset =
            isFinite(baselineVerticalOffset) && isFinite(fontSizeValue) ? baselineVerticalOffset * fontSizeValue : 0;
        let horizontalOffset =
            isFinite(baselineHorizontalOffset) && isFinite(fontSizeValue)
                ? baselineHorizontalOffset * fontSizeValue
                : 0;

        // console.log(fontSizeValue, fontSizeUnit, baselineOffset, verticalOffset);
        let result = {
            fontSizeValue,
            fontSizeUnit,
            baselineVerticalOffset,
            baselineHorizontalOffset,
            verticalOffset,
            horizontalOffset,
        };

        // Only adjust horizontal offset in Firefox or not on Mac
        if (!isMac() || isFirefoxBased()) {
            result.verticalOffset = 0;
        }

        return result;
    }

    // If input is an array, map over it
    if (Array.isArray(fontSizeOrElement)) {
        return fontSizeOrElement.map(calcOne);
    }
    // If input is an object, map over it
    if (typeof fontSizeOrElement === "object") {
        return Object.fromEntries(Object.entries(fontSizeOrElement).map(([key, value]) => [key, calcOne(value)]));
    }
    // Otherwise, single value
    return calcOne(fontSizeOrElement);
}
