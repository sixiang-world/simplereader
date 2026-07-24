/**
 * Tests for CSS i18n variable completeness.
 *
 * This test validates the four-part i18n architecture described in AGENTS.md:
 *   1. :root base definitions with _zh and _en variants
 *   2. [lang="zh"] block mappings
 *   3. [lang="en"] block mappings
 *   4. ::before pseudo-element content rules
 *
 * It reads SETTINGS_SCHEMA to discover all labels that need CSS variables,
 * then checks that each label has complete i18n coverage in variables.css.
 *
 * This catches the most common bug: adding a setting but forgetting one of
 * the four CSS sections, resulting in blank text in the UI.
 *
 * Run: node test/test-css-i18n-completeness.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── Extract SETTINGS_SCHEMA labels ──────────────────────────────────────

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

// ── Extract MENU_SCHEMA sections ────────────────────────────────────────

function extractMenuSchema(source) {
    const startMarker = "const MENU_SCHEMA = ";
    const startIdx = source.indexOf(startMarker);
    if (startIdx === -1) throw new Error("MENU_SCHEMA not found");

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
                const fn = new Function("return " + arrayText);
                return fn();
            }
            continue;
        }
    }
    throw new Error("Could not find matching bracket for MENU_SCHEMA");
}

const MENU_SCHEMA = extractMenuSchema(schemaSrc);

// ── Read variables.css ──────────────────────────────────────────────────

const VARIABLES_PATH = path.resolve(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "styles",
    "variables.css"
);
const variablesSrc = fs.readFileSync(VARIABLES_PATH, "utf-8");

// ── Parse CSS sections ──────────────────────────────────────────────────

function extractCssBlock(css, selector) {
    const startIdx = css.indexOf(selector);
    if (startIdx === -1) return null;
    // Find the opening brace
    let braceIdx = css.indexOf("{", startIdx);
    if (braceIdx === -1) return null;
    let depth = 0;
    let endIdx = -1;
    for (let i = braceIdx; i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}") {
            depth--;
            if (depth === 0) { endIdx = i; break; }
        }
    }
    if (endIdx === -1) return null;
    return css.slice(braceIdx + 1, endIdx);
}

const rootBlock = extractCssBlock(variablesSrc, ":root");
const zhBlock = extractCssBlock(variablesSrc, '[data-lang="zh"]');
const enBlock = extractCssBlock(variablesSrc, '[data-lang="en"]');

// Extract all --ui_* variable definitions from a block
function extractDefinedVars(block) {
    const vars = new Set();
    const regex = /--([a-zA-Z0-9_-]+)\s*:/g;
    let m;
    while ((m = regex.exec(block)) !== null) {
        vars.add(m[1]);
    }
    return vars;
}

const rootVars = extractDefinedVars(rootBlock || "");
const zhVars = extractDefinedVars(zhBlock || "");
const enVars = extractDefinedVars(enBlock || "");

// Extract all pseudo-element content rules
const contentRules = [];
const contentRegex = /#(settingLabel|tooltip|settingLabel)-setting_([a-zA-Z0-9_-]+)::before\s*\{[^}]*content:\s*var\(--([^)]+)\)/g;
let cm;
while ((cm = contentRegex.exec(variablesSrc)) !== null) {
    contentRules.push({
        selectorType: cm[1],
        key: cm[2],
        varName: cm[3],
    });
}

// ── Collect all required labels ─────────────────────────────────────────

const requiredLabels = new Set();
const requiredNotes = new Set();
const requiredSeparators = new Set();

for (const entry of SETTINGS_SCHEMA) {
    if (entry.hidden) continue; // hidden items don't have UI text
    if (entry.label) {
        // The label in schema is like "setting_show_filter_bar" but CSS uses "ui_show_filter_bar"
        // However, some labels map to different CSS var names (e.g. "setting_light_mainColor_active" -> "ui_lightMode_mainColor")
        // We need to find the actual CSS variable name used in the pseudo-element rule
        const schemaKey = entry.label.replace(/^setting_/, "");
        const rule = contentRules.find((r) => r.key === schemaKey);
        if (rule) {
            requiredLabels.add(rule.varName);
            if (entry.note) {
                requiredNotes.add(rule.varName + "_note");
            }
        }
        // If no rule found, this label doesn't have a visible UI element — skip it
    }
}

// Also collect separator labels from MENU_SCHEMA
for (const tab of MENU_SCHEMA) {
    if (!tab.content) continue;
    for (const group of tab.content) {
        if (group.section) {
            requiredSeparators.add(group.section);
        }
    }
}

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

// ── Tests ───────────────────────────────────────────────────────────────

console.log("styles/variables.css — i18n four-part architecture validation\n");

test(":root block exists and contains variables", () => {
    assert.ok(rootBlock, ":root block not found in variables.css");
    assert.ok(rootVars.size > 0, ":root block has no variable definitions");
});

test('[data-lang="zh"] block exists and contains variables', () => {
    assert.ok(zhBlock, '[data-lang="zh"] block not found in variables.css');
    assert.ok(zhVars.size > 0, '[data-lang="zh"] block has no variable definitions');
});

test('[data-lang="en"] block exists and contains variables', () => {
    assert.ok(enBlock, '[data-lang="en"] block not found in variables.css');
    assert.ok(enVars.size > 0, '[data-lang="en"] block has no variable definitions');
});

console.log("\nstyles/variables.css — label variable completeness\n");

for (const label of requiredLabels) {
    const baseVar = label; // e.g., "ui_show_filter_bar"
    const zhVar = baseVar + "_zh";
    const enVar = baseVar + "_en";
    // Find the schema key from the content rule (reverse lookup)
    const rule = contentRules.find((r) => r.varName === label);
    const schemaKey = rule ? rule.key : label.replace(/^ui_/, "");

    test(`Label "${label}" has :root _zh definition`, () => {
        assert.ok(
            rootVars.has(zhVar),
            `Missing --${zhVar} in :root block`
        );
    });

    test(`Label "${label}" has :root _en definition`, () => {
        assert.ok(
            rootVars.has(enVar),
            `Missing --${enVar} in :root block`
        );
    });

    test(`Label "${label}" has [data-lang="zh"] mapping`, () => {
        assert.ok(
            zhVars.has(baseVar),
            `Missing --${baseVar} in [data-lang="zh"] block`
        );
    });

    test(`Label "${label}" has [data-lang="en"] mapping`, () => {
        assert.ok(
            enVars.has(baseVar),
            `Missing --${baseVar} in [data-lang="en"] block`
        );
    });

    test(`Label "${label}" has ::before content rule`, () => {
        const foundRule = contentRules.find((r) => r.key === schemaKey);
        assert.ok(
            foundRule,
            `Missing #settingLabel-setting_${schemaKey}::before rule`
        );
        assert.ok(
            foundRule.varName.startsWith("ui_") || foundRule.varName.startsWith("setting_"),
            `Content rule for ${label} uses unexpected variable: ${foundRule.varName}`
        );
    });
}

console.log("\nstyles/variables.css — note variable completeness\n");

for (const noteLabel of requiredNotes) {
    const baseVar = noteLabel; // e.g., "ui_show_filter_bar_note"
    const zhVar = baseVar + "_zh";
    const enVar = baseVar + "_en";
    const schemaKey = noteLabel.replace(/^ui_/, "").replace(/_note$/, ""); // e.g., "show_filter_bar"

    test(`Note "${noteLabel}" has :root _zh definition`, () => {
        assert.ok(
            rootVars.has(zhVar),
            `Missing --${zhVar} in :root block`
        );
    });

    test(`Note "${noteLabel}" has :root _en definition`, () => {
        assert.ok(
            rootVars.has(enVar),
            `Missing --${enVar} in :root block`
        );
    });

    test(`Note "${noteLabel}" has [data-lang="zh"] mapping`, () => {
        assert.ok(
            zhVars.has(baseVar),
            `Missing --${baseVar} in [data-lang="zh"] block`
        );
    });

    test(`Note "${noteLabel}" has [data-lang="en"] mapping`, () => {
        assert.ok(
            enVars.has(baseVar),
            `Missing --${baseVar} in [data-lang="en"] block`
        );
    });

    test(`Note "${noteLabel}" has tooltip ::before content rule`, () => {
        const rule = contentRules.find((r) => r.selectorType === "tooltip" && r.key === schemaKey);
        assert.ok(
            rule,
            `Missing #tooltip-setting_${schemaKey}::before rule`
        );
    });
}

console.log("\nstyles/variables.css — separator variable completeness\n");

for (const sepLabel of requiredSeparators) {
    // sepLabel is like "setting_separator_font" but CSS uses "ui_separator_font"
    const cssVarName = sepLabel.replace(/^setting_/, "ui_"); // e.g., "ui_separator_font"
    const zhVar = cssVarName + "_zh";
    const enVar = cssVarName + "_en";
    const schemaKey = cssVarName.replace(/^ui_/, ""); // e.g., "separator_font"

    test(`Separator "${sepLabel}" has :root _zh definition`, () => {
        assert.ok(
            rootVars.has(zhVar),
            `Missing --${zhVar} in :root block`
        );
    });

    test(`Separator "${sepLabel}" has :root _en definition`, () => {
        assert.ok(
            rootVars.has(enVar),
            `Missing --${enVar} in :root block`
        );
    });

    test(`Separator "${sepLabel}" has [data-lang="zh"] mapping`, () => {
        assert.ok(
            zhVars.has(cssVarName),
            `Missing --${cssVarName} in [data-lang="zh"] block`
        );
    });

    test(`Separator "${sepLabel}" has [data-lang="en"] mapping`, () => {
        assert.ok(
            enVars.has(cssVarName),
            `Missing --${cssVarName} in [data-lang="en"] block`
        );
    });

    test(`Separator "${sepLabel}" has ::before content rule`, () => {
        const rule = contentRules.find((r) => r.key === schemaKey);
        assert.ok(
            rule,
            `Missing #settingLabel-setting_${schemaKey}::before rule`
        );
    });
}

console.log("\nstyles/variables.css — orphan variable detection\n");

test("No orphan _zh variables in :root (must have corresponding _en)", () => {
    const zhOnly = [...rootVars].filter((v) => v.endsWith("_zh") && !rootVars.has(v.replace(/_zh$/, "_en")));
    assert.equal(
        zhOnly.length,
        0,
        `Orphan _zh variables without _en counterpart: ${zhOnly.join(", ")}`
    );
});

test("No orphan _en variables in :root (must have corresponding _zh)", () => {
    const enOnly = [...rootVars].filter((v) => v.endsWith("_en") && !rootVars.has(v.replace(/_en$/, "_zh")));
    assert.equal(
        enOnly.length,
        0,
        `Orphan _en variables without _zh counterpart: ${enOnly.join(", ")}`
    );
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error("\n❌ CSS i18n completeness test FAILED.");
    console.error("   See AGENTS.md section 2 (Adding Settings Options) for the correct workflow.");
    process.exit(1);
}
