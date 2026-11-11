import { normalizeSettingValue } from "./setting-values.js";

const format = "simplereader-settings";
export const MAX_SETTINGS_FILE_BYTES = 64 * 1024;

function collect(schema, values) {
    const result = {};
    for (const def of schema) {
        if (!def.persist || def.type === "hidden" || def.getValue || !Object.hasOwn(values, def.key)) continue;
        const normalized = normalizeSettingValue(def, values[def.key]);
        if (normalized !== undefined) result[def.key] = normalized;
    }
    return result;
}

export function writeSettingsFile(schema, values) {
    return JSON.stringify({ format, version: 1, settings: collect(schema, values) }, null, 2);
}

export function readSettingsFile(schema, text) {
    const document = JSON.parse(text);
    if (document?.format !== format || document.version !== 1 || !document.settings
        || typeof document.settings !== "object" || Array.isArray(document.settings)) {
        throw new TypeError("Invalid SimpleReader settings file");
    }
    return collect(schema, document.settings);
}
