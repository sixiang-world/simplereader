/**
 * Tests for the v2 refactored utility submodules split out of base.js.
 *
 * Covers the pure functions that don't require DOM/browser globals:
 *   - base/color.js : hexToRGB, hexToHSL, HSLToHex, pSBC, invertColor
 *   - base/format.js: padZero, truncateText, formatBytes, formatBytes_simple,
 *                     convertUTCTimestampToLocalString, compareDates,
 *                     constructNotificationMessageFromArray
 *   - base/path.js  : snakeToCamel, setDeep
 *   - base/toBool.js: toBool
 *   - base/env.js   : isWindows, isMac (Node-aware, no navigator needed)
 *
 * Functions that require DOM globals (document, navigator.userAgent,
 * window, getComputedStyle, etc.) are NOT tested here — they would need
 * jsdom or a browser harness, which is out of scope for this refactor.
 *
 * Run: node test/test-base-submodules.mjs
 */

import assert from "node:assert/strict";
import {
    hexToRGB,
    hexToHSL,
    HSLToHex,
    pSBC,
    invertColor,
} from "../client/src/utils/base/color.js";
import {
    padZero,
    truncateText,
    formatBytes,
    formatBytes_simple,
    convertUTCTimestampToLocalString,
    compareDates,
    constructNotificationMessageFromArray,
} from "../client/src/utils/base/format.js";
import { snakeToCamel, setDeep } from "../client/src/utils/base/path.js";
import { toBool } from "../client/src/utils/base/toBool.js";
import { isWindows, isMac } from "../client/src/utils/base/env.js";

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

// ── color.js ────────────────────────────────────────────────────────────

console.log("base/color.js — hexToRGB\n");

test("hexToRGB('#FF0000') → [255, 0, 0]", () => {
    assert.deepEqual(hexToRGB("#FF0000"), [255, 0, 0]);
});
test("hexToRGB('#000') → [0, 0, 0] (3-digit shorthand expands)", () => {
    assert.deepEqual(hexToRGB("#000"), [0, 0, 0]);
});
test("hexToRGB('#03F') → [0, 51, 255] (3-digit shorthand expands)", () => {
    assert.deepEqual(hexToRGB("#03F"), [0, 51, 255]);
});
test("hexToRGB('FF0000') → [255, 0, 0] (no # prefix)", () => {
    assert.deepEqual(hexToRGB("FF0000"), [255, 0, 0]);
});
test("hexToRGB('garbage') → null", () => {
    assert.equal(hexToRGB("garbage"), null);
});
test("hexToRGB('#ZZZZZZ') → null (invalid hex chars)", () => {
    assert.equal(hexToRGB("#ZZZZZZ"), null);
});

console.log("\nbase/color.js — hexToHSL\n");

test("hexToHSL('#FF0000') → red: hue ~0, sat 100, lightness 50", () => {
    const [h, s, l] = hexToHSL("#FF0000");
    assert.equal(h, 0);
    assert.equal(s, 100);
    // Note: l is returned as a string from .toFixed(1), e.g. "50.0"
    assert.equal(Number(l), 50);
});
test("hexToHSL('#00FF00') → green: hue 120", () => {
    const [h] = hexToHSL("#00FF00");
    assert.equal(h, 120);
});
test("hexToHSL('#0000FF') → blue: hue 240", () => {
    const [h] = hexToHSL("#0000FF");
    assert.equal(h, 240);
});
test("hexToHSL('#808080') → gray: sat 0", () => {
    const [, s] = hexToHSL("#808080");
    assert.equal(s, 0);
});
test("hexToHSL('#FFFFFF', 0.5) → lightness halved to 50", () => {
    const [, , l] = hexToHSL("#FFFFFF", 0.5);
    assert.equal(Number(l), 50);
});

console.log("\nbase/color.js — HSLToHex\n");

test("HSLToHex(0, 100, 50) → '#ff0000' (red)", () => {
    assert.equal(HSLToHex(0, 100, 50), "#ff0000");
});
test("HSLToHex(120, 100, 50) → '#00ff00' (green)", () => {
    assert.equal(HSLToHex(120, 100, 50), "#00ff00");
});
test("HSLToHex(240, 100, 50) → '#0000ff' (blue)", () => {
    assert.equal(HSLToHex(240, 100, 50), "#0000ff");
});
test("hexToHSL → HSLToHex roundtrip preserves color (#2F5086)", () => {
    const original = "#2F5086";
    const [h, s, l] = hexToHSL(original);
    const roundtrip = HSLToHex(h, s, l);
    assert.equal(roundtrip.toLowerCase(), original.toLowerCase());
});

