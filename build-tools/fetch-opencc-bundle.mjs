/**
 * fetch-opencc-bundle.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * Ensures `client/lib/opencc/full.js` exists locally before a build.
 *
 * Why this exists
 * ───────────────
 * The OpenCC UMD bundle (~1.1 MB) is bundled into the production frontend so
 * that heavy-mode Traditional→Simplified conversion works fully offline
 * (no third-party CDN at runtime, no tracking-prevention blocks). Committing
 * a 1.1 MB binary to git pollutes history, so instead we materialise it
 * locally at install time and gitignore the file.
 *
 * Where the file comes from (network-free by preference)
 * ───────────────────────────────────────────────────────────
 * 1. Preferred: copy from the installed `opencc-js` dependency
 *    (`node_modules/opencc-js/dist/umd/full.js`). This needs NO network —
 *    the bundle is already on disk because opencc-js is a devDependency.
 * 2. Fallback: download from jsDelivr using the installed opencc-js version.
 *    Only used if the local package layout changes and the file is missing.
 *
 * The file is gitignored; running `pnpm install` (postinstall) regenerates it.
 * Re-running is idempotent: if a valid bundle already exists, it is kept.
 *
 * Run: node build-tools/fetch-opencc-bundle.mjs   (auto via `postinstall`)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DEST = path.join(ROOT, "client", "lib", "opencc", "full.js");

const MIN_SIZE = 500 * 1024; // 500 KB sanity floor
const VALID_CDN = "https://cdn.jsdelivr.net/npm/opencc-js@VERSION/dist/umd/full.js";

/** @returns {boolean} True if the candidate file is a valid OpenCC bundle. */
function isValidOpenCCBundle(p) {
    try {
        const stat = fs.statSync(p);
        if (stat.size < MIN_SIZE) return false;
        const head = fs.readFileSync(p, "utf-8").slice(0, 200_000);
        return /OpenCC/.test(head);
    } catch {
        return false;
    }
}

function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

async function fetchFromCdn(version, dest) {
    const url = VALID_CDN.replace("VERSION", version);
    if (typeof globalThis.fetch !== "function") {
        throw new Error("global fetch is unavailable; cannot download OpenCC bundle");
    }
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
}

function openccVersion() {
    try {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(ROOT, "node_modules", "opencc-js", "package.json"), "utf-8")
        );
        return pkg.version;
    } catch {
        return null;
    }
}

async function main() {
    // Idempotent: keep an existing valid bundle.
    if (isValidOpenCCBundle(DEST)) {
        console.log("[opencc] client/lib/opencc/full.js already present and valid — skipping.");
        return;
    }

    // 1) Copy from the installed dependency (no network).
    const localSrc = path.join(ROOT, "node_modules", "opencc-js", "dist", "umd", "full.js");
    if (isValidOpenCCBundle(localSrc)) {
        copyFile(localSrc, DEST);
        console.log(`[opencc] Copied OpenCC bundle from node_modules/opencc-js → ${path.relative(ROOT, DEST)}`);
        return;
    }

    // 2) Fallback: download from jsDelivr.
    const version = openccVersion();
    if (version) {
        try {
            await fetchFromCdn(version, DEST);
            if (isValidOpenCCBundle(DEST)) {
                console.log(`[opencc] Downloaded OpenCC bundle (opencc-js@${version}) → ${path.relative(ROOT, DEST)}`);
                return;
            }
        } catch (err) {
            console.warn(`[opencc] CDN fetch failed: ${err.message}`);
        }
    }

    console.error(
        "[opencc] ERROR: could not obtain OpenCC bundle.\n" +
        "  Expected node_modules/opencc-js/dist/umd/full.js (install opencc-js first),\n" +
        "  or network access to cdn.jsdelivr.net. Build will fail without it."
    );
    process.exit(1);
}

main().catch((err) => {
    console.error("[opencc] Unexpected error:", err);
    process.exit(1);
});
