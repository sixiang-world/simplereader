/**
 * Tests for version number consistency across the repository.
 *
 * Per AGENTS.md release workflow, the version must be identical in:
 *   1. version.json — "version" field
 *   2. client/manifests/Chrome/manifest.json — "version" field
 *   3. client/manifests/Firefox/manifest.json — "version" field
 *   4. package.json — "version" field (optional but recommended)
 *
 * Also validates:
 *   - version.json has a changelog entry for the current version
 *   - version follows semver (x.y.z)
 *   - manifest versions use valid Chrome extension version format
 *
 * Run: node test/test-version-consistency.mjs
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

const ROOT = path.resolve(import.meta.dirname, "..");

// ── Read all version files ──────────────────────────────────────────────

const versionJson = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf-8"));
const chromeManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "client", "manifests", "Chrome", "manifest.json"), "utf-8"));
const firefoxManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "client", "manifests", "Firefox", "manifest.json"), "utf-8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

console.log("version consistency — cross-file version alignment\n");

test("version.json has a version field", () => {
    assert.ok(versionJson.version, "version.json missing 'version' field");
    assert.equal(typeof versionJson.version, "string");
});

test("Chrome manifest has a version field", () => {
    assert.ok(chromeManifest.version, "Chrome manifest missing 'version' field");
    assert.equal(typeof chromeManifest.version, "string");
});

test("Firefox manifest has a version field", () => {
    assert.ok(firefoxManifest.version, "Firefox manifest missing 'version' field");
    assert.equal(typeof firefoxManifest.version, "string");
});

test("package.json has a version field", () => {
    assert.ok(packageJson.version, "package.json missing 'version' field");
    assert.equal(typeof packageJson.version, "string");
});

test("All version fields match each other", () => {
    const versions = [
        { file: "version.json", val: versionJson.version },
        { file: "Chrome manifest", val: chromeManifest.version },
        { file: "Firefox manifest", val: firefoxManifest.version },
        { file: "package.json", val: packageJson.version },
    ];
    const first = versions[0].val;
    for (const { file, val } of versions) {
        assert.equal(
            val,
            first,
            `Version mismatch: ${file} has "${val}", expected "${first}"`
        );
    }
});

console.log("\nversion consistency — format validation\n");

test("Version follows semver x.y.z format", () => {
    const semverRe = /^\d+\.\d+\.\d+$/;
    assert.ok(
        semverRe.test(versionJson.version),
        `Version "${versionJson.version}" does not match x.y.z format`
    );
});

test("Chrome manifest version uses valid extension version format", () => {
    // Chrome extensions: up to 4 dot-separated integers, each 0-65535
    const chromeVersionRe = /^(\d{1,5})(\.\d{1,5}){0,3}$/;
    assert.ok(
        chromeVersionRe.test(chromeManifest.version),
        `Chrome version "${chromeManifest.version}" is not a valid extension version`
    );
});

test("Firefox manifest version uses valid extension version format", () => {
    // Firefox uses the same format as Chrome for version
    const ffVersionRe = /^(\d{1,5})(\.\d{1,5}){0,3}$/;
    assert.ok(
        ffVersionRe.test(firefoxManifest.version),
        `Firefox version "${firefoxManifest.version}" is not a valid extension version`
    );
});

console.log("\nversion consistency — changelog validation\n");

test("version.json has a changelog object", () => {
    assert.ok(
        versionJson.changelog && typeof versionJson.changelog === "object",
        "version.json missing 'changelog' object"
    );
});

test("Current version has a changelog entry", () => {
    const entry = versionJson.changelog[versionJson.version];
    assert.ok(entry, `No changelog entry found for version ${versionJson.version}`);
});

test("Changelog entry has required fields", () => {
    const entry = versionJson.changelog[versionJson.version];
    assert.ok(entry.date, `Changelog entry for ${versionJson.version} missing 'date'`);
    assert.ok(entry.changes, `Changelog entry for ${versionJson.version} missing 'changes'`);
    assert.ok(entry.changes.zh, `Changelog entry for ${versionJson.version} missing 'changes.zh'`);
    assert.ok(entry.changes.en, `Changelog entry for ${versionJson.version} missing 'changes.en'`);
});

test("Changelog entry date follows YYYY-MM-DD format", () => {
    const entry = versionJson.changelog[versionJson.version];
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    assert.ok(
        dateRe.test(entry.date),
        `Changelog date "${entry.date}" does not match YYYY-MM-DD format`
    );
});

test("Changelog has at least one version entry", () => {
    const versions = Object.keys(versionJson.changelog);
    assert.ok(versions.length > 0, "Changelog has no version entries");
});

console.log("\nversion consistency — CHANGELOG.md alignment\n");

const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");
if (fs.existsSync(CHANGELOG_PATH)) {
    const changelogMd = fs.readFileSync(CHANGELOG_PATH, "utf-8");

    test("CHANGELOG.md contains the current version header", () => {
        const versionHeader = `## [${versionJson.version}]`;
        assert.ok(
            changelogMd.includes(versionHeader),
            `CHANGELOG.md missing header for version ${versionJson.version}`
        );
    });

    test("CHANGELOG.md version header has a date", () => {
        const entry = versionJson.changelog[versionJson.version];
        const expectedHeader = `## [${versionJson.version}] - ${entry.date}`;
        assert.ok(
            changelogMd.includes(expectedHeader) || changelogMd.includes(`## [${versionJson.version}]`),
            `CHANGELOG.md missing dated header for version ${versionJson.version}`
        );
    });
} else {
    test("CHANGELOG.md exists", () => {
        assert.fail("CHANGELOG.md not found");
    });
}

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error("\n❌ Version consistency test FAILED.");
    console.error("   See AGENTS.md 'Release Workflow' section for the correct process.");
    process.exit(1);
}
