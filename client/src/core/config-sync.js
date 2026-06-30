/**
 * @fileoverview Config sync HTTP client for textdb.hunluan.space.
 *
 * Implements multi-device settings synchronization via the textdb-edgeone
 * serverless KV store (https://github.com/sixiang-world/textdb-edgeone).
 *
 * == API contract (textdb-edgeone) ==
 *
 *   GET    https://textdb.hunluan.space/{key}
 *          Returns raw text body (text/plain). 404 if key doesn't exist.
 *
 *   POST   https://textdb.hunluan.space/{key}
 *          Body: raw text (request body becomes the stored content).
 *          Returns 200 on success.
 *
 *   DELETE https://textdb.hunluan.space/{key}
 *          Removes the key. Returns 200 on success.
 *
 * The "key" is the user-provided sync token (a memorable phrase). It
 * is NOT secure — anyone who knows the token can read/write the
 * config. For sensitive data, the user should pick an unguessable
 * token.
 *
 * == Conflict resolution ==
 *
 * Last-write-wins. The textdb store has no concept of versions; the
 * most recent POST wins. This is simple and good enough for
 * single-user multi-device sync where concurrent writes are rare.
 *
 * == Failure modes ==
 *
 * Sync failure must NEVER crash the app. All network errors are
 * caught, logged, and surface as `null` (pull) or `false` (push).
 * The caller is responsible for degrading gracefully.
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
const STORAGE_KEY_LAST_PUSH = "config_sync_lastPushedAt";
const STORAGE_KEY_LAST_PULL = "config_sync_lastPulledAt";

/** @type {number} Max push attempts on failure. */
const MAX_PUSH_RETRIES = 3;
/** @type {number} Base delay (ms) for exponential backoff. */
const BACKOFF_BASE_MS = 500;

/** @type {ReturnType<typeof setTimeout>|null} Debounce timer for pushOnSettingsChange. */
let _pushTimer = null;

/**
 * Get the user's sync token from localStorage.
 * @returns {string|null} The token, or null if sync is not configured.
 * @public
 */
export function getSyncToken() {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch (_e) {
        return null;
    }
}

/**
 * Set the sync token. Setting to null disables sync.
 * @param {string|null} token
 * @public
 */
