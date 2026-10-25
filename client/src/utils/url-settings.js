/** URL parameters override effective settings without writing persistent storage. */
import { normalizeSettingValue } from "../core/setting-values.js";

export function parseURLSettings(schema, urlParams) {
    const overrides = {};
    const definitions = new Map(schema.map((def) => [def.key, def]));
    for (const [key, input] of urlParams) {
        const def = definitions.get(key);
        if (!def || def.hidden) continue;
        const value = normalizeSettingValue(def, input, { source: "url" });
        if (value !== undefined) overrides[key] = value;
    }
    return overrides;
}
