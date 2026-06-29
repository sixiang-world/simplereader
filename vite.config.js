/**
 * Vite configuration for SimpleReader.
 *
 * Project layout (kept stable to minimize churn):
 *   /              — index.html (Vite entry), package.json, vite.config.js
 *   /client/       — frontend source (ES modules), CSS, fonts, images, manifests
 *   /shared/       — pure JS shared between client (and historically server)
 *   /archive/      — historical code (server/, debug/) kept for recovery, not in main code path
 *   /test/         — Node-native .mjs tests using assert (no test framework)
 *
 * Vite is configured with root = repo root so index.html stays at the original
 * location required by Caddy static deployment. The dev server serves from
 * root, the production build outputs to /dist and is what Caddy should serve.
 *
 * Third-party libraries (jQuery, tippy, jschardet, JSZip, sweetalert2, hyperlist,
 * ipad-cursor, yaireo/color-picker, yaireo/position) are loaded as classic
 * <script> tags in index.html and attach to window.* globals. They are NOT
 * bundled by Vite — we keep them as-is to preserve the global-variable contract
 * that the rest of the codebase relies on (e.g. `$`, `jQuery`, `tippy`, `Swal`,
 * `jschardet`, `JSZip`, `HyperList`, `ColorPicker`, `attachIpadCursor`).
 */
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, mkdirSync } from "node:fs";

/**
 * Post-build: copy classic-script lib files to dist/ so the classic
 * <script> tags in index.html (jQuery, jschardet, JSZip, etc.) resolve.
 */
function copyDir(src, dest) {
    if (!existsSync(src)) {
        console.warn(`[vite] Source not found, skipping: ${src}`);
        return;
    }
    if (!existsSync(dest)) {
        mkdirSync(dest, { recursive: true });
    }
    cpSync(src, dest, { recursive: true, force: true });
    console.log(`[vite] Copied ${src} → ${dest}`);
}

export default defineConfig({
    plugins: [
        {
            name: "postbuild-copy-lib",
            closeBundle() {
                const src = fileURLToPath(new URL("./client/lib/", import.meta.url));
                const dest = fileURLToPath(new URL("./dist/client/lib/", import.meta.url));
                copyDir(src, dest);
            },
        },
    ],
    root: fileURLToPath(new URL("./", import.meta.url)),
    base: "./",
    publicDir: false,
    server: {
        port: 3000,
        strictPort: false,
        open: false,
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // Target modern browsers that support top-level await, private class
        // fields, static class fields, etc. The codebase uses all of these.
        target: "es2022",
        // Keep module IDs stable for easier debugging. The app uses ES module
        // imports with explicit .js extensions throughout, so we keep the
        // structure as flat as possible.
        rollupOptions: {
            input: fileURLToPath(new URL("./index.html", import.meta.url)),
            output: {
                entryFileNames: "assets/[name].js",
                chunkFileNames: "assets/[name].js",
                assetFileNames: "assets/[name][extname]",
            },
            // jschardet is loaded as a classic <script> in the browser
            // (window.jschardet). The shared/adapters/jschardet.js adapter
            // only references the npm package in the Node branch (for tests
            // and build scripts), so we mark it external to keep it out of
            // the browser bundle.
            external: ["jschardet"],
        },
        // The codebase is not yet minification-safe (some code uses arguments
        // trickery and eval-like patterns). Keep minify off for safety; the
        // app is small enough that file size is not a concern.
        minify: false,
        sourcemap: true,
    },
    // Expose /client, /shared, /server paths directly so dev server can serve
    // them with same relative URLs as production.
    resolve: {
        alias: {
            // No aliases — the codebase uses relative imports consistently.
        },
    },
    optimizeDeps: {
        // jschardet is only ever imported in the Node branch of
        // shared/adapters/jschardet.js — the browser branch uses self.jschardet.
        // We exclude it from Vite's dep optimizer so dev mode doesn't try to
        // pre-bundle a package that's only used in Node.
        exclude: ["jschardet"],
    },
});
