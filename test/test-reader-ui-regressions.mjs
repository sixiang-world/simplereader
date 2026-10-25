import assert from "node:assert/strict";
import test from "node:test";
import { findMatchingLine } from "../client/src/modules/reader/search-matcher.js";

test("search matches visible text in supplied forward/backward traversal order", () => {
    const lines = [{ lineNumber: 2, text: "Needle needle" }, { lineNumber: 0, text: "Needle" }];
    assert.deepEqual(findMatchingLine(lines, "needle"), { lineNumber: 2, ranges: [[0, 6], [7, 13]] });
    assert.deepEqual(findMatchingLine(lines.toReversed(), "needle"), { lineNumber: 0, ranges: [[0, 6]] });
});
test("search keeps regex semantics, Unicode offsets and literal fallback", () => {
    assert.deepEqual(findMatchingLine([{ lineNumber: 1, text: "第一章 第二章" }], "第.章"), { lineNumber: 1, ranges: [[0, 3], [4, 7]] });
    assert.deepEqual(findMatchingLine([{ lineNumber: 0, text: "x[y" }], "["), { lineNumber: 0, ranges: [[1, 2]] });
});
test("empty matches do not produce empty DOM marks or infinite matching loops", () => {
    assert.equal(findMatchingLine([{ lineNumber: 0, text: "abc" }], "^|$"), null);
    assert.equal(findMatchingLine([{ lineNumber: 0, text: "abc" }], "missing"), null);
});