console.log("\nbase/color.js — pSBC\n");

test("pSBC(0, '#000000') → '#000000' (no change at p=0)", () => {
    assert.equal(pSBC(0, "#000000"), "#000000");
});
test("pSBC(1, '#000000') → '#ffffff' (shade to white at p=1)", () => {
    assert.equal(pSBC(1, "#000000"), "#ffffff");
});
test("pSBC(-1, '#ffffff') → '#000000' (shade to black at p=-1)", () => {
    assert.equal(pSBC(-1, "#ffffff"), "#000000");
});
test("pSBC(null, '#000') → null (invalid p type)", () => {
    assert.equal(pSBC(null, "#000"), null);
});
test("pSBC(0.5, 'garbage') → null (invalid color)", () => {
    assert.equal(pSBC(0.5, "garbage"), null);
});

console.log("\nbase/color.js — invertColor\n");

test("invertColor('#000000') → '#ffffffff' (black inverts to white + alpha ff)", () => {
    // Default alpha=1 produces trailing 'ff' (alpha channel).
    assert.equal(invertColor("#000000"), "#ffffffff");
});
test("invertColor('#FFFFFF') → '#000000ff' (white inverts to black + alpha ff)", () => {
    assert.equal(invertColor("#FFFFFF"), "#000000ff");
});
test("invertColor('#000', true) → '#FFFFFF' (bw mode, dark → white, no alpha)", () => {
    assert.equal(invertColor("#000", true), "#FFFFFF");
});
test("invertColor('#FFF', true) → '#000000' (bw mode, light → black, no alpha)", () => {
    assert.equal(invertColor("#FFF", true), "#000000");
});
test("invertColor('000000') → '#ffffffff' (no # prefix is OK)", () => {
    assert.equal(invertColor("000000"), "#ffffffff");
});
test("invertColor('#XYZ') → does NOT throw (3-digit hex expands to 'XXYYZZ')", () => {
    // '#XYZ' is 3 digits → expands to 'XXYYZZ' (length 6) → passes the
    // length check. The result is a valid (if meaningless) hex color.
    // This is the original behavior, preserved verbatim.
    const result = invertColor("#XYZ");
    assert.equal(typeof result, "string");
    assert.ok(result.startsWith("#"));
});

// ── format.js ───────────────────────────────────────────────────────────

console.log("\nbase/format.js — padZero\n");

test("padZero('5') → '05' (default len=2)", () => {
    assert.equal(padZero("5"), "05");
});
test("padZero('5', 4) → '0005'", () => {
    assert.equal(padZero("5", 4), "0005");
});
test("padZero('abc', 2) → 'bc' (truncates if longer than len)", () => {
    assert.equal(padZero("abc", 2), "bc");
});
test("padZero(15) → '15' (accepts numbers)", () => {
    assert.equal(padZero(15), "15");
});

console.log("\nbase/format.js — truncateText\n");

test("truncateText('hello world', 5) → 'hello...' (truncates with ellipsis)", () => {
    assert.equal(truncateText("hello world", 5), "hello...");
});
test("truncateText('short', 50) → 'short' (no truncation under limit)", () => {
    assert.equal(truncateText("short", 50), "short");
});
test("truncateText('', 50) → '' (empty string passes through)", () => {
    assert.equal(truncateText("", 50), "");
});
test("truncateText(null) → '' (null becomes empty string)", () => {
    assert.equal(truncateText(null), "");
});
test("truncateText('hello', -5) → falls back to maxLength=100", () => {
    assert.equal(truncateText("hello", -5), "hello");
});
test("truncateText('hello') → 'hello' (default maxLength=50)", () => {
    assert.equal(truncateText("hello"), "hello");
});

console.log("\nbase/format.js — formatBytes\n");

