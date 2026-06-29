/**
 * @fileoverview Config sync stub for future multi-device synchronization.
 *
 * Reserved for the planned "运行时配置同步" feature:
 *   - Runtime config (a subset of SETTINGS_SCHEMA values, plus the
 *     reading history) is synced to an external text storage service
 *     (textdb.hunluan.space) so the same user can pick up where they
 *     left off across devices.
 *   - Sync is keyed by a user-provided token (NOT a server-issued
 *     session ID — there is no server anymore post-v2-refactor).
 *   - The sync is fire-and-forget: writes happen in the background,
 *     reads happen on boot. Conflicts are last-write-wins.
 *
 * This module is a STUB — it defines the public API surface but the
 * methods are no-ops that log a warning. When the feature is
 * implemented:
 *
 *   1. Implement the `_push` and `_pull` methods to talk to the textdb
 *      HTTP API.
 *   2. Wire `pullOnBoot()` into app.js's onReady handler (after
 *      settings.enable() runs, so local settings take precedence if
 *      the sync fails).
 *   3. Wire `pushOnSettingsChange()` into settings.js's saveSettings()
 *      via a cbReg listener or a direct call.
 *
 * == Why a separate module instead of using cbReg? ==
 *
 * cbReg is in-process only. Config sync needs to talk to a NETWORK
 * endpoint, with retry, debounce, and conflict resolution. Those
 * concerns don't belong in cbReg. This module encapsulates them.
 *
 * == Why last-write-wins instead of CRDTs/OT? ==
 *
 * The config payload is small (a few KB of settings + reading history).
 * Real-world conflict is rare (the user would have to actively read
 * the same book on two devices simultaneously). LWW is simple, debuggable,
 * and good enough. If conflict becomes a real problem, migrate to a
 * versioned merge later.
 *
 * == Textdb API contract (planned, not yet implemented) ==
 *
 *   PUT  https://textdb.hunluan.space/api/text/{token}
 *        Body: raw text (the JSON-stringified config payload)
 *        Response: { ok: true }
 *
 *   GET  https://textdb.hunluan.space/api/text/{token}
 *        Response: raw text (the last PUT body), or 404 if never written
 *
 * The token is a user-provided string (e.g. a memorable phrase). It
 * is NOT secure — anyone who knows the token can read/write the
 * config. For sensitive data, the user should pick an unguessable
 * token. Future versions may add a hash of the token as the actual
 * storage key to make enumeration harder.
 *
 * @module client/src/core/config-sync
 */

/**
 * @typedef {Object} SyncConfig
 * @property {string} token - The user-provided sync token.
 * @property {string} [endpoint="https://textdb.hunluan.space"] - The textdb base URL.
 * @property {number} [debounceMs=2000] - Debounce window for pushOnSettingsChange().
 */

const DEFAULT_ENDPOINT = "https://textdb.hunluan.space";
const DEFAULT_DEBOUNCE_MS = 2000;
const STORAGE_KEY = "config_sync_token";

let _pushTimer = null;

/**
 * Get the user's sync token from localStorage.
 * @returns {string|null} The token, or null if sync is not configured.
 */
export function getSyncToken() {
    return localStorage.getItem(STORAGE_KEY);
}

/**
 * Set the sync token. Setting to null disables sync.
 * @param {string|null} token
 */
export function setSyncToken(token) {
    if (token) {
        localStorage.setItem(STORAGE_KEY, token);
    } else {
        localStorage.removeItem(STORAGE_KEY);
    }
}

/**
 * Is sync configured? (i.e. is there a token in localStorage?)
 * @returns {boolean}
 */
export function isSyncEnabled() {
    return !!getSyncToken();
}

/**
 * Pull the synced config from textdb on boot.
 *
 * This is a STUB — it logs a warning and returns null. When implemented,
 * it should:
 *   1. GET {endpoint}/api/text/{token}
 *   2. If 200, JSON.parse the body and return it.
 *   3. If 404, return null (no sync data yet — first run on this device).
 *   4. On network error, return null and log a warning (don't throw —
 *      sync failure should not block app boot).
 *
 * The caller (app.js) is responsible for merging the returned config
 * into settings.values via settings.applyPreset() (or a similar merge).
 *
 * @returns {Promise<Object|null>} The synced config object, or null.
 */
export async function pullOnBoot() {
    const token = getSyncToken();
    if (!token) return null;

    console.warn(
        "[config-sync] pullOnBoot() is a STUB. The textdb API client " +
            "has not been implemented yet. Returning null (no sync data)."
    );
    return null;
}

/**
 * Push the current config to textdb.
 *
 * This is a STUB — it logs a warning and does nothing. When implemented,
 * it should:
 *   1. PUT {endpoint}/api/text/{token} with the JSON-stringified payload.
 *   2. On network error, retry with exponential backoff (3 attempts).
 *   3. On success, update localStorage["config_sync_lastPushedAt"].
 *
 * The payload is the caller's responsibility — pass in whatever subset
 * of settings + reading history you want synced.
 *
 * @param {Object} payload - The config object to sync.
 * @returns {Promise<boolean>} True if the push succeeded, false otherwise.
 */
export async function pushConfig(payload) {
    const token = getSyncToken();
    if (!token) return false;

    console.warn(
        "[config-sync] pushConfig() is a STUB. The textdb API client " +
            "has not been implemented yet. Payload will be dropped.",
        { token, payloadSize: JSON.stringify(payload).length }
    );
    return false;
}

/**
 * Debounced version of pushConfig, intended to be called from
 * settings.js's saveSettings() (or a cbReg listener on "applySettings").
 *
 * Coalesces rapid consecutive calls (e.g. when the user drags a slider)
 * into a single network push after DEFAULT_DEBOUNCE_MS of quiet.
 *
 * @param {Object} payload - The config object to sync.
 * @param {number} [debounceMs=2000] - Override the debounce window.
 */
export function pushOnSettingsChange(payload, debounceMs = DEFAULT_DEBOUNCE_MS) {
    if (!isSyncEnabled()) return;
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
        _pushTimer = null;
        pushConfig(payload).catch((err) => {
            console.warn("[config-sync] Background push failed:", err);
        });
    }, debounceMs);
}
