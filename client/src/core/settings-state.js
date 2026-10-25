import { mergeSyncedConfig, getFieldTimestamps, setFieldTimestamps } from "./config-sync.js";
import { normalizeSettingValue } from "./setting-values.js";

/** Apply a validated remote snapshot without coupling data versions to DOM changes. */
export function applyPulledSettings(target, syncData, schema, { getTimestamps = getFieldTimestamps, saveTimestamps = setFieldTimestamps } = {}) {
    if (!syncData || typeof syncData !== "object" || !target.values) return [];
    const validated = {};
    for (const def of schema) {
        // Derived fields are recalculated locally, never accepted as remote authority.
        if (def.hidden && def.getValue) continue;
        const entry = Object.hasOwn(syncData, def.key) && syncData[def.key];
        if (!entry || typeof entry !== "object" || !Number.isFinite(entry.ts) || entry.ts < 0) continue;
        const value = normalizeSettingValue(def, entry.v, { source: "sync" });
        if (value !== undefined) validated[def.key] = { v: value, ts: entry.ts };
    }
    const result = mergeSyncedConfig(target.values, validated, new Set(schema.map((s) => s.key)), getTimestamps(), target._userInteractedKeys || new Set());
    // A newly enabled remote mode disables its opposite in the same committed
    // transition, rather than letting schema iteration order defeat the choice.
    for (const key of [...result.changedKeys]) {
        const def = schema.find((item) => item.key === key);
        const other = def?.mutualExclusiveWith;
        if (result.values[key] !== true || !other) continue;
        if (target._userInteractedKeys?.has(other) && result.values[other] === true) {
            result.values[key] = target.values[key];
            result.timestamps[key] = getTimestamps()[key] ?? 0;
            result.changedKeys = result.changedKeys.filter((changed) => changed !== key);
        } else if (result.values[other] !== false) {
            result.values[other] = false;
            result.timestamps[other] = result.timestamps[key];
            if (!result.changedKeys.includes(other)) result.changedKeys.push(other);
        }
    }
    saveTimestamps(result.timestamps);
    if (result.changedKeys.length) {
        target.values = result.values;
        target.persistSyncedKeys(result.changedKeys);
        if (result.changedKeys.includes("ui_language")) target.applyLanguagePreference?.(target.values.ui_language);
        target.applySettings();
        target.syncValuesToForm(result.changedKeys);
    }
    return result.changedKeys;
}
