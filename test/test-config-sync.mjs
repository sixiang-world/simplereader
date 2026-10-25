/**
 * Tests for the config-sync client in client/src/core/config-sync.js.
 *
 * Covers:
 *   - Token management (getSyncToken / setSyncToken / isSyncEnabled)
 *   - Token validation (validateSyncToken)
 *   - pullOnBoot: 200 v2, 200 v1→v2 migration, 404, network error, parse error
 *   - pushConfig: success, 4xx (no retry), 5xx (retry), network error
 *   - pushOnSettingsChange: debounce behavior
 *   - Field timestamps (getFieldTimestamps / setFieldTimestamps / recordLocalChange)
 *   - buildPushPayload: v2 format with timestamps
 *   - mergeSyncedConfig: field-level LWW by timestamp
 *   - flushPendingPush: offline retry
 *
 * Run: node test/test-config-sync.mjs
 */

import assert from "node:assert/strict";

// ── Mock localStorage ───────────────────────────────────────────────────

function makeMockStorage() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, val) => store.set(key, String(val)),
        removeItem: (key) => store.delete(key),
        clear: () => store.clear(),
        _dump: () => Object.fromEntries(store),
    };
}

const mockStorage = makeMockStorage();
globalThis.localStorage = mockStorage;

const cs = await import("../client/src/core/config-sync.js");
const {
    getSyncToken,
    setSyncToken,
    isSyncEnabled,
    validateSyncToken,
    pullOnBoot,
    pushConfig,
    pushOnSettingsChange,
    mergeSyncedConfig,
    buildPushPayload,
    recordLocalChange,
    getFieldTimestamps,
    setFieldTimestamps,
    flushPendingPush,
    getLastPushedAt,
    getLastPulledAt,
    _cancelPendingPush,
} = cs;

let passed = 0;
let failed = 0;
async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
    }
}

function reset() {
    mockStorage.clear();
    _cancelPendingPush();
}

/**
 * Build a fake fetch that returns a configurable response sequence.
 */
function makeFakeFetch(responses) {
    const calls = [];
    let i = 0;
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        const r = responses[Math.min(i, responses.length - 1)];
        i++;
        if (r.error) throw r.error;
        const status = r.status ?? 200;
        const body = r.body ?? "";
        return {
            ok: r.ok ?? (status >= 200 && status < 300),
            status,
            statusText: `Status ${status}`,
            text: async () => body,
        };
    };
    return { fetch: fetchImpl, calls };
}

// ── Tests ───────────────────────────────────────────────────────────────

console.log("core/config-sync.js — token management\n");

await test("setSyncToken / getSyncToken roundtrip", () => {
    reset();
    setSyncToken("mysecretphrase");
    assert.equal(getSyncToken(), "mysecretphrase");
});

await test("setSyncToken(null) clears the token", () => {
    reset();
    setSyncToken("temp");
    assert.equal(isSyncEnabled(), true);
    setSyncToken(null);
    assert.equal(getSyncToken(), null);
    assert.equal(isSyncEnabled(), false);
});

await test("isSyncEnabled: false on empty storage", () => {
    reset();
    assert.equal(isSyncEnabled(), false);
});

await test("isSyncEnabled: true when token set", () => {
    reset();
    setSyncToken("abc");
    assert.equal(isSyncEnabled(), true);
});

// ── Token validation ────────────────────────────────────────────────────

console.log("\ncore/config-sync.js — validateSyncToken\n");

await test("validateSyncToken: empty string is valid (disables sync)", () => {
    const result = validateSyncToken("");
    assert.equal(result.valid, true);
});

await test("validateSyncToken: whitespace-only trims to empty → valid", () => {
    assert.equal(validateSyncToken("   ").valid, true);
});

await test("validateSyncToken: alphanumeric token is valid", () => {
    assert.equal(validateSyncToken("myToken123").valid, true);
});

await test("validateSyncToken: underscore is allowed", () => {
    assert.equal(validateSyncToken("my_token_456").valid, true);
});

