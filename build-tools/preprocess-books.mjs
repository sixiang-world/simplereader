/**
 * @fileoverview Build-time preprocessor for books/ directory.
 *
 * Scans books/ for .txt and .epub files, processes each one through
 * the shared FileProcessorCore + PaginationCalculator pipeline, and
 * writes the result as a static JSON file under dist/books/.
 *
 * Output file format (dist/books/{filename}.json):
 *   {
 *     "metadata": { "title": "...", "author": "..." },
 *     "processedLines": [...],   // HTML strings, one per line
 *     "titles": [...],           // TOC entries
 *     "titles_ind": {...},
 *     "footnotes": [...],
 *     "page_breaks": [...],
 *     "total_pages": N,
 *     "source": { "filename": "...", "encoding": "utf-8", "size_bytes": N }
 *   }
 *
 * This script is invoked:
 *   - Automatically as a Vite plugin during `pnpm build` (see vite.config.js)
 *   - Manually via `pnpm preprocess-books`
 *
 * Books opened by users via the browser File API are NOT affected —
 * they still go through the client-side Web Worker pipeline. This
 * build-time pre-processing only applies to books/ directory content
 * served as static JSON.
 *
 * @module build-tools/preprocess-books
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Polyfill globalThis.JSZip for the existing EpubConverter, which
// expects it as a browser global. We import the npm package and
// attach it to globalThis before importing the converter.
globalThis.JSZip = (await import("jszip")).default;

// Node 18+ has a global Blob. Confirm it exists.
if (typeof globalThis.Blob === "undefined") {
    throw new Error("[preprocess-books] Blob is not available. Use Node.js 18+.");
}

// Resolve repo root from this file's location: build-tools/preprocess-books.mjs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// Use pathToFileURL for Windows compatibility with dynamic import.
const importURL = (rel) => pathToFileURL(path.resolve(REPO_ROOT, rel)).href;

// Load shared/client modules lazily so the script fails fast on
// import errors instead of after scanning files.
const [{ FileProcessorCore }, { EpubConverter }, { CONST_PAGINATION }, { removeFileExtension }] =
    await Promise.all([
        import(importURL("shared/core/file/file-processor-core.js")),
        import(importURL("client/src/modules/epub/epub-converter.js")),
        import(importURL("client/src/config/constants.js")),
        import(importURL("client/src/utils/base.js")),
    ]);

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Recursively scan a directory for files matching an extension list.
 *
 * @param {string} dir - Absolute directory path.
 * @param {string[]} exts - Lowercase extensions including the dot, e.g. [".txt"].
 * @returns {string[]} Absolute file paths.
 */
function scanFiles(dir, exts) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...scanFiles(full, exts));
        } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Build a minimal CONFIG shim that FileProcessorCore.processChunkStatic
 * expects. The full client CONFIG has hundreds of fields; we only need
 * a handful.
 *
 * @param {Object} [extra]
 * @returns {Object}
 */
function buildConfigShim(extra = {}) {
    return {
        // Pagination constants — used by PaginationCalculator.
        CONST_PAGINATION,
        // Runtime vars that processChunkStatic reads.
        VARS: {
            IS_EASTERN_LAN: extra.isEasternLan ?? true,
            BOOK_AND_AUTHOR: extra.bookAndAuthor ?? { bookName: "", author: "" },
            ...extra.vars,
        },
        // Other fields the processor might touch.
        RUNTIME_VARS: { STYLE: {} },
        ...extra.config,
    };
}

/**
 * Pre-process a single .txt file.
 *
 * Mirrors what the client-side Web Worker does: detect encoding &
 * language, build a title page, process the chunk statically, then
 * run the PaginationCalculator on the result.
 *
 * @param {string} filePath - Absolute path to the .txt file.
 * @returns {Promise<Object>} Processed book data.
 */
async function processTxtFile(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileBlob = new Blob([fileBuffer]);
    const fileName = path.basename(filePath);

    // Detect encoding & language.
    const processor = new FileProcessorCore(fileBuffer.length, null, null);
    await processor.detectEncodingAndLanguage(fileBlob);

    // Build book metadata from filename.
    const { bookName, author, bookNameRE, authorRE } =
        FileProcessorCore.getBookNameAndAuthor(fileName);
    const bookAndAuthor = { bookName, author, bookNameRE, authorRE };

    // Generate title page lines.
    const titlePageLines = FileProcessorCore.generateTitlePage(
        { bookName, author },
        {} // styles — empty for build-time
    );
    const titlePageTitles = titlePageLines.map((_, i) => ["", i]);

    // Process the entire file as one chunk (build-time = no streaming).
    // NOTE: do NOT pass `extraContent.endPageLines`/`endPageTitles` — the
    // processChunkStatic code path requires both arrays to be non-empty
    // when present (it does `endPageTitles[0][1] = ...`). The end page
    // is generated separately below and appended to processedLines.
    const config = buildConfigShim({
        isEasternLan: processor.isEasternLan,
        bookAndAuthor,
    });
    const result = await FileProcessorCore.processChunkStatic(fileBlob, {
        extraContent: {
            titlePageLines,
            titlePageTitles,
        },
        title_page_line_number_offset: 3,
        pageBreakOnTitle: true,
        CONFIG: config,
        encoding: processor.encoding,
        isInitialChunk: false, // Treat as a complete book — single chunk
        forcePatternDetection: true,
        patternDetectionOptions: {
            fileSize: fileBuffer.length,
            initialChunkSize: 1024 * 1024,
        },
        logMode: false,
    });

    // Generate end page (single HTML string; not added to TOC).
    const endPageLines = FileProcessorCore.generateEndPage(result.htmlLines.length);

    return {
        metadata: { title: bookName, author },
        processedLines: [...titlePageLines, ...result.htmlLines, ...endPageLines],
        titles: [...titlePageTitles, ...result.titles],
        titles_ind: result.titles_ind,
        footnotes: result.footnotes,
        page_breaks: result.pageBreaks,
        total_pages: result.pageBreaks.length || 1,
        source: {
            filename: fileName,
            encoding: processor.encoding,
            size_bytes: fileBuffer.length,
            is_eastern_lan: processor.isEasternLan,
        },
    };
}

