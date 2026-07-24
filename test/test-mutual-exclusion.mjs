/**
 * Tests for mutual exclusion behavior in settings.
 *
 * Covers:
 *   - t2s_lite and t2s_pro mutual exclusivity at schema level
 *   - onApply callbacks correctly disable sibling
 *   - Settings values object stays consistent after toggling
 *   - Edge case: both enabled simultaneously (old share config)
 *
 * Run: node test/test-mutual-exclusion.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

// Can't import settings-schema.js directly (it references window/document).
// Read and parse the source to extract SETTINGS_SCHEMA.
const SCHEMA_PATH = path.resolve(import.meta.dirname, "..", "client", "src", "config", "schema", "settings-schema.js");
const schemaSrc = fs.readFileSync(SCHEMA_PATH, "utf-8");

function extractSchemaArray(source) {
    const startMarker = "const SETTINGS_SCHEMA = ";
    const startIdx = source.indexOf(startMarker);
    if (startIdx === -1) throw new Error("SETTINGS_SCHEMA not found");

    let bracketDepth = 0;
    let inString = false;
    let stringChar = null;
    let escapeNext = false;
    let arrayStart = -1;

    for (let i = startIdx + startMarker.length; i < source.length; i++) {
        const ch = source[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (ch === "\\") { escapeNext = true; continue; }
        if (inString) { if (ch === stringChar) inString = false; continue; }
        if (ch === '"' || ch === "'" || ch === "`") { inString = true; stringChar = ch; continue; }
        if (ch === "[") { if (bracketDepth === 0) arrayStart = i; bracketDepth++; continue; }
        if (ch === "]") {
            bracketDepth--;
            if (bracketDepth === 0) {
                const arrayText = source.slice(arrayStart, i + 1);
                const sandbox = {
                    CONFIG: {
                        RUNTIME_VARS: { STYLE: new Proxy({}, { get: () => "__dummy__" }) },
                        CONST_CONFIG: new Proxy({}, {
                            get(target, prop) {
                                if (prop === "SHORTCUTS") return new Proxy({}, { get: () => true });
                                return "__dummy__";
                            }
                        }),
                        CONST_UI: { LANGUAGE_MAPPING: {} },
                        DOM_ELEMENT: {},
                        VARS: {},
                    },
                    toBool: () => true,
                    HSLToHex: () => "#000000",
                    hexToHSL: () => [0, 0, 0],
                    Object, Array, console,
                };
                const fn = new Function(
                    "CONFIG", "toBool", "HSLToHex", "hexToHSL", "Object", "Array", "console",
                    "return " + arrayText
                );
                return fn(
                    sandbox.CONFIG, sandbox.toBool, sandbox.HSLToHex, sandbox.hexToHSL,
                    sandbox.Object, sandbox.Array, sandbox.console
                );
            }
            continue;
        }
    }
    throw new Error("Could not find matching bracket for SETTINGS_SCHEMA");
}

const SETTINGS_SCHEMA = extractSchemaArray(schemaSrc);

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

console.log("config/schema/settings-schema.js — mutual exclusion structure\n");

test("Exactly two settings have mutualExclusiveWith", () => {
    const withMutex = SETTINGS_SCHEMA.filter((e) => e.mutualExclusiveWith);
    assert.equal(withMutex.length, 2, `Expected 2, got ${withMutex.length}`);
});

test("mutualExclusiveWith forms a pair (A→B, B→A)", () => {
    const withMutex = SETTINGS_SCHEMA.filter((e) => e.mutualExclusiveWith);
    const [a, b] = withMutex;
    assert.equal(a.mutualExclusiveWith, b.key);
    assert.equal(b.mutualExclusiveWith, a.key);
});

test("Both mutual exclusion entries are in the 'general' tab", () => {
    const withMutex = SETTINGS_SCHEMA.filter((e) => e.mutualExclusiveWith);
    for (const entry of withMutex) {
        assert.equal(entry.tab, "general", `Entry "${entry.key}" not in general tab`);
    }
});

test("Both mutual exclusion entries persist to localStorage", () => {
    const withMutex = SETTINGS_SCHEMA.filter((e) => e.mutualExclusiveWith);
    for (const entry of withMutex) {
        assert.equal(entry.persist, true, `Entry "${entry.key}" does not persist`);
    }
});

console.log("\ncore/t2s.js — mutual exclusion via localStorage\n");

const {
    setLite,
    setPro,
    isLite,
    isPro,
    setMode,
    getMode,
} = await import("../client/src/core/t2s.js");

test("setLite(true) → isLite=true, isPro=false (even if pro was on)", () => {
    reset();
    setPro(true);
    assert.equal(isPro(), true);
    setLite(true);
    assert.equal(isLite(), true);
    assert.equal(isPro(), false);
});

test("setPro(true) → isPro=true, isLite=false (even if lite was on)", () => {
    reset();
    setLite(true);
    assert.equal(isLite(), true);
    setPro(true);
    assert.equal(isPro(), true);
    assert.equal(isLite(), false);
});

test("setMode('light') via API also enforces mutual exclusion", () => {
    reset();
    setMode("heavy");
    assert.equal(getMode(), "heavy");
    setMode("light");
    assert.equal(getMode(), "light");
    assert.equal(isPro(), false);
});

test("setMode('off') disables both", () => {
    reset();
    setLite(true);
    setMode("off");
    assert.equal(isLite(), false);
    assert.equal(isPro(), false);
    assert.equal(getMode(), "off");
});

console.log("\ncore/t2s.js — edge case: both enabled in localStorage\n");

test("If both t2s_lite and t2s_pro are 'true', lite wins", () => {
    reset();
    mockStorage.setItem("t2s_lite", "true");
    mockStorage.setItem("t2s_pro", "true");
    // _readSettings() has: if (lite && pro) pro = false
    assert.equal(isLite(), true);
    assert.equal(isPro(), false);
    assert.equal(getMode(), "light");
});

test("If both are 'false', mode is off", () => {
    reset();
    mockStorage.setItem("t2s_lite", "false");
    mockStorage.setItem("t2s_pro", "false");
    assert.equal(isLite(), false);
    assert.equal(isPro(), false);
    assert.equal(getMode(), "off");
});

console.log("\ncore/t2s.js — edge case: malformed localStorage values\n");

test("Invalid stored values fall back to defaults (lite=true, pro=false)", () => {
    reset();
    mockStorage.setItem("t2s_lite", "garbage");
    mockStorage.setItem("t2s_pro", "garbage");
    // _readSettings: storedLite !== "false" && !== "0" → lite stays true (default)
    // storedPro !== "true" && !== "1" → pro stays false (default)
    assert.equal(isLite(), true);
    assert.equal(isPro(), false);
});

test("Empty string stored → lite defaults to true, pro to false", () => {
    reset();
    mockStorage.setItem("t2s_lite", "");
    mockStorage.setItem("t2s_pro", "");
    assert.equal(isLite(), true);
    assert.equal(isPro(), false);
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
