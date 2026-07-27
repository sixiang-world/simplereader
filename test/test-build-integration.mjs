/**
 * Integration tests for the Vite build and production artifacts.
 *
 * Covers:
 *   - dist/ directory structure after build
 *   - Critical files exist in dist/
 *   - version.json is copied to dist/
 *   - OpenCC bundle is in dist/
 *   - Worker files are copied to dist/
 *   - Production build is minified (no sourcemaps in production)
 *   - No source files leak into dist/ (except copied workers)
 *
 * Run: node test/test-build-integration.mjs
 * Precondition: pnpm run build (or vite build) has been executed.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

const DIST = path.resolve(import.meta.dirname, "..", "dist");

// ── Tests ───────────────────────────────────────────────────────────────

console.log("build integration — dist/ directory structure\n");

test("dist/ directory exists", () => {
    assert.ok(fs.existsSync(DIST), `dist/ not found at ${DIST}. Run 'pnpm run build' first.`);
});

test("dist/index.html exists", () => {
    assert.ok(fs.existsSync(path.join(DIST, "index.html")), "dist/index.html missing");
});

// Helper: list files in dist/assets/ (hashed filenames since v2.1.0).
function listAssets() {
    const assetsDir = path.join(DIST, "assets");
    if (!fs.existsSync(assetsDir)) return [];
    return fs.readdirSync(assetsDir);
}

test("dist/assets/ contains a hashed entry JS bundle", () => {
    const assets = listAssets();
    const entryJs = assets.find((f) => /^index-.*\.js$/.test(f));
    assert.ok(
        entryJs,
        `Expected dist/assets/index-<hash>.js (hashed). Found: ${assets.join(", ") || "(empty)"}`
    );
});

test("dist/assets/ contains a hashed entry CSS bundle", () => {
    const assets = listAssets();
    const entryCss = assets.find((f) => /^index-.*\.css$/.test(f));
    assert.ok(
        entryCss,
        `Expected dist/assets/index-<hash>.css (hashed). Found: ${assets.join(", ") || "(empty)"}`
    );
});

test("dist/version.json exists", () => {
    assert.ok(fs.existsSync(path.join(DIST, "version.json")), "dist/version.json missing");
});

test("dist/version.json is valid JSON with version field", () => {
    const raw = fs.readFileSync(path.join(DIST, "version.json"), "utf-8");
    const parsed = JSON.parse(raw);
    assert.ok(parsed.version, "version field missing");
    assert.equal(typeof parsed.version, "string");
});

console.log("\nbuild integration — OpenCC bundle\n");

test("dist/client/lib/opencc/full.js exists", () => {
    const openccPath = path.join(DIST, "client", "lib", "opencc", "full.js");
    assert.ok(fs.existsSync(openccPath), "OpenCC bundle missing in dist/");
});

test("dist/client/lib/opencc/full.js has reasonable size (≥500KB)", () => {
    const openccPath = path.join(DIST, "client", "lib", "opencc", "full.js");
    const stats = fs.statSync(openccPath);
    assert.ok(stats.size >= 500 * 1024, `OpenCC bundle too small: ${(stats.size / 1024).toFixed(0)}KB`);
});

console.log("\nbuild integration — Worker files\n");

test("dist/client/src/modules/database/db-worker.js exists", () => {
    const workerPath = path.join(DIST, "client", "src", "modules", "database", "db-worker.js");
    assert.ok(fs.existsSync(workerPath), "db-worker.js missing in dist/");
});

test("dist/client/src/modules/file/file-processor-worker.js exists", () => {
    const workerPath = path.join(DIST, "client", "src", "modules", "file", "file-processor-worker.js");
    assert.ok(fs.existsSync(workerPath), "file-processor-worker.js missing in dist/");
});

test("dist/shared/ directory exists (worker dependencies)", () => {
    assert.ok(fs.existsSync(path.join(DIST, "shared")), "shared/ missing in dist/");
});

console.log("\nbuild integration — Production minification\n");

test("dist/assets/ contains no source maps (production disables sourcemaps)", () => {
    const maps = listAssets().filter((f) => f.endsWith(".js.map") || f.endsWith(".css.map"));
    assert.ok(maps.length === 0, `Unexpected source maps in dist/assets: ${maps.join(", ")}`);
});

test("dist/assets entry JS is minified (no block comments)", () => {
    const entryJs = listAssets().find((f) => /^index-.*\.js$/.test(f));
    assert.ok(entryJs, "entry JS not found");
    const js = fs.readFileSync(path.join(DIST, "assets", entryJs), "utf-8");
    // Minified code should not contain typical un-minified multi-line block comments
    assert.ok(!js.includes("/**"), "entry JS still contains block comments (not minified)");
});

console.log("\nbuild integration — Font assets\n");

test("dist/client/fonts/ directory exists", () => {
    assert.ok(fs.existsSync(path.join(DIST, "client", "fonts")), "fonts/ missing in dist/");
});

test("dist/assets/ contains the subset UI font (hashed)", () => {
    const font = listAssets().find((f) => /^LXGWWenKaiScreen_sub-.*\.woff2$/.test(f));
    assert.ok(
        font,
        `Subset UI font missing in dist/assets (hashed name expected)`
    );
});

console.log("\nbuild integration — No source files leaked\n");

test("dist/ does not contain node_modules/", () => {
    assert.ok(!fs.existsSync(path.join(DIST, "node_modules")), "node_modules/ leaked into dist/");
});

test("dist/ does not contain test/ files", () => {
    assert.ok(!fs.existsSync(path.join(DIST, "test")), "test/ leaked into dist/");
});

test("dist/ does not contain build-tools/", () => {
    assert.ok(!fs.existsSync(path.join(DIST, "build-tools")), "build-tools/ leaked into dist/");
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.log("\n⚠️  Some tests require 'pnpm run build' to be run first.");
    process.exit(1);
}