export function setSyncToken(token) {
    try {
        if (token) {
            localStorage.setItem(STORAGE_KEY, token);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch (e) {
        console.warn("[config-sync] Failed to access localStorage:", e);
    }
}

/**
 * Is sync configured? (i.e. is there a token in localStorage?)
 * @returns {boolean}
 * @public
 */
export function isSyncEnabled() {
    return !!getSyncToken();
}

/**
 * Build the full URL for a textdb key.
 *
 * @param {string} token - The sync token (becomes the URL path segment).
 * @param {string} [endpoint] - Override the default endpoint.
 * @returns {string} Full URL.
 * @private
 */
function _buildUrl(token, endpoint = DEFAULT_ENDPOINT) {
    // Trim trailing slash, then append the token (URL-encoded for safety).
    const base = endpoint.replace(/\/+$/, "");
    return `${base}/${encodeURIComponent(token)}`;
}

/**
 * Pull the synced config from textdb on boot.
 *
 * Behavior:
 *   - If sync is disabled (no token), returns null immediately.
 *   - GET {endpoint}/{token}
 *   - 200 → JSON.parse the body and return the resulting object.
 *   - 404 → return null (first run on this device — no sync data yet).
 *   - Network error / non-200 / parse error → return null and log a warning.
 *
 * The caller (app.js) is responsible for merging the returned config
 * into settings.values via a shallow merge.
 *
 * @param {Object} [opts]
 * @param {string} [opts.endpoint] - Override the default endpoint (tests).
 * @param {typeof fetch} [opts.fetchImpl] - Override fetch (tests).
 * @returns {Promise<Object|null>} The synced config object, or null.
 * @public
 */
export async function pullOnBoot(opts = {}) {
    const token = getSyncToken();
    if (!token) return null;

    const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

    if (typeof fetchImpl !== "function") {
        console.warn("[config-sync] pullOnBoot: fetch is not available");
        return null;
    }

    const url = _buildUrl(token, endpoint);
    try {
        const res = await fetchImpl(url, {
            method: "GET",
            // textdb is a public KV store — no auth headers needed.
            // We don't send cookies to a cross-origin endpoint.
            credentials: "omit",
            redirect: "follow",
        });

        if (res.status === 404) {
            // No sync data yet — first run on this device.
            return null;
        }
        if (!res.ok) {
            console.warn(`[config-sync] pullOnBoot: HTTP ${res.status} ${res.statusText}`);
            return null;
        }

        const text = await res.text();
        if (!text) return null;

        try {
            const parsed = JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                console.warn("[config-sync] pullOnBoot: stored value is not a plain object");
                return null;
            }
            // Update last-pulled timestamp.
            try {
                localStorage.setItem(STORAGE_KEY_LAST_PULL, String(Date.now()));
            } catch (_e) {
                /* ignore */
            }
            return parsed;
        } catch (e) {
            console.warn("[config-sync] pullOnBoot: failed to parse stored JSON:", e.message);
            return null;
        }
    } catch (e) {
        console.warn("[config-sync] pullOnBoot: network error:", e.message);
        return null;
    }
}

/**
 * Push the current config to textdb.
 *
 * Retries up to {@link MAX_PUSH_RETRIES} times with exponential backoff
 * on transient failures (network errors, 5xx responses).
 *
 * @param {Object} payload - The config object to sync.
 * @param {Object} [opts]
 * @param {string} [opts.endpoint] - Override the default endpoint (tests).
 * @param {typeof fetch} [opts.fetchImpl] - Override fetch (tests).
 * @returns {Promise<boolean>} True if the push succeeded, false otherwise.
 * @public
 */
export async function pushConfig(payload, opts = {}) {
    const token = getSyncToken();
    if (!token) return false;

    const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
        console.warn("[config-sync] pushConfig: fetch is not available");
        return false;
    }

    const url = _buildUrl(token, endpoint);
    const body = JSON.stringify(payload);

    for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
        try {
            const res = await fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=UTF-8" },
                body,
                credentials: "omit",
                redirect: "follow",
            });

            if (res.ok) {
                try {
                    localStorage.setItem(STORAGE_KEY_LAST_PUSH, String(Date.now()));
                } catch (_e) {
                    /* ignore */
                }
                return true;
            }

            // 4xx = client error — don't retry (e.g. 413 payload too large).
            if (res.status >= 400 && res.status < 500) {
                console.warn(
                    `[config-sync] pushConfig: HTTP ${res.status} ${res.statusText} (not retrying)`
                );
                return false;
            }

            // 5xx = server error — retry with backoff.
            console.warn(
                `[config-sync] pushConfig: HTTP ${res.status} (attempt ${attempt}/${MAX_PUSH_RETRIES})`
            );
        } catch (e) {
            console.warn(
                `[config-sync] pushConfig: network error (attempt ${attempt}/${MAX_PUSH_RETRIES}):`,
                e.message
            );
        }

        if (attempt < MAX_PUSH_RETRIES) {
            const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
        }
    }

    return false;
}

/**
 * Debounced version of pushConfig, intended to be called from
 * settings.js's saveSettings() (or a cbReg listener on "applySettings").
 *
 * Coalesces rapid consecutive calls (e.g. when the user drags a slider)
 * into a single network push after `debounceMs` of quiet.
 *
 * @param {Object} payload - The config object to sync.
 * @param {number} [debounceMs=2000] - Override the debounce window.
 * @param {Object} [opts] - Forwarded to pushConfig (endpoint, fetchImpl).
 * @public
 */
export function pushOnSettingsChange(payload, debounceMs = DEFAULT_DEBOUNCE_MS, opts = {}) {
    if (!isSyncEnabled()) return;
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
        _pushTimer = null;
        pushConfig(payload, opts).catch((err) => {
            console.warn("[config-sync] Background push failed:", err);
        });
    }, debounceMs);
}

/**
 * Cancel any pending debounced push. Mainly for tests.
 * @public
 */
export function _cancelPendingPush() {
    if (_pushTimer) {
        clearTimeout(_pushTimer);
        _pushTimer = null;
    }
}

