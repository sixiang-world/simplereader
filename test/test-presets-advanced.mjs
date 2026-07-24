/**
 * Advanced tests for the preset system.
 *
 * Covers:
 *   - Factory default preset content validation
 *   - applyPreset with empty/null inputs
 *   - User preset vs factory preset precedence
 *   - resolvePresetFromURL edge cases (empty string, special chars)
 *   - Preset persistence roundtrip with unicode names
 *   - Preset deletion edge cases
 *
 * Run: node test/test-presets-advanced.mjs
 */

import assert from "node:assert/strict";

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

const {
    savePreset,
    getPreset,
    loadAllPresets,
    deletePreset,
    listPresets,
    applyPreset,
    getDefaultPreset,
    listDefaultPresets,
    resolvePresetFromURL,
    FACTORY_DEFAULT_MARKER,
} = await import("../client/src/core/presets.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
    try {
        fn();
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
}

// ── Tests ───────────────────────────────────────────────────────────────

console.log("core/presets.js — advanced: factory defaults\n");

test("listDefaultPresets returns non-empty array", () => {
    reset();
    const names = listDefaultPresets();
    assert.ok(Array.isArray(names));
    assert.ok(names.length > 0);
});

test("getDefaultPreset returns object for known names", () => {
    reset();
    for (const name of listDefaultPresets()) {
        const preset = getDefaultPreset(name);
        assert.ok(preset && typeof preset === "object", `Preset "${name}" should be an object`);
    }
});

test("getDefaultPreset returns null for unknown names", () => {
    reset();
    assert.equal(getDefaultPreset("nonexistent"), null);
    assert.equal(getDefaultPreset(""), null);
    assert.equal(getDefaultPreset(null), null);
});

test("getDefaultPreset returns fresh copy (mutation-safe)", () => {
    reset();
    const name = listDefaultPresets()[0];
    const p1 = getDefaultPreset(name);
    const p2 = getDefaultPreset(name);
    assert.notStrictEqual(p1, p2);
    p1.infinite_scroll_mode = "false";
    assert.equal(p2.infinite_scroll_mode, "true");
});

console.log("\ncore/presets.js — advanced: applyPreset edge cases\n");

test("applyPreset with empty currentValues → returns preset only", () => {
    reset();
    const preset = getDefaultPreset(listDefaultPresets()[0]);
    const result = applyPreset({}, listDefaultPresets()[0]);
    assert.deepEqual(result, preset);
});

test("applyPreset with null presetName → returns shallow copy", () => {
    reset();
    const current = { a: "1", b: "2" };
    const result = applyPreset(current, "nonexistent");
    assert.notStrictEqual(result, current);
    assert.deepEqual(result, current);
});

test("applyPreset: non-preset keys are preserved", () => {
    reset();
    const current = { existing_key: "value", another: "123" };
    savePreset("partial", { new_key: "new_value" });
    const result = applyPreset(current, "partial");
    assert.equal(result.existing_key, "value");
    assert.equal(result.another, "123");
    assert.equal(result.new_key, "new_value");
});

test("applyPreset: preset overrides existing keys", () => {
    reset();
    const current = { infinite_scroll_mode: "false", anonymous_mode: "false" };
    savePreset("override", { infinite_scroll_mode: "true" });
    const result = applyPreset(current, "override");
    assert.equal(result.infinite_scroll_mode, "true");
    assert.equal(result.anonymous_mode, "false");
});

console.log("\ncore/presets.js — advanced: user preset vs factory precedence\n");

test("user preset takes precedence over factory preset of same name", () => {
    reset();
    const name = listDefaultPresets()[0];
    const factory = getDefaultPreset(name);
    // Save a user preset with the same name but different values
    savePreset(name, { ...factory, infinite_scroll_mode: "false" });
    const result = applyPreset({ some_other: "value" }, name);
    assert.equal(result.infinite_scroll_mode, "false");
});

console.log("\ncore/presets.js — advanced: resolvePresetFromURL edge cases\n");

test("resolvePresetFromURL with empty URLSearchParams → null", () => {
    reset();
    const params = new URLSearchParams("");
    assert.equal(resolvePresetFromURL(params), null);
});

test("resolvePresetFromURL with scheme=0 → FACTORY_DEFAULT_MARKER", () => {
    reset();
    const params = new URLSearchParams("scheme=0");
    assert.equal(resolvePresetFromURL(params), FACTORY_DEFAULT_MARKER);
});

test("resolvePresetFromURL with scheme= (empty) → null", () => {
    reset();
    const params = new URLSearchParams("scheme=");
    assert.equal(resolvePresetFromURL(params), null);
});

test("resolvePresetFromURL with negative index → null", () => {
    reset();
    savePreset("a", { x: "1" });
    const params = new URLSearchParams("scheme=-1");
    assert.equal(resolvePresetFromURL(params), null);
});

test("resolvePresetFromURL with zero index → null (0 is special)", () => {
    reset();
    savePreset("a", { x: "1" });
    // scheme=0 is special (factory default), not an index
    const params = new URLSearchParams("scheme=0");
    assert.equal(resolvePresetFromURL(params), FACTORY_DEFAULT_MARKER);
});

test("resolvePresetFromURL with URL-encoded name", () => {
    reset();
    savePreset("中文预设", { x: "1" });
    const encoded = encodeURIComponent("中文预设");
    const params = new URLSearchParams(`scheme=${encoded}`);
    assert.equal(resolvePresetFromURL(params), "中文预设");
});

test("resolvePresetFromURL with index out of range → null", () => {
    reset();
    savePreset("a", { x: "1" });
    const params = new URLSearchParams("scheme=99");
    assert.equal(resolvePresetFromURL(params), null);
});

console.log("\ncore/presets.js — advanced: unicode and special names\n");

test("savePreset with unicode name roundtrip", () => {
    reset();
    const name = "🎨 夜间阅读 🌙";
    savePreset(name, { light_bgColor: "#000000" });
    assert.deepEqual(getPreset(name), { light_bgColor: "#000000" });
});

test("savePreset with very long name", () => {
    reset();
    const name = "a".repeat(200);
    savePreset(name, { x: "1" });
    assert.equal(getPreset(name).x, "1");
});

test("listPresets returns names in insertion order", () => {
    reset();
    savePreset("z", {});
    savePreset("a", {});
    savePreset("m", {});
    const names = listPresets();
    assert.deepEqual(names, ["z", "a", "m"]);
});

console.log("\ncore/presets.js — advanced: deletePreset edge cases\n");

test("deletePreset returns false when preset did not exist", () => {
    reset();
    assert.equal(deletePreset("ghost"), false);
});

test("deletePreset removes preset from list", () => {
    reset();
    savePreset("temp", { x: "1" });
    assert.equal(listPresets().length, 1);
    deletePreset("temp");
    assert.equal(listPresets().length, 0);
    assert.equal(getPreset("temp"), null);
});

test("deletePreset with empty string → false", () => {
    reset();
    assert.equal(deletePreset(""), false);
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
