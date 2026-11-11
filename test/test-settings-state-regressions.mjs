import * as OpenCC from "opencc-js";
globalThis.OpenCC = OpenCC;
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettingValue, readStoredSetting } from "../client/src/core/setting-values.js";
import { HookRegistry } from "../client/src/core/hooks.js";
import * as t2s from "../client/src/core/t2s.js";
import { hooks } from "../client/src/core/hooks.js";

const makeStorage = () => { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) }; };
const schema = [{ key: "p_fontSize", type: "range", unit: "em", min: 1, max: 3 }];
test("schema boundary rejects wrong types and out-of-range values", () => {
    for (const bad of [null, {}, [], "999em", "2em;display:none", Infinity]) assert.equal(normalizeSettingValue(schema[0], bad), undefined);
});
test("canonical language key overrides legacy UILang; legacy remains a fallback", () => {
    const storage = makeStorage(); const def = { key: "ui_language", type: "select", options: ["auto", "zh", "en"], default: "auto" };
    storage.setItem("UILang", "en"); assert.equal(readStoredSetting(storage, def, "UILang"), "en");
    storage.setItem("ui_language", "zh"); assert.equal(readStoredSetting(storage, def, "UILang"), "zh");
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
test("preset storage names cannot resolve inherited properties or mutate its prototype", async () => {
    const presets = await import("../client/src/core/presets.js");
    globalThis.localStorage = makeStorage();
    assert.equal(presets.getDefaultPreset("constructor"), null);
    assert.equal(presets.getPreset("constructor"), null);
    presets.savePreset("__proto__", { p_fontSize: "2em" });
    assert.deepEqual(presets.getPreset("__proto__"), { p_fontSize: "2em" });
});