await test("validateSyncToken: hyphen is rejected (textdb returns 400)", () => {
    const result = validateSyncToken("my-token");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "sync_token_error_invalid_chars");
});

await test("validateSyncToken: space is rejected", () => {
    assert.equal(validateSyncToken("my token").valid, false);
});

await test("validateSyncToken: special chars are rejected", () => {
    assert.equal(validateSyncToken("tok@en").valid, false);
    assert.equal(validateSyncToken("tok#1").valid, false);
    assert.equal(validateSyncToken("tok!").valid, false);
});

await test("validateSyncToken: too short (< 4 chars) is rejected", () => {
    const result = validateSyncToken("abc");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "sync_token_error_too_short");
});

await test("validateSyncToken: exact minimum length (4) is valid", () => {
    assert.equal(validateSyncToken("abcd").valid, true);
});

await test("validateSyncToken: too long (> 64 chars) is rejected", () => {
    const result = validateSyncToken("a".repeat(65));
    assert.equal(result.valid, false);
    assert.equal(result.reason, "sync_token_error_too_long");
});

await test("validateSyncToken: exact maximum length (64) is valid", () => {
    assert.equal(validateSyncToken("a".repeat(64)).valid, true);
});

await test("validateSyncToken: non-string input is rejected", () => {
    assert.equal(validateSyncToken(null).valid, false);
    assert.equal(validateSyncToken(undefined).valid, false);
    assert.equal(validateSyncToken(12345).valid, false);
    assert.equal(validateSyncToken({}).valid, false);
});

// ── Field timestamps ────────────────────────────────────────────────────

console.log("\ncore/config-sync.js — field timestamps\n");

await test("getFieldTimestamps: empty on fresh storage", () => {
    reset();
    assert.deepEqual(getFieldTimestamps(), {});
});

await test("setFieldTimestamps / getFieldTimestamps roundtrip", () => {
    reset();
    setFieldTimestamps({ a: 1000, b: 2000 });
    assert.deepEqual(getFieldTimestamps(), { a: 1000, b: 2000 });
});

await test("recordLocalChange: stamps key with current time", () => {
    reset();
    const before = Date.now();
    recordLocalChange("p_fontSize");
    const after = Date.now();
    const ts = getFieldTimestamps();
    assert.ok(ts.p_fontSize >= before && ts.p_fontSize <= after);
});

await test("recordLocalChange: preserves existing timestamps", () => {
    reset();
    setFieldTimestamps({ a: 1000 });
    recordLocalChange("b");
    const ts = getFieldTimestamps();
    assert.equal(ts.a, 1000);
    assert.ok(ts.b > 1000);
});

// ── buildPushPayload ────────────────────────────────────────────────────

console.log("\ncore/config-sync.js — buildPushPayload\n");

await test("buildPushPayload: produces v2 format with _meta", () => {
    reset();
    const values = { p_fontSize: "2em", light_bgColor: "#FFF" };
    recordLocalChange("p_fontSize");
    const payload = buildPushPayload(values);
    assert.ok(payload._meta);
    assert.equal(payload._meta.v, 2);
    assert.ok(payload._meta.pushedAt > 0);
});

await test("buildPushPayload: each key has {v, ts} structure", () => {
    reset();
    recordLocalChange("p_fontSize");
    const payload = buildPushPayload({ p_fontSize: "2em" });
    assert.equal(payload.p_fontSize.v, "2em");
    assert.ok(payload.p_fontSize.ts > 0);
});

await test("buildPushPayload: keys without local ts get ts=0", () => {
    reset();
    const payload = buildPushPayload({ unknownKey: "val" });
    assert.equal(payload.unknownKey.ts, 0);
});

// ── pullOnBoot ──────────────────────────────────────────────────────────

console.log("\ncore/config-sync.js — pullOnBoot\n");

