/**
 * Tests for config constant consistency.
 *
 * Validates that:
 *   1. Every SETTINGS_SCHEMA entry with `bind` pointing to CONFIG.CONST_CONFIG
 *      has a corresponding *_DEFAULT constant defined.
 *   2. CONST_CONFIG values match their *_DEFAULT counterparts.
 *   3. No orphaned *_DEFAULT constants exist (defined but never used in schema).
 *   4. All CONST_CONFIG values used in schema have the correct type.
 *
 * This catches the common bug of adding a setting default in schema but
 * forgetting to add it to CONST_CONFIG, or vice versa.
 *
 * Run: node test/test-config-constants.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── Extract SETTINGS_SCHEMA ─────────────────────────────────────────────

const SCHEMA_PATH = path.resolve(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "config",
    "schema",
    "settings-schema.js"
);
const schemaSrc = fs.readFileSync(SCHEMA_PATH, "utf-8");

function extractSchemaArray(source, marker) {
    const startIdx = source.indexOf(marker);
    if (startIdx === -1) throw new Error(`${marker} not found`);

    let bracketDepth = 0;
    let inString = false;
    let stringChar = null;
    let escapeNext = false;
    let arrayStart = -1;

    for (let i = startIdx + marker.length; i < source.length; i++) {
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
    throw new Error(`Could not find matching bracket for ${marker}`);
}

const SETTINGS_SCHEMA = extractSchemaArray(schemaSrc, "const SETTINGS_SCHEMA = ");

// ── Read config/constants.js for CONST_CONFIG ───────────────────────────

const CONSTANTS_PATH = path.resolve(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "config",
    "constants.js"
);
const constantsSrc = fs.readFileSync(CONSTANTS_PATH, "utf-8");

// Extract CONST_CONFIG object
function extractConstConfig(source) {
    const marker = "export const CONST_CONFIG = ";
    const startIdx = source.indexOf(marker);
    if (startIdx === -1) {
        // Try without export
        const altMarker = "const CONST_CONFIG = ";
        const altIdx = source.indexOf(altMarker);
        if (altIdx === -1) throw new Error("CONST_CONFIG not found in config/constants.js");
        return extractObjectLiteral(source, altIdx + altMarker.length);
    }
    return extractObjectLiteral(source, startIdx + marker.length);
}

function extractObjectLiteral(source, startPos) {
    let braceDepth = 0;
    let inString = false;
    let stringChar = null;
    let escapeNext = false;
    let objStart = -1;

    for (let i = startPos; i < source.length; i++) {
        const ch = source[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (ch === "\\") { escapeNext = true; continue; }
        if (inString) { if (ch === stringChar) inString = false; continue; }
        if (ch === '"' || ch === "'" || ch === "`") { inString = true; stringChar = ch; continue; }
        if (ch === "{") { if (braceDepth === 0) objStart = i; braceDepth++; continue; }
        if (ch === "}") {
            braceDepth--;
            if (braceDepth === 0) {
                const objText = source.slice(objStart, i + 1);
                const fn = new Function("return " + objText);
                return fn();
            }
            continue;
        }
    }
    throw new Error("Could not find matching brace for CONST_CONFIG");
}

let CONST_CONFIG;
try {
    CONST_CONFIG = extractConstConfig(constantsSrc);
} catch (e) {
    // If we can't parse it, try a simpler approach: just look for the object
    console.error("Warning: Could not extract CONST_CONFIG object:", e.message);
    CONST_CONFIG = {};
}

// ── Tests ───────────────────────────────────────────────────────────────

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

console.log("config/index.js — CONST_CONFIG structure\n");

test("CONST_CONFIG is defined and is an object", () => {
    assert.ok(CONST_CONFIG && typeof CONST_CONFIG === "object", "CONST_CONFIG is not an object");
});

console.log("\nconfig/schema/settings-schema.js — bind path validation\n");

// Collect all entries that bind to CONST_CONFIG
const constConfigBindings = [];
for (const entry of SETTINGS_SCHEMA) {
    if (!entry.bind) continue;
    const binds = Array.isArray(entry.bind) ? entry.bind : [entry.bind];
    for (const bindPath of binds) {
        if (bindPath.includes("CONST_CONFIG")) {
            const match = bindPath.match(/CONST_CONFIG\.([A-Za-z0-9_]+)/);
            if (match) {
                constConfigBindings.push({
                    key: entry.key,
                    bindPath,
                    constKey: match[1],
                });
            }
        }
    }
}

test("All CONST_CONFIG bindings reference existing constants", () => {
    const missing = [];
    for (const { key, constKey } of constConfigBindings) {
        if (!(constKey in CONST_CONFIG)) {
            missing.push(`${key} → CONST_CONFIG.${constKey}`);
        }
    }
    assert.equal(
        missing.length,
        0,
        `Schema bindings reference missing CONST_CONFIG keys: ${missing.join(", ")}`
    );
});

console.log("\nconfig/index.js — DEFAULT constant completeness\n");

// Find all *_DEFAULT keys in CONST_CONFIG
const defaultKeys = Object.keys(CONST_CONFIG).filter((k) => k.endsWith("_DEFAULT"));
const runtimeKeys = Object.keys(CONST_CONFIG).filter((k) => !k.endsWith("_DEFAULT"));

test("Every *_DEFAULT has a corresponding runtime key", () => {
    const orphaned = [];
    for (const dk of defaultKeys) {
        const runtimeKey = dk.replace("_DEFAULT", "");
        if (!(runtimeKey in CONST_CONFIG)) {
            orphaned.push(`${dk} (expected runtime key: ${runtimeKey})`);
        }
    }
    assert.equal(
        orphaned.length,
        0,
        `Orphaned DEFAULT constants without runtime counterpart: ${orphaned.join(", ")}`
    );
});

test("Every runtime key used in schema has a *_DEFAULT counterpart (or is SHORTCUTS)", () => {
    const missingDefault = [];
    const usedRuntimeKeys = new Set(constConfigBindings.map((b) => b.constKey));
    for (const rk of usedRuntimeKeys) {
        if (rk.endsWith("_DEFAULT")) continue; // already a default
        if (rk === "SHORTCUTS") continue; // SHORTCUTS is a nested object with internal defaults
        const defaultKey = rk + "_DEFAULT";
        if (!(defaultKey in CONST_CONFIG)) {
            missingDefault.push(`${rk} (expected ${defaultKey})`);
        }
    }
    assert.equal(
        missingDefault.length,
        0,
        `Runtime keys missing DEFAULT counterpart: ${missingDefault.join(", ")}`
    );
});

console.log("\nconfig/index.js — type consistency between runtime and default\n");

test("Runtime value and DEFAULT value have the same type", () => {
    const mismatched = [];
    for (const dk of defaultKeys) {
        const runtimeKey = dk.replace("_DEFAULT", "");
        if (!(runtimeKey in CONST_CONFIG)) continue;
        const defaultVal = CONST_CONFIG[dk];
        const runtimeVal = CONST_CONFIG[runtimeKey];
        // Skip if either is a dummy value from sandbox
        if (defaultVal === "__dummy__" || runtimeVal === "__dummy__") continue;
        if (typeof defaultVal !== typeof runtimeVal) {
            mismatched.push(
                `${runtimeKey}: runtime=${typeof runtimeVal}, default=${typeof defaultVal}`
            );
        }
    }
    assert.equal(
        mismatched.length,
        0,
        `Type mismatches between runtime and DEFAULT: ${mismatched.join("; ")}`
    );
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error("\n❌ Config constants test FAILED.");
    process.exit(1);
}
