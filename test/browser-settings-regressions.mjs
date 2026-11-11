import assert from "node:assert/strict";
import { withBrowserTest } from "./helpers/browser.mjs";

await withBrowserTest(async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
        localStorage.setItem("UILang", "en");
        localStorage.setItem("respectUserLangSetting", "true");
        localStorage.setItem("t2s_enabled", "true");
        // A nonessential font request that never resolves must not gate the app.
        document.fonts.load = () => new Promise(() => {});
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let syncRequests = 0;
    await page.route("https://textdb.hunluan.space/**", (route) => { syncRequests++; return route.abort(); });
    await page.goto(`${baseURL}/?t2s_enabled=false`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(async () => {
        const { VARS } = await import("/client/src/config/variables.js");
        return VARS.SETTINGS_INITIALIZED && VARS.CUSTOM_FONTS_LOADED;
    }, null, { timeout: 10000 });
    await page.evaluate(() => window.Swal.close());
    await page.locator("#setting-btn").click();
    await page.locator("#setting-tab-general").click();
    await page.getByRole("button", { name: "Export settings", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Import settings", exact: true }).waitFor({ state: "visible" });
    const actual = await page.evaluate(async () => {
        const { settings } = await import("/client/src/modules/settings/settings.js");
        const { hooks } = await import("/client/src/core/hooks.js");
        const converted = await hooks.run("file:afterProcess", { bookData: { processedLines: ["傳統臺灣"], metadata: { title: "臺灣" } } });
        const oldFontSize = settings.values.p_fontSize;
        const upload = new File([JSON.stringify({
            format: "simplereader-settings",
            version: 1,
            settings: { ui_language: "zh", p_fontSize: "999em", config_sync_token: "ignore-me" }
        })], "settings.json", { type: "application/json" });
        const changed = await settings.importSettingsFile(upload);
        const exported = JSON.parse(settings.exportSettingsFile());
        return {
            converted: converted.bookData.processedLines[0],
            changed,
            language: document.documentElement.getAttribute("data-lang"),
            unchangedFontSize: settings.values.p_fontSize === oldFontSize,
            exported,
        };
    });
    assert.equal(actual.converted, "傳統臺灣");
    assert.deepEqual(actual.changed, ["ui_language"]);
    assert.equal(actual.language, "zh");
    assert.equal(actual.unchangedFontSize, true);
    assert.equal(actual.exported.settings.ui_language, "zh");
    assert.ok(!Object.hasOwn(actual.exported.settings, "config_sync_token"));
    assert.equal(syncRequests, 0);
    await page.getByRole("button", { name: "导出配置", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "导入配置", exact: true }).waitFor({ state: "visible" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.getAttribute("data-lang") === "zh");
    assert.deepEqual(errors, [], "no uncaught startup or settings errors");
    console.log("settings browser: pending fonts do not block startup, local settings transfer, language persistence, URL T2S and schema validation passed");
    await context.close();
});
