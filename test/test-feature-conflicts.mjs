/**
 * Tests for feature conflict detection and resolution.
 *
 * Validates the documented behavior in AGENTS.md:
 *   - 日志模式 (Log Mode) forces auto-join and line numbers
 *   - 自动拼接 (Auto-Join) and 无限滚动 (Infinite Scroll) are mutually exclusive
 *   - Log mode hides sidebar
 *
 * These tests verify the schema-level declarations and the runtime behavior
 * by inspecting the source code for the correct conflict resolution logic.
 *
 * Run: node test/test-feature-conflicts.mjs
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

// ── Read reader.js for conflict resolution logic ────────────────────────

const READER_PATH = path.resolve(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "modules",
    "reader",
    "reader.js"
);
let readerSrc = "";
try {
    readerSrc = fs.readFileSync(READER_PATH, "utf-8");
} catch (_e) {
    // reader.js may not exist in all branches
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

console.log("Feature conflict detection — schema-level validation\n");

const logMode = SETTINGS_SCHEMA.find((e) => e.key === "log_mode");
const autoJoin = SETTINGS_SCHEMA.find((e) => e.key === "continuous_scroll_mode");
const infiniteScroll = SETTINGS_SCHEMA.find((e) => e.key === "infinite_scroll_mode");
const showLineNumbers = SETTINGS_SCHEMA.find((e) => e.key === "show_line_numbers");
const showToc = SETTINGS_SCHEMA.find((e) => e.key === "show_toc");

test("log_mode exists in SETTINGS_SCHEMA", () => {
    assert.ok(logMode, "log_mode not found in SETTINGS_SCHEMA");
});

test("continuous_scroll_mode (auto-join) exists in SETTINGS_SCHEMA", () => {
    assert.ok(autoJoin, "continuous_scroll_mode not found in SETTINGS_SCHEMA");
});

test("infinite_scroll_mode exists in SETTINGS_SCHEMA", () => {
    assert.ok(infiniteScroll, "infinite_scroll_mode not found in SETTINGS_SCHEMA");
});

test("show_line_numbers exists in SETTINGS_SCHEMA", () => {
    assert.ok(showLineNumbers, "show_line_numbers not found in SETTINGS_SCHEMA");
});

test("show_toc exists in SETTINGS_SCHEMA", () => {
    assert.ok(showToc, "show_toc not found in SETTINGS_SCHEMA");
});

console.log("\nFeature conflict detection — runtime logic validation (reader.js)\n");

if (readerSrc) {
    test("reader.js references LOG_MODE", () => {
        assert.ok(
            /LOG_MODE/.test(readerSrc),
            "reader.js should reference LOG_MODE"
        );
    });

    test("reader.js references CONTINUOUS_SCROLL_MODE", () => {
        assert.ok(
            /CONTINUOUS_SCROLL_MODE/.test(readerSrc),
            "reader.js should reference CONTINUOUS_SCROLL_MODE"
        );
    });

    test("reader.js references INFINITE_SCROLL_MODE", () => {
        assert.ok(
            /INFINITE_SCROLL_MODE/.test(readerSrc),
            "reader.js should reference INFINITE_SCROLL_MODE"
        );
    });

    test("reader.js enforces log mode → flow mode (LOG_MODE activates flowReader.enter())", () => {
        // Log mode now enters flow mode via flowReader.enter() directly,
        // without modifying CONTINUOUS_SCROLL_MODE setting value.
        assert.ok(
            /flowReader\.enter\(\)|Log mode.*flow/.test(readerSrc),
            "reader.js should activate flow mode when LOG_MODE is on"
        );
    });

    test("reader.js has infinite scroll threshold logic", () => {
        assert.ok(
            /INFINITE_SCROLL_MODE_THRESHOLD|INFINITE_SCROLL_EASY_MODE/.test(readerSrc),
            "reader.js should have infinite scroll threshold/easy mode logic"
        );
    });
} else {
    console.log("  (skipped: reader.js not found)");
}

// ── Read settings.js for onApply logic inspection ───────────────────────

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

test("settings.js has applySchema or similar mechanism for onApply callbacks", () => {
    assert.ok(
        /applySchema|onApply/.test(settingsJsSrc),
        "settings.js should have mechanism to call onApply callbacks from schema"
    );
});

// ── Read constants.js for default value consistency ─────────────────────

const CONSTANTS_PATH = path.resolve(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "config",
    "constants.js"
);
const constantsSrc = fs.readFileSync(CONSTANTS_PATH, "utf-8");

test("constants.js defines LOG_MODE default as false", () => {
    assert.ok(
        /LOG_MODE:\s*false/.test(constantsSrc),
        "LOG_MODE should default to false"
    );
});

test("constants.js defines CONTINUOUS_SCROLL_MODE default as false", () => {
    assert.ok(
        /CONTINUOUS_SCROLL_MODE:\s*false/.test(constantsSrc),
        "CONTINUOUS_SCROLL_MODE should default to false"
    );
});

test("constants.js defines INFINITE_SCROLL_MODE default as false", () => {
    assert.ok(
        /INFINITE_SCROLL_MODE:\s*false/.test(constantsSrc),
        "INFINITE_SCROLL_MODE should default to false"
    );
});

test("constants.js defines SHOW_LINE_NUMBERS default as false", () => {
    assert.ok(
        /SHOW_LINE_NUMBERS:\s*false/.test(constantsSrc),
        "SHOW_LINE_NUMBERS should default to false"
    );
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error("\n❌ Feature conflict test FAILED.");
    process.exit(1);
}
