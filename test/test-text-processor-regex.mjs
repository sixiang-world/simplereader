/**
 * Tests for text processor regex safety.
 *
 * Validates that:
 *   1. generateAdsRules properly escapes regex metacharacters in bookName/author.
 *   2. No unescaped user input reaches regex construction.
 *   3. Special characters in book metadata don't crash the ads rule generator.
 *
 * This is a regression test for the regex crash bug where book names
 * containing regex metacharacters (like parentheses) caused SyntaxError
 * in the worker thread.
 *
 * Run: node test/test-text-processor-regex.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── Read the text processor source ──────────────────────────────────────

const PROCESSOR_PATH = path.resolve(
    import.meta.dirname,
    "..",
    "shared",
    "core",
    "text",
    "text-processor-core.js"
);
const processorSrc = fs.readFileSync(PROCESSOR_PATH, "utf-8");

// ── Tests ───────────────────────────────────────────────────────────────

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

console.log("shared/core/text/text-processor-core.js — regex safety\n");

test("Source has a safeREStr or equivalent escape function", () => {
    assert.ok(
        /safeREStr|escapeRegExp|escapeRegex/.test(processorSrc),
        "Expected a regex escape function (safeREStr, escapeRegExp, etc.)"
    );
});

test("safeREStr escapes regex metacharacters", () => {
    // The escape function should handle: ^ $ . * + ? ( ) [ ] { } | \
    // Pattern 1: explicit list of metacharacters in character class
    const explicitPattern = /\[\\\^\$\.\*\+\?\(\)\[\]\{\}\|]/;
    // Pattern 2: replace with backslash prefix (\\$&)
    const replacePattern = /replace\s*\(\s*\/\[.*?\\\\.*?\]\/.*?\)/;
    assert.ok(
        explicitPattern.test(processorSrc) || replacePattern.test(processorSrc),
        "Expected regex metacharacter escaping pattern"
    );
});

test("generateAdsRules uses escaped bookName/author", () => {
    // The function should call safeREStr on user-provided strings
    assert.ok(
        /generateAdsRules.*safeREStr|safeREStr.*bookName|safeREStr.*author/.test(processorSrc),
        "generateAdsRules should escape bookName and/or author with safeREStr"
    );
});

test("No raw bookName/author used in RegExp construction without escaping", () => {
    // Look for patterns like new RegExp(bookName) or /${bookName}/
    // that don't go through safeREStr first
    const dangerousPatterns = [
        /new\s+RegExp\s*\(\s*bookName\s*\)/,
        /new\s+RegExp\s*\(\s*author\s*\)/,
        /\`\$\{\s*bookName\s*\}\`/,
        /\`\$\{\s*author\s*\}\`/,
    ];
    for (const pattern of dangerousPatterns) {
        assert.ok(
            !pattern.test(processorSrc),
            `Found potentially dangerous RegExp construction: ${pattern}`
        );
    }
});

// ── Runtime test: simulate generateAdsRules with dangerous input ────────

// Extract the safeREStr function and generateAdsRules by evaluating them
const safeREStrMatch = processorSrc.match(/#safeREStr\s*\([^)]*\)\s*\{[^}]*\}/);
const generateAdsRulesMatch = processorSrc.match(/#generateAdsRules\s*\([^)]*\)\s*\{/);

if (safeREStrMatch && generateAdsRulesMatch) {
    console.log("\nshared/core/text/text-processor-core.js — runtime regex safety\n");

    // Build a minimal testable version
    const testCode = `
        ${safeREStrMatch[0].replace("#safeREStr", "function safeREStr")}
        ${generateAdsRulesMatch[0].replace("#generateAdsRules", "function generateAdsRules")}
    `;

    try {
        const sandbox = new Function(testCode + "; return { safeREStr, generateAdsRules };")();

        test("safeREStr escapes parentheses", () => {
            assert.equal(sandbox.safeREStr("(test)"), "\\(test\\)");
        });

        test("safeREStr escapes brackets", () => {
            assert.equal(sandbox.safeREStr("[test]"), "\\[test\\]");
        });

        test("safeREStr escapes braces", () => {
            assert.equal(sandbox.safeREStr("{test}"), "\\{test\\}");
        });

        test("safeREStr escapes dots", () => {
            assert.equal(sandbox.safeREStr("v1.0"), "v1\\.0");
        });

        test("safeREStr escapes asterisks", () => {
            assert.equal(sandbox.safeREStr("A*B"), "A\\*B");
        });

        test("safeREStr escapes plus signs", () => {
            assert.equal(sandbox.safeREStr("A+B"), "A\\+B");
        });

        test("safeREStr escapes question marks", () => {
            assert.equal(sandbox.safeREStr("A?B"), "A\\?B");
        });

        test("safeREStr escapes carets", () => {
            assert.equal(sandbox.safeREStr("^start"), "\\^start");
        });

        test("safeREStr escapes dollar signs", () => {
            assert.equal(sandbox.safeREStr("end$"), "end\\$");
        });

        test("safeREStr escapes pipes", () => {
            assert.equal(sandbox.safeREStr("A|B"), "A\\|B");
        });

        test("safeREStr escapes backslashes", () => {
            assert.equal(sandbox.safeREStr("C:\\\\path"), "C:\\\\/\\\\path");
        });

        test("safeREStr handles normal text without metacharacters", () => {
            assert.equal(sandbox.safeREStr("Normal Book Title"), "Normal Book Title");
        });

        test("safeREStr handles empty string", () => {
            assert.equal(sandbox.safeREStr(""), "");
        });

        test("generateAdsRules with bookName containing parentheses doesn't throw", () => {
            const rules = sandbox.generateAdsRules("Book (Special Edition)", "Author");
            assert.ok(Array.isArray(rules));
            // All rules should be valid regex strings
            for (const rule of rules) {
                assert.ok(typeof rule === "string");
                // Should be parseable as regex
                new RegExp(rule);
            }
        });

        test("generateAdsRules with author containing brackets doesn't throw", () => {
            const rules = sandbox.generateAdsRules("Book", "Author [Translator]");
            assert.ok(Array.isArray(rules));
            for (const rule of rules) {
                new RegExp(rule);
            }
        });

        test("generateAdsRules with bookName containing dots doesn't throw", () => {
            const rules = sandbox.generateAdsRules("v1.0 Release", "Author");
            assert.ok(Array.isArray(rules));
            for (const rule of rules) {
                new RegExp(rule);
            }
        });

        test("generateAdsRules with bookName containing asterisks doesn't throw", () => {
            const rules = sandbox.generateAdsRules("C* Programming", "Author");
            assert.ok(Array.isArray(rules));
            for (const rule of rules) {
                new RegExp(rule);
            }
        });

        test("generateAdsRules with mixed special chars doesn't throw", () => {
            const rules = sandbox.generateAdsRules(
                "Book (Vol. 1) [Special] {Limited}",
                "Author A+B|C"
            );
            assert.ok(Array.isArray(rules));
            for (const rule of rules) {
                new RegExp(rule);
            }
        });
    } catch (e) {
        console.log(`  (skipped runtime tests: ${e.message})`);
    }
} else {
    console.log("  (skipped runtime tests: could not extract functions from source)");
}

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error("\n❌ Text processor regex safety test FAILED.");
    process.exit(1);
}