await test("pullOnBoot: returns null when sync disabled", async () => {
    reset();
    const result = await pullOnBoot({ fetchImpl: () => assert.fail("should not call fetch") });
    assert.equal(result, null);
});

await test("pullOnBoot: 200 with v2 JSON → returns v2 object", async () => {
    reset();
    setSyncToken("testtoken");
    const payload = {
        _meta: { v: 2, pushedAt: 1000 },
        p_fontSize: { v: "2em", ts: 2000 },
    };
    const { fetch: f } = makeFakeFetch([{ status: 200, body: JSON.stringify(payload) }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.deepEqual(result, payload);
});

await test("pullOnBoot: 200 with v1 JSON → migrates to v2 with ts=0", async () => {
    reset();
    setSyncToken("testtoken");
    // v1 format: flat { key: value }
    const v1Data = { p_fontSize: "2em", light_bgColor: "#FFF" };
    const { fetch: f } = makeFakeFetch([{ status: 200, body: JSON.stringify(v1Data) }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result._meta.v, 2);
    assert.equal(result.p_fontSize.v, "2em");
    assert.equal(result.p_fontSize.ts, 0);
    assert.equal(result.light_bgColor.v, "#FFF");
    assert.equal(result.light_bgColor.ts, 0);
});

await test("pullOnBoot: 404 → returns null (no error)", async () => {
    reset();
    setSyncToken("testtoken");
    const { fetch: f } = makeFakeFetch([{ status: 404, body: "" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: 500 → returns null (no throw)", async () => {
    reset();
    setSyncToken("testtoken");
    const { fetch: f } = makeFakeFetch([{ status: 500, body: "server error" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: network error → returns null (no throw)", async () => {
    reset();
    setSyncToken("testtoken");
    const { fetch: f } = makeFakeFetch([{ error: new Error("network down") }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: invalid JSON body → returns null", async () => {
    reset();
    setSyncToken("testtoken");
    const { fetch: f } = makeFakeFetch([{ status: 200, body: "not valid json" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: JSON array → returns null", async () => {
    reset();
    setSyncToken("testtoken");
    const { fetch: f } = makeFakeFetch([{ status: 200, body: "[1,2,3]" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: empty body → returns null", async () => {
    reset();
    setSyncToken("testtoken");
    const { fetch: f } = makeFakeFetch([{ status: 200, body: "" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: URL is correctly constructed with encoded token", async () => {
    reset();
    setSyncToken("my_token");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200, body: "{}" }]);
    await pullOnBoot({ fetchImpl: f });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("my_token"));
});

await test("pullOnBoot: uses GET method with credentials:omit", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200, body: "{}" }]);
    await pullOnBoot({ fetchImpl: f });
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.credentials, "omit");
});

await test("pullOnBoot: success updates last-pulled timestamp", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f } = makeFakeFetch([{ status: 200, body: "{}" }]);
    await pullOnBoot({ fetchImpl: f });
    const ts = getLastPulledAt();
    assert.ok(typeof ts === "number" && ts > 0);
});

// ── pushConfig ──────────────────────────────────────────────────────────

console.log("\ncore/config-sync.js — pushConfig\n");

await test("pushConfig: returns false when sync disabled", async () => {
    reset();
    const result = await pushConfig({ x: 1 }, { fetchImpl: () => assert.fail("should not call") });
    assert.equal(result, false);
});

await test("pushConfig: 200 success → returns true, updates last-pushed", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200, body: "" }]);
    const result = await pushConfig({ x: 1 }, { fetchImpl: f });
    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.credentials, "omit");
    assert.ok(getLastPushedAt() > 0);
});

await test("pushConfig: 4xx error → returns false, does NOT retry", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 413, body: "too large" }]);
    const result = await pushConfig({ x: 1 }, { fetchImpl: f });
    assert.equal(result, false);
    assert.equal(calls.length, 1, "should not retry on 4xx");
});

