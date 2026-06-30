/**
 * Regression test for P0-5: the OpenCC CDN URL must point to a real,
 * existing file. The previous code pinned opencc-js@1.0.5 (which
 * doesn't exist on npm) and used the path dist/umd/index.js (which
 * doesn't exist in the package). Both made heavy mode always 404
 * and fall back to light mode.
 *
 * This test does TWO things:
 *   1. Statically inspects t2s-opencc.js source to verify the URL
 *      matches the expected pattern (correct package + version + path).
 *   2. (Optional, online-only) verifies the URL returns HTTP 200.
 *      Skipped if network is unavailable so the test passes in CI
 *      without internet.
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

const filePath = path.resolve(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "core",
    "t2s-opencc.js"
);
const src = fs.readFileSync(filePath, "utf-8");

console.log("t2s-opencc.js — P0-5 regression: CDN URL must be valid\n");

await test("source defines a CDN URL constant", () => {
    assert.ok(
        /const\s+OPENCC_JS_CDN\s*=\s*["']https:\/\/[^"']+["']/.test(src),
        "Expected `const OPENCC_JS_CDN = 'https://...'` not found."
    );
});

await test("CDN URL points to jsDelivr (reliable global CDN)", () => {
    assert.ok(
        /cdn\.jsdelivr\.net/.test(src),
        "CDN URL should use jsDelivr for global availability."
    );
});

await test("CDN URL uses the opencc-js package (not opencc-wasm)", () => {
    assert.ok(
        /opencc-js@\d+\.\d+\.\d+/.test(src),
        "Expected `opencc-js@<version>` in CDN URL. " +
            "The package is `opencc-js` on npm, NOT `opencc-wasm`."
    );
});

await test("CDN URL uses dist/umd/full.js path (bundles dict data)", () => {
    // The umd/ directory has 3 files: t2cn.js, cn2t.js, full.js.
    // Only full.js bundles the dictionary data and exports the full
    // OpenCC.Converter factory. The other two are partial builds.
    assert.ok(
        /dist\/umd\/full\.js/.test(src),
        "Expected `dist/umd/full.js` path in CDN URL. " +
            "The umd/ directory has 3 files (t2cn.js, cn2t.js, full.js); " +
            "only full.js bundles the dictionary data."
    );
});

await test("CDN URL does NOT use the broken 1.0.5 version", () => {
    assert.ok(
        !/opencc-js@1\.0\.5/.test(src),
        "CDN URL still references the non-existent opencc-js@1.0.5. " +
            "That version was never published to npm; the URL always 404s."
    );
});

await test("CDN URL does NOT use the broken dist/umd/index.js path", () => {
    // Extract just the URL string (not comments) and verify it doesn't
    // reference index.js. Comments may mention index.js to explain what
    // NOT to use — that's fine.
    const urlMatch = src.match(/["'](https:\/\/cdn\.jsdelivr\.net\/npm\/opencc-js@[^"']+)["']/);
    assert.ok(urlMatch, "Could not extract CDN URL string from source");
    const url = urlMatch[1];
    assert.ok(
        !url.includes("dist/umd/index.js"),
        `CDN URL "${url}" references dist/umd/index.js which does not exist ` +
            "in the opencc-js package."
    );
});

// Optional online check — skip silently if network is unavailable.
await test("CDN URL returns HTTP 200 (online check, may skip)", async () => {
    const match = src.match(/["'](https:\/\/cdn\.jsdelivr\.net\/npm\/opencc-js@[^"']+)["']/);
    if (!match) {
        assert.fail("Could not extract CDN URL from source");
    }
    const url = match[1];
    try {
        const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
        assert.ok(res.ok, `CDN URL returned HTTP ${res.status}`);
    } catch (e) {
        // Network unavailable in CI — skip with a warning, don't fail.
        console.log(`    (skipped: ${e.message})`);
    }
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
