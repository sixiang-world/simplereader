/**
 * Browser smoke: Firefox Web compatibility (plan task B04).
 *
 * Chromium remains the automated main gate (all browser-*.mjs files).
 * This file adds a REAL Firefox run of the core reading path:
 * boot without page errors, TXT import through the real pipeline,
 * rendered content, TOC entries, and the search/settings dialogs.
 *
 * Firefox is not a CI requirement: when no Firefox build is available
 * (e.g. the alpine CNB runner), the file prints an explicit
 * "UNVERIFIED" marker and exits 0 — it never silently claims coverage.
 * Install locally with: pnpm exec playwright-core install firefox
 *
 * Run: node test/browser-firefox-smoke.mjs
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

const executablePath = firefox.executablePath();
if (!executablePath || !existsSync(executablePath)) {
    console.log('Firefox Web smoke: UNVERIFIED — no Firefox build found (install with `pnpm exec playwright-core install firefox`). Chromium remains the enforced gate.');
    process.exit(0);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const vite = await createViteServer({
    root, cacheDir: resolve(root, 'tmp/.vite-browser-cache'),
    server: { host: '127.0.0.1', port: 0, open: false },
});
let browser;
try {
    await vite.listen();
    const baseURL = `http://127.0.0.1:${vite.httpServer.address().port}`;
    browser = await firefox.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(baseURL);
    await page.waitForFunction(
        () => document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'),
        null, { timeout: 20000 },
    );
    assert.deepEqual(errors, [], 'startup page errors in Firefox');

    // Import a small TXT through the real pipeline and read back state.
    const txt = ['第一章 Firefox 冒烟', 'plain body line one', 'plain body line two', '第二章 tail'].join('\n');
    const loaded = await page.evaluate(async (content) => {
        const C = await import('/client/src/config/index.js');
        const { FileHandler } = await import('/client/src/modules/file/file-handler.js');
        const file = new File([content], 'firefox-smoke.txt', { type: 'text/plain' });
        await FileHandler.handleMultipleFiles({ 0: file, length: 1, item: () => file });
        await new Promise((resolve) => setTimeout(resolve, 300));
        return {
            filename: C.VARS.FILENAME,
            lines: C.VARS.FILE_CONTENT_CHUNKS.length,
            titles: C.VARS.ALL_TITLES.length,
            rendered: C.DOM_ELEMENT.CONTENT_CONTAINER.querySelectorAll('p, [data-line-num]').length,
        };
    }, txt);
    assert.equal(loaded.filename, 'firefox-smoke.txt', 'TXT import did not complete in Firefox');
    assert.ok(loaded.lines > 0, 'no processed lines in Firefox');
    assert.ok(loaded.titles > 0, 'no TOC titles detected in Firefox');
    assert.ok(loaded.rendered > 0, 'no rendered content in Firefox');

    // Real UI interactions: open the search dialog via its public entry and
    // the settings menu via its button (shortcut-key bindings are exercised
    // by the Chromium UI regressions; the smoke checks the dialogs work in
    // the Firefox DOM).
    const searchVisible = await page.evaluate(async () => {
        const { search } = await import('/client/src/modules/reader/search.js');
        search.showDialog();
        const input = document.querySelector('#search-input, input[type=text], #search input');
        return Boolean(input && document.body.contains(search._getDialog?.() || input.closest('div')));
    });
    await page.keyboard.press('Escape');
    assert.ok(searchVisible, 'search dialog did not open in Firefox');

    const settingsVisible = await page.evaluate(async () => {
        const { settings } = await import('/client/src/modules/settings/settings.js');
        settings.settingsMenu?.show?.();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const el = document.querySelector('.settings-menu-container, #settings-menu-container, #settings-menu, .settings-menu');
        return Boolean(el);
    });
    assert.ok(settingsVisible, 'settings menu did not open in Firefox');
    await page.keyboard.press('Escape');

    assert.deepEqual(errors, [], 'page errors during Firefox smoke');
    await context.close();
    console.log('Firefox Web smoke passed: boot, real TXT import, TOC, search dialog, settings menu');
} finally {
    await browser?.close();
    await vite.close();
}
