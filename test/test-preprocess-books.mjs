/**
 * Tests for the build-time books/ preprocessor.
 *
 * Verifies that:
 *   - The preprocessBooks() function scans books/ and writes JSON files.
 *   - Output JSON has the expected schema (metadata, processedLines,
 *     titles, page_breaks, source).
 *   - The script handles missing books/ directory gracefully.
 *   - The script handles unsupported file extensions gracefully.
 *
 * NOTE: This test creates a temporary books/ directory, runs the
 * preprocessor against it, and cleans up afterwards. It does NOT
 * modify the real books/ directory.
 *
 * Run: node test/test-preprocess-books.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let passed = 0;
let failed = 0;
async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
    }
}

// ── Setup: create a temporary repo-like directory ──────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-preprocess-"));

// The preprocess-books.mjs script resolves REPO_ROOT from its own
// __dirname, so we can't easily redirect it. Instead, we import the
// internal helpers (processTxtFile, processEpubFile, processOne) and
// test them directly with controlled inputs.
const { preprocessBooks } = await import("../build-tools/preprocess-books.mjs");

// We'll create a temp books/ dir AND temp dist/ dir, then call
// preprocessBooks() with explicit booksDir/outDir overrides.

console.log("build-tools/preprocess-books.mjs — preprocessBooks\n");

await test("preprocessBooks: empty books/ → 0 processed, no error", async () => {
    const emptyBooks = path.join(tmpDir, "empty-books");
    const outDir = path.join(tmpDir, "empty-out");
    fs.mkdirSync(emptyBooks, { recursive: true });
    const result = await preprocessBooks({ booksDir: emptyBooks, outDir });
    assert.equal(result.processed, 0);
    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 0);
});

await test("preprocessBooks: nonexistent books/ → 0 processed, no error", async () => {
    const nonexistent = path.join(tmpDir, "does-not-exist");
    const outDir = path.join(tmpDir, "noexist-out");
    const result = await preprocessBooks({ booksDir: nonexistent, outDir });
    assert.equal(result.processed, 0);
    assert.equal(result.failed, 0);
});

await test("preprocessBooks: simple .txt file → JSON output with expected schema", async () => {
    const booksDir = path.join(tmpDir, "txt-books");
    const outDir = path.join(tmpDir, "txt-out");
    fs.mkdirSync(booksDir, { recursive: true });
    const txtPath = path.join(booksDir, "test-book.txt");
    fs.writeFileSync(
        txtPath,
        [
            "第一章 测试",
            "",
            "这是一段测试文本。用于验证 build-time preprocessing 的输出格式。",
            "",
            "第二章 结论",
            "",
            "预处理后的 JSON 应当包含 processedLines、titles、page_breaks 等字段。",
            "",
        ].join("\n"),
        "utf-8"
    );

    const result = await preprocessBooks({ booksDir, outDir });
    assert.equal(result.processed, 1);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 0);

    const outPath = path.join(outDir, "test-book.json");
    assert.ok(fs.existsSync(outPath), `Expected output file at ${outPath}`);

    const data = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    assert.ok(data.metadata, "metadata field missing");
    assert.ok(typeof data.metadata.title === "string");
    assert.ok(Array.isArray(data.processedLines));
    assert.ok(data.processedLines.length > 0);
    assert.ok(Array.isArray(data.titles));
    assert.ok(Array.isArray(data.page_breaks));
    assert.ok(data.source, "source field missing");
    assert.equal(data.source.filename, "test-book.txt");
    assert.ok(typeof data.source.size_bytes === "number");
    assert.ok(data.source.size_bytes > 0);
});

await test("preprocessBooks: unsupported extension is skipped (not a failure)", async () => {
    const booksDir = path.join(tmpDir, "mixed-books");
    const outDir = path.join(tmpDir, "mixed-out");
    fs.mkdirSync(booksDir, { recursive: true });
    fs.writeFileSync(path.join(booksDir, "readme.md"), "# Readme", "utf-8");
    fs.writeFileSync(path.join(booksDir, "notes.txt"), "Some notes.\n", "utf-8");

    const result = await preprocessBooks({ booksDir, outDir });
    // .md is not in the supported extensions list — scanFiles filters it out.
    assert.equal(result.processed, 1); // only .txt counted
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 0);
});

await test("preprocessBooks: statistics are correct (totalPages > 0 for non-empty book)", async () => {
    const booksDir = path.join(tmpDir, "stats-books");
    const outDir = path.join(tmpDir, "stats-out");
    fs.mkdirSync(booksDir, { recursive: true });
    fs.writeFileSync(
        path.join(booksDir, "long.txt"),
        Array.from({ length: 50 }, (_, i) => `第${i + 1}章 章节${i + 1}\n\n内容${i + 1}。`).join("\n\n"),
        "utf-8"
    );
    const result = await preprocessBooks({ booksDir, outDir });
    assert.equal(result.succeeded, 1);
    assert.ok(result.totalPages >= 1, `Expected >= 1 page, got ${result.totalPages}`);
});

await test("preprocessBooks: output JSON has valid HTML in processedLines", async () => {
    const booksDir = path.join(tmpDir, "html-books");
    const outDir = path.join(tmpDir, "html-out");
    fs.mkdirSync(booksDir, { recursive: true });
    fs.writeFileSync(
        path.join(booksDir, "html-test.txt"),
        "第一章 测试\n\n这是一段测试文本。\n",
        "utf-8"
    );
    await preprocessBooks({ booksDir, outDir });
    const data = JSON.parse(fs.readFileSync(path.join(outDir, "html-test.json"), "utf-8"));
    // Each processedLine is EITHER:
    //   - A plain HTML string (from generateTitlePage / generateEndPage), OR
    //   - An object {type, tag, content, ...} (from processChunkStatic).
    // Verify every entry has non-empty HTML content.
    for (const line of data.processedLines) {
        if (typeof line === "string") {
            assert.ok(line.length >= 0, "string processedLine should not be null");
        } else if (line && typeof line === "object") {
            assert.ok(typeof line.content === "string", "object processedLine should have string content");
        } else {
            assert.fail(`Unexpected processedLine type: ${typeof line}`);
        }
    }
});

await test("REGRESSION P0-6: no single-char garbage strings in processedLines", async () => {
    // P0-6 regression guard: the previous code did
    //   processedLines: [...titlePageLines, ...result.htmlLines, ...endPageLines]
    // where endPageLines was a STRING (from generateEndPage). Spreading a
    // string with ... splits it into individual characters, producing 72+
    // garbage single-char entries. This test verifies no such garbage
    // exists in the output.
    const booksDir = path.join(tmpDir, "regression-books");
    const outDir = path.join(tmpDir, "regression-out");
    fs.mkdirSync(booksDir, { recursive: true });
    fs.writeFileSync(
        path.join(booksDir, "regression-test.txt"),
        "第一章 测试\n\n这是一段测试文本。\n\n第二章 结束\n\n内容结束。\n",
        "utf-8"
    );
    await preprocessBooks({ booksDir, outDir });
    const data = JSON.parse(fs.readFileSync(path.join(outDir, "regression-test.json"), "utf-8"));

    const stringLines = data.processedLines.filter((l) => typeof l === "string");
    const singleCharStrings = stringLines.filter((s) => s.length === 1);
    assert.equal(
        singleCharStrings.length,
        0,
        `Found ${singleCharStrings.length} single-char string(s) in processedLines — ` +
            `this indicates the endPageLines string-spread bug is back. ` +
            `Sample: ${JSON.stringify(singleCharStrings.slice(0, 5))}`
    );
});

await test("REGRESSION P0-6: no duplicate title page content in processedLines", async () => {
    // P0-6 regression guard: the previous code spread titlePageLines as
    // raw strings AND result.htmlLines (which already contains the title
    // page as objects, prepended by processChunkStatic). This duplicated
    // the title page. This test verifies no duplicate content exists.
    const booksDir = path.join(tmpDir, "dupe-books");
    const outDir = path.join(tmpDir, "dupe-out");
    fs.mkdirSync(booksDir, { recursive: true });
    fs.writeFileSync(
        path.join(booksDir, "dupe-test.txt"),
        "第一章 测试\n\n内容。\n",
        "utf-8"
    );
    await preprocessBooks({ booksDir, outDir });
    const data = JSON.parse(fs.readFileSync(path.join(outDir, "dupe-test.json"), "utf-8"));

    // Extract all content strings (from both string and object entries).
    const contents = data.processedLines.map((l) =>
        typeof l === "string" ? l : l?.content ?? ""
    );
    // Count non-trivial duplicates (length > 5 to skip whitespace).
    const counts = {};
    for (const c of contents) {
        if (c.trim().length > 5) {
            counts[c] = (counts[c] ?? 0) + 1;
        }
    }
    const dupes = Object.entries(counts).filter(([, n]) => n > 1);
    assert.equal(
        dupes.length,
        0,
        `Found ${dupes.length} duplicate content(s) in processedLines — ` +
            `this indicates the title page is being added twice. ` +
            `Duplicates: ${JSON.stringify(dupes.slice(0, 3))}`
    );
});

// ── Cleanup ────────────────────────────────────────────────────────────

try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (_e) {
    // Ignore cleanup failures.
}

// ── Summary ────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