test("formatBytes(0) → '0 Bytes'", () => {
    assert.equal(formatBytes(0), "0 Bytes");
});
test("formatBytes(1) → '1 Byte' (singular)", () => {
    assert.equal(formatBytes(1), "1 Byte");
});
test("formatBytes(1024, 'si') → '1.02 kB' (SI base 1000)", () => {
    assert.equal(formatBytes(1024, "si"), "1.02 kB");
});
test("formatBytes(1024, 'iec') → '1.00 KiB' (IEC base 1024)", () => {
    assert.equal(formatBytes(1024, "iec"), "1.00 KiB");
});
test("formatBytes(-1) → '-1 Bytes' (plural; -1 is in [-1,0,1] but != 1)", () => {
    // Original behavior: the singular/plural check is `bytes === 1`, so
    // -1 falls through to plural "Bytes".
    assert.equal(formatBytes(-1), "-1 Bytes");
});
test("formatBytes_simple(0) → '0 Bytes'", () => {
    assert.equal(formatBytes_simple(0), "0 Bytes");
});
test("formatBytes_simple(1500) → '1.5 KB' (SI only)", () => {
    assert.equal(formatBytes_simple(1500), "1.5 KB");
});
test("formatBytes_simple(NaN) → '0 Bytes' (non-finite fallback)", () => {
    assert.equal(formatBytes_simple(NaN), "0 Bytes");
});
test("formatBytes_simple('abc') → '0 Bytes' (non-number fallback)", () => {
    assert.equal(formatBytes_simple("abc"), "0 Bytes");
});
test("formatBytes_simple(1500, 2) → '1.50 KB' (decimals param honored)", () => {
    assert.equal(formatBytes_simple(1500, 2), "1.50 KB");
});
test("formatBytes_simple(1500, 0) → '2 KB' (zero decimals)", () => {
    assert.equal(formatBytes_simple(1500, 0), "2 KB");
});
test("formatBytes_simple(1500, 10) → clamps to 3 decimals", () => {
    assert.equal(formatBytes_simple(1500, 10), "1.500 KB");
});
test("formatBytes_simple(0.5) → '0.5 Bytes' (sub-byte values stay in Bytes)", () => {
    assert.equal(formatBytes_simple(0.5), "0.5 Bytes");
});
test("formatBytes_simple(-0.5) → '-0.5 Bytes' (negative sub-byte values stay in Bytes)", () => {
    assert.equal(formatBytes_simple(-0.5), "-0.5 Bytes");
});

console.log("\nbase/format.js — convertUTCTimestampToLocalString\n");

test("convertUTCTimestampToLocalString('0') → returns a string", () => {
    const result = convertUTCTimestampToLocalString("0");
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0);
});
test("convertUTCTimestampToLocalString(0) → accepts number input", () => {
    const result = convertUTCTimestampToLocalString(0);
    assert.equal(typeof result, "string");
});

console.log("\nbase/format.js — compareDates\n");

test("compareDates('2024-01-01', '2024-01-02') → false (d1 earlier)", () => {
    assert.equal(compareDates("2024-01-01", "2024-01-02"), false);
});
test("compareDates('2024-01-02', '2024-01-01') → true (d1 later)", () => {
    assert.equal(compareDates("2024-01-02", "2024-01-01"), true);
});
test("compareDates('2024-01-01', '2024-01-01') → false (equal)", () => {
    assert.equal(compareDates("2024-01-01", "2024-01-01"), false);
});
test("compareDates('garbage', 'garbage') → null (both invalid)", () => {
    assert.equal(compareDates("garbage", "garbage"), null);
});
test("compareDates('2024-01-01', 'garbage') → true (d1 valid, d2 invalid)", () => {
    assert.equal(compareDates("2024-01-01", "garbage"), true);
});

console.log("\nbase/format.js — constructNotificationMessageFromArray\n");

test("empty itemList → ''", () => {
    assert.equal(constructNotificationMessageFromArray("Added", []), "");
});
test("zh: single item → 'Added：\\n“item1”'", () => {
    const result = constructNotificationMessageFromArray("Added", ["item1"], { language: "zh" });
    assert.equal(result, "Added：\n“item1”");
});
test("en: single item → 'Added: \\n\"item1\"'", () => {
    const result = constructNotificationMessageFromArray("Added", ["item1"], { language: "en" });
    assert.equal(result, 'Added: \n"item1"');
});
test("en: multiple items → pluralizes base text with 's'", () => {
    // The function appends 's' to baseText when itemList.length > 1
    // in English mode, producing 'Addeds: ...'.
    const result = constructNotificationMessageFromArray("Added", ["a", "b"], { language: "en" });
    assert.ok(result.startsWith("Addeds: "));
});
test("zh: >3 items → uses messageSuffix with count", () => {
    const result = constructNotificationMessageFromArray("已添加", ["a", "b", "c", "d", "e"], {
        language: "zh",
        maxItems: 3,
        messageSuffix: "还有 xxx 项",
    });
    assert.ok(result.includes("还有 2 项"));
});

// ── path.js ─────────────────────────────────────────────────────────────

console.log("\nbase/path.js — snakeToCamel\n");

