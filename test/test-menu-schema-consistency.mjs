/**
 * Tests for MENU_SCHEMA consistency with SETTINGS_SCHEMA.
 *
 * Validates:
 *   1. Every item referenced in MENU_SCHEMA exists in SETTINGS_SCHEMA
 *      or is a valid virtual item (starts with __).
 *   2. Every non-hidden SETTINGS_SCHEMA entry appears at least once
 *      in MENU_SCHEMA (prevents orphaned settings that never render).
 *   3. Virtual items (__) that are referenced in MENU_SCHEMA have
 *      corresponding routing logic in settings.js.
 *   4. Tab IDs in MENU_SCHEMA are from the allowed set.
 *   5. No duplicate items within the same group.
 *
 * This catches:
 *   - Adding a setting to SETTINGS_SCHEMA but forgetting to add it to MENU_SCHEMA
 *   - Typo in MENU_SCHEMA item ID that doesn't match any SETTINGS_SCHEMA key
 *   - Removing a setting from SETTINGS_SCHEMA but leaving it in MENU_SCHEMA
 *   - Virtual items without routing handlers in settings.js
 *
 * Run: node test/test-menu-schema-consistency.mjs
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
const MENU_SCHEMA = extractSchemaArray(schemaSrc, "const MENU_SCHEMA = ");

// ── Read settings.js for virtual item routing ───────────────────────────

const SETTINGS_JS_PATH = path.resolve(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "modules",
    "settings",
    "settings.js"
);
const settingsJsSrc = fs.readFileSync(SETTINGS_JS_PATH, "utf-8");

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

const ALLOWED_TABS = new Set(["general", "theme", "content-style", "reader", "shortcuts", "about"]);
const schemaKeys = new Set(SETTINGS_SCHEMA.map((e) => e.key));
const hiddenKeys = new Set(SETTINGS_SCHEMA.filter((e) => e.hidden).map((e) => e.key));

// Collect all MENU_SCHEMA items
const menuItems = new Set();
const virtualItems = new Set();
const menuGroups = [];

for (const tab of MENU_SCHEMA) {
    menuGroups.push({ tab: tab.id, items: [] });
    if (!tab.content) continue;
    for (const group of tab.content) {
        if (!group.items) continue;
        for (const itemId of group.items) {
            menuItems.add(itemId);
            menuGroups[menuGroups.length - 1].items.push(itemId);
            if (itemId.startsWith("__")) {
                virtualItems.add(itemId);
            }
        }
    }
}

console.log("config/schema/settings-schema.js — MENU_SCHEMA consistency\n");

test("MENU_SCHEMA is a non-empty array", () => {
    assert.ok(Array.isArray(MENU_SCHEMA));
    assert.ok(MENU_SCHEMA.length > 0);
});

test("All tab IDs are from the allowed set", () => {
    for (const tab of MENU_SCHEMA) {
        assert.ok(
            ALLOWED_TABS.has(tab.id),
            `Tab "${tab.id}" is not in allowed tabs: ${[...ALLOWED_TABS].join(", ")}`
        );
    }
});

test("Every MENU_SCHEMA item exists in SETTINGS_SCHEMA or is a virtual item", () => {
    const missing = [];
    for (const itemId of menuItems) {
        if (itemId.startsWith("__")) continue; // virtual items are allowed
        if (!schemaKeys.has(itemId)) {
            missing.push(itemId);
        }
    }
    assert.equal(
        missing.length,
        0,
        `MENU_SCHEMA references non-existent keys: ${missing.join(", ")}`
    );
});

test("Every non-hidden SETTINGS_SCHEMA entry appears in MENU_SCHEMA", () => {
    const orphaned = [];
    for (const entry of SETTINGS_SCHEMA) {
        if (entry.hidden) continue; // hidden items don't need to be in MENU_SCHEMA
        if (!menuItems.has(entry.key)) {
            orphaned.push(entry.key);
        }
    }
    assert.equal(
        orphaned.length,
        0,
        `SETTINGS_SCHEMA entries missing from MENU_SCHEMA (will never render): ${orphaned.join(", ")}`
    );
});

test("No duplicate items within the same group", () => {
    const dupes = [];
    for (const group of menuGroups) {
        const seen = new Set();
        for (const item of group.items) {
            if (seen.has(item)) {
                dupes.push(`${item} in tab "${group.tab}"`);
            }
            seen.add(item);
        }
    }
    assert.equal(dupes.length, 0, `Duplicate items found: ${dupes.join(", ")}`);
});

console.log("\nmodules/settings/settings.js — virtual item routing\n");

test("Every virtual item in MENU_SCHEMA has routing in settings.js", () => {
    const unhandled = [];
    for (const itemId of virtualItems) {
        // Check for `if (itemId === "xxx")` pattern in settings.js
        const pattern = new RegExp(`if\\s*\\(\\s*itemId\\s*===\\s*["\']${itemId}["\']\\s*\\)`);
        if (!pattern.test(settingsJsSrc)) {
            unhandled.push(itemId);
        }
    }
    assert.equal(
        unhandled.length,
        0,
        `Virtual items without routing in settings.js: ${unhandled.join(", ")}. ` +
            `Add 'if (itemId === "...")' branch in #createTabFromSchema().`
    );
});

test("Virtual item routing branches appear before standard item processing", () => {
    // The virtual item checks must come BEFORE the schemaMap lookup,
    // otherwise the code will try to find the virtual item in schemaMap
    // and throw/fail.
    const virtualCheckIdx = settingsJsSrc.indexOf('if (itemId.startsWith("__"))') ||
        settingsJsSrc.indexOf('if (itemId === "__');
    const schemaMapIdx = settingsJsSrc.indexOf("schemaMap.get");

    // If there's an explicit virtual check, it should be before schemaMap
    if (virtualCheckIdx !== -1 && schemaMapIdx !== -1) {
        assert.ok(
            virtualCheckIdx < schemaMapIdx,
            "Virtual item routing should appear before schemaMap lookup"
        );
    }
});

console.log("\nconfig/schema/settings-schema.js — mutual exclusion consistency\n");

test("mutualExclusiveWith is always bidirectional", () => {
    const unidirectional = [];
    for (const entry of SETTINGS_SCHEMA) {
        if (entry.mutualExclusiveWith) {
            const sibling = SETTINGS_SCHEMA.find((e) => e.key === entry.mutualExclusiveWith);
            if (!sibling) {
                unidirectional.push(`${entry.key} → ${entry.mutualExclusiveWith} (sibling not found)`);
                continue;
            }
            if (sibling.mutualExclusiveWith !== entry.key) {
                unidirectional.push(
                    `${entry.key} → ${entry.mutualExclusiveWith} but ${entry.mutualExclusiveWith} → ${sibling.mutualExclusiveWith || "(none)"}`
                );
            }
        }
    }
    assert.equal(
        unidirectional.length,
        0,
        `Unidirectional mutual exclusion found: ${unidirectional.join("; ")}`
    );
});

test("Entries with mutualExclusiveWith have onApply callbacks", () => {
    const missingOnApply = [];
    for (const entry of SETTINGS_SCHEMA) {
        if (entry.mutualExclusiveWith && typeof entry.onApply !== "function") {
            missingOnApply.push(entry.key);
        }
    }
    assert.equal(
        missingOnApply.length,
        0,
        `Entries with mutualExclusiveWith missing onApply: ${missingOnApply.join(", ")}`
    );
});

test("Entries with onApply for mutual exclusion are checkbox type", () => {
    const wrongType = [];
    for (const entry of SETTINGS_SCHEMA) {
        if (entry.mutualExclusiveWith && entry.type !== "checkbox") {
            wrongType.push(`${entry.key} (type: ${entry.type})`);
        }
    }
    assert.equal(
        wrongType.length,
        0,
        `Non-checkbox entries with mutualExclusiveWith: ${wrongType.join(", ")}`
    );
});

console.log("\nconfig/schema/settings-schema.js — bind path validation\n");

test("All bind fields are non-empty strings or arrays", () => {
    const invalid = [];
    for (const entry of SETTINGS_SCHEMA) {
        if (!entry.bind) {
            invalid.push(`${entry.key}: missing bind`);
            continue;
        }
        const type = typeof entry.bind;
        if (type !== "string" && !Array.isArray(entry.bind)) {
            invalid.push(`${entry.key}: bind is ${type}`);
        }
        if (type === "string" && entry.bind.length === 0) {
            invalid.push(`${entry.key}: bind is empty string`);
        }
    }
    assert.equal(invalid.length, 0, `Invalid bind fields: ${invalid.join("; ")}`);
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error("\n❌ MENU_SCHEMA consistency test FAILED.");
    console.error("   See AGENTS.md section 2 (Adding Settings Options) for the correct workflow.");
    process.exit(1);
}
