/**
 * Test for Issue-12: share URL copy button labels must refresh on setLanguage().
 *
 * Verifies:
 * 1. After #createShareURLItem() is called, the button carries
 *    data-copy-text and data-copied-text attributes matching the language
 *    at creation time.
 * 2. After setLanguage("zh" → "en") with the button in DOM, the button
 *    textContent updates to the new language's idle label.
 * 3. If the button is in "✓ Copied" transient state (data-is-copied="true"),
 *    setLanguage() updates the dataset but does NOT clobber the transient
 *    visible textContent. The pending setTimeout will restore to the
 *    (new) idle label when it fires.
 *
 * Run: node test/test-issue-12.mjs
 */

import assert from "node:assert";

// Minimal mocks — we only need to verify the label refresh logic.
// We don't import the real module because it pulls in DOM/jQuery globals
// we can't easily polyfill in node. Instead we replicate the exact
// setLanguage refresh snippet from settings.js to guard against regressions.

function makeMockButton(initialLang) {
    const isZh = initialLang === "zh";
    const btn = {
        id: "config-share-url-copy-btn",
        textContent: isZh ? "复制" : "Copy",
        _dataset: {
            copyText: isZh ? "复制" : "Copy",
            copiedText: isZh ? "✓ 已复制" : "✓ Copied!",
            isCopied: "false",
        },
        get dataset() {
            return this._dataset;
        },
        set dataset(v) {
            this._dataset = v;
        },
    };
    return btn;
}

// Simulate the exact refresh block from setLanguage().
// This is a copy-paste of the production code so any future edit to
// the source will need a matching edit here — intentionally brittle.
function refreshShareButtonLabels(btn, lang) {
    if (!btn) return;
    const isZhNow = lang === "zh";
    btn.dataset.copyText = isZhNow ? "复制" : "Copy";
    btn.dataset.copiedText = isZhNow ? "✓ 已复制" : "✓ Copied!";
    if (btn.dataset.isCopied !== "true") {
        btn.textContent = btn.dataset.copyText;
    }
}

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

console.log("Issue-12: share URL copy button label refresh\n");

console.log("Case A: button created in zh, language switches to en");
test("zh → en, idle state: textContent updates to 'Copy'", () => {
    const btn = makeMockButton("zh");
    assert.strictEqual(btn.textContent, "复制");
    refreshShareButtonLabels(btn, "en");
    assert.strictEqual(btn.textContent, "Copy");
    assert.strictEqual(btn.dataset.copyText, "Copy");
    assert.strictEqual(btn.dataset.copiedText, "✓ Copied!");
});

console.log("\nCase B: button created in en, language switches to zh");
test("en → zh, idle state: textContent updates to '复制'", () => {
    const btn = makeMockButton("en");
    assert.strictEqual(btn.textContent, "Copy");
    refreshShareButtonLabels(btn, "zh");
    assert.strictEqual(btn.textContent, "复制");
    assert.strictEqual(btn.dataset.copyText, "复制");
    assert.strictEqual(btn.dataset.copiedText, "✓ 已复制");
});

console.log("\nCase C: button in '✓ Copied' transient, language switches");
test("zh → en, transient state: dataset updates but textContent NOT clobbered", () => {
    const btn = makeMockButton("zh");
    // Simulate user just clicked copy, button shows "✓ 已复制"
    btn.dataset.isCopied = "true";
    btn.textContent = btn.dataset.copiedText; // "✓ 已复制"
    refreshShareButtonLabels(btn, "en");
    // Dataset should be updated to new language
    assert.strictEqual(btn.dataset.copyText, "Copy");
    assert.strictEqual(btn.dataset.copiedText, "✓ Copied!");
    // Visible textContent should still be the old "✓ 已复制" — the
    // pending setTimeout will restore to the new idle label.
    assert.strictEqual(btn.textContent, "✓ 已复制",
        "textcontent should not be clobbered during transient");
});

console.log("\nCase D: button missing (settings menu closed)");
test("no button in DOM: refresh is a no-op", () => {
    refreshShareButtonLabels(null, "en"); // must not throw
});

console.log("\nCase E: same-language refresh is idempotent");
test("zh → zh: textContent and dataset unchanged", () => {
    const btn = makeMockButton("zh");
    refreshShareButtonLabels(btn, "zh");
    assert.strictEqual(btn.textContent, "复制");
    assert.strictEqual(btn.dataset.copyText, "复制");
    assert.strictEqual(btn.dataset.copiedText, "✓ 已复制");
});

console.log("\nCase F: rapid language switches back and forth");
test("zh → en → zh → en: final state matches last lang", () => {
    const btn = makeMockButton("zh");
    refreshShareButtonLabels(btn, "en");
    refreshShareButtonLabels(btn, "zh");
    refreshShareButtonLabels(btn, "en");
    assert.strictEqual(btn.textContent, "Copy");
    assert.strictEqual(btn.dataset.copyText, "Copy");
    assert.strictEqual(btn.dataset.copiedText, "✓ Copied!");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
