/**
 * @fileoverview Config sync client for textdb.hunluan.space.
 *
 * Implements multi-device settings synchronization via the textdb-edgeone
 * serverless KV store (https://github.com/sixiang-world/textdb-edgeone).
 *
 * == Sync model: MANUAL (on-demand) ==
 *
 * Pull and push are independent request actions — they are NOT triggered
 * automatically. There is no boot-time auto-pull, no periodic background
 * polling, no auto-push on settings change, and no `online`-event auto-retry.
 * The caller (e.g. the settings panel) invokes `pullOnBoot` / `pushConfig`
 * explicitly (typically via "Pull" / "Push" buttons) and handles the
 * returned change-status to update local state and re-render the UI.
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
 * == Data format (v2) ==
 *
 *   {
 *     "_meta": { "v": 2, "pushedAt": 1722000000000 },
 *     "p_fontSize": { "v": "2em", "ts": 1722000001000 },
 *     "light_bgColor": { "v": "#FFF", "ts": 1721999999000 }
 *   }
 *
 * Each field carries its own timestamp (`ts`). Merge is FIELD-LEVEL
 * last-write-wins: for each key, the entry with the higher timestamp
 * wins. This prevents the data-loss bug where a full-state push from
 * device B (which hasn't pulled device A's changes) overwrites A's
 * edits on unrelated keys.
 *
 * == Backward compatibility (v1 → v2 migration) ==
 *
 * Old sync data (v1) is a flat `{ key: value }` object with no
 * timestamps. On pull, v1 data is auto-migrated: each value is
 * wrapped as `{ v: value, ts: 0 }`. A ts of 0 means "ancient" — any
 * local change (ts > 0) wins over migrated v1 data. The next push
 * writes v2 format, upgrading the remote store.
 *
 * == Conflict resolution ==
 *
 * Field-level last-write-wins by timestamp. Concurrent edits to
 * DIFFERENT keys on multiple devices are preserved (both survive the
 * merge). Concurrent edits to the SAME key resolve to the newer
 * timestamp.
 *
 * == Protected keys ==
 *
 * When the user modifies a setting in the current session, that key
 * is added to a "protected" set. Pulls never override protected keys
 * — the user's in-session change always wins for those keys. This
 * prevents a slow pull from reverting a change the user just made
 * before the push has fired.
 *
 * == Failure modes ==
 *
 * Sync failure must NEVER crash the app. All network errors are
 * caught, logged, and surface as `null` (pull) or `false` (push).
 * Failed pushes are stored for manual retry via `flushPendingPush()`.
 *
 * @module client/src/core/config-sync
 */

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "https://textdb.hunluan.space";
const DEFAULT_DEBOUNCE_MS = 2000;
const STORAGE_KEY = "config_sync_token";
const STORAGE_KEY_LAST_PUSH = "config_sync_lastPushedAt";
const STORAGE_KEY_LAST_PULL = "config_sync_lastPulledAt";
const STORAGE_KEY_FIELD_TS = "config_sync_fieldTs";
const SYNC_SCHEMA_VERSION = 2;

/** @type {number} Max push attempts on failure. */
const MAX_PUSH_RETRIES = 3;
/** @type {number} Base delay (ms) for exponential backoff. */
const BACKOFF_BASE_MS = 500;

// ── Module-level state ──────────────────────────────────────────────────

/** @type {ReturnType<typeof setTimeout>|null} Debounce timer for pushOnSettingsChange. */
let _pushTimer = null;

/** @type {any|null} Payload awaiting retry (set when all push attempts fail). */
let _pendingPushPayload = null;

// ── Token management ────────────────────────────────────────────────────

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

// ── Token validation ────────────────────────────────────────────────────

/**
 * Valid sync token characters.
 *
 * textdb.hunluan.space rejects keys that contain certain characters
 * (notably hyphens "-" return HTTP 400 "Invalid Key"). We restrict
 * tokens to alphanumeric + underscore to stay safely inside the
 * accepted character set.
 *
 * @type {RegExp}
 * @private
 */
const VALID_TOKEN_RE = /^[a-zA-Z0-9_]+$/;

/**
 * Minimum token length. Shorter tokens are too easy to guess.
 * @type {number}
 * @private
 */
const MIN_TOKEN_LENGTH = 4;

/**
 * Maximum token length. Extremely long tokens may hit URL length limits.
 * @type {number}
 * @private
 */
const MAX_TOKEN_LENGTH = 64;

/**
 * Validate a user-provided sync token.
 *
 * @param {string} token - The token to validate.
 * @returns {{valid: boolean, reason?: string}}
 * @public
 */
