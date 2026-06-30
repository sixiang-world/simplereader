/**
 * Tests for the config-sync HTTP client in client/src/core/config-sync.js.
 *
 * Covers:
 *   - getSyncToken / setSyncToken / isSyncEnabled (localStorage roundtrip)
 *   - pullOnBoot: 200 with valid JSON, 404, network error, parse error,
 *     non-object body, sync disabled
 *   - pushConfig: 200 success, 4xx (no retry), 5xx (retry with backoff),
 *     network error (retry), sync disabled
 *   - pushOnSettingsChange: debounce behavior
 *   - mergeSyncedConfig: local precedence rule
 *
 * Network calls are mocked via a fake fetchImpl — no real HTTP requests
 * are made. This makes the tests fast and deterministic.
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
    pullOnBoot,
    pushConfig,
    pushOnSettingsChange,
    mergeSyncedConfig,
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
 *
 * @param {Array<{status?: number, body?: string, ok?: boolean, error?: Error}>} responses
 * @returns {{fetch: typeof fetch, calls: Array<{url: string, init: Object}>}}
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
    setSyncToken("my-secret-phrase");
    assert.equal(getSyncToken(), "my-secret-phrase");
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

console.log("\ncore/config-sync.js — pullOnBoot\n");

await test("pullOnBoot: returns null when sync disabled", async () => {
    reset();
    const result = await pullOnBoot({ fetchImpl: () => assert.fail("should not call fetch") });
    assert.equal(result, null);
});

await test("pullOnBoot: 200 with valid JSON object → returns parsed object", async () => {
    reset();
    setSyncToken("test-token");
    const payload = { p_fontSize: "1.5em", light_bgColor: "#FFFFFF" };
    const { fetch: f } = makeFakeFetch([{ status: 200, body: JSON.stringify(payload) }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.deepEqual(result, payload);
});

await test("pullOnBoot: 404 → returns null (no error)", async () => {
    reset();
    setSyncToken("test-token");
    const { fetch: f } = makeFakeFetch([{ status: 404, body: "" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: 500 → returns null (no throw)", async () => {
    reset();
    setSyncToken("test-token");
    const { fetch: f } = makeFakeFetch([{ status: 500, body: "server error" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: network error → returns null (no throw)", async () => {
    reset();
    setSyncToken("test-token");
    const { fetch: f } = makeFakeFetch([{ error: new Error("network down") }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: invalid JSON body → returns null (no throw)", async () => {
    reset();
    setSyncToken("test-token");
    const { fetch: f } = makeFakeFetch([{ status: 200, body: "not valid json" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: JSON array (not object) → returns null", async () => {
    reset();
    setSyncToken("test-token");
    const { fetch: f } = makeFakeFetch([{ status: 200, body: "[1,2,3]" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: empty body → returns null", async () => {
    reset();
    setSyncToken("test-token");
    const { fetch: f } = makeFakeFetch([{ status: 200, body: "" }]);
    const result = await pullOnBoot({ fetchImpl: f });
    assert.equal(result, null);
});

await test("pullOnBoot: URL is correctly constructed with encoded token", async () => {
    reset();
    setSyncToken("my token with spaces");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200, body: "{}" }]);
    await pullOnBoot({ fetchImpl: f });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("my%20token%20with%20spaces"), `URL: ${calls[0].url}`);
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
    assert.ok(typeof ts === "number");
    assert.ok(ts > 0);
});

console.log("\ncore/config-sync.js — pushConfig\n");

await test("pushConfig: returns false when sync disabled", async () => {
    reset();
    const result = await pushConfig({ x: 1 }, { fetchImpl: () => assert.fail("should not call fetch") });
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
    assert.equal(calls[0].init.body, JSON.stringify({ x: 1 }));
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
    const { fetch: f, calls } = makeFakeFetch([
        { status: 500 },
        { status: 503 },
        { status: 500 },
    ]);
    const result = await pushConfig({ x: 1 }, { fetchImpl: f });
    assert.equal(result, false);
    assert.equal(calls.length, 3, "should retry 3 times on 5xx");
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
    const { fetch: f, calls } = makeFakeFetch([{ error: new Error("net") }, { error: new Error("net") }, { error: new Error("net") }]);
    const result = await pushConfig({ x: 1 }, { fetchImpl: f });
    assert.equal(result, false);
    assert.equal(calls.length, 3);
});

await test("pushConfig: success after 2 network errors", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([
        { error: new Error("net") },
        { error: new Error("net") },
        { status: 200 },
    ]);
    const result = await pushConfig({ x: 1 }, { fetchImpl: f });
    assert.equal(result, true);
    assert.equal(calls.length, 3);
});

await test("pushConfig: body is JSON-stringified payload", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200 }]);
    const payload = { a: 1, b: "two", c: [3, 4] };
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

console.log("\ncore/config-sync.js — pushOnSettingsChange (debounce)\n");

await test("pushOnSettingsChange: coalesces rapid calls into one push", async () => {
    reset();
    setSyncToken("tok");
    const { fetch: f, calls } = makeFakeFetch([{ status: 200 }]);
    // Fire 5 rapid calls.
    for (let i = 0; i < 5; i++) {
        pushOnSettingsChange({ x: i }, 50, { fetchImpl: f });
    }
    // Wait long enough for the debounce to fire.
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
    // Before debounce fires:
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.length, 0);
    // After debounce fires:
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(calls.length, 1);
});

console.log("\ncore/config-sync.js — mergeSyncedConfig\n");

await test("mergeSyncedConfig: null syncData → returns copy of current", () => {
    reset();
    const current = { a: 1 };
    const merged = mergeSyncedConfig(current, null);
    assert.deepEqual(merged, { a: 1 });
});

await test("mergeSyncedConfig: sync OVERRIDES local (P1-2 — sync wins)", () => {
    // P1-2 fix: the previous implementation used "local wins, sync fills
    // empty" which effectively disabled sync because loadSettings()
    // populates every key with either localStorage value or schema default.
    // The new semantics is "sync wins" — sync data overrides local values.
    reset();
    const current = { a: "local", b: "local-only" };
    const sync = { a: "remote", c: "remote-only" };
    const merged = mergeSyncedConfig(current, sync);
    assert.equal(merged.a, "remote"); // sync wins
    assert.equal(merged.b, "local-only"); // local-only key preserved
    assert.equal(merged.c, "remote-only"); // sync-only key added
});

await test("mergeSyncedConfig: null syncData → returns copy of current", () => {
    reset();
    const current = { a: 1, b: 2 };
    const merged = mergeSyncedConfig(current, null);
    assert.deepEqual(merged, { a: 1, b: 2 });
    assert.notEqual(merged, current); // must be a new object, not the same ref
});

await test("mergeSyncedConfig: non-object syncData → returns copy of current", () => {
    reset();
    const current = { a: 1 };
    assert.deepEqual(mergeSyncedConfig(current, "string"), { a: 1 });
    assert.deepEqual(mergeSyncedConfig(current, 42), { a: 1 });
    assert.deepEqual(mergeSyncedConfig(current, [1, 2, 3]), { a: 1 });
});

await test("mergeSyncedConfig: does not mutate input objects", () => {
    reset();
    const current = { a: 1 };
    const sync = { b: 2 };
    const merged = mergeSyncedConfig(current, sync);
    assert.deepEqual(current, { a: 1 }); // unchanged
    assert.deepEqual(sync, { b: 2 }); // unchanged
    assert.deepEqual(merged, { a: 1, b: 2 });
});

console.log("\ncore/config-sync.js — Issue 3: allowedKeys filtering\n");

await test("REGRESSION i3: allowedKeys filters out unknown keys from syncData", () => {
    // Issue 3 fix: unknown keys (not in SETTINGS_SCHEMA) must be dropped
    // from syncData during merge. This prevents a feedback loop where
    // unknown keys accumulate in the sync store via push → pull → push.
    reset();
    const current = { p_fontSize: "1em", light_bgColor: "#FFF" };
    const sync = {
        p_fontSize: "2em", // known key — should be merged
        light_bgColor: "#000", // known key — should be merged
        unknownKey1: "garbage", // unknown — should be dropped
        unknownKey2: 42, // unknown — should be dropped
        _userInteracted: true, // unknown — should be dropped (defensive)
    };
    const allowed = new Set(["p_fontSize", "light_bgColor", "p_lineHeight"]);
    const merged = mergeSyncedConfig(current, sync, allowed);
    assert.equal(merged.p_fontSize, "2em"); // known, merged
    assert.equal(merged.light_bgColor, "#000"); // known, merged
    assert.equal(merged.unknownKey1, undefined); // unknown, dropped
    assert.equal(merged.unknownKey2, undefined); // unknown, dropped
    assert.equal(merged._userInteracted, undefined); // unknown, dropped
});

await test("REGRESSION i3: allowedKeys=null (default) keeps all keys (backward compat)", () => {
    // The default (no allowedKeys) preserves the pre-Issue-3 behavior
    // so existing callers and tests don't break. This is important for
    // the test environment where we can't import SETTINGS_SCHEMA.
    reset();
    const current = { a: 1 };
    const sync = { a: 2, unknownKey: "kept" };
    const merged = mergeSyncedConfig(current, sync); // no allowedKeys
    assert.equal(merged.a, 2);
    assert.equal(merged.unknownKey, "kept"); // NOT filtered
});

await test("REGRESSION i3: allowedKeys=empty Set keeps all keys", () => {
    // An empty Set is treated the same as null (no filtering). This
    // avoids accidentally dropping everything if the caller passes an
    // empty set by mistake.
    reset();
    const current = { a: 1 };
    const sync = { a: 2, unknownKey: "kept" };
    const merged = mergeSyncedConfig(current, sync, new Set());
    assert.equal(merged.a, 2);
    assert.equal(merged.unknownKey, "kept"); // NOT filtered
});

await test("REGRESSION i3: allowedKeys preserves local-only keys", () => {
    // Keys in currentValues but NOT in syncData should always be
    // preserved, regardless of allowedKeys.
    reset();
    const current = { a: 1, b: 2, c: 3 };
    const sync = { a: 10 }; // only updates 'a'
    const allowed = new Set(["a", "b", "c"]);
    const merged = mergeSyncedConfig(current, sync, allowed);
    assert.equal(merged.a, 10); // updated by sync
    assert.equal(merged.b, 2); // preserved (local-only, in allowed)
    assert.equal(merged.c, 3); // preserved (local-only, in allowed)
});

await test("REGRESSION i3: allowedKeys with syncData containing only unknown keys", () => {
    // Edge case: syncData has ONLY unknown keys. The merge should
    // return currentValues unchanged (all sync keys dropped).
    reset();
    const current = { a: 1, b: 2 };
    const sync = { unknown1: "x", unknown2: "y" };
    const allowed = new Set(["a", "b"]);
    const merged = mergeSyncedConfig(current, sync, allowed);
    assert.deepEqual(merged, { a: 1, b: 2 }); // unchanged
    assert.equal(merged.unknown1, undefined);
    assert.equal(merged.unknown2, undefined);
});

await test("REGRESSION i3: allowedKeys with non-Set value is ignored (no filtering)", () => {
    // Defensive: if someone passes a non-Set value (array, string, etc.),
    // we should NOT filter — fall back to the default behavior.
    reset();
    const current = { a: 1 };
    const sync = { a: 2, unknown: "kept" };
    // Pass an array instead of a Set — should be ignored.
    const merged = mergeSyncedConfig(current, sync, ["a"]);
    assert.equal(merged.a, 2);
    assert.equal(merged.unknown, "kept"); // NOT filtered (array is not a Set)
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
