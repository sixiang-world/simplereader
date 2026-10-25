import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPulledSettings } from "../client/src/core/settings-state.js";
import { normalizeSettingValue, readStoredSetting } from "../client/src/core/setting-values.js";
import * as sync from "../client/src/core/config-sync.js";
import { HookRegistry } from "../client/src/core/hooks.js";
import * as t2s from "../client/src/core/t2s.js";
import { hooks } from "../client/src/core/hooks.js";

const makeStorage = () => { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) }; };
const schema = [{ key: "p_fontSize", type: "range", unit: "em", min: 1, max: 3 }];
test("pull advances timestamps even when values have not changed; stale snapshots stay rejected", () => {
    let timestamps = { p_fontSize: 1 };
    let paints = 0;
    const target = { values: { p_fontSize: "2em" }, persistSyncedKeys() {}, applySettings() { paints++; }, syncValuesToForm() {} };
    const opts = { getTimestamps: () => timestamps, saveTimestamps: (next) => { timestamps = next; } };
    applyPulledSettings(target, { p_fontSize: { v: "2em", ts: 100 } }, schema, opts);
    assert.equal(timestamps.p_fontSize, 100);
    applyPulledSettings(target, { p_fontSize: { v: "1em", ts: 50 } }, schema, opts);
    assert.equal(target.values.p_fontSize, "2em");
    assert.equal(paints, 0);
});
test("schema boundary rejects wrong types, out-of-range values and invalid timestamps", () => {
    for (const bad of [null, {}, [], "999em", "2em;display:none", Infinity]) assert.equal(normalizeSettingValue(schema[0], bad), undefined);
    let timestamps = {};
    const target = { values: { p_fontSize: "2em" } };
    const opts = { getTimestamps: () => ({}), saveTimestamps: (next) => { timestamps = next; } };
    for (const ts of [NaN, Infinity, -1, "100"]) applyPulledSettings(target, { p_fontSize: { v: "1em", ts } }, schema, opts);
    assert.deepEqual(timestamps, {});
    assert.equal(target.values.p_fontSize, "2em");
});
test("canonical language key overrides legacy UILang; legacy remains a fallback", () => {
    const storage = makeStorage(); const def = { key: "ui_language", type: "select", options: ["auto", "zh", "en"], default: "auto" };
    storage.setItem("UILang", "en"); assert.equal(readStoredSetting(storage, def, "UILang"), "en");
    storage.setItem("ui_language", "zh"); assert.equal(readStoredSetting(storage, def, "UILang"), "zh");
});
test("manual pull distinguishes missing data from network and parse failures", async () => {
    globalThis.localStorage = makeStorage(); sync.setSyncToken("test_token");
    assert.equal((await sync.pullConfigResult({ fetchImpl: async () => { throw new Error("offline"); } })).status, "error");
    assert.equal((await sync.pullConfigResult({ fetchImpl: async () => ({ status: 404 }) })).status, "missing");
    assert.equal((await sync.pullConfigResult({ fetchImpl: async () => ({ status: 200, ok: true, text: async () => "garbage" }) })).status, "error");
});
test("merged push preserves newer fields on sequential stale-device pushes and never writes after GET failure", async () => {
    globalThis.localStorage = makeStorage(); sync.setSyncToken("test_token");
    let remote = { _meta: { v: 2 }, p_fontSize: { v: "2em", ts: 100 } }; let posts = 0;
    const fetchImpl = async (_url, opts) => { if (opts.method === "POST") { posts++; remote = JSON.parse(opts.body); } return { status: 200, ok: true, text: async () => JSON.stringify(remote) }; };
    const result = await sync.pushMergedConfig({ _meta: { v: 2 }, p_fontSize: { v: "1em", ts: 1 }, p_lineHeight: { v: "3em", ts: 200 } }, { fetchImpl });
    assert.equal(result, true); assert.equal(remote.p_fontSize.v, "2em"); assert.equal(remote.p_lineHeight.v, "3em");
    assert.equal(await sync.pushMergedConfig({}, { fetchImpl: async () => { throw new Error("offline"); } }), false); assert.equal(posts, 1);
});
test("once hooks are consumed on abort, undefined and throw, including concurrent runs", async () => {
    for (const result of [null, false, undefined, "throw"]) {
        const registry = new HookRegistry(); let calls = 0;
        registry.register("test", async () => { calls++; if (result === "throw") throw new Error("test"); return result; }, { once: true });
        await Promise.all([registry.run("test", {}), registry.run("test", {})]); await registry.run("test", {});
        assert.equal(calls, 1); assert.equal(registry.count("test"), 0);
    }
});
test("T2S hook follows effective temporary settings without persisting URL overrides", async () => {
    globalThis.localStorage = makeStorage(); localStorage.setItem("t2s_lite", "true");
    let effective = { lite: false, pro: false };
    t2s.registerT2SHook(() => effective);
    const book = () => ({ bookData: { processedLines: ["傳統臺灣"], metadata: { title: "臺灣" } } });
    try {
        let value = await hooks.run("file:afterProcess", book()); assert.equal(value.bookData.processedLines[0], "傳統臺灣");
        effective = { lite: true, pro: false }; value = await hooks.run("file:afterProcess", book()); assert.equal(value.bookData.processedLines[0], "传统台湾");
        assert.equal(localStorage.getItem("t2s_lite"), "true");
    } finally { t2s.unregisterT2SHook(); }
});
test("remote mode selection commits and persists the mutually exclusive partner", () => {
    const modeSchema = [{ key: "lite", type: "checkbox", mutualExclusiveWith: "pro" }, { key: "pro", type: "checkbox", mutualExclusiveWith: "lite" }];
    let persisted;
    const target = { values: { lite: true, pro: false }, persistSyncedKeys(keys) { persisted = keys; }, applySettings() {}, syncValuesToForm() {} };
    applyPulledSettings(target, { pro: { v: true, ts: 100 } }, modeSchema, { getTimestamps: () => ({}), saveTimestamps() {} });
    assert.deepEqual(target.values, { lite: false, pro: true });
    assert.deepEqual(persisted, ["pro", "lite"]);
});
test("sync deadline bounds requests whose fetch never settles", async () => {
    globalThis.localStorage = makeStorage(); sync.setSyncToken("test_token");
    const result = await sync.pullConfigResult({ fetchImpl: () => new Promise(() => {}), timeoutMs: 5 });
    assert.equal(result.status, "error"); assert.match(result.error, /timed out/);
});
test("preset storage names cannot resolve inherited properties or mutate its prototype", async () => {
    const presets = await import("../client/src/core/presets.js");
    globalThis.localStorage = makeStorage();
    assert.equal(presets.getDefaultPreset("constructor"), null);
    assert.equal(presets.getPreset("constructor"), null);
    presets.savePreset("__proto__", { p_fontSize: "2em" });
    assert.deepEqual(presets.getPreset("__proto__"), { p_fontSize: "2em" });
});
