/**
 * Regression test: opening an EPUB failed with
 * "Processed book with name ... not found in the database."
 *
 * Two ways this fired from updateProcessedBook (bookshelf-db.js):
 *   1. Anonymous mode: putBook() silently no-ops, so the bookfiles entry is
 *      never created and the missing bookProcessed record then threw.
 *   2. Books saved by older builds (before atomic multi-store writes) can
 *      have a bookfiles row without a bookProcessed row; every re-open threw.
 *
 * bookshelf-db.js imports DBManager, which spawns a Worker and needs
 * IndexedDB, so we statically inspect the source instead of importing it.
 *
 * Run: node test/test-processed-book-save.mjs
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

const dbPath = path.resolve(
  import.meta.dirname,
  "..",
  "client",
  "src",
  "modules",
  "bookshelf",
  "bookshelf-db.js",
);
const src = fs.readFileSync(dbPath, "utf-8");

const updateFn = src.slice(
  src.indexOf("async updateProcessedBook("),
  src.indexOf("async updateBookLanguage("),
);
assert.ok(updateFn.length > 0, "updateProcessedBook not found in bookshelf-db.js");

console.log("bookshelf-db.js — processed-book save regressions\n");

test("updateProcessedBook skips persistence in anonymous mode", () => {
  assert.ok(
    /if\s*\(CONFIG\.CONST_CONFIG\.ANONYMOUS_MODE\)\s*\{\s*return false;/.test(updateFn),
    "Expected an early `return false` guard on CONFIG.CONST_CONFIG.ANONYMOUS_MODE " +
      "in updateProcessedBook. Anonymous mode must not persist books, and " +
      "putBook() no-ops there — without this guard, opening a new book fails " +
      "with 'Processed book with name ... not found'.",
  );
});

test("updateProcessedBook upserts a missing bookProcessed record instead of throwing", () => {
  assert.ok(
    !updateFn.includes('Processed book with name "'),
    "updateProcessedBook still throws 'Processed book with name ... not found'. " +
      "Books saved before atomic multi-store writes can legitimately lack the " +
      "derived record; it must be rebuilt from the processed snapshot.",
  );
  assert.ok(
    /existingProcessedBook\s*=\s*\{\s*name\s*\}/.test(updateFn),
    "Expected the missing-record fallback `existingProcessedBook = { name }` " +
      "so the final put upserts a complete derived record.",
  );
});

test("putBook keeps its anonymous-mode no-op guard", () => {
  assert.ok(
    /if\s*\(CONFIG\.CONST_CONFIG\.ANONYMOUS_MODE\)\s*\{\s*return false;/.test(src),
    "putBook must keep returning false in anonymous mode.",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