export function validateSyncToken(token) {
    if (typeof token !== "string") {
        return { valid: false, reason: "sync_token_error_type" };
    }
    const trimmed = token.trim();
    if (trimmed.length === 0) {
        return { valid: true }; // Empty = disable sync, which is valid
    }
    if (trimmed.length < MIN_TOKEN_LENGTH) {
        return { valid: false, reason: "sync_token_error_too_short" };
    }
    if (trimmed.length > MAX_TOKEN_LENGTH) {
        return { valid: false, reason: "sync_token_error_too_long" };
    }
    if (!VALID_TOKEN_RE.test(trimmed)) {
        return { valid: false, reason: "sync_token_error_invalid_chars" };
    }
    return { valid: true };
}

// ── Field timestamp management ──────────────────────────────────────────

/**
 * Get the local field-timestamp map from localStorage.
 *
 * @returns {Object<string,number>} A `{ key: ts }` object.
 * @public
 */
export function getFieldTimestamps() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_FIELD_TS);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            ? parsed
            : {};
    } catch (_e) {
        return {};
    }
}

/**
 * Persist the field-timestamp map to localStorage.
 *
 * @param {Object<string,number>} ts - The `{ key: ts }` object to store.
 * @public
 */
export function setFieldTimestamps(ts) {
    try {
        localStorage.setItem(STORAGE_KEY_FIELD_TS, JSON.stringify(ts));
    } catch (e) {
        console.warn("[config-sync] Failed to persist field timestamps:", e);
    }
}

/**
 * Record a local change for a specific key, stamping it with the
 * current time. Called from settings.saveSettings() for every key
 * whose value changed.
 *
 * @param {string} key - The setting key that was modified.
 * @public
 */
export function recordLocalChange(key) {
    const ts = getFieldTimestamps();
    ts[key] = Date.now();
    setFieldTimestamps(ts);
}

// ── URL builder ─────────────────────────────────────────────────────────

/**
 * Build the full URL for a textdb key.
 *
 * @param {string} token - The sync token (becomes the URL path segment).
 * @param {string} [endpoint] - Override the default endpoint.
 * @returns {string} Full URL.
 * @private
 */
function _buildUrl(token, endpoint = DEFAULT_ENDPOINT) {
    const base = endpoint.replace(/\/+$/, "");
    return `${base}/${encodeURIComponent(token)}`;
}

// ── Sync data parsing (v1/v2) ───────────────────────────────────────────

/**
 * Parse raw textdb response text into a v2-format sync object.
 *
 * Detects whether the stored data is v2 (has `_meta.v === 2`) or v1
 * (flat `{ key: value }`). V1 data is auto-migrated: each value is
 * wrapped as `{ v: value, ts: 0 }` (ts=0 means "ancient").
 *
 * @param {string} text - Raw response body from textdb GET.
 * @returns {Object|null} V2-format sync object, or null if unparseable.
 * @private
 */
function _parseSyncData(text) {
    if (!text) return null;
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        console.warn("[config-sync] Failed to parse stored JSON:", e.message);
        return null;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        console.warn("[config-sync] Stored value is not a plain object");
        return null;
    }
    // Already v2?
    if (parsed._meta && parsed._meta.v === SYNC_SCHEMA_VERSION) {
        return parsed;
    }
    // v1 → migrate to v2 with ts=0 (ancient).
    const migrated = { _meta: { v: SYNC_SCHEMA_VERSION, pushedAt: 0 } };
    for (const [key, value] of Object.entries(parsed)) {
        if (key === "_meta") continue;
        migrated[key] = { v: value, ts: 0 };
    }
    return migrated;
}

// ── Push payload builder ────────────────────────────────────────────────

/**
 * Build a v2-format push payload from flat settings values and the
 * local field-timestamp map.
 *
 * @param {Object<string,*>} values - Flat `{ key: value }` settings.
 * @returns {Object} V2-format payload ready for POST.
 * @public
 */
export function buildPushPayload(values) {
    const ts = getFieldTimestamps();
    const payload = {
        _meta: { v: SYNC_SCHEMA_VERSION, pushedAt: Date.now() },
    };
    for (const [key, value] of Object.entries(values)) {
        payload[key] = { v: value, ts: ts[key] ?? 0 };
    }
    return payload;
}

// ── Pull ────────────────────────────────────────────────────────────────

/**
 * Pull the synced config from textdb.
 *
 * @param {Object} [opts]
 * @param {string} [opts.endpoint] - Override the default endpoint (tests).
 * @param {typeof fetch} [opts.fetchImpl] - Override fetch (tests).
 * @returns {Promise<Object|null>} V2-format sync object, or null.
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
            credentials: "omit",
            redirect: "follow",
        });

        if (res.status === 404) return null;
        if (!res.ok) {
            console.warn(`[config-sync] pullOnBoot: HTTP ${res.status} ${res.statusText}`);
            return null;
        }

        const text = await res.text();
        const syncData = _parseSyncData(text);
        if (syncData) {
            try {
                localStorage.setItem(STORAGE_KEY_LAST_PULL, String(Date.now()));
            } catch (_e) { /* ignore */ }
        }
        return syncData;
    } catch (e) {
        console.warn("[config-sync] pullOnBoot: network error:", e.message);
        return null;
    }
}

// ── Push ────────────────────────────────────────────────────────────────

