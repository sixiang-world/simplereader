/** Schema value validation shared by URL, storage, presets and sync boundaries. */
export function normalizeSettingValue(def, input, { source = "storage" } = {}) {
    if (input == null || (typeof input !== "string" && typeof input !== "number" && typeof input !== "boolean")) return undefined;
    const text = String(input).trim();
    switch (def.type) {
        case "checkbox": {
            const value = text.toLowerCase();
            if (["true", "1", "yes", "on"].includes(value)) return true;
            if (["false", "0", "no", "off", ""].includes(value)) return false;
            // Preserve the public URL contract; persisted/remote junk is rejected.
            return source === "url" ? false : undefined;
        }
        case "range": {
            const match = text.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(em|px|%|rem|vh|vw)?$/i);
            if (!match) return undefined;
            const number = Number(match[1]);
            if (!Number.isFinite(number) || (def.min !== undefined && number < def.min) || (def.max !== undefined && number > def.max)) return undefined;
            return match[1] + (match[2] || def.unit || "");
        }
        case "color":
            return /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(text) ? text : undefined;
        case "select": {
            const match = def.options?.find((option) => String(option).toLowerCase() === text.toLowerCase());
            return def.options?.length ? match : text;
        }
        case "select-font":
            // Font family values may contain spaces, quotes and commas, but no CSS declarations.
            return text.length > 0 && text.length <= 512 && !/[;{}<>]/.test(text) && !Array.from(text).some((char) => char.charCodeAt(0) < 32) ? text : undefined;
        default:
            return text;
    }
}

export function normalizeSettings(schema, values, options) {
    const normalized = {};
    if (!values || typeof values !== "object") return normalized;
    for (const def of schema) {
        if (!Object.hasOwn(values, def.key)) continue;
        const value = normalizeSettingValue(def, values[def.key], options);
        if (value !== undefined) normalized[def.key] = value;
    }
    return normalized;
}

/** Canonical language key wins; UILang is only a migration fallback. */
export function readStoredSetting(storage, def, alternate = null) {
    for (const key of [def.key, alternate].filter(Boolean)) {
        const value = storage.getItem(key);
        if (value == null) continue;
        const normalized = normalizeSettingValue(def, value);
        if (normalized !== undefined) return normalized;
    }
    return def.default;
}
