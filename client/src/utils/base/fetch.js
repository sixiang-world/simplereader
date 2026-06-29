/**
 * @fileoverview Typed JSON fetchers for version.json, help.json, and font_baseline_offsets.json.
 *
 * (v2 refactor) Extracted from the original client/src/utils/base.js
 * monolith. The original base.js now re-exports from these submodules
 * so existing import paths continue to work unchanged.
 *
 * @module client/src/utils/base/fetch
 */

/**
 * Fetches the version number from a JSON file.
 * @public
 * @async
 * @param {string} url - The URL of the JSON file containing the version.
 * @returns {Promise<string>} A promise that resolves to the version number, or an empty string if not found.
 */
export async function fetchVersion(url = "version.json") {
    return fetchJSON(url, {
        transform: (data) => (data?.version ? `v${data?.version}` : ""),
        defaultValue: "",
        errorPrefix: "Error fetching version",
    });
}


/**
 * Fetches the complete version data from a JSON file.
 * @public
 * @async
 * @param {string} url - The URL of the JSON file containing the version data.
 * @returns {Promise<Object>} A promise that resolves to the version data object, or null if not found.
 */
export async function fetchVersionData(url = "version.json") {
    return fetchJSON(url, {
        transform: (data) => data ?? null,
        defaultValue: null,
        errorPrefix: "Error fetching version data",
    });
}


/**
 * Fetches the help text from a JSON file.
 * @public
 * @async
 * @param {string} url - The URL of the JSON file containing the help text.
 * @returns {Promise<Object>} A promise that resolves to the help text object, or null if not found.
 */
export async function fetchHelpText(url = "help.json") {
    return fetchJSON(url, {
        transform: (data) => data ?? null,
        defaultValue: null,
        errorPrefix: "Error fetching help text",
    });
}


/**
 * Fetches the font baseline offsets from a JSON file.
 * @public
 * @async
 * @param {string} url - The URL of the JSON file containing the font baseline offsets.
 * @returns {Promise<Object>} A promise that resolves to the font baseline offsets object, or null if not found.
 */
export async function fetchFontBaselineOffsets(url = "font_baseline_offsets.json") {
    return fetchJSON(url, {
        transform: (data) => data ?? null,
        defaultValue: null,
        errorPrefix: "Error fetching font baseline offsets",
    });
}


/**
 * Fetches JSON data from a URL
 * @private
 * @async
 * @param {string} url - The URL of the JSON file to fetch
 * @param {Object} [options={}] - Additional options
 * @param {Function} [options.transform] - Function to transform the fetched data
 * @param {*} [options.defaultValue] - Default value to return if the fetch fails
 * @param {string} [options.errorPrefix="Error fetching data"] - Error prefix for console logs
 * @returns {Promise<*>} A promise that resolves to the fetched data, or the default value if the fetch fails
 */
async function fetchJSON(
    url,
    { transform = (data) => data, defaultValue = null, errorPrefix = "Error fetching data" } = {}
) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return transform(data);
    } catch (error) {
        console.error(`${errorPrefix}:`, error);
        return defaultValue;
    }
}
