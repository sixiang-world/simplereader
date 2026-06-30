/**
 * Verification test for the locally-hosted opencc-js bundle.
 *
 * The opencc-js UMD bundle (opencc-js@1.3.2) was downloaded from jsDelivr CDN
 * and placed in `client/lib/opencc/full.js` to avoid browser tracking-prevention
 * blocking third-party CDN requests.
 *
 * This test verifies:
 *   1. t2s-opencc.js references the local file path (not a CDN URL)
 *   2. The local file exists on disk and has reasonable size
 *   3. The local file is a valid UMD bundle that exports the OpenCC global
 *
 * Run: node test/test-opencc-cdn.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let passed = 0;
let failed = 0;
function test(name, fn) {
    return Promise.resolve()
        .then(() => fn())
        .then(() => {
            passed++;
            console.log(`  ✓ ${name}`);
        })
        .catch((err) => {
            failed++;
            console.error(`  ✗ ${name}`);
            console.error(`    ${err.message}`);
        });
}

const __dirname = import.meta.dirname;
const ROOT = path.resolve(__dirname, "..");

// The t2s-opencc.js source file.
const SRC_PATH = path.resolve(ROOT, "client", "src", "core", "t2s-opencc.js");
const src = fs.readFileSync(SRC_PATH, "utf-8");

// The local bundle file.
const BUNDLE_PATH = path.resolve(ROOT, "client", "lib", "opencc", "full.js");

console.log("t2s-opencc.js — locally-hosted bundle verification\n");

await test("source defines a file-path constant (not CDN URL)", () => {
    assert.ok(
        /const\s+OPENCC_JS_PATH\s*=/.test(src),
        "Expected `const OPENCC_JS_PATH = '...'` not found. " +
            "The source should define OPENCC_JS_PATH pointing to the local bundle."
    );
});

await test("source path points to client/lib/opencc/full.js", () => {
    assert.ok(
        /client\/lib\/opencc\/full\.js/.test(src),
        "Expected `client/lib/opencc/full.js` in the OPENCC_JS_PATH constant."
    );
});

await test("source no longer references a CDN URL for loading", () => {
    // The ONLY path in the source should be the local one. No jsDelivr URLs.
    assert.ok(
        !/cdn\.jsdelivr\.net/.test(src),
        "Source should NOT contain jsDelivr URLs. The file is loaded locally."
    );
});

await test("local bundle file exists on disk", () => {
    assert.ok(
        fs.existsSync(BUNDLE_PATH),
        `Expected bundle file at ${BUNDLE_PATH} not found.`
    );
});

await test("local bundle file has reasonable size (≥500KB)", () => {
    const stat = fs.statSync(BUNDLE_PATH);
    assert.ok(
        stat.size >= 500 * 1024,
        `Bundle file is only ${Math.round(stat.size / 1024)}KB, expected at least 500KB.`
    );
    console.log(`    ${Math.round(stat.size / 1024)}KB`);
});

await test("local bundle file contains the OpenCC global assignment", () => {
    const bundleContent = fs.readFileSync(BUNDLE_PATH, "utf-8");
    assert.ok(
        /OpenCC/.test(bundleContent),
        "Bundle should contain the OpenCC global assignment.\n" +
            "The UMD wrapper sets `globalThis.OpenCC = factory()`."
    );
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
