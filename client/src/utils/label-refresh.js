/**
 * Refresh the copy/copied labels on the share URL button after a language switch.
 *
 * This is extracted as a standalone function so both production code (setLanguage
 * in settings.js) and tests (test/test-issue-12.mjs) import from the same source.
 * If the production logic changes, the test will automatically fail on mismatch.
 *
 * @param {Object|null} btn - A DOM element (or mock) with dataset.copyText,
 *   dataset.copiedText, dataset.isCopied, and textContent properties.
 *   May be null/undefined — the function is a no-op in that case (safe for
 *   callers that don't know if the settings menu is open).
 * @param {string} lang - The new language code ('zh' or 'en').
 */
export function refreshShareButtonLabels(btn, lang) {
    if (!btn) return;
    const isZhNow = lang === "zh";
    btn.dataset.copyText = isZhNow ? "复制" : "Copy";
    btn.dataset.copiedText = isZhNow ? "✓ 已复制" : "✓ Copied!";
    // Only update visible textContent when the button is in its idle state.
    // If a "✓ Copied" countdown is in flight, let the pending setTimeout
    // restore the (now-updated) idle label — flashing "✓ Copied" → "Copy"
    // → "✓ Copied" mid-countdown would be worse than keeping the transient.
    if (btn.dataset.isCopied !== "true") {
        btn.textContent = btn.dataset.copyText;
    }
}