await test("pushConfig: 5xx error → retries up to MAX_PUSH_RETRIES (3)", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 500 }, { status: 503 }, { status: 500 }]);
    const result = await pushConfig({ x: 1 }, { fetchImpl: f });
    assert.equal(result, false);
    assert.equal(calls.length, 3);
});

await test("pushConfig: 5xx then 200 → succeeds on retry", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 503 }, { status: 200 }]);
    const result = await pushConfig({ x: 1 }, { fetchImpl: f });
    assert.equal(result, true);
    assert.equal(calls.length, 2);
});

await test("pushConfig: network error → retries up to 3 times", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([
        { error: new Error("net") }, { error: new Error("net") }, { error: new Error("net") },
    ]);
    const result = await pushConfig({ x: 1 }, { fetchImpl: f });
    assert.equal(result, false);
    assert.equal(calls.length, 3);
});

await test("pushConfig: body is JSON-stringified payload", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200 }]);
    const payload = { _meta: { v: 2 }, x: { v: 1, ts: 100 } };
    await pushConfig(payload, { fetchImpl: f });
    assert.equal(calls[0].init.body, JSON.stringify(payload));
});

await test("pushConfig: Content-Type header is text/plain", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200 }]);
    await pushConfig({ x: 1 }, { fetchImpl: f });
    assert.equal(calls[0].init.headers["Content-Type"], "text/plain;charset=UTF-8");
});

// ── pushOnSettingsChange (debounce) ─────────────────────────────────────

console.log("\ncore/config-sync.js — pushOnSettingsChange (debounce)\n");

await test("pushOnSettingsChange: coalesces rapid calls into one push", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200 }]);
    for (let i = 0; i < 5; i++) {
        pushOnSettingsChange({ x: i }, 50, { fetchImpl: f });
    }
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(calls.length, 1, "only one push should happen after debounce");
});

await test("pushOnSettingsChange: no-op when sync disabled", async () => {
    reset();
    let calls = 0;
    const f = async () => { calls++; return { ok: true, status: 200, text: async () => "" }; };
    pushOnSettingsChange({ x: 1 }, 10, { fetchImpl: f });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 0);
});

await test("pushOnSettingsChange: fires after debounce window", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200 }]);
    pushOnSettingsChange({ x: 1 }, 30, { fetchImpl: f });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.length, 0);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(calls.length, 1);
});

// ── mergeSyncedConfig: field-level LWW ──────────────────────────────────

console.log("\ncore/config-sync.js — mergeSyncedConfig (field-level LWW)\n");

await test("mergeSyncedConfig: null syncData → returns copy of current, no changes", () => {
    reset();
    const current = { a: 1 };
    const result = mergeSyncedConfig(current, null);
    assert.deepEqual(result.values, { a: 1 });
    assert.deepEqual(result.changedKeys, []);
});

await test("mergeSyncedConfig: non-object syncData → returns copy of current", () => {
    reset();
    const current = { a: 1 };
    assert.deepEqual(mergeSyncedConfig(current, "string").values, { a: 1 });
    assert.deepEqual(mergeSyncedConfig(current, 42).values, { a: 1 });
    assert.deepEqual(mergeSyncedConfig(current, [1, 2, 3]).values, { a: 1 });
});

await test("mergeSyncedConfig: remote newer → remote wins for that key", () => {
    reset();
    const current = { a: "local", b: "local" };
    const localTs = { a: 1000, b: 1000 };
    const sync = {
        _meta: { v: 2, pushedAt: 2000 },
        a: { v: "remote", ts: 2000 }, // newer → wins
        b: { v: "remote", ts: 500 },  // older → local wins
    };
    const result = mergeSyncedConfig(current, sync, null, localTs);
    assert.equal(result.values.a, "remote"); // remote wins (2000 > 1000)
    assert.equal(result.values.b, "local");  // local wins (500 < 1000)
    assert.deepEqual(result.changedKeys, ["a"]);
    assert.equal(result.timestamps.a, 2000); // adopted remote ts
    assert.equal(result.timestamps.b, 1000); // kept local ts
});

