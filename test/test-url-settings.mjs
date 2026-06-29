/**
 * Tests for parseURLSettings — the schema-driven URL query parameter parser
 * with type coercion for checkbox, range, color, select, and hidden settings.
 *
 * This is a pure function: ({schema, urlParams}) → overrides, so it's
 * trivially testable in Node.js without any DOM mocking.
 *
 * Run: node test/test-url-settings.mjs
 */

import assert from "node:assert/strict";
import { parseURLSettings } from "../client/app/utils/url-settings.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function params(str) {
    return new URLSearchParams(str.replace(/^\?/, ""));
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

// ── Schema fixtures ──────────────────────────────────────────────────────

const SCHEMA = Object.freeze([
    { key: "show_helper_btn",       type: "checkbox" },
    { key: "enable_custom_cursor",  type: "checkbox" },
    { key: "p_fontSize",            type: "range",   unit: "em",  min: 0.5,  max: 3 },
    { key: "p_lineHeight",          type: "range",   unit: "",    min: 1,    max: 3 },
    { key: "light_mainColor_active", type: "color" },
    { key: "light_mainColor_inactive", type: "color", hidden: true },
    { key: "ui_language",           type: "select",  options: ["zh", "en", "auto"] },
    { key: "p_fontFamily",          type: "select-font" },
]);

// ── Tests ────────────────────────────────────────────────────────────────

console.log("parseURLSettings — type coercion\n");

// ───── Checkbox ─────
console.log("Checkbox:");
test('"true" → true', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=true"));
    assert.deepEqual(r, { show_helper_btn: true });
});

test('"1" → true', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=1"));
    assert.deepEqual(r, { show_helper_btn: true });
});

test('"yes" → true', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=yes"));
    assert.deepEqual(r, { show_helper_btn: true });
});

test('"on" → true', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=on"));
    assert.deepEqual(r, { show_helper_btn: true });
});

test('"TRUE" (case insensitive) → true', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=TRUE"));
    assert.deepEqual(r, { show_helper_btn: true });
});

test('"0" → false (BUG-1 regression guard)', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=0"));
    assert.deepEqual(r, { show_helper_btn: false });
});

test('"no" → false', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=no"));
    assert.deepEqual(r, { show_helper_btn: false });
});

test('"off" → false', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=off"));
    assert.deepEqual(r, { show_helper_btn: false });
});

test('"false" → false', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=false"));
    assert.deepEqual(r, { show_helper_btn: false });
});

test('empty string → false', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn="));
    assert.deepEqual(r, { show_helper_btn: false });
});

test('garbage string → false', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=maybe"));
    assert.deepEqual(r, { show_helper_btn: false });
});

test('multiple checkboxes → both coerced correctly', () => {
    const r = parseURLSettings(SCHEMA, params("?show_helper_btn=1&enable_custom_cursor=0"));
    assert.deepEqual(r, { show_helper_btn: true, enable_custom_cursor: false });
});

// ───── Range ─────
console.log("\nRange:");
test('unitless value auto-appends schema unit → "1.5em"', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=1.5"));
    assert.deepEqual(r, { p_fontSize: "1.5em" });
});

test('value with unit preserved → "2em"', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=2em"));
    assert.deepEqual(r, { p_fontSize: "2em" });
});

test('non-em unit preserved → "2px" (within min/max)', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=2px"));
    assert.deepEqual(r, { p_fontSize: "2px" });
});

test('empty unit schema → no unit appended', () => {
    const r = parseURLSettings(SCHEMA, params("?p_lineHeight=1.5"));
    assert.deepEqual(r, { p_lineHeight: "1.5" });
});

test('value below min → rejected', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=0.1"));
    assert.deepEqual(r, {});
});

test('value equal to min → accepted', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=0.5"));
    assert.deepEqual(r, { p_fontSize: "0.5em" });
});

test('value above max → rejected', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=99999"));
    assert.deepEqual(r, {});
});

