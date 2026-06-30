/**
 * Tests for the preset manager in client/src/core/presets.js.
 *
 * The preset manager stores partial settings objects in localStorage under
 * the "reader_presets" key. Tests cover:
 *   - savePreset / getPreset / deletePreset / listPresets
 *   - applyPreset (pure merge function)
 *   - resolvePresetFromURL (name + 1-based index)
 *   - localStorage error resilience
 *
 * Each test uses a fresh localStorage mock to avoid cross-test contamination.
 *
 * Run: node test/test-presets.mjs
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
        // For debugging
        _dump: () => Object.fromEntries(store),
    };
}

// Install the mock on globalThis before importing the module under test,
// so the module's top-level reference to localStorage resolves to our mock.
const mockStorage = makeMockStorage();
globalThis.localStorage = mockStorage;

const {
    loadAllPresets,
    getPreset,
    savePreset,
    deletePreset,
    listPresets,
    applyPreset,
    resolvePresetFromURL,
    getDefaultPreset,
    listDefaultPresets,
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

console.log("core/presets.js — save / load / list / delete\n");

test("loadAllPresets() on empty storage → returns {}", () => {
    reset();
    assert.deepEqual(loadAllPresets(), {});
});

test("savePreset then getPreset roundtrip", () => {
    reset();
    const preset = { p_fontSize: "1.2em", light_bgColor: "#FDF3DF" };
    savePreset("cozy", preset);
    assert.deepEqual(getPreset("cozy"), preset);
});

test("getPreset for nonexistent name → null", () => {
    reset();
    assert.equal(getPreset("nope"), null);
});

test("listPresets returns all saved preset names", () => {
    reset();
    savePreset("a", { x: 1 });
    savePreset("b", { y: 2 });
    savePreset("c", { z: 3 });
    const names = listPresets().sort();
    assert.deepEqual(names, ["a", "b", "c"]);
});

test("savePreset overwrites existing preset with same name", () => {
    reset();
    savePreset("x", { v: 1 });
    savePreset("x", { v: 2 });
    assert.deepEqual(getPreset("x"), { v: 2 });
});

test("deletePreset returns true when preset existed", () => {
    reset();
    savePreset("doomed", { x: 1 });
    assert.equal(deletePreset("doomed"), true);
    assert.equal(getPreset("doomed"), null);
});

test("deletePreset returns false when preset did not exist", () => {
    reset();
    assert.equal(deletePreset("ghost"), false);
});

test("presets persist in localStorage under 'reader_presets' key", () => {
    reset();
    savePreset("test", { a: "b" });
    const raw = mockStorage.getItem("reader_presets");
    assert.ok(raw !== null);
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, { test: { a: "b" } });
});

console.log("\ncore/presets.js — applyPreset (pure merge)\n");

test("applyPreset merges preset values into current values", () => {
    reset();
    savePreset("dark", { light_bgColor: "#000000", light_fontColor: "#FFFFFF" });
    const current = { p_fontSize: "1em", light_bgColor: "#FFFFFF", light_fontColor: "#000000" };
    const result = applyPreset(current, "dark");
    assert.deepEqual(result, {
        p_fontSize: "1em", // preserved (not in preset)
        light_bgColor: "#000000", // overridden
        light_fontColor: "#FFFFFF", // overridden
    });
});

test("applyPreset does NOT mutate the input currentValues", () => {
    reset();
    savePreset("p", { x: 1 });
    const current = { x: 0, y: 2 };
    applyPreset(current, "p");
    // Original should be untouched.
    assert.deepEqual(current, { x: 0, y: 2 });
});

test("applyPreset with nonexistent preset → returns shallow copy of current", () => {
    reset();
    const current = { x: 1 };
    const result = applyPreset(current, "ghost");
    assert.deepEqual(result, { x: 1 });
    assert.notEqual(result, current); // it's a copy, not the same ref
});

test("applyPreset with partial preset only overrides keys in the preset", () => {
    reset();
    savePreset("partial", { a: "new" });
    const current = { a: "old", b: "keep", c: "keep" };
    const result = applyPreset(current, "partial");
    assert.deepEqual(result, { a: "new", b: "keep", c: "keep" });
});

console.log("\ncore/presets.js — resolvePresetFromURL\n");

test("resolvePresetFromURL with no ?scheme param → null", () => {
    reset();
    const params = new URLSearchParams("");
    assert.equal(resolvePresetFromURL(params), null);
});

test("resolvePresetFromURL with ?scheme=NAME resolves to that preset", () => {
    reset();
    savePreset("cozy", { x: 1 });
    const params = new URLSearchParams("scheme=cozy");
    assert.equal(resolvePresetFromURL(params), "cozy");
});

test("resolvePresetFromURL with ?scheme=1 resolves to first preset (alphabetical)", () => {
    reset();
    savePreset("zebra", { x: 1 });
    savePreset("alpha", { x: 2 });
    savePreset("middle", { x: 3 });
    const params = new URLSearchParams("scheme=1");
    // Sorted alphabetically: alpha, middle, zebra. Index 1 = alpha.
    assert.equal(resolvePresetFromURL(params), "alpha");
});

test("resolvePresetFromURL with ?scheme=2 resolves to second preset", () => {
    reset();
    savePreset("zebra", { x: 1 });
    savePreset("alpha", { x: 2 });
    const params = new URLSearchParams("scheme=2");
    // Sorted: alpha, zebra. Index 2 = zebra.
    assert.equal(resolvePresetFromURL(params), "zebra");
});

test("resolvePresetFromURL with out-of-range index → null", () => {
    reset();
    savePreset("only", { x: 1 });
    const params = new URLSearchParams("scheme=5");
    assert.equal(resolvePresetFromURL(params), null);
});

test("resolvePresetFromURL with nonexistent name AND non-numeric → null", () => {
    reset();
    savePreset("real", { x: 1 });
    const params = new URLSearchParams("scheme=ghost");
    assert.equal(resolvePresetFromURL(params), null);
});

test("resolvePresetFromURL with URL-encoded unicode name resolves correctly", () => {
    reset();
    savePreset("夜间阅读", { x: 1 });
    const params = new URLSearchParams("scheme=" + encodeURIComponent("夜间阅读"));
    assert.equal(resolvePresetFromURL(params), "夜间阅读");
});

test("resolvePresetFromURL defaults to window.location.search when no params passed", () => {
    reset();
    savePreset("test", { x: 1 });
    // Mock window.location.search
    const origSearch = globalThis.window?.location?.search;
    globalThis.window = globalThis.window || {};
    globalThis.window.location = globalThis.window.location || {};
    globalThis.window.location.search = "?scheme=test";
    try {
        assert.equal(resolvePresetFromURL(), "test");
    } finally {
        if (origSearch === undefined) {
            delete globalThis.window.location.search;
        } else {
            globalThis.window.location.search = origSearch;
        }
    }
});

console.log("\ncore/presets.js — factory default presets\n");

test("getDefaultPreset: returns values for known factory name", () => {
    reset();
    const preset = getDefaultPreset("Infinite Scroll");
    assert.ok(preset, "expected preset to be defined");
    assert.equal(preset.p_infiniteScroll, "true");
    assert.equal(preset.p_infiniteScrollEasyTrigger, "true");
    assert.equal(preset.p_anonymousMode, "true");
});

test("getDefaultPreset: returns null for unknown name", () => {
    reset();
    assert.equal(getDefaultPreset("nonexistent"), null);
    assert.equal(getDefaultPreset(""), null);
    assert.equal(getDefaultPreset(null), null);
    assert.equal(getDefaultPreset(undefined), null);
});

test("getDefaultPreset: returns a fresh copy (mutations don't persist)", () => {
    reset();
    const a = getDefaultPreset("Infinite Scroll");
    a.p_infiniteScroll = "false";
    const b = getDefaultPreset("Infinite Scroll");
    assert.equal(b.p_infiniteScroll, "true"); // unaffected by mutation
});

test("listDefaultPresets: returns array of factory preset names", () => {
    reset();
    const names = listDefaultPresets();
    assert.ok(Array.isArray(names));
    assert.ok(names.includes("Infinite Scroll"));
});

test("applyPreset: factory preset is applied via name even when not in localStorage", () => {
    reset();
    // No localStorage entry for "Infinite Scroll" — but applyPreset should
    // still find it via the factory default fallback.
    const current = { p_fontSize: "1.5em", p_infiniteScroll: "false" };
    const merged = applyPreset(current, "Infinite Scroll");
    assert.equal(merged.p_fontSize, "1.5em"); // preserved
    assert.equal(merged.p_infiniteScroll, "true"); // overridden by preset
    assert.equal(merged.p_infiniteScrollEasyTrigger, "true"); // added by preset
    assert.equal(merged.p_anonymousMode, "true"); // added by preset
});

test("applyPreset: shallow merge — preset keys override, non-preset keys preserved", () => {
    reset();
    savePreset("partial", { p_fontSize: "2em" }); // only one key
    const current = {
        p_fontSize: "1em",
        p_lineHeight: "1.5em",
        light_bgColor: "#FFFFFF",
    };
    const merged = applyPreset(current, "partial");
    assert.equal(merged.p_fontSize, "2em"); // overridden
    assert.equal(merged.p_lineHeight, "1.5em"); // preserved
    assert.equal(merged.light_bgColor, "#FFFFFF"); // preserved
});

test("applyPreset: user preset takes precedence over factory preset of same name", () => {
    reset();
    // User saves a preset with the same name as a factory default.
    savePreset("Infinite Scroll", { p_fontSize: "3em" });
    const current = { p_fontSize: "1em", p_infiniteScroll: "false" };
    const merged = applyPreset(current, "Infinite Scroll");
    // User's value wins.
    assert.equal(merged.p_fontSize, "3em");
    // Factory-only key is NOT applied (because user preset replaced it).
    assert.equal(merged.p_infiniteScroll, "false");
});

console.log("\ncore/presets.js — resolvePresetFromURL with factory defaults\n");

test("resolvePresetFromURL: ?scheme=0 returns FACTORY_DEFAULT_MARKER", () => {
    reset();
    const params = new URLSearchParams("scheme=0");
    assert.equal(resolvePresetFromURL(params), FACTORY_DEFAULT_MARKER);
});

test("resolvePresetFromURL: ?scheme=Infinite Scroll resolves to factory preset", () => {
    reset();
    const params = new URLSearchParams("scheme=Infinite Scroll");
    assert.equal(resolvePresetFromURL(params), "Infinite Scroll");
});

test("resolvePresetFromURL: ?scheme=Infinite%20Scroll (URL-encoded) resolves", () => {
    reset();
    const params = new URLSearchParams("scheme=Infinite%20Scroll");
    assert.equal(resolvePresetFromURL(params), "Infinite Scroll");
});

test("resolvePresetFromURL: ?scheme=1 still works for user-saved presets (backward compat)", () => {
    reset();
    savePreset("zebra", { x: 1 });
    savePreset("alpha", { x: 2 });
    savePreset("middle", { x: 3 });
    const params = new URLSearchParams("scheme=1");
    // Factory presets are addressable by NAME only — ?scheme=1 still
    // refers to the first user-saved preset (alpha), preserving backward
    // compatibility with existing shared URLs.
    assert.equal(resolvePresetFromURL(params), "alpha");
});

test("resolvePresetFromURL: factory preset name takes precedence over index 0 (special)", () => {
    reset();
    // ?scheme=0 is ALWAYS the factory-default marker, never a name lookup.
    // Even if a user saves a preset named "0", the marker wins.
    savePreset("0", { x: 1 });
    const params = new URLSearchParams("scheme=0");
    assert.equal(resolvePresetFromURL(params), FACTORY_DEFAULT_MARKER);
});

test("resolvePresetFromURL: nonexistent name still returns null", () => {
    reset();
    const params = new URLSearchParams("scheme=nonexistent");
    assert.equal(resolvePresetFromURL(params), null);
});

// ── Error resilience ────────────────────────────────────────────────────

console.log("\ncore/presets.js — error resilience\n");

test("loadAllPresets with corrupt JSON in localStorage → returns {} (no throw)", () => {
    reset();
    mockStorage.setItem("reader_presets", "this is not json {");
    assert.deepEqual(loadAllPresets(), {});
});

test("loadAllPresets with non-object JSON (e.g. '[1,2,3]') → returns {}", () => {
    reset();
    mockStorage.setItem("reader_presets", "[1,2,3]");
    assert.deepEqual(loadAllPresets(), {});
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