await test("mergeSyncedConfig: equal timestamps → remote wins (first sync)", () => {
    reset();
    const current = { a: "local" };
    const localTs = { a: 0 }; // no local change yet
    const sync = { a: { v: "remote", ts: 0 } }; // v1 migration, ts=0
    const result = mergeSyncedConfig(current, sync, null, localTs);
    assert.equal(result.values.a, "remote"); // 0 >= 0 → remote wins
    assert.deepEqual(result.changedKeys, ["a"]);
});

await test("mergeSyncedConfig: concurrent edits to different keys both survive", () => {
    // This is the core fix for the data-loss bug.
    reset();
    const current = { font: "1em", theme: "dark" };
    const localTs = { font: 1000, theme: 1000 };
    // Device A changed font (ts=2000), Device B changed theme (ts=2000)
    const sync = {
        font: { v: "2em", ts: 2000 },   // remote newer for font
        theme: { v: "light", ts: 500 }, // remote older for theme (local wins)
    };
    const result = mergeSyncedConfig(current, sync, null, localTs);
    assert.equal(result.values.font, "2em");   // remote wins (2000 > 1000)
    assert.equal(result.values.theme, "dark"); // local wins (500 < 1000)
});

await test("mergeSyncedConfig: protected keys are skipped", () => {
    reset();
    const current = { a: "user_change", b: "local" };
    const localTs = { a: 1000, b: 1000 };
    const sync = {
        a: { v: "remote_newer", ts: 9999 }, // would normally win
        b: { v: "remote", ts: 2000 },
    };
    const protectedKeys = new Set(["a"]); // user just changed 'a'
    const result = mergeSyncedConfig(current, sync, null, localTs, protectedKeys);
    assert.equal(result.values.a, "user_change"); // protected — not overridden
    assert.equal(result.values.b, "remote");      // not protected — remote wins
    assert.deepEqual(result.changedKeys, ["b"]);
});

await test("mergeSyncedConfig: allowedKeys filters unknown keys", () => {
    reset();
    const current = { a: 1 };
    const localTs = {};
    const sync = {
        a: { v: 2, ts: 100 },
        unknownKey: { v: "garbage", ts: 100 },
    };
    const allowed = new Set(["a", "b"]);
    const result = mergeSyncedConfig(current, sync, allowed, localTs);
    assert.equal(result.values.a, 2);
    assert.equal(result.values.unknownKey, undefined); // filtered out
});

await test("mergeSyncedConfig: does not mutate input objects", () => {
    reset();
    const current = { a: 1 };
    const localTs = { a: 0 };
    const sync = { a: { v: 2, ts: 100 } };
    const result = mergeSyncedConfig(current, sync, null, localTs);
    assert.deepEqual(current, { a: 1 }); // unchanged
    assert.deepEqual(sync, { a: { v: 2, ts: 100 } }); // unchanged
    assert.deepEqual(result.values, { a: 2 });
});

await test("mergeSyncedConfig: same value at equal ts → no change reported", () => {
    reset();
    const current = { a: "same" };
    const localTs = { a: 100 };
    const sync = { a: { v: "same", ts: 100 } };
    const result = mergeSyncedConfig(current, sync, null, localTs);
    assert.deepEqual(result.changedKeys, []); // value didn't change
    assert.equal(result.timestamps.a, 100);   // ts still updated
});

await test("mergeSyncedConfig: v1-migrated data (ts=0) applies on first sync", () => {
    reset();
    const current = { font: "1em", theme: "dark" };
    const localTs = {}; // no local timestamps — first sync
    // v1-migrated: all ts=0
    const sync = {
        font: { v: "2em", ts: 0 },
        theme: { v: "light", ts: 0 },
    };
    const result = mergeSyncedConfig(current, sync, null, localTs);
    assert.equal(result.values.font, "2em");   // 0 >= 0 → remote wins
    assert.equal(result.values.theme, "light");
    assert.deepEqual(result.changedKeys, ["font", "theme"]);
});