/**
 * Get the timestamp of the last successful push, or null.
 * @returns {number|null} Epoch milliseconds, or null.
 * @public
 */
export function getLastPushedAt() {
    try {
        const v = localStorage.getItem(STORAGE_KEY_LAST_PUSH);
        return v ? parseInt(v, 10) : null;
    } catch (_e) {
        return null;
    }
}

/**
 * Get the timestamp of the last successful pull, or null.
 * @returns {number|null} Epoch milliseconds, or null.
 * @public
 */
export function getLastPulledAt() {
    try {
        const v = localStorage.getItem(STORAGE_KEY_LAST_PULL);
        return v ? parseInt(v, 10) : null;
    } catch (_e) {
        return null;
    }
}

/**
 * Merge synced config into the current settings values.
 *
 * Sync data OVERRIDES local values. This implements the "sync wins"
 * rule, which matches user expectations for multi-device sync: when a
 * user changes a setting on device A and syncs, they expect device B
 * to pick up the new value — not to keep its old local default.
 *
 * The previous implementation used "local wins, sync fills empty" which
 * effectively disabled sync because loadSettings() populates EVERY key
 * with either the localStorage value or the schema default — there are
 * no empty slots for sync to fill.
 *
 * == Key filtering (Issue 3 fix) ==
 *
 * If `allowedKeys` is provided, only keys in that set are merged from
 * syncData. Unknown keys (not in the schema) are dropped. This prevents
 * a feedback loop:
 *
 *   1. syncData contains an unknown key X (e.g. from an old schema
 *      version, or a typo, or a malicious push).
 *   2. mergeSyncedConfig writes X into settings.values.
 *   3. saveSettings() persists settings.values — but since X is not in
 *      the schema, it's not written to localStorage (saveSettingFromInput
 *      only iterates SETTINGS_SCHEMA). However, pushOnSettingsChange
 *      sends the full settings.values object (including X) back to sync.
 *   4. The next pull sees X again → infinite loop of garbage keys
 *      accumulating in the sync store.
 *
 * The caller (app.js) passes the schema keys:
 *   mergeSyncedConfig(values, syncData, new Set(SETTINGS_SCHEMA.map(s => s.key)))
 *
 * config-sync.js does NOT import SETTINGS_SCHEMA directly to avoid a
 * potential circular dependency (settings.js imports config-sync.js,
 * and settings.js re-exports SETTINGS_SCHEMA via its schema import).
 * The caller injects the allowed-keys set instead.
 *
 * @param {Object<string,*>} currentValues - The current settings.values.
 * @param {Object<string,*>|null} syncData - The synced config (or null).
 * @param {Set<string>|null} [allowedKeys=null] - Optional set of keys to
 *        allow from syncData. If null, all syncData keys are merged (the
 *        pre-Issue-3 behavior, kept for backward compatibility with tests).
 * @returns {Object<string,*>} A new values object with sync data merged in.
 * @public
 */
export function mergeSyncedConfig(currentValues, syncData, allowedKeys = null) {
    if (!syncData || typeof syncData !== "object" || Array.isArray(syncData)) {
        return { ...currentValues };
    }
    // Filter syncData to allowed keys (if provided) to prevent unknown
    // keys from entering settings.values and creating a feedback loop
    // through pushOnSettingsChange → textdb → pullOnBoot.
    let filtered = syncData;
    if (allowedKeys instanceof Set && allowedKeys.size > 0) {
        filtered = {};
        let dropped = 0;
        for (const [k, v] of Object.entries(syncData)) {
            if (allowedKeys.has(k)) {
                filtered[k] = v;
            } else {
                dropped++;
            }
        }
        if (dropped > 0) {
            console.warn(
                `[config-sync] mergeSyncedConfig: dropped ${dropped} unknown key(s) ` +
                    `from sync data (not in SETTINGS_SCHEMA). This prevents a ` +
                    `feedback loop where unknown keys accumulate in the sync store.`
            );
        }
    }
    // Sync overrides local. Shallow merge: sync values replace local
    // values for the same key; local-only keys are preserved.
    return { ...currentValues, ...filtered };
}
