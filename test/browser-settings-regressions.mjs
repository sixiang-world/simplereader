import assert from "node:assert/strict";
import { withBrowserTest } from "./helpers/browser.mjs";

await withBrowserTest(async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
        localStorage.setItem("UILang", "en");
        localStorage.setItem("respectUserLangSetting", "true");
        localStorage.setItem("t2s_lite", "true");
        // A nonessential font request that never resolves must not gate the app.
        document.fonts.load = () => new Promise(() => {});
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let syncRequests = 0;
    await page.route("https://textdb.hunluan.space/**", (route) => { syncRequests++; return route.abort(); });
    await page.goto(`${baseURL}/?t2s_lite=false&t2s_pro=false`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(async () => {
        const { VARS } = await import("/client/src/config/variables.js");
        return VARS.SETTINGS_INITIALIZED && VARS.CUSTOM_FONTS_LOADED;
    }, null, { timeout: 10000 });
    assert.equal(syncRequests, 0, "startup remains manual-only");
    const actual = await page.evaluate(async () => {
        const { settings } = await import("/client/src/modules/settings/settings.js");
        const { hooks } = await import("/client/src/core/hooks.js");
        const sync = await import("/client/src/core/config-sync.js");
        const converted = await hooks.run("file:afterProcess", { bookData: { processedLines: ["傳統臺灣"], metadata: { title: "臺灣" } } });
        const changed = settings.applySyncPull({ ui_language: { v: "zh", ts: Date.now() } });
        const language = document.documentElement.getAttribute("data-lang");
        const oldFontSize = settings.values.p_fontSize;
        const bad = settings.applySyncPull({ p_fontSize: { v: { bad: true }, ts: Date.now() } });
        sync.setSyncToken("test_token");
        const offline = await settings.syncPull();
        return { converted: converted.bookData.processedLines[0], changed, language, bad, unchangedFontSize: settings.values.p_fontSize === oldFontSize, offline };
    });
    assert.equal(actual.converted, "傳統臺灣");
    assert.ok(actual.changed.includes("ui_language"));
    assert.equal(actual.language, "zh");
    assert.deepEqual(actual.bad, []);
    assert.equal(actual.unchangedFontSize, true);
    assert.equal(actual.offline.ok, false);
    assert.equal(syncRequests, 1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.getAttribute("data-lang") === "zh");
    assert.deepEqual(errors, [], "no uncaught startup or settings errors");
    console.log("settings browser: pending fonts do not block startup, manual sync errors, language persistence, URL T2S and schema validation passed");
    await context.close();
});