await test("mergeSyncedConfig: local changes win over v1-migrated data", () => {
    reset();
    const current = { font: "2em", theme: "dark" };
    const localTs = { font: 9999 }; // user changed font
    const sync = {
        font: { v: "1em", ts: 0 },    // v1 migrated, ts=0 → local wins
        theme: { v: "light", ts: 0 }, // v1 migrated, ts=0 → remote wins (no local ts)
    };
    const result = mergeSyncedConfig(current, sync, null, localTs);
    assert.equal(result.values.font, "2em");   // local wins (9999 > 0)
    assert.equal(result.values.theme, "light"); // remote wins (0 >= 0)
});

// ── flushPendingPush (offline retry) ────────────────────────────────────

console.log("\ncore/config-sync.js — flushPendingPush (offline retry)\n");

await test("flushPendingPush: returns true when nothing pending", async () => {
    reset();
    const result = await flushPendingPush({ fetchImpl: () => assert.fail("should not call") });
    assert.equal(result, true);
});

await test("flushPendingPush: retries pending payload after failed push", async () => {
    reset();
    setSyncToken("tok");
    // First push: all 3 attempts fail (5xx)
    const { fetch: f1 } = makeFakeFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    const ok1 = await pushConfig({ _meta: { v: 2 }, x: { v: 1, ts: 1 } }, { fetchImpl: f1 });
    assert.equal(ok1, false); // failed
    // Retry: succeeds
    const { fetch: f2, calls: calls2 } = makeFakeFetch([{ status: 200 }]);
    const ok2 = await flushPendingPush({ fetchImpl: f2 });
    assert.equal(ok2, true);
    assert.equal(calls2.length, 1);
});

await test("flushPendingPush: re-stores payload if retry also fails", async () => {
    reset();
    setSyncToken("tok");
    // First push fails
    const { fetch: f1 } = makeFakeFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    await pushConfig({ x: 1 }, { fetchImpl: f1 });
    // Retry also fails
    const { fetch: f2 } = makeFakeFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    const ok = await flushPendingPush({ fetchImpl: f2 });
    assert.equal(ok, false);
    // A third retry should still have a pending payload
    const { fetch: f3, calls: calls3 } = makeFakeFetch([{ status: 200 }]);
    const ok3 = await flushPendingPush({ fetchImpl: f3 });
    assert.equal(ok3, true);
    assert.equal(calls3.length, 1);
});

await test("pushConfig: success clears pending payload", async () => {
    reset();
    setSyncToken("tok");
    // First push fails
    const { fetch: f1 } = makeFakeFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    await pushConfig({ x: 1 }, { fetchImpl: f1 });
    // Second push succeeds
    const { fetch: f2 } = makeFakeFetch([{ status: 200 }]);
    const ok = await pushConfig({ x: 2 }, { fetchImpl: f2 });
    assert.equal(ok, true);
    // flushPendingPush should be a no-op now
    const result = await flushPendingPush({ fetchImpl: () => assert.fail("should not call") });
    assert.equal(result, true);
});

// ── Protocol boundary tests (B05) ───────────────────────────────────────
//
// These tests DOCUMENT the current textdb protocol boundary — they do not
// claim it solved. The KV service is whole-document GET/POST with no CAS,
// no ETag, and no atomic field merge, so:
//   - interleaved concurrent pushes can lose one writer's field
//   - LWW follows each device's *claimed* timestamp, so clock skew wins
// Sequential pull-edit-push (the flow recommended in the settings UI)
// preserves both devices' fields.

/**
 * A tiny shared KV store mimicking textdb: whole-document GET/POST,
 * last POST wins. `makeClient({ holdGet: true })` parks GETs until
 * releaseGets() so two writers can interleave read-then-write.
 */
