/**
 * @fileoverview String/number/date/byte formatting helpers, plus notification message composition.
 *
 * (v2 refactor) Extracted from the original client/src/utils/base.js
 * monolith. The original base.js now re-exports from these submodules
 * so existing import paths continue to work unchanged.
 *
 * @module client/src/utils/base/format
 */

/**
 * Simple byte formatter using SI units (no IEC option)
 * @public
 * @param {number} bytes - The size in bytes
 * @returns {string} Formatted size string (e.g., "1.5 KB")
 */
export function formatBytes_simple(bytes) {
    if ([-1, 0, 1].includes(bytes)) {
        return `${bytes} Byte${bytes === 1 ? "" : "s"}`;
    }

    const UNITS = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const absBytes = Math.abs(bytes);
    const exponent = Math.floor(Math.log(absBytes) / Math.log(1000));
    const value = (absBytes / Math.pow(1000, exponent)) * Math.sign(bytes);

    return `${value >= 99.995 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[exponent]}`;
}

/**
 * Formats byte size to human readable format using SI or IEC units
 * @public
 * @param {number} bytes - The size in bytes
 * @param {string} units - Unit system to use ('si' or 'iec')
 * @returns {string} Formatted size string (e.g., "1.5 MB" or "1.5 MiB")
 */
export function formatBytes(bytes, units = "si") {
    // Handle special cases
    if ([-1, 0, 1].includes(bytes)) {
        return `${bytes} Byte${bytes === 1 ? "" : "s"}`;
    }

    const UNITS_CONFIG = {
        si: {
            base: 1000, // 10^3
            units: ["Bytes", "kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
        },
        iec: {
            base: 1024, // 2^10
            units: ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"],
        },
    };

    const config = UNITS_CONFIG[units.toLowerCase()] || UNITS_CONFIG.iec;
    const absBytes = Math.abs(bytes);
    const exponent = Math.floor(Math.log(absBytes) / Math.log(config.base));
    const value = (absBytes / Math.pow(config.base, exponent)) * Math.sign(bytes);

    return `${value >= 99.995 || exponent === 0 ? value.toFixed(0) : value.toFixed(2)} ${config.units[exponent]}`;
}


/**
 * Truncates a text to a maximum length
 * @param {string} text - The text to truncate
 * @param {number} maxLength - The maximum length of the text
 * @returns {string} The truncated text
 */
export function truncateText(text, maxLength = 50) {
    // Check if maxLength is a positive integer
    if (typeof maxLength !== "number" || maxLength <= 0) {
        maxLength = 100;
    }
    // Check if text is a string
    if (typeof text !== "string") {
        return "";
    }
    // Check if text is empty
    if (!text) return "";
    // Check if text is longer than maxLength
    if (text.length > maxLength) {
        return text.slice(0, maxLength) + "...";
    }
    return text;
}


/**
 * Converts UTC timestamp to local date/time string
 * @public
 * @param {string|number} utcTimestamp - UTC timestamp to convert
 * @returns {string} Localized date/time string
 */
export function convertUTCTimestampToLocalString(utcTimestamp) {
    return new Date(parseInt(utcTimestamp) + new Date().getTimezoneOffset() * 60000).toLocaleString();
}


/**
 * Compares two dates
 * @public
 * @param {string} dateString1 - The first date string
 * @param {string} dateString2 - The second date string
 * @returns {boolean} true if dateString1 is later, false if dateString1 is earlier, null if both dates are invalid
 */
export function compareDates(dateString1, dateString2) {
    // Convert strings to Date objects
    const date1 = new Date(dateString1);
    const date2 = new Date(dateString2);

    const isValidDate1 = !isNaN(date1);
    const isValidDate2 = !isNaN(date2);

    // Handle invalid dates
    if (!isValidDate1 && !isValidDate2) {
        return null; // Both are invalid
    }
    if (isValidDate1 && !isValidDate2) {
        return true; // date1 is larger because date2 is invalid
    }
    if (!isValidDate1 && isValidDate2) {
        return false; // date2 is larger because date1 is invalid
    }

    // Compare valid dates
    return date1 > date2;
}


/**
 * Constructs a notification message from an array of items.
 * @public
 * @param {string} baseText - The base notification text.
 * @param {Array<string>} itemList - The list of items to include in the message.
 * @param {Object} [options={}] - Additional options.
 * @param {string} [options.language="zh"] - The language of the notification ("en" or "zh").
 * @param {number} [options.maxItems=3] - The maximum number of items to display.
 * @param {string} [options.messageSuffix=""] - The suffix for additional items (e.g., "more files").
 * @returns {string} - The constructed notification message.
 */
export function constructNotificationMessageFromArray(baseText, itemList, options = {}) {
    if (itemList.length === 0) {
        return "";
    }

    const language = options.language ?? "zh";
    const maxItems = options.maxItems ?? 3;
    const messageSuffix = options.messageSuffix ?? "";

    const isEnglish = language === "en";
    const baseTextSuffix = isEnglish ? (itemList.length > 1 ? "s: " : ": ") : "：";
    const suffixMore =
        itemList.length > maxItems
            ? (isEnglish ? ` ${messageSuffix}` : messageSuffix).replace("xxx", itemList.length - maxItems)
            : "";
    const itemNames = itemList
        .slice(0, maxItems)
        .map((item) => (isEnglish ? `"${truncateText(item)}"` : `“${truncateText(item)}”`))
        .join(",\n");
    const moreItems = itemList.length > maxItems ? `,\n...${suffixMore}` : "";

    return `${baseText}${baseTextSuffix}\n${itemNames}${moreItems}`;
}


/**
 * Pads a string with leading zeros
 * @public
 * @param {string|number} str - String to pad
 * @param {number} len - Desired length (default: 2)
 * @returns {string} Padded string
 */
export function padZero(str, len) {
    len = len || 2;
    const zeros = new Array(len).join("0");
    return (zeros + str).slice(-len);
}
