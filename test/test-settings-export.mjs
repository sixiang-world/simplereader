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

console.log("\nsettings.js — Issue 2 regression: sync pull must not overwrite user changes\n");

test("REGRESSION i2: saveSettings sets `_userInteracted = true`", () => {
    // Issue 2 fix: saveSettings must set a flag so the sync-pull handler
    // in app.js can detect that the user has touched settings since boot
    // and skip the merge (avoiding rolling back the user's changes).
    assert.ok(
        /this\._userInteracted\s*=\s*true/.test(src),
        "Expected `this._userInteracted = true` in saveSettings not found. " +
            "Without this flag, a slow sync pull can overwrite the user's " +
            "in-flight settings changes."
    );
});

test("REGRESSION i2: app.js checks `_userInteracted` before applying sync", () => {
    const appPath = path.resolve(import.meta.dirname, "..", "client", "src", "app.js");
    const appSrc = fs.readFileSync(appPath, "utf-8");
    assert.ok(
        /_userInteracted/.test(appSrc),
        "Expected app.js to check `settingsSingleton._userInteracted` before " +
            "applying synced config. Without this guard, a sync pull that " +
            "resolves after the user has edited settings will roll back " +
            "their changes."
    );
    // Verify the guard SKIPS the merge (not just references the flag).
    assert.ok(
        /if\s*\(\s*settingsSingleton\._userInteracted\s*\)\s*\{[^}]*return/.test(appSrc),
        "Expected app.js to `return` early when `settingsSingleton._userInteracted` " +
            "is true, skipping the sync merge. The flag must gate the merge, not " +
            "just be logged."
    );
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