function makeSharedStore() {
    const state = { doc: null, posts: [] };
    const parkedGets = [];
    const makeClient = ({ holdGet = false } = {}) => async (url, init) => {
        if (!init || init.method !== "POST") {
            if (holdGet) await new Promise((resolve) => parkedGets.push(resolve));
            if (state.doc === null) {
                return { ok: false, status: 404, statusText: "Not Found", text: async () => "" };
            }
            return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(state.doc) };
        }
        const body = JSON.parse(init.body);
        state.doc = body;
        state.posts.push(body);
        return { ok: true, status: 200, statusText: "OK", text: async () => "ok" };
    };
    const releaseGets = () => {
        while (parkedGets.length) parkedGets.shift()();
    };
    return { state, makeClient, releaseGets };
}

await test("protocol boundary: interleaved concurrent pushes lose one writer's field (no CAS)", async () => {
    reset();
    setSyncToken("proto_concurrent");
    const { state, makeClient, releaseGets } = makeSharedStore();
    const base = Date.now();

    const payloadA = { _meta: { v: 2 }, p_fontSize: { v: "2em", ts: base + 10 } };
    const payloadB = { _meta: { v: 2 }, p_lineHeight: { v: "1.8", ts: base + 20 } };

    // Both writers GET before either POSTs — the interleaving that
    // GET-merge-POST cannot prevent without CAS.
    const pushA = cs.pushMergedConfig(payloadA, { fetchImpl: makeClient({ holdGet: true }) });
    const pushB = cs.pushMergedConfig(payloadB, { fetchImpl: makeClient({ holdGet: true }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseGets();
    const [okA, okB] = await Promise.all([pushA, pushB]);

    // Each push *reports* success — that is precisely why the boundary is
    // invisible to users. The store, however, kept only the last POST.
    assert.equal(okA, true, "A's push reports success");
    assert.equal(okB, true, "B's push reports success");
    const keys = Object.keys(state.doc).filter((k) => k !== "_meta");
    assert.equal(
        keys.length, 1,
        `expected exactly one field to survive the race, got: ${keys.join(", ")}`
    );
    assert.equal(state.posts.length, 2, "both writers reached the store");
});

await test("protocol: sequential pull-edit-push keeps both devices' fields", async () => {
    reset();
    setSyncToken("proto_sequential");
    const { state, makeClient } = makeSharedStore();
    const base = Date.now();

    const okA = await cs.pushMergedConfig(
        { _meta: { v: 2 }, p_fontSize: { v: "2em", ts: base + 10 } },
        { fetchImpl: makeClient() });
    assert.equal(okA, true);

    // Device B follows the recommended flow: pull first, then push its own
    // field alongside what it pulled.
    const okB = await cs.pushMergedConfig(
        {
            _meta: { v: 2 },
            p_fontSize: { v: "2em", ts: base + 10 },
            p_lineHeight: { v: "1.8", ts: base + 20 },
        },
        { fetchImpl: makeClient() });
    assert.equal(okB, true);

    assert.equal(state.doc.p_fontSize.v, "2em", "A's field survives");
    assert.equal(state.doc.p_lineHeight.v, "1.8", "B's field survives");
});

await test("protocol boundary: clock skew makes an older edit win by claimed timestamp", async () => {
    reset();
    setSyncToken("proto_clock");
    const { state, makeClient } = makeSharedStore();
    const now = Date.now();

    // Device A's clock runs an hour ahead; its edit is older in real time.
    await cs.pushMergedConfig(
        { _meta: { v: 2 }, p_theme: { v: "dark", ts: now + 3600000 } },
        { fetchImpl: makeClient() });

    // Device B edits the same key later with a correct clock.
    const okB = await cs.pushMergedConfig(
        { _meta: { v: 2 }, p_theme: { v: "sepia", ts: now } },
        { fetchImpl: makeClient() });

    // LWW follows the claimed ts, not real time: B's push succeeds while
    // its edit is silently reverted in the merged document.
    assert.equal(okB, true, "B's push reports success");
    assert.equal(state.doc.p_theme.v, "dark", "skewed older edit wins by timestamp");
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
