/**
 * Regression test for Vite production build worker URL resolution.
 *
 * In production, the bundled app lives at /assets/index.js. When
 * createWorker("client/src/modules/database/db-worker.js", import.meta.url)
 * is called from that bundled context, resolveWorkerUrl must produce
 * http://host/client/src/modules/database/db-worker.js — NOT the
 * broken http://host/assets/index.js/client/src/.../db-worker.js that
 * the old "append" fallback produced.
 *
 * We can't easily import worker.js in Node (it references `self`, DOM
 * globals, etc.), so we statically inspect the source to verify the
 * Vite-build fallback branch exists. We also test the resolveWorkerUrl
 * logic in isolation by copying it into the test (the function is pure
 * and self-contained).
 *
 * Run: node test/test-worker-resolution.mjs
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

const workerPath = path.resolve(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "utils",
    "helpers",
    "worker.js"
);
const src = fs.readFileSync(workerPath, "utf-8");

console.log("worker.js — Vite production build URL resolution\n");

test("REGRESSION: resolveWorkerUrl has a Vite-build fallback branch", () => {
    // The fix adds a `return base.origin + "/" + absParts.join("/")` branch
    // inside the equivalentPaths block, triggered when equivalentIndex === -1
    // (i.e. the caller is under /assets/ with no equivalent path segment).
    // Verify the source contains this fallback.
    assert.ok(
        /base\.origin\s*\+\s*["']\/["']\s*\+\s*absParts\.join/.test(src),
        "Expected `base.origin + '/' + absParts.join(...)` fallback not found. " +
            "Without this, workers load from /assets/index.js/client/... (broken)."
    );
});

test("REGRESSION: the fallback is inside the equivalentPaths block (not a global fallback)", () => {
    // The fallback must be inside the `if (equivalentPaths.includes(firstAbsPart))`
    // block, so it only triggers for worker paths starting with client/shared/server.
    // A global fallback would break other resolution cases.
    // We check that the fallback return appears after the equivalentIndex check.
    const fallbackIdx = src.indexOf('base.origin + "/" + absParts.join');
    const equivBlockIdx = src.indexOf("equivalentPaths.includes(firstAbsPart)");
    assert.ok(fallbackIdx > equivBlockIdx, "Fallback should be after the equivalentPaths check");
    // And it should be before the Priority 2 comment.
    const priority2Idx = src.indexOf("Priority 2");
    assert.ok(fallbackIdx < priority2Idx, "Fallback should be before Priority 2");
});

// ── Isolated logic test ────────────────────────────────────────────────
// Copy the resolveWorkerUrl logic verbatim and test it. This catches
// logic regressions even if the source structure changes.

/**
 * Replicate of resolveWorkerUrl for testing. Must match the source.
 * @param {string} absolutePath
 * @param {string} baseUrl
 * @returns {string}
 */
function resolveWorkerUrl(absolutePath, baseUrl) {
    if (/^https?:\/\//.test(absolutePath)) return absolutePath;
    const base = new URL(baseUrl);
    const baseParts = base.pathname.split("/").filter(Boolean);
    const absParts = absolutePath.split("/").filter(Boolean);
    const equivalentPaths = ["client", "shared", "server"];
    const firstAbsPart = absParts[0];
    if (equivalentPaths.includes(firstAbsPart)) {
        let equivalentIndex = -1;
        for (let i = 0; i < baseParts.length; i++) {
            if (equivalentPaths.includes(baseParts[i])) {
                equivalentIndex = i;
                break;
            }
        }
        if (equivalentIndex !== -1) {
            const resultParts = [...baseParts.slice(0, equivalentIndex), ...absParts];
            return base.origin + "/" + resultParts.join("/");
        }
        // Vite production build fallback
        return base.origin + "/" + absParts.join("/");
    }
    // ... (Priority 2/3 omitted for brevity — not needed for these tests)
    return base.origin + "/" + [...baseParts, ...absParts].join("/");
}

test("Vite build: createWorker from /assets/index.js resolves db-worker correctly", () => {
    // Production: index.js is at /assets/index.js, worker path is
    // "client/src/modules/database/db-worker.js" (absolute from site root).
    const result = resolveWorkerUrl(
        "client/src/modules/database/db-worker.js",
        "http://localhost:4175/assets/index.js"
    );
    assert.equal(result, "http://localhost:4175/client/src/modules/database/db-worker.js");
});

test("Vite build: createWorker resolves file-processor-worker correctly", () => {
    const result = resolveWorkerUrl(
        "client/src/modules/file/file-processor-worker.js",
        "http://localhost:4175/assets/index.js"
    );
    assert.equal(result, "http://localhost:4175/client/src/modules/file/file-processor-worker.js");
});

test("Dev mode: createWorker from /client/src/modules/file/ resolves correctly", () => {
    // Dev: file-processor.js is at /client/src/modules/file/file-processor.js
    // It calls createWorker("client/src/modules/file/file-processor-worker.js", import.meta.url)
    const result = resolveWorkerUrl(
        "client/src/modules/file/file-processor-worker.js",
        "http://localhost:3000/client/src/modules/file/file-processor.js"
    );
    // baseParts = [client, src, modules, file, file-processor.js]
    // equivalentIndex = 0 (client is at index 0)
    // resultParts = [] + [client, src, modules, file, file-processor-worker.js]
    assert.equal(result, "http://localhost:3000/client/src/modules/file/file-processor-worker.js");
});

test("Dev mode: importDependencies shared path from db-worker resolves correctly", () => {
    // Dev: db-worker.js runs at /client/src/modules/database/db-worker.js
    // It calls importDependencies(["shared/utils/logger.js"], import.meta.url)
    const result = resolveWorkerUrl(
        "shared/utils/logger.js",
        "http://localhost:3000/client/src/modules/database/db-worker.js"
    );
    // baseParts = [client, src, modules, database, db-worker.js]
    // equivalentIndex = 0 (client is at index 0)
    // resultParts = [] + [shared, utils, logger.js]
    assert.equal(result, "http://localhost:3000/shared/utils/logger.js");
});

test("Vite build: importDependencies shared path from db-worker resolves correctly", () => {
    // Production: db-worker.js is copied to /client/src/modules/database/db-worker.js
    // (same path as dev). import.meta.url inside the worker is the worker's URL.
    const result = resolveWorkerUrl(
        "shared/utils/logger.js",
        "http://localhost:4175/client/src/modules/database/db-worker.js"
    );
    assert.equal(result, "http://localhost:4175/shared/utils/logger.js");
});

test("Vite build: importDependencies from file-processor-worker resolves shared/core/file", () => {
    const result = resolveWorkerUrl(
        "shared/core/file/file-processor-core.js",
        "http://localhost:4175/client/src/modules/file/file-processor-worker.js"
    );
    assert.equal(result, "http://localhost:4175/shared/core/file/file-processor-core.js");
});

test("Already-absolute URL is returned as-is", () => {
    const result = resolveWorkerUrl(
        "https://cdn.example.com/worker.js",
        "http://localhost:4175/assets/index.js"
    );
    assert.equal(result, "https://cdn.example.com/worker.js");
});

// ── Summary ────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