test('value equal to max → accepted', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=3"));
    assert.deepEqual(r, { p_fontSize: "3em" });
});

test('value with unit above max → rejected', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=99em"));
    assert.deepEqual(r, {});
});

test('non-numeric string → rejected', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=not-a-number"));
    assert.deepEqual(r, {});
});

test('empty value → rejected', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize="));
    assert.deepEqual(r, {});
});

test('value below min via out-of-range unitless → rejected', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontSize=-0.5"));
    assert.deepEqual(r, {});
});

// ───── Color ─────
console.log("\nColor:");
test('6-digit hex → "#333333"', () => {
    const r = parseURLSettings(SCHEMA, params("?light_mainColor_active=%23333333"));
    assert.deepEqual(r, { light_mainColor_active: "#333333" });
});

test('3-digit hex → "#333"', () => {
    const r = parseURLSettings(SCHEMA, params("?light_mainColor_active=%23333"));
    assert.deepEqual(r, { light_mainColor_active: "#333" });
});

test('uppercase hex → "#FF8800"', () => {
    const r = parseURLSettings(SCHEMA, params("?light_mainColor_active=%23FF8800"));
    assert.deepEqual(r, { light_mainColor_active: "#FF8800" });
});

test('garbage string → rejected', () => {
    const r = parseURLSettings(SCHEMA, params("?light_mainColor_active=garbage"));
    assert.deepEqual(r, {});
});

test('4-digit hex → rejected (not 3 or 6)', () => {
    const r = parseURLSettings(SCHEMA, params("?light_mainColor_active=%231234"));
    assert.deepEqual(r, {});
});

test('hex without # → rejected', () => {
    const r = parseURLSettings(SCHEMA, params("?light_mainColor_active=FFFFFF"));
    assert.deepEqual(r, {});
});

// ───── Select ─────
console.log("\nSelect:");
test('valid option → normalized to lowercase', () => {
    const r = parseURLSettings(SCHEMA, params("?ui_language=ZH"));
    assert.deepEqual(r, { ui_language: "zh" });
});

test('"auto" → "auto"', () => {
    const r = parseURLSettings(SCHEMA, params("?ui_language=auto"));
    assert.deepEqual(r, { ui_language: "auto" });
});

test('invalid option → rejected', () => {
    const r = parseURLSettings(SCHEMA, params("?ui_language=fr"));
    assert.deepEqual(r, {});
});

test('select without options → passed raw', () => {
    const r = parseURLSettings(SCHEMA, params("?p_fontFamily=serif"));
    assert.deepEqual(r, { p_fontFamily: "serif" });
});

// ───── Hidden ─────
console.log("\nHidden:");
test('hidden setting → skipped', () => {
    const r = parseURLSettings(SCHEMA, params("?light_mainColor_inactive=%23ff0"));
    assert.deepEqual(r, {});
});

// ───── Unknown keys ─────
console.log("\nUnknown keys:");
test('key not in schema → skipped', () => {
    const r = parseURLSettings(SCHEMA, params("?unknown_key=hello"));
    assert.deepEqual(r, {});
});

// ───── Edge cases ─────
console.log("\nEdge cases:");
test('empty params → empty result', () => {
    const r = parseURLSettings(SCHEMA, params(""));
    assert.deepEqual(r, {});
});

test('empty schema → empty result', () => {
    const r = parseURLSettings([], params("?show_helper_btn=true"));
    assert.deepEqual(r, {});
});

test('mixed types in one URL → all coerced correctly', () => {
    const r = parseURLSettings(SCHEMA, params(
        "?show_helper_btn=1" +
        "&p_fontSize=1.5" +
        "&light_mainColor_active=%23314874" +
        "&ui_language=EN"
    ));
    assert.deepEqual(r, {
        show_helper_btn: true,
        p_fontSize: "1.5em",
        light_mainColor_active: "#314874",
        ui_language: "en",
    });
});

// ───── Summary ─────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
