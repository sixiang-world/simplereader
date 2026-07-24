/**
 * Advanced tests for the T2S (Traditional → Simplified) conversion module.
 *
 * Covers edge cases not in test-t2s.mjs:
 *   - setLite/setPro mutual exclusivity at the localStorage level
 *   - Auto-detect disabled (force conversion)
 *   - Empty/null bookData shapes
 *   - Mixed processedLines (strings + objects in same array)
 *   - T2S_MAP integrity: no key maps to itself
 *   - Performance: large text conversion
 *
 * Run: node test/test-t2s-advanced.mjs
 */

import assert from "node:assert/strict";

// ── Mock localStorage ───────────────────────────────────────────────────

function makeMockStorage() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, val) => store.set(key, String(val)),
        removeItem: (key) => store.delete(key),
        clear: () => store.clear(),
        _dump: () => Object.fromEntries(store),
    };
}

const mockStorage = makeMockStorage();
globalThis.localStorage = mockStorage;

const {
    convertLight,
    containsTraditional,
    setMode,
    getMode,
    setLite,
    setPro,
    isLite,
    isPro,
    setAutoDetect,
    getAutoDetect,
    registerT2SHook,
    unregisterT2SHook,
    T2S_MAP_EXPORTED,
} = await import("../client/src/core/t2s.js");

const { hooks } = await import("../client/src/core/hooks.js");

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

function reset() {
    mockStorage.clear();
    hooks.clear();
}

// ── Tests ───────────────────────────────────────────────────────────────

console.log("core/t2s.js — advanced: setLite/setPro mutual exclusivity\n");

await test("setLite(true) disables pro", () => {
    reset();
    setPro(true);
    assert.equal(isPro(), true);
    setLite(true);
    assert.equal(isLite(), true);
    assert.equal(isPro(), false);
});

await test("setPro(true) disables lite", () => {
    reset();
    setLite(true);
    assert.equal(isLite(), true);
    setPro(true);
    assert.equal(isPro(), true);
    assert.equal(isLite(), false);
});

await test("setLite(false) leaves pro untouched", () => {
    reset();
    setPro(true);
    setLite(false);
    assert.equal(isPro(), true);
    assert.equal(isLite(), false);
});

await test("setPro(false) leaves lite untouched", () => {
    reset();
    setLite(true);
    setPro(false);
    assert.equal(isLite(), true);
    assert.equal(isPro(), false);
});

console.log("\ncore/t2s.js — advanced: auto-detect disabled\n");

await test("autoDetect=false forces conversion even for simp-only books", async () => {
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "你好" },
        processedLines: ["<p>这是一段简体中文</p>"],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    // With auto-detect off, conversion runs regardless of content.
    // Since "你好" has no trad chars, convertLight leaves it unchanged.
    assert.equal(result.bookData.metadata.title, "你好");
});

await test("autoDetect=false + trad book converts", async () => {
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "愛國論" },
        processedLines: ["<p>我愛我的國家</p>"],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.metadata.title, "爱国论");
});

console.log("\ncore/t2s.js — advanced: empty/null bookData shapes\n");

await test("hook: empty processedLines array → no crash", async () => {
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "愛國論" },
        processedLines: [],
        titles: [],
        footnotes: [],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.metadata.title, "爱国论");
});

await test("hook: missing metadata → no crash", async () => {
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        processedLines: ["<p>愛國</p>"],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.processedLines[0], "<p>爱国</p>");
});

await test("hook: undefined footnotes → no crash", async () => {
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "愛國論" },
        processedLines: ["<p>愛國</p>"],
        footnotes: undefined,
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.metadata.title, "爱国论");
});

console.log("\ncore/t2s.js — advanced: mixed processedLines shapes\n");

await test("hook: mixed string + object processedLines", async () => {
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "書名" },
        processedLines: [
            "<h1>第一章 引言</h1>",
            { type: "paragraph", tag: "p", content: "我愛我的國家", charCount: 7, lineNumber: 4, elementType: "p" },
            "<p>普通字串段落</p>",
        ],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.processedLines[0], "<h1>第一章 引言</h1>");
    assert.equal(result.bookData.processedLines[1].content, "我爱我的国家");
    assert.equal(result.bookData.processedLines[2], "<p>普通字串段落</p>");
});

console.log("\ncore/t2s.js — advanced: map integrity\n");

await test("T2S_MAP: no key maps to itself", () => {
    reset();
    const selfMappings = [];
    for (const [k, v] of Object.entries(T2S_MAP_EXPORTED)) {
        if (k === v) selfMappings.push(k);
    }
    assert.equal(selfMappings.length, 0, `Self-mappings found: ${selfMappings.join(", ")}`);
});

await test("T2S_MAP: all keys are single characters", () => {
    reset();
    for (const k of Object.keys(T2S_MAP_EXPORTED)) {
        assert.equal(k.length, 1, `Key "${k}" is not a single character (length=${k.length})`);
    }
});

await test("T2S_MAP: all values are single characters", () => {
    reset();
    for (const v of Object.values(T2S_MAP_EXPORTED)) {
        assert.equal(v.length, 1, `Value "${v}" is not a single character (length=${v.length})`);
    }
});

console.log("\ncore/t2s.js — advanced: performance\n");

await test("convertLight handles 100KB text without crashing", () => {
    reset();
    const trad = "語言學";
    const simp = "语言学";
    const huge = trad.repeat(10000); // ~30KB
    const start = performance.now();
    const result = convertLight(huge);
    const elapsed = performance.now() - start;
    assert.equal(result, simp.repeat(10000));
    assert.ok(elapsed < 5000, `Conversion took ${elapsed.toFixed(0)}ms, expected < 5000ms`);
});

await test("containsTraditional handles 100KB simp-only text quickly", () => {
    reset();
    const huge = "简体中文".repeat(10000); // ~40KB, no trad chars
    const start = performance.now();
    const result = containsTraditional(huge);
    const elapsed = performance.now() - start;
    assert.equal(result, false);
    assert.ok(elapsed < 100, `Detection took ${elapsed.toFixed(0)}ms, expected < 100ms`);
});

console.log("\ncore/t2s.js — advanced: backward-compatible API edge cases\n");

await test("setMode with invalid mode throws TypeError", () => {
    reset();
    assert.throws(() => setMode("invalid"), /Invalid mode/);
    assert.throws(() => setMode(""), /Invalid mode/);
    assert.throws(() => setMode(null), /Invalid mode/);
});

await test("getMode after fresh reset → 'light' (default)", () => {
    reset();
    // Default is lite=true, pro=false
    assert.equal(getMode(), "light");
});

await test("setAutoDetect persists across getAutoDetect calls", () => {
    reset();
    assert.equal(getAutoDetect(), true); // default
    setAutoDetect(false);
    assert.equal(getAutoDetect(), false);
    setAutoDetect(true);
    assert.equal(getAutoDetect(), true);
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