test("snakeToCamel('pagination_bottom') → 'paginationBottom'", () => {
    assert.equal(snakeToCamel("pagination_bottom"), "paginationBottom");
});
test("snakeToCamel('some_long_snake_case') → 'someLongSnakeCase'", () => {
    assert.equal(snakeToCamel("some_long_snake_case"), "someLongSnakeCase");
});
test("snakeToCamel('already_camel') → 'alreadyCamel'", () => {
    assert.equal(snakeToCamel("already_camel"), "alreadyCamel");
});
test("snakeToCamel('nounderscore') → 'nounderscore' (no change)", () => {
    assert.equal(snakeToCamel("nounderscore"), "nounderscore");
});
test("snakeToCamel('') → '' (empty input)", () => {
    assert.equal(snakeToCamel(""), "");
});

console.log("\nbase/path.js — setDeep\n");

test("setDeep({}, 'a.b.c', 1) → {a:{b:{c:1}}}", () => {
    const obj = {};
    setDeep(obj, "a.b.c", 1);
    assert.deepEqual(obj, { a: { b: { c: 1 } } });
});
test("setDeep({a:{b:1}}, 'a.c', 2) → preserves existing keys", () => {
    const obj = { a: { b: 1 } };
    setDeep(obj, "a.c", 2);
    assert.deepEqual(obj, { a: { b: 1, c: 2 } });
});
test("setDeep({}, ['x', 'y'], 5) → accepts array path", () => {
    const obj = {};
    setDeep(obj, ["x", "y"], 5);
    assert.deepEqual(obj, { x: { y: 5 } });
});
test("setDeep({}, 'foo.bar[2].baz', 123) → handles bracket notation", () => {
    const obj = {};
    setDeep(obj, "foo.bar[2].baz", 123);
    // Note: '2' becomes a string key, not an array index, since setDeep
    // creates plain objects. This is the original behavior preserved
    // verbatim in the refactor.
    assert.deepEqual(obj, { foo: { bar: { "2": { baz: 123 } } } });
});
test("setDeep({}, 42, 'x') → false (invalid path type)", () => {
    const obj = {};
    const result = setDeep(obj, 42, "x");
    assert.equal(result, false);
});
test("setDeep overwrites existing primitive with object", () => {
    const obj = { a: 1 };
    setDeep(obj, "a.b", 2);
    // Original behavior: a primitive at the path is replaced by an object.
    assert.deepEqual(obj, { a: { b: 2 } });
});

// ── toBool.js ───────────────────────────────────────────────────────────

console.log("\nbase/toBool.js — toBool\n");

test("toBool(true) → true (boolean passthrough)", () => {
    assert.equal(toBool(true), true);
});
test("toBool(false) → false (boolean passthrough)", () => {
    assert.equal(toBool(false), false);
});
test("toBool('true') → true (string)", () => {
    assert.equal(toBool("true"), true);
});
test("toBool('false') → false (string)", () => {
    assert.equal(toBool("false"), false);
});
test("toBool('TRUE') → true (case insensitive)", () => {
    assert.equal(toBool("TRUE"), true);
});
test("toBool('FALSE') → false (case insensitive)", () => {
    assert.equal(toBool("FALSE"), false);
});
test("toBool('  true  ') → true (trims whitespace)", () => {
    assert.equal(toBool("  true  "), true);
});
test("toBool(1) → true (forceConvert default)", () => {
    assert.equal(toBool(1), true);
});
test("toBool(0) → false (forceConvert default)", () => {
    assert.equal(toBool(0), false);
});
test("toBool('maybe', false) → 'maybe' (forceConvert=false returns raw)", () => {
    assert.equal(toBool("maybe", false), "maybe");
});
test("toBool('', false) → '' (empty string with forceConvert=false)", () => {
    assert.equal(toBool("", false), "");
});
test("toBool('1', false) → '1' (non-bool/string, forceConvert=false returns raw)", () => {
    // '1' is a string but doesn't match 'true'/'false', so with forceConvert=false
    // it falls through to the default return path.
    assert.equal(toBool("1", false), "1");
});

// ── env.js (Node-safe subset) ───────────────────────────────────────────

console.log("\nbase/env.js — isWindows / isMac (Node-aware)\n");

test("isWindows() returns a boolean (matches process.platform)", () => {
    const result = isWindows();
    assert.equal(typeof result, "boolean");
    assert.equal(result, process.platform === "win32");
});
test("isMac() returns a boolean (matches process.platform)", () => {
    const result = isMac();
    assert.equal(typeof result, "boolean");
    assert.equal(result, process.platform === "darwin");
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
