/**
 * Regression test for P0-4: settings object must be exported from
 * settings.js so that app.js's config-sync wiring can access it.
 *
 * Before the fix, settings.js only exported `initSettings` — the
 * `settings` singleton was a module-level const with no export. The
 * app.js code `(await import('./settings.js')).settings` returned
 * undefined, and the `if (settings && settings.values)` guard
 * silently skipped the sync merge.
 *
 * We can't fully import settings.js in Node.js (its transitive
 * imports need a real DOM), but we CAN statically inspect the source
 * to verify the export statement exists. This catches the regression
 * without needing jsdom.
 *
 * Run: node test/test-settings-export.mjs
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

const settingsPath = path.resolve(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "modules",
    "settings",
    "settings.js"
);
const src = fs.readFileSync(settingsPath, "utf-8");

console.log("settings.js — P0-4 regression: settings must be exported\n");

test("settings.js source contains `export { settings }`", () => {
    // Match `export { settings }` or `export {settings}` (whitespace-flexible).
    assert.ok(
        /export\s*\{\s*settings\s*\}/.test(src),
        "Expected `export { settings }` statement not found in settings.js. " +
            "Without this export, app.js's `(await import('./settings.js')).settings` " +
            "is undefined and config-sync merges are silently skipped."
    );
});

test("settings.js source defines `const settings = {`", () => {
    // Confirm the settings object is declared at module level (not just exported).
    assert.ok(
        /^const\s+settings\s*=/m.test(src),
        "Expected `const settings =` declaration not found in settings.js."
    );
});

test("settings.js source exports `initSettings` function", () => {
    // Make sure we didn't accidentally remove the existing initSettings export.
    assert.ok(
        /export\s+function\s+initSettings\s*\(/.test(src),
        "Expected `export function initSettings()` not found in settings.js."
    );
});

test("app.js imports `settings` from settings.js (not just initSettings)", () => {
    const appPath = path.resolve(import.meta.dirname, "..", "client", "src", "app.js");
    const appSrc = fs.readFileSync(appPath, "utf-8");
    assert.ok(
        /from\s+["'][^"']*settings\.js["']/.test(appSrc) &&
            /settings\s+as\s+settingsSingleton|initSettings\s*,\s*settings\b/.test(appSrc),
        "Expected app.js to import the `settings` singleton from settings.js. " +
            "The previous code used dynamic import which returned undefined."
    );
});

console.log("\nsettings.js — sync: user changes must be protected from pull overwrite\n");

test("REGRESSION: saveSettings tracks changed keys via _userInteractedKeys", () => {
    // The old code used a boolean _userInteracted that skipped the ENTIRE
    // pull. The new code uses _userInteractedKeys (a Set) so that only the
    // specific keys the user touched are protected — the rest of the pull
    // still merges normally.
    assert.ok(
        /_userInteractedKeys\.add\s*\(/.test(src),
        "Expected `_userInteractedKeys.add(key)` in saveSettings. " +
            "Without per-key tracking, a slow sync pull either overwrites the " +
            "user's in-flight changes (no protection) or skips the entire pull " +
            "(too aggressive)."
    );
});

test("REGRESSION: settings.js defines _userInteractedKeys as a Set", () => {
    assert.ok(
        /_userInteractedKeys\s*:\s*new\s+Set\s*\(\s*\)/.test(src),
        "Expected `_userInteractedKeys: new Set()` in the settings object definition."
    );
});

test("REGRESSION: app.js uses _userInteractedKeys as protectedKeys in merge", () => {
    const appPath = path.resolve(import.meta.dirname, "..", "client", "src", "app.js");
    const appSrc = fs.readFileSync(appPath, "utf-8");
    assert.ok(
        /_userInteractedKeys/.test(appSrc),
        "Expected app.js to reference `settingsSingleton._userInteractedKeys` " +
            "and pass it as protectedKeys to mergeSyncedConfig."
    );
});

test("REGRESSION: saveSettings uses buildPushPayload (not raw values)", () => {
    assert.ok(
        /buildPushPayload\s*\(\s*this\.values\s*\)/.test(src),
        "Expected `buildPushPayload(this.values)` in saveSettings. " +
            "Pushing raw values (without timestamps) causes data loss when " +
            "two devices edit different settings concurrently."
    );
});

test("REGRESSION: settings.js has persistSyncedKeys method", () => {
    assert.ok(
        /persistSyncedKeys\s*\(/.test(src),
        "Expected `persistSyncedKeys` method in settings.js. " +
            "Without it, merged sync values are not written to localStorage, " +
            "causing redundant pulls on every boot."
    );
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