/**
 * Push a payload to textdb. Retries up to {@link MAX_PUSH_RETRIES}
 * times with exponential backoff on transient failures.
 *
 * On total failure, stores the payload for retry via
 * {@link flushPendingPush} (typically triggered by the `online` event).
 *
 * @param {Object} payload - The v2-format config object to sync.
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
                } catch (_e) { /* ignore */ }
                _pendingPushPayload = null;
                return true;
            }

            // 4xx = client error (bad/revoked token, quota). Don't retry the
            // network call, but RETAIN the payload so a later manual retry (or
            // token fix) can resend it instead of silently dropping the user's
            // settings change. (Previously the payload was discarded here.)
            if (res.status >= 400 && res.status < 500) {
                console.warn(
                    `[config-sync] pushConfig: HTTP ${res.status} ${res.statusText} (not retrying; payload retained for retry)`
                );
                _pendingPushPayload = payload;
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

    // All retries exhausted — store for later retry on `online`.
    _pendingPushPayload = payload;
    return false;
}

/**
 * Debounced push, intended for settings-change events. Coalesces rapid
 * consecutive calls into a single network push.
 *
 * @param {Object} payload - V2-format config object (use buildPushPayload).
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
 * Retry a previously-failed push (if any). Typically called on the
 * browser `online` event.
 *
 * @param {Object} [opts] - Forwarded to pushConfig.
 * @returns {Promise<boolean>} True if a pending push succeeded (or none
 *          was pending), false if the retry also failed.
 * @public
 */
export async function flushPendingPush(opts = {}) {
    if (!_pendingPushPayload) return true;
    const payload = _pendingPushPayload;
    // Clear first; if it fails again, pushConfig will re-store it.
    _pendingPushPayload = null;
    return pushConfig(payload, opts);
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
 * Reset all module-level mutable state. Tests ONLY — clears the pending-push
 * payload and any in-flight debounce timer so cases don't leak state into
 * each other. (Addresses review P3-4: `_pendingPushPayload` is module-level
 * singleton state that could cross-contaminate tests.)
 * @public
 */
export function __resetForTest() {
    _pendingPushPayload = null;
    if (_pushTimer) {
        clearTimeout(_pushTimer);
        _pushTimer = null;
    }
}

// ── Field-level merge ───────────────────────────────────────────────────

/**
 * Merge synced config into current settings values using field-level
 * last-write-wins by timestamp.
 *
 * For each key in `syncData`:
 *   - Skip if not in `allowedKeys` (unknown keys — prevents feedback loop).
 *   - Skip if in `protectedKeys` (user's in-session changes — prevents
 *     a slow pull from reverting the user's edits).
 *   - If `remoteTs >= localTs`: take the remote value (adopt its timestamp).
 *   - Else: keep the local value and timestamp.
 *
 * @param {Object<string,*>} currentValues - Flat settings.values.
 * @param {Object|null} syncData - V2-format sync object (or null).
 * @param {Set<string>|null} [allowedKeys=null] - Schema keys to allow.
 * @param {Object<string,number>} [localTs={}] - Local field timestamps.
 * @param {Set<string>} [protectedKeys=new Set()] - Keys to skip.
 * @returns {{values: Object<string,*>, timestamps: Object<string,number>, changedKeys: string[]}}
 * @public
 */
export function mergeSyncedConfig(currentValues, syncData, allowedKeys = null, localTs = {}, protectedKeys = new Set()) {
    if (!syncData || typeof syncData !== "object" || Array.isArray(syncData)) {
        return { values: { ...currentValues }, timestamps: { ...localTs }, changedKeys: [] };
    }

    const result = { ...currentValues };
    const newTs = { ...localTs };
    const changedKeys = [];

    for (const [key, entry] of Object.entries(syncData)) {
        if (key === "_meta") continue;

        // Filter unknown keys.
        if (allowedKeys instanceof Set && allowedKeys.size > 0 && !allowedKeys.has(key)) {
            continue;
        }

        // Skip protected keys (user's in-session changes).
        if (protectedKeys instanceof Set && protectedKeys.has(key)) {
            continue;
        }

        // Extract remote value + timestamp.
        let remoteValue, remoteTs;
        if (entry && typeof entry === "object" && "v" in entry && "ts" in entry) {
            remoteValue = entry.v;
            remoteTs = typeof entry.ts === "number" ? entry.ts : 0;
        } else {
            // Unexpected format — skip.
            continue;
        }

        const localTsForKey = localTs[key] ?? 0;

        if (remoteTs >= localTsForKey) {
            // Remote is newer (or equal) — take remote value.
            if (result[key] !== remoteValue) {
                result[key] = remoteValue;
                changedKeys.push(key);
            }
            newTs[key] = remoteTs;
        }
        // else: local is newer — keep local value and timestamp.
    }

    return { values: result, timestamps: newTs, changedKeys };
}

// ── Timestamp accessors (kept for backward compat) ──────────────────────

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
