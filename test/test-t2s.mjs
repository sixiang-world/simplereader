/**
 * Tests for the trad-to-simplified Chinese conversion module.
 *
 * Covers:
 *   - Light mode character-level conversion (convertLight)
 *   - Heavy mode OpenCC integration (convertHeavy) — skipped if OpenCC unavailable
 *   - Auto-detect heuristic (containsTraditional)
 *   - Mode switching (setMode / getMode, mutual exclusivity)
 *   - file:afterProcess hook integration (light + heavy)
 *
 * Run: node test/test-t2s.mjs
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

const t2s = await import("../client/src/core/t2s.js");
const {
    convertLight,
    convertHeavy,
    containsTraditional,
    setMode,
    getMode,
    setAutoDetect,
    getAutoDetect,
    registerT2SHook,
    unregisterT2SHook,
    T2S_MAP_EXPORTED,
} = t2s;

const { hooks, HookRegistry } = await import("../client/src/core/hooks.js");

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

console.log("core/t2s.js — light mode (character-level)\n");

await test("convertLight: known trad→simp pairs convert correctly", () => {
    reset();
    // Spot-check a handful of high-frequency pairs across the map.
    assert.equal(convertLight("愛"), "爱");
    assert.equal(convertLight("國"), "国");
    assert.equal(convertLight("會"), "会");
    assert.equal(convertLight("說"), "说");
    assert.equal(convertLight("學"), "学");
    assert.equal(convertLight("見"), "见");
    assert.equal(convertLight("書"), "书");
    assert.equal(convertLight("門"), "门");
});

await test("convertLight: mixed trad+simp text — only trad chars replaced", () => {
    reset();
    const input = "我愛國, 也愛學習"; // 我愛國 → 我爱国
    const out = convertLight(input);
    assert.equal(out, "我爱国, 也爱学习");
});

await test("convertLight: text with no trad chars → unchanged", () => {
    reset();
    const input = "你好, 世界。这是一段简体中文文本。";
    assert.equal(convertLight(input), input);
});

await test("convertLight: ASCII + HTML markup → unchanged", () => {
    reset();
    const input = '<p class="x">Hello 愛 World</p>';
    const out = convertLight(input);
    // ASCII (incl. "World") is preserved as-is; only trad chars are replaced.
    assert.equal(out, '<p class="x">Hello 爱 World</p>');
});

await test("convertLight: empty string → empty string", () => {
    reset();
    assert.equal(convertLight(""), "");
});

await test("convertLight: non-string input → returned as-is", () => {
    reset();
    assert.equal(convertLight(null), null);
    assert.equal(convertLight(42), 42);
    assert.equal(convertLight(undefined), undefined);
});

await test("convertLight: long text with many trad chars converts fully", () => {
    reset();
    const input = "語言學是一門研究語言的學問。";
    const expected = "语言学是一门研究语言的学问。";
    assert.equal(convertLight(input), expected);
});

console.log("\ncore/t2s.js — heavy mode (OpenCC Wasm)\n");

await test("convertHeavy: falls back to light mode when OpenCC unavailable", async () => {
    reset();
    // In a Node.js environment without a DOM, OpenCC's script-tag loader
    // will reject. The converter should fall back to light mode and
    // still produce correct output.
    const input = "我愛國";
    const out = await convertHeavy(input);
    // Either OpenCC loaded (heavy result) or fallback (light result).
    // Both should convert 愛→爱 and 國→国.
    assert.equal(out, "我爱国");
});

await test("convertHeavy: empty string → empty string", async () => {
    reset();
    assert.equal(await convertHeavy(""), "");
});

console.log("\ncore/t2s.js — auto-detect heuristic\n");

await test("containsTraditional: returns true for text containing trad chars", () => {
    reset();
    assert.equal(containsTraditional("我愛國"), true);
    assert.equal(containsTraditional("學習"), true);
    assert.equal(containsTraditional("見書"), true);
});

await test("containsTraditional: returns false for pure simp text", () => {
    reset();
    assert.equal(containsTraditional("你好,世界"), false);
    assert.equal(containsTraditional("这是一段简体中文"), false);
    assert.equal(containsTraditional("Hello, World!"), false);
});

await test("containsTraditional: empty string → false", () => {
    reset();
    assert.equal(containsTraditional(""), false);
    assert.equal(containsTraditional(null), false);
});

await test("containsTraditional: long text — samples without crashing", () => {
    reset();
    // Put a trad char at the START (index 0 is always sampled) plus
    // a long body of simp chars. This verifies the function handles
    // large inputs without crashing.
    const huge = "愛" + "简体".repeat(10000); // 1 trad + 20000 simp chars
    assert.equal(containsTraditional(huge), true);
    // Also verify a huge simp-only text returns false (no false positive
    // from sampling edge cases).
    const simpOnly = "简体".repeat(10000);
    assert.equal(containsTraditional(simpOnly), false);
});

console.log("\ncore/t2s.js — mode switching (mutual exclusivity)\n");

await test("setMode('off') / getMode()", () => {
    reset();
    setMode("off");
    assert.equal(getMode(), "off");
});

await test("setMode('light') / getMode()", () => {
    reset();
    setMode("light");
    assert.equal(getMode(), "light");
});

await test("setMode('heavy') / getMode()", () => {
    reset();
    setMode("heavy");
    assert.equal(getMode(), "heavy");
});

await test("setMode: invalid mode throws", () => {
    reset();
    assert.throws(() => setMode("invalid"), /Invalid mode/);
});

await test("setAutoDetect / getAutoDetect", () => {
    reset();
    setAutoDetect(false);
    assert.equal(getAutoDetect(), false);
    setAutoDetect(true);
    assert.equal(getAutoDetect(), true);
});

await test("mode switching is mutually exclusive — setMode overwrites prior value", () => {
    reset();
    setMode("light");
    assert.equal(getMode(), "light");
    setMode("heavy");
    assert.equal(getMode(), "heavy"); // heavy replaced light, not added
    setMode("off");
    assert.equal(getMode(), "off"); // off replaces heavy
});

console.log("\ncore/t2s.js — file:afterProcess hook integration\n");

await test("registerT2SHook: registers exactly one hook on file:afterProcess", () => {
    reset();
    setMode("light");
    registerT2SHook();
    assert.equal(hooks.count("file:afterProcess"), 1);
    unregisterT2SHook();
    assert.equal(hooks.count("file:afterProcess"), 0);
});

await test("hook: mode=off → bookData unchanged", async () => {
    reset();
    setMode("off");
    registerT2SHook();
    const bookData = {
        metadata: { title: "我愛國", author: "張三" },
        processedLines: ["<p>愛國</p>", "<p>學習</p>"],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.metadata.title, "我愛國"); // unchanged
    assert.equal(result.bookData.processedLines[0], "<p>愛國</p>");
});

await test("hook: mode=light converts bookData text fields", async () => {
    reset();
    setMode("light");
    setAutoDetect(false); // skip detection, force conversion
    registerT2SHook();
    const bookData = {
        metadata: { title: "我愛國", author: "張三" },
        processedLines: ["<p>愛國</p>", "<p>學習</p>"],
        titles: [{ text: "目錄", line: "第一章" }],
        footnotes: [{ text: "註解" }],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.metadata.title, "我爱国");
    assert.equal(result.bookData.metadata.author, "张三");
    assert.equal(result.bookData.processedLines[0], "<p>爱国</p>");
    assert.equal(result.bookData.processedLines[1], "<p>学习</p>");
    assert.equal(result.bookData.titles[0].text, "目录");
    assert.equal(result.bookData.titles[0].line, "第一章");
    assert.equal(result.bookData.footnotes[0].text, "注解");
});

await test("hook: mode=light converts OBJECT-typed processedLines (.content field)", async () => {
    // This is the modern client worker output shape: each processedLine
    // is an object returned by TextProcessorCore.process, with a .content
    // string field holding the actual HTML/text. The hook MUST convert
    // this, not skip it.
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "愛國論", author: "張三" },
        processedLines: [
            { type: "heading", tag: "h2", content: "第一章 引言", charCount: 6, lineNumber: 3, elementType: "h" },
            { type: "paragraph", tag: "p", content: "我愛我的國家", charCount: 7, lineNumber: 4, elementType: "p" },
            {
                type: "paragraph",
                tag: "p",
                className: "first",
                dropCap: { content: "愛" },
                content: "國家的歷史",
                charCount: 5,
                lineNumber: 5,
                elementType: "p",
            },
        ],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.processedLines[0].content, "第一章 引言");
    assert.equal(result.bookData.processedLines[1].content, "我爱我的国家");
    assert.equal(result.bookData.processedLines[2].content, "国家的历史");
    assert.equal(result.bookData.processedLines[2].dropCap.content, "爱");
});

await test("hook: mode=light converts ARRAY-typed titles (FileProcessorCore shape)", async () => {
    // FileProcessorCore produces titles as arrays:
    //   [text, lineNumber, shortestTitle, isCustomOnly]
    // The hook must convert t[0] and t[2], not look for t.text/t.line.
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "書名" },
        processedLines: [],
        titles: [
            ["第一章 引言", 3, "引言", false],
            ["第二章 論語", 10, "論語", false],
        ],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.titles[0][0], "第一章 引言");
    assert.equal(result.bookData.titles[0][2], "引言");
    assert.equal(result.bookData.titles[1][0], "第二章 论语");
    assert.equal(result.bookData.titles[1][2], "论语");
});

await test("hook: mode=light converts OBJECT-typed titles (EpubConverter shape)", async () => {
    // EpubConverter produces titles as objects with .label / .lineNumber.
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "書名" },
        processedLines: [],
        titles: [
            { text: "第一章 論語", line: "3", label: "論語" },
        ],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.titles[0].text, "第一章 论语");
    assert.equal(result.bookData.titles[0].label, "论语");
    assert.equal(result.bookData.titles[0].line, "3"); // numbers aren't converted
});

await test("hook: mode=light converts footnotes with .content and .original fields", async () => {
    reset();
    setMode("light");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "書名" },
        processedLines: [],
        footnotes: [
            {
                type: "footnote",
                marker: "①",
                markerCode: "9312",
                lineNumber: 5,
                content: "這是註解內容",
                original: "①這是註解內容",
            },
        ],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.footnotes[0].content, "这是注解内容");
    assert.equal(result.bookData.footnotes[0].original, "①这是注解内容");
});

await test("hook: mode=light + autoDetect=true skips simp-only books", async () => {
    reset();
    setMode("light");
    setAutoDetect(true);
    registerT2SHook();
    const bookData = {
        metadata: { title: "你好" },
        processedLines: ["<p>这是一段简体中文</p>"],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    // Auto-detect found no trad chars → no conversion.
    assert.equal(result.bookData.metadata.title, "你好");
    assert.equal(result.bookData.processedLines[0], "<p>这是一段简体中文</p>");
});

await test("hook: mode=light + autoDetect=true converts trad books", async () => {
    reset();
    setMode("light");
    setAutoDetect(true);
    registerT2SHook();
    const bookData = {
        metadata: { title: "愛國論" },
        processedLines: ["<p>我愛我的國家</p>"],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    assert.equal(result.bookData.metadata.title, "爱国论");
    assert.equal(result.bookData.processedLines[0], "<p>我爱我的国家</p>");
});

await test("REGRESSION i1: autoDetect works with OBJECT-typed processedLines", async () => {
    // i1 regression guard: _sampleForDetection previously pushed raw
    // objects into the parts array, which became "[object Object]"
    // after join(" "). containsTraditional then never found trad chars
    // in the sample, so auto-detect skipped conversion even for trad
    // books. This test verifies the hook extracts .content from
    // object-typed processedLines during detection.
    reset();
    setMode("light");
    setAutoDetect(true); // ← the bug path
    registerT2SHook();
    const bookData = {
        metadata: { title: "愛國論" },
        processedLines: [
            // Modern TextProcessorCore.process output shape (objects).
            { type: "heading", tag: "h2", content: "第一章 引言", charCount: 6, lineNumber: 3, elementType: "h" },
            { type: "paragraph", tag: "p", content: "我愛我的國家", charCount: 7, lineNumber: 4, elementType: "p" },
        ],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    // Auto-detect must find the trad chars in .content and convert.
    assert.equal(result.bookData.metadata.title, "爱国论");
    assert.equal(result.bookData.processedLines[0].content, "第一章 引言");
    assert.equal(result.bookData.processedLines[1].content, "我爱我的国家");
});

await test("REGRESSION i1: autoDetect correctly skips simp-only OBJECT-typed books", async () => {
    // i1 companion test: verify the fix doesn't cause false positives.
    // A simp-only book with object-typed processedLines should still
    // be skipped by auto-detect (no conversion needed).
    reset();
    setMode("light");
    setAutoDetect(true);
    registerT2SHook();
    const bookData = {
        metadata: { title: "你好" },
        processedLines: [
            { type: "paragraph", tag: "p", content: "这是一段简体中文", charCount: 9, lineNumber: 1, elementType: "p" },
        ],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    // Auto-detect found no trad chars in .content → no conversion.
    assert.equal(result.bookData.metadata.title, "你好");
    assert.equal(result.bookData.processedLines[0].content, "这是一段简体中文");
});

await test("hook: mode=heavy converts via OpenCC (or falls back to light)", async () => {
    reset();
    setMode("heavy");
    setAutoDetect(false);
    registerT2SHook();
    const bookData = {
        metadata: { title: "我愛國" },
        processedLines: ["<p>愛國</p>"],
    };
    const result = await hooks.run("file:afterProcess", { bookData, file: {} });
    // Heavy mode either loads OpenCC or falls back to light. Both
    // produce the same character-level result for these pairs.
    assert.equal(result.bookData.metadata.title, "我爱国");
    assert.equal(result.bookData.processedLines[0], "<p>爱国</p>");
});

await test("hook: handles null/undefined bookData gracefully", async () => {
    reset();
    setMode("light");
    registerT2SHook();
    const result = await hooks.run("file:afterProcess", { bookData: null, file: {} });
    assert.equal(result.bookData, null);
});

await test("registerT2SHook is idempotent — calling twice doesn't double-register", () => {
    reset();
    setMode("light");
    registerT2SHook();
    registerT2SHook();
    assert.equal(hooks.count("file:afterProcess"), 1);
});

console.log("\ncore/t2s.js — map integrity\n");

await test("T2S_MAP_EXPORTED: contains expected number of pairs (>=500)", () => {
    reset();
    const n = Object.keys(T2S_MAP_EXPORTED).length;
    assert.ok(n >= 500, `Expected >= 500 pairs, got ${n}`);
});

await test("T2S_MAP_EXPORTED: all values are single chars and differ from keys", () => {
    reset();
    for (const [k, v] of Object.entries(T2S_MAP_EXPORTED)) {
        assert.equal(typeof k, "string");
        assert.equal(typeof v, "string");
        assert.equal(k.length, 1);
        assert.equal(v.length, 1);
        assert.notEqual(k, v);
    }
});

await test("REGRESSION P1-4/5/6: no char maps to '锬' except 錟 (was 140 corrupted)", () => {
    // P1-4 regression guard: the previous hand-curated map had 140 chars
    // in the U+936x–U+93FF range (釒 radical) all mapping to '锬' due to a
    // bug in the generation script. Only 錟 should map to 锬.
    reset();
    const yanGroup = Object.entries(T2S_MAP_EXPORTED).filter(([, v]) => v === "锬");
    assert.ok(
        yanGroup.length <= 2,
        `Expected <= 2 chars mapping to '锬', got ${yanGroup.length}: ${yanGroup.map(([k]) => k).join(", ")}`
    );
});

await test("REGRESSION P1-5: 嚴 → 严 (was wrongly mapped to 颜)", () => {
    // P1-5 regression guard: 嚴 (strict) must map to 严, not 颜 (face/color).
    reset();
    assert.equal(T2S_MAP_EXPORTED["嚴"], "严");
    assert.equal(T2S_MAP_EXPORTED["顏"], "颜"); // 顏 is the correct source for 颜
});

await test("REGRESSION P1-6: high-frequency chars are present (龍, 點, 題, 間, etc.)", () => {
    // P1-6 regression guard: the previous map was missing many common
    // high-frequency chars. This test verifies a representative sample.
    reset();
    const required = {
        龍: "龙", 點: "点", 題: "题", 間: "间", 蘭: "兰", 徹: "彻",
        瀨: "濑", 結: "结", 語: "语", 場: "场", 幾: "几", 處: "处",
        體: "体", 頭: "头", 話: "话", 們: "们", 圖: "图", 聲: "声",
        萬: "万", 節: "节", 覺: "觉", 觀: "观", 論: "论", 買: "买",
    };
    const missing = [];
    const wrong = [];
    for (const [trad, expected] of Object.entries(required)) {
        const actual = T2S_MAP_EXPORTED[trad];
        if (actual === undefined) {
            missing.push(trad);
        } else if (actual !== expected) {
            wrong.push(`${trad} → ${actual} (expected ${expected})`);
        }
    }
    assert.equal(missing.length, 0, `Missing high-freq chars: ${missing.join(", ")}`);
    assert.equal(wrong.length, 0, `Wrong mappings: ${wrong.join(", ")}`);
});

await test("convertLight: real-world traditional text converts correctly", () => {
    // End-to-end conversion test on a realistic sentence.
    reset();
    const input = "嚴重的問題在於點火系統，需要徹底檢查龍頭部件。";
    const expected = "严重的问题在于点火系统，需要彻底检查龙头部件。";
    assert.equal(convertLight(input), expected);
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
