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
import { cpSync, existsSync, mkdirSync, statSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Vite plugin: pre-process books/ at build time.
 *
 * Scans the books/ directory for .txt and .epub files, runs each
 * through FileProcessorCore + PaginationCalculator, and writes the
 * result as static JSON under dist/books/. This lets the production
 * build serve pre-paginated book content without needing a backend.
 *
 * The plugin runs in the closeBundle hook so it executes after Vite
 * has emitted its own assets — dist/ exists by then.
 *
 * Failures are logged but do NOT abort the build (a missing or
 * corrupt book should not block the rest of the deployment).
 *
 * @returns {import("vite").Plugin}
 */
function preprocessBooksPlugin() {
    return {
        name: "preprocess-books",
        async closeBundle() {
            try {
                const { preprocessBooks } = await import("./build-tools/preprocess-books.mjs");
                await preprocessBooks();
            } catch (err) {
                console.warn("[vite] preprocess-books plugin failed:", err.message);
            }
        },
    };
}

/**
 * Post-build: copy files to dist/ that are loaded at runtime (classic <script>
 * libs, JSON data, Web Worker, font CSS) so they resolve correctly.
 */
function copyDir(src, dest) {
    if (!existsSync(src)) {
        console.warn(`[vite] Source not found, skipping: ${src}`);
        return;
    }
    if (statSync(src).isFile()) {
        var destDir = dirname(dest);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        if (existsSync(dest) && statSync(dest).isDirectory()) {
            rmSync(dest, { recursive: true, force: true });
        }
        writeFileSync(dest, readFileSync(src));
        console.log(`[vite] Copied file ${src} → ${dest}`);
    } else {
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
        cpSync(src, dest, { recursive: true, force: true });
        console.log(`[vite] Copied dir ${src} → ${dest}`);
    }
}

export default defineConfig({
    plugins: [
        preprocessBooksPlugin(),
        {
            name: "postbuild-copy-lib",
            closeBundle() {
                var root = fileURLToPath(new URL("./", import.meta.url));
                var distPath = fileURLToPath(new URL("./dist/", import.meta.url));
                // ── Classic <script> libs and static data ──
                copyDir(root + "client/lib/", distPath + "client/lib/");
                copyDir(root + "version.json", distPath + "version.json");
                copyDir(root + "help.json", distPath + "help.json");
                copyDir(root + "client/fonts/", distPath + "client/fonts/");
                // ── Web Workers and their runtime-imported deps ──
                //
                // Vite only bundles modules statically reachable from
                // index.html. Web Workers loaded via `new Worker(url)`
                // and their internal dynamic `import()` / importDependencies()
                // calls are NOT statically analyzable, so Vite leaves them
                // as-is. The worker files and every module they import
                // (transitively) must be copied to dist/ verbatim, preserving
                // the source directory layout so the relative import paths
                // resolve at runtime.
                //
                // Dependency map (verified by tracing imports):
                //   client/src/modules/database/db-worker.js
                //     └→ import("../../utils/helpers/worker.js")
                //         └→ import("../../../../shared/utils/logger.js")
                //   client/src/modules/file/file-processor-worker.js
                //     └→ import("../../utils/helpers/worker.js")        (above)
                //     └→ importDependencies([
                //           "shared/core/file/file-processor-core.js",
                //           "client/src/config/constants.js",
                //           "client/src/config/variables.js",
                //           "shared/utils/logger.js",                   (above)
                //         ])
                //         file-processor-core.js static-imports:
                //           shared/adapters/text-decoder.js
                //           shared/core/text/text-processor-core.js
                //           shared/core/text/pagination-calculator.js
                //           shared/core/text/title-pattern-detector.js
                //           client/src/utils/base.js (barrel → base/*.js)
                //         text-processor-core.js static-imports:
                //           shared/adapters/jschardet.js
                //           shared/core/text/regex-rules.js
                //           shared/core/text/bracket-processor.js
                //           client/src/config/constants.js             (above)
                //           client/src/config/variables.js            (above)
                //         title-pattern-detector.js → regex-rules.js  (above)
                //         bracket-processor.js → logger.js            (above)
                //
                // The simplest correct fix is to copy the entire `shared/`
                // tree (all transitive deps live there) plus the specific
                // `client/src/` subtrees the workers touch. Copying all of
                // `client/src/` would also work but is unnecessarily broad.
                copyDir(root + "client/src/modules/database/", distPath + "client/src/modules/database/");
                copyDir(root + "client/src/modules/file/", distPath + "client/src/modules/file/");
                copyDir(root + "client/src/utils/helpers/worker.js", distPath + "client/src/utils/helpers/worker.js");
                copyDir(root + "client/src/utils/base.js", distPath + "client/src/utils/base.js");
                copyDir(root + "client/src/utils/base/", distPath + "client/src/utils/base/");
                copyDir(root + "client/src/config/", distPath + "client/src/config/");
                copyDir(root + "shared/", distPath + "shared/");
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
        // Enable esbuild minification for production. esbuild handles the
        // codebase's argument/eval patterns correctly in modern versions.
        // This cuts JS payload by ~60-70%.
        minify: "esbuild",
        sourcemap: false,
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