/**
 * Pre-process a single .epub file.
 *
 * Uses the existing EpubConverter with the JSZip polyfill. The
 * converter returns htmlLines + titles; we then run PaginationCalculator
 * on the result.
 *
 * @param {string} filePath - Absolute path to the .epub file.
 * @returns {Promise<Object>} Processed book data.
 */
async function processEpubFile(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileBlob = new Blob([fileBuffer]);
    const fileName = path.basename(filePath);

    // Build a File-like object (EpubConverter expects a File/Blob with .name).
    const fileLike = Object.assign(fileBlob, { name: fileName });

    const result = await EpubConverter.convert(fileLike);

    return {
        metadata: {
            title: result.metadata?.title || removeFileExtension(fileName),
            author: result.metadata?.author || "",
        },
        processedLines: result.htmlLines,
        titles: result.titles,
        titles_ind: result.titlesInd,
        footnotes: [],
        page_breaks: result.pageBreaks || [0],
        total_pages: (result.pageBreaks || [0]).length,
        source: {
            filename: fileName,
            encoding: "utf-8",
            size_bytes: fileBuffer.length,
            is_eastern_lan: true, // EPUB content is detected per-spine in the converter
        },
    };
}

/**
 * Process a single book file and write the JSON output.
 *
 * @param {string} filePath - Absolute path to the book file.
 * @param {string} outDir - Absolute path to the output directory.
 * @returns {Promise<{file: string, pages: number, ok: boolean, error?: string}>}
 */
async function processOne(filePath, outDir) {
    const ext = path.extname(filePath).toLowerCase();
    const baseName = removeFileExtension(path.basename(filePath));
    const outPath = path.join(outDir, `${baseName}.json`);

    try {
        const data =
            ext === ".txt"
                ? await processTxtFile(filePath)
                : ext === ".epub"
                ? await processEpubFile(filePath)
                : null;

        if (!data) {
            return { file: filePath, pages: 0, ok: false, error: `unsupported extension: ${ext}` };
        }

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
        return { file: filePath, pages: data.total_pages, ok: true, outPath };
    } catch (err) {
        console.error(`[preprocess-books] Failed to process ${filePath}:`, err.message);
        if (process.env.PREPROCESS_BOOKS_DEBUG) {
            console.error(err.stack);
        }
        return { file: filePath, pages: 0, ok: false, error: err.message };
    }
}

/**
 * Main entry point.
 *
 * @param {Object} [opts]
 * @param {string} [opts.booksDir]  - Source directory. Defaults to <repo>/books.
 * @param {string} [opts.outDir]    - Output directory. Defaults to <repo>/dist/books.
 * @returns {Promise<{processed: number, succeeded: number, failed: number, totalPages: number}>}
 */
export async function preprocessBooks(opts = {}) {
    const booksDir = opts.booksDir ?? path.resolve(REPO_ROOT, "books");
    const outDir = opts.outDir ?? path.resolve(REPO_ROOT, "dist", "books");

    const t0 = Date.now();
    console.log(`[preprocess-books] Scanning ${booksDir} for .txt/.epub files...`);

    const files = scanFiles(booksDir, [".txt", ".epub"]);
    console.log(`[preprocess-books] Found ${files.length} book(s).`);

    if (files.length === 0) {
        console.log("[preprocess-books] No books to process. Done.");
        return { processed: 0, succeeded: 0, failed: 0, totalPages: 0 };
    }

    let succeeded = 0;
    let failed = 0;
    let totalPages = 0;
    for (const file of files) {
        const result = await processOne(file, outDir);
        if (result.ok) {
            succeeded++;
            totalPages += result.pages;
            console.log(
                `[preprocess-books] ✓ ${path.basename(file)} → ${path.basename(result.outPath)} (${result.pages} pages)`
            );
        } else {
            failed++;
            console.error(`[preprocess-books] ✗ ${path.basename(file)}: ${result.error}`);
        }
    }

    const dt = (Date.now() - t0) / 1000;
    console.log(
        `[preprocess-books] Done in ${dt.toFixed(2)}s. ` +
            `${succeeded} succeeded, ${failed} failed, ${totalPages} total pages.`
    );
    return { processed: files.length, succeeded, failed, totalPages };
}

// CLI entry point — only run when invoked directly, not when imported.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
    preprocessBooks().catch((err) => {
        console.error("[preprocess-books] Fatal:", err);
        process.exit(1);
    });
}
