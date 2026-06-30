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

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
