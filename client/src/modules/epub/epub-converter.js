/**
 * @fileoverview EPUB Converter module for extracting content from EPUB files
 *
 * Converts EPUB files into SimpleTextReader's internal content structure
 * (FILE_CONTENT_CHUNKS + ALL_TITLES format) so all existing rendering,
 * pagination, TOC, and reading features work automatically.
 *
 * @module client/src/modules/epub/epub-converter
 */

import { Logger } from "../../../../shared/utils/logger.js";

/**
 * @class EpubConverter
 * @description Converts EPUB files to SimpleTextReader content structure
 */
export class EpubConverter {
    static #logger = Logger.getLogger(EpubConverter, false);

    /**
     * Convert an EPUB File to SimpleTextReader content structure
     * @param {File} file - The EPUB file
     * @param {Function} [onProgress] - Callback(step, detail) for progress updates
     * @returns {Promise<{source: Object, htmlLines: Array, titles: Array, titlesInd: Object, metadata: Object, spineBreaks: Array}>}
     *   spineBreaks is shifted (+1 for non-zero breaks) when a synthetic
     *   title page is prepended, so values stay aligned with htmlLines.
     */
    static async convert(file, onProgress) {
        const reportProgress = (step, detail = "") => {
            if (typeof onProgress === "function") {
                try {
                    onProgress(step, detail);
                } catch (e) {
                    this.#logger.log("EPUB progress callback error:", e);
                }
            }
        };

        const t0 = performance.now();
        this.#logger.log("Starting conversion...");
        reportProgress("start");

        // 1. Unzip
        this.#logger.log("Unzipping...");
        reportProgress("unzip");
        const buffer = await file.arrayBuffer();
        this.#logger.log(`File size: ${(buffer.byteLength / 1024).toFixed(0)}KB`);
        const zip = await JSZip.loadAsync(buffer);
        this.#logger.log(`Unzipped: ${Object.keys(zip.files).length} files`);

        // 2. Parse container → find OPF path
        this.#logger.log("Parsing container.xml...");
        reportProgress("container");
        const opfPath = await this.#parseContainer(zip);
        this.#logger.log(`OPF path: ${opfPath}`);

        // 3. Parse OPF → metadata, manifest, spine
        this.#logger.log("Parsing OPF...");
        reportProgress("opf");
        const { metadata, manifest, spine } = await this.#parseOpf(zip, opfPath);
        this.#logger.log(`Spine: ${spine.length} items, Manifest: ${Object.keys(manifest).length} items`);

        // 4. Parse TOC (EPUB3 nav or EPUB2 NCX)
        this.#logger.log("Parsing TOC...");
        reportProgress("toc");
        const tocEntries = await this.#parseToc(zip, manifest, opfPath);
        this.#logger.log(`TOC entries: ${tocEntries.length}`);

        // 5. Process spine items in order
        this.#logger.log("Processing spine...");
        reportProgress("spine", `${spine.length} items`);
        const { htmlLines, titles: spineTitles, spineBreaks, fileToLine, fragmentToLine, missingFiles } = await this.#processSpine(
            zip,
            spine,
            manifest,
            opfPath,
            (current, total) => reportProgress("spine-item", `${current}/${total}`)
        );
        this.#logger.log(`Spine done: ${htmlLines.length} lines, ${spineTitles.length} titles, ${spineBreaks.length} spine breaks`);

        // 6. Build titles from NCX/TOC entries (using fileToLine mapping)
        //    Prefer NCX titles over auto-detected ones when available
        let titles;
        if (tocEntries.length > 0) {
            this.#logger.log(`Mapping ${tocEntries.length} TOC entries to line numbers...`);
            titles = [];
            const seenLines = new Set();
            for (const entry of tocEntries) {
                // parseToc has already resolved hrefs to zip-root absolute paths.
                const [filePath, fragment] = entry.href.split("#");
                // Prefer fragment-level mapping; fall back to file start
                let lineNum;
                if (fragment) {
                    lineNum = fragmentToLine[`${filePath}#${fragment}`];
                }
                if (lineNum === undefined) {
                    lineNum = fileToLine[filePath];
                }
                if (lineNum !== undefined && !seenLines.has(lineNum)) {
                    seenLines.add(lineNum);
                    titles.push([entry.label, lineNum, entry.label, false]);
                }
            }
            // Also include auto-detected <h1-h6> titles that weren't in NCX
            for (const st of spineTitles) {
                if (!seenLines.has(st[1])) {
                    titles.push(st);
                    seenLines.add(st[1]);
                }
            }
            this.#logger.log(`TOC mapping produced ${titles.length} titles (${tocEntries.length - titles.length} unmapped)`);
        } else {
            titles = spineTitles;
        }

        // 7. Synthetic title page if the EPUB doesn't start with a title
        const syntheticLines = [];
        const hasTitleAtStart = htmlLines.length > 0 && htmlLines[0].type === "title";
        if (!hasTitleAtStart && metadata.title) {
            const authorHtml = metadata.author ? `<p class="author">${this.#escapeHtml(metadata.author)}</p>` : "";
            syntheticLines.push({
                type: "title",
                tag: "div",
                content: `<h1>${this.#escapeHtml(metadata.title)}</h1>${authorHtml}`,
                charCount: (metadata.title + (metadata.author || "")).length,
                lineNumber: 0,
                elementType: "t",
                source: "epub",
                synthetic: true,
            });
            // Shift existing titles
            for (const title of titles) {
                title[1] += 1;
            }
            // Shift spine breaks to keep them aligned with the prepended
            // synthetic title page. Non-zero breaks move by +1; the implicit
            // break at 0 (first spine item) stays anchored to the new line 0.
            for (let i = 0; i < spineBreaks.length; i++) {
                if (spineBreaks[i] > 0) spineBreaks[i] += 1;
            }
        }

        // 8. Synthetic end page. Text is supplied by CSS via the existing
        // --ui_endPage variable so it respects the current display language.
        syntheticLines.push({
            type: "title",
            tag: "div",
            content: "<h1 class=\"end-page\"></h1>",
            charCount: 0,
            lineNumber: htmlLines.length + syntheticLines.length,
            elementType: "t",
            source: "epub",
            synthetic: true,
        });

        // Prepend title page and append end page
        const adjustedHtmlLines = [...htmlLines];
        if (!hasTitleAtStart && metadata.title) {
            adjustedHtmlLines.unshift(syntheticLines[0]);
        }
        adjustedHtmlLines.push(syntheticLines[syntheticLines.length - 1]);

        // Reassign line numbers sequentially
        for (let i = 0; i < adjustedHtmlLines.length; i++) {
            adjustedHtmlLines[i].lineNumber = i;
        }

        // 9. Build titlesInd
        this.#logger.log("Building titlesInd...");
        const titlesInd = {};
        for (let i = 0; i < titles.length; i++) {
            titlesInd[titles[i][1]] = i;
        }

        const elapsed = performance.now() - t0;
        this.#logger.log(`Conversion complete in ${elapsed.toFixed(0)}ms`);
        reportProgress("complete");
        return {
            source: { type: "epub", filename: file.name, size_bytes: buffer.byteLength },
            htmlLines: adjustedHtmlLines,
            titles,
            titlesInd,
            metadata,
            spineBreaks,
            missingFiles,
        };
    }

    // ──────────────────────────────────────────────
    //  Container & OPF parsing
    // ──────────────────────────────────────────────

    /**
     * Parse META-INF/container.xml to find the OPF file path
     * @param {JSZip} zip
     * @returns {Promise<string>} OPF path relative to zip root
     */
    static async #parseContainer(zip) {
        const containerFile = zip.file("META-INF/container.xml");
        if (!containerFile) throw new Error("Invalid EPUB: missing META-INF/container.xml");

        const xml = await containerFile.async("text");
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        // Use getElementsByTagNameNS to handle default namespace
        const rootfile = doc.getElementsByTagNameNS("*", "rootfile")[0];
        if (!rootfile) throw new Error("Invalid EPUB: no rootfile in container.xml");

        return rootfile.getAttribute("full-path");
    }

    /**
     * Parse the OPF file for metadata, manifest, and spine
     * @param {JSZip} zip
     * @param {string} opfPath
     * @returns {Promise<{metadata: Object, manifest: Object, spine: Array}>}
     */
    static async #parseOpf(zip, opfPath) {
        const opfFile = zip.file(opfPath);
        if (!opfFile) throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`);

        const xml = await opfFile.async("text");
        const doc = new DOMParser().parseFromString(xml, "application/xml");

        // --- Metadata ---
        // Use getElementsByTagNameNS with the DC namespace first, then fall back to
        // prefixed tag names for environments (e.g. linkedom) that don't handle
        // wildcard namespaces in getElementsByTagNameNS.
        const DC_NS = "http://purl.org/dc/elements/1.1/";
        const OPF_NS = "http://www.idpf.org/2007/opf";
        const metadata = {};
        const getDcElements = (tag) => {
            const byNs = doc.getElementsByTagNameNS(DC_NS, tag);
            if (byNs.length > 0) return Array.from(byNs);
            const byName = doc.getElementsByTagName(`dc:${tag}`);
            if (byName.length > 0) return Array.from(byName);
            return [];
        };
        const getDcText = (tag, preferRole) => {
            const els = getDcElements(tag);
            if (preferRole) {
                for (const el of els) {
                    const role = el.getAttributeNS(OPF_NS, "role");
                    if (role === preferRole) return el.textContent?.trim() || "";
                }
            }
            return els[0]?.textContent?.trim() || "";
        };
        const getDcAll = (tag) => getDcElements(tag)
            .map((el) => el.textContent?.trim())
            .filter(Boolean);

        metadata.title = getDcText("title");
        metadata.author = getDcText("creator", "aut") || getDcText("creator");
        metadata.publisher = getDcText("publisher");
        metadata.date = getDcText("date");
        metadata.language = getDcText("language");
        metadata.description = getDcText("description");
        metadata.subjects = getDcAll("subject");
        metadata.identifier = getDcText("identifier");

        // --- Manifest ---
        // Use getElementsByTagNameNS("*", ...) to handle namespaced OPF (default xmlns)
        const manifest = {};
        const manifestEl = doc.getElementsByTagNameNS("*", "manifest")[0];
        const manifestItems = manifestEl ? manifestEl.getElementsByTagNameNS("*", "item") : doc.getElementsByTagNameNS("*", "item");
        for (const item of manifestItems) {
            const id = item.getAttribute("id");
            const href = item.getAttribute("href");
            const mediaType = item.getAttribute("media-type");
            const properties = item.getAttribute("properties");
            const fallback = item.getAttribute("fallback");
            if (id && href) {
                manifest[id] = { href, mediaType, properties, fallback };
            }
        }

        // EPUB2 cover image reference (<meta name="cover" content="cover-id"/>)
        const metaEls = doc.getElementsByTagNameNS("*", "meta");
        for (const metaEl of metaEls) {
            if (metaEl.getAttribute("name") === "cover") {
                const coverId = metaEl.getAttribute("content");
                const coverItem = manifest[coverId];
                if (coverItem) {
                    metadata.coverHref = this.#resolveHref(coverItem.href, opfPath);
                }
                break;
            }
        }

        // --- Spine ---
        const spine = [];
        const spineEl = doc.getElementsByTagNameNS("*", "spine")[0];
        const spineItems = spineEl ? spineEl.getElementsByTagNameNS("*", "itemref") : doc.getElementsByTagNameNS("*", "itemref");
        for (const itemref of spineItems) {
            const idref = itemref.getAttribute("idref");
            if (idref && manifest[idref]) {
                spine.push(manifest[idref]);
            }
        }

        return { metadata, manifest, spine };
    }

    // ──────────────────────────────────────────────
    //  TOC parsing (EPUB3 nav + EPUB2 NCX)
    // ──────────────────────────────────────────────

    /**
     * Parse TOC from EPUB3 nav or EPUB2 NCX
     * @param {JSZip} zip
     * @param {Object} manifest
     * @param {string} opfPath
     * @returns {Promise<Array<{label: string, href: string}>>}
     */
    static async #parseToc(zip, manifest, opfPath) {
        // Try EPUB3 nav first: manifest item whose properties include "nav"
        const navEntry = Object.values(manifest).find(
            (item) =>
                item.mediaType === "application/xhtml+xml" &&
                item.properties &&
                item.properties.split(/\s+/).includes("nav")
        ) || Object.values(manifest).find(
            // Fallback: href contains "nav" (less reliable)
            (item) => item.mediaType === "application/xhtml+xml" && item.href && item.href.includes("nav")
        );

        if (navEntry) {
            try {
                return await this.#parseNavToc(zip, navEntry.href, opfPath);
            } catch (e) {
                this.#logger.log("EPUB3 nav parse failed, trying NCX:", e);
            }
        }

        // Fallback to EPUB2 NCX
        const ncxEntry = Object.values(manifest).find((item) => item.mediaType === "application/x-dtbncx+xml");
        if (ncxEntry) {
            try {
                return await this.#parseNcxToc(zip, ncxEntry.href, opfPath);
            } catch (e) {
                this.#logger.log("NCX parse failed:", e);
            }
        }

        return [];
    }

    /**
     * Parse EPUB3 nav.xhtml TOC
     */
    static async #parseNavToc(zip, navHref, opfPath) {
        const navPath = this.#resolveHref(navHref, opfPath);
        const navFile = zip.file(navPath);
        if (!navFile) return [];

        const html = await navFile.async("text");
        const doc = new DOMParser().parseFromString(html, "application/xhtml+xml");

        // Find <nav epub:type="toc">. Namespace-aware CSS selectors are not
        // reliable in all DOM implementations (e.g. linkedom), so scan navs.
        let navEl;
        for (const nav of doc.querySelectorAll("nav")) {
            const type = nav.getAttribute("epub:type") || nav.getAttribute("type");
            if (type === "toc") {
                navEl = nav;
                break;
            }
        }
        if (!navEl) {
            navEl = doc.querySelector("nav");
        }
        if (!navEl) return [];

        const entries = [];
        const links = navEl.querySelectorAll("a, span");
        for (const link of links) {
            const href = link.getAttribute("href");
            const label = link.textContent?.trim();
            if (href && label) {
                const [pathPart, fragment] = href.split("#");
                const resolvedPath = this.#resolveHref(pathPart, navPath);
                const resolvedHref = fragment ? `${resolvedPath}#${fragment}` : resolvedPath;
                entries.push({ label, href: resolvedHref });
            }
        }

        return entries;
    }

    /**
     * Parse EPUB2 toc.ncx TOC
     */
    static async #parseNcxToc(zip, ncxHref, opfPath) {
        const ncxPath = this.#resolveHref(ncxHref, opfPath);
        const ncxFile = zip.file(ncxPath);
        if (!ncxFile) return [];

        const xml = await ncxFile.async("text");
        const doc = new DOMParser().parseFromString(xml, "application/xml");

        // Use getElementsByTagNameNS to handle default namespace (xmlns="http://www.daisy.org/z3986/2005/ncx/")
        const entries = [];
        const navPoints = doc.getElementsByTagNameNS("*", "navPoint");
        for (const point of navPoints) {
            const labelEl = point.getElementsByTagNameNS("*", "navLabel")[0]?.getElementsByTagNameNS("*", "text")[0];
            const contentEl = point.getElementsByTagNameNS("*", "content")[0];
            if (labelEl && contentEl) {
                const label = labelEl.textContent?.trim();
                const src = contentEl.getAttribute("src");
                if (label && src) {
                    const [pathPart, fragment] = src.split("#");
                    // NCX content/@src is relative to the NCX file itself, not the
                    // OPF. Using opfPath here only works when both live in the same
                    // directory; subdirectory NCX (e.g. OEBPS/nav/toc.ncx) would
                    // resolve to wrong paths and drop TOC entries.
                    const resolvedPath = this.#resolveHref(pathPart, ncxPath);
                    const resolvedHref = fragment ? `${resolvedPath}#${fragment}` : resolvedPath;
                    entries.push({ label, href: resolvedHref });
                }
            }
        }

        return entries;
    }

    // ──────────────────────────────────────────────
    //  Spine processing
    // ──────────────────────────────────────────────

    /**
     * Process all spine items in order, producing htmlLines and titles.
     * Also builds a filePath → startLine mapping for NCX/TOC cross-referencing.
     * @param {JSZip} zip
     * @param {Array} spine
     * @param {Object} manifest
     * @param {string} opfPath
     * @returns {Promise<{htmlLines: Array, titles: Array, spineBreaks: Array, fileToLine: Object}>}
     */
    /**
     * Resolve a spine manifest item to a processable HTML/XML item using OPF fallback chain.
     * @param {Object} item - Spine manifest item
     * @param {Object} manifest - Full manifest
     * @param {number} depth - Recursion guard
     * @returns {Object|null} Processable item or null
     */
    /**
     * Scan an XHTML file for <img> elements and extract referenced images
     * from the zip as data: URLs. Returns a map of raw src → data URL.
     * External (http/https) and already-inline images are skipped.
     * @param {JSZip} zip
     * @param {Object} manifest - EPUB manifest
     * @param {string} filePath - Zip-absolute path of the XHTML spine file
     * @param {string} xhtml - The XHTML source
     * @returns {Promise<Object<string,string>>}
     */
    static async #buildImageRegistry(zip, manifest, filePath, xhtml) {
        const registry = {};
        try {
            const doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
            const imgs = doc.querySelectorAll("img");
            for (const img of imgs) {
                const src = img.getAttribute("src");
                if (!src) continue;
                // Already inline or external: leave external images out
                // entirely (privacy / anti-tracking) and skip data:/blob:.
                if (/^(data:|blob:)/i.test(src)) continue;
                if (/^(https?:|\/\/)/i.test(src)) continue;
                const abs = this.#resolveHref(src, filePath);
                if (!abs || registry[src]) continue;
                const file = zip.file(abs);
                if (!file) continue;
                const mime = this.#guessImageMime(abs);
                if (!mime) continue;
                try {
                    const b64 = await file.async("base64");
                    registry[src] = `data:${mime};base64,${b64}`;
                } catch (e) {
                    this.#logger.warn(`[epub] Failed to extract image: ${abs}`);
                }
            }
        } catch (e) {
            this.#logger.warn("[epub] buildImageRegistry failed:", e.message);
        }
        return registry;
    }

    /**
     * Render a standalone <img> or <figure> as a block element with an
     * inlined data: URL. Returns null when the image cannot be inlined.
     * @param {Element} node - The <img> or <figure> element
     * @param {Object|null} imageRegistry - src → data URL map
     * @returns {string|null}
     */
    static #extractImageBlock(node, imageRegistry) {
        const tag = node.tagName?.toLowerCase();
        if (tag === "img") {
            return this.#renderInlineImage(node, imageRegistry) || null;
        }
        if (tag === "figure") {
            let imgHtml = "";
            let captionHtml = "";
            for (const child of node.childNodes) {
                if (child.nodeType !== Node.ELEMENT_NODE) continue;
                const childTag = child.tagName?.toLowerCase();
                if (childTag === "img") {
                    imgHtml = this.#renderInlineImage(child, imageRegistry) || "";
                } else if (childTag === "figcaption") {
                    captionHtml = this.#extractInlineHtml(child, imageRegistry);
                }
            }
            if (!imgHtml) return null;
            const caption = captionHtml ? `<figcaption>${captionHtml}</figcaption>` : "";
            return `<figure>${imgHtml}${caption}</figure>`;
        }
        return null;
    }

    /**
     * Render a single <img> with an inlined data: URL, keeping only safe
     * attributes (src, alt, title). Returns empty string when the image
     * cannot be inlined (so it is dropped rather than left broken).
     * @param {Element} img
     * @param {Object|null} imageRegistry
     * @returns {string}
     */
    static #renderInlineImage(img, imageRegistry) {
        const src = img.getAttribute("src");
        let dataUrl = "";
        if (src && /^(data:|blob:)/i.test(src)) {
            dataUrl = src;
        } else if (src && imageRegistry && imageRegistry[src]) {
            dataUrl = imageRegistry[src];
        }
        if (!dataUrl) return "";
        let html = `<img src="${this.#escapeHtml(dataUrl)}"`;
        const alt = img.getAttribute("alt");
        if (alt !== null) html += ` alt="${this.#escapeHtml(alt)}"`;
        const title = img.getAttribute("title");
        if (title !== null) html += ` title="${this.#escapeHtml(title)}"`;
        html += ">";
        return html;
    }

    /**
     * Guess an image MIME type from a file path extension.
     * @param {string} path
     * @returns {string|null}
     */
    static #guessImageMime(path) {
        const ext = path.split(".").pop()?.toLowerCase() || "";
        const map = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            avif: "image/avif",
            bmp: "image/bmp",
            svg: "image/svg+xml",
        };
        return map[ext] || null;
    }

    static #resolveSpineItem(item, manifest, depth = 0) {
        if (!item) return null;
        if (depth > 10) return null; // Prevent circular fallback loops
        const mediaType = item.mediaType || "";
        if (mediaType.includes("html") || mediaType.includes("xml")) {
            return item;
        }
        if (item.fallback && manifest[item.fallback]) {
            return this.#resolveSpineItem(manifest[item.fallback], manifest, depth + 1);
        }
        return null;
    }

    static async #processSpine(zip, spine, manifest, opfPath, onItemProgress) {
        const htmlLines = [];
        const titles = [];
        const spineBreaks = [0]; // First page always starts at 0
        const fileToLine = {};   // {filePath: startLineNumber}
        const fragmentToLine = {}; // {filePath#id: lineNumber}
        const missingFiles = [];
        let lineNumber = 0;
        this.#logger.log(`Processing ${spine.length} spine items...`);
        for (const [idx, item] of spine.entries()) {
            const filePath = this.#resolveHref(item.href, opfPath);
            let file = zip.file(filePath);

            if (!file) {
                missingFiles.push(filePath);
                this.#logger.warn(`Spine [${idx}] NOT FOUND: ${filePath} (skipping)`);
                continue;
            }

            // Resolve fallback chain for non-HTML/XML spine items
            const effectiveItem = this.#resolveSpineItem(item, manifest);
            if (!effectiveItem) {
                this.#logger.log(`Spine [${idx}] SKIP: ${filePath} (${item.mediaType}, no HTML/XML fallback)`);
                continue;
            }

            const effectivePath = effectiveItem === item ? filePath : this.#resolveHref(effectiveItem.href, opfPath);
            if (effectiveItem !== item) {
                file = zip.file(effectivePath);
                if (!file) {
                    missingFiles.push(effectivePath);
                    this.#logger.warn(`Spine [${idx}] NOT FOUND (fallback): ${effectivePath} (skipping)`);
                    continue;
                }
                this.#logger.log(`Spine [${idx}] FALLBACK: ${filePath} → ${effectivePath}`);
            }

            // Record spine boundary (skip index 0 since spineBreaks already starts with 0)
            if (lineNumber > 0) {
                spineBreaks.push(lineNumber);
            }

            // Map the normalized file path to its starting line number for NCX matching
            fileToLine[effectivePath] = lineNumber;

            const xhtml = await file.async("text");
            const t1 = performance.now();
            // Pre-resolve image resources referenced by this spine file so the
            // (synchronous) HTML walker can inline them as data: URLs.
            const imageRegistry = await this.#buildImageRegistry(zip, manifest, effectivePath, xhtml);
            const result = this.#processXhtml(xhtml, lineNumber, effectivePath, fragmentToLine, imageRegistry);
            const elapsed = (performance.now() - t1).toFixed(1);

            htmlLines.push(...result.elements);
            titles.push(...result.titles);
            lineNumber += result.elements.length;

            if (result.elements.length > 0 || result.titles.length > 0) {
                this.#logger.log(`Spine [${idx}] ${effectivePath}: ${result.elements.length} els, ${result.titles.length} titles (${elapsed}ms)`);
            }
            if (typeof onItemProgress === "function") {
                try {
                    onItemProgress(idx + 1, spine.length);
                } catch (e) {
                    this.#logger.log("EPUB item progress callback error:", e);
                }
            }
            // Yield to the event loop between spine items so the progress UI can
            // repaint and the tab stays responsive during long conversions.
            await Promise.resolve();
        }

        // Non-fatal: surface missing files as a warning but keep the successfully
        // parsed content. Throwing here would discard the entire book just because
        // one non-critical spine item (e.g. a missing copyright page) is absent.
        if (missingFiles.length > 0) {
            this.#logger.warn(`EPUB missing spine file(s): ${missingFiles.join(", ")}`);
        }

        return { htmlLines, titles, spineBreaks, fileToLine, fragmentToLine, missingFiles };
    }

    /**
     * Process a single XHTML file into structure objects
     * @param {string} xhtml - The XHTML content
     * @param {number} lineOffset - Starting line number
     * @param {string} [filePath] - Path of the XHTML file within the EPUB
     * @param {Object} [fragmentToLine] - Map to populate with file#id → lineNumber
     * @returns {{elements: Array, titles: Array}}
     */
    static #processXhtml(xhtml, lineOffset, filePath, fragmentToLine, imageRegistry = null) {
        const elements = [];
        const titles = [];

        // Parse as XHTML, fallback to HTML if it fails
        let doc;
        try {
            doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
            // Check for parse errors
            const parseError = doc.querySelector("parsererror");
            if (parseError) {
                doc = new DOMParser().parseFromString(xhtml, "text/html");
            }
        } catch {
            doc = new DOMParser().parseFromString(xhtml, "text/html");
        }

        // Get the body content
        const body = doc.querySelector("body");
        if (!body) return { elements: [], titles: [] };

        // Process child nodes of body
        const walker = this.#createBlockWalker(body);

        for (const node of walker) {
            const tag = node.tagName?.toLowerCase();
            const textContent = node.textContent?.trim();

            // Standalone images: emit an image block even though the
            // element has no text content (must run before the empty
            // element guard below).
            if (tag === "img" || tag === "figure") {
                const lineNumber = lineOffset + elements.length;
                const content = this.#extractImageBlock(node, imageRegistry);
                if (content) {
                    elements.push({
                        type: "image",
                        tag,
                        content,
                        // Image block counts as one content line so pagination
                        // allocates page space to it instead of skipping it.
                        charCount: 1,
                        lineNumber,
                        elementType: "img",
                        source: "epub",
                    });
                    if (fragmentToLine && filePath && node.id) {
                        fragmentToLine[`${filePath}#${node.id}`] = lineNumber;
                    }
                }
                continue;
            }

            // Skip empty elements
            if (!textContent && tag !== "br" && tag !== "hr") continue;

            // Skip non-content elements
            if (["script", "style", "svg"].includes(tag)) continue;

            const lineNumber = lineOffset + elements.length;

            // Headings
            if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
                const content = this.#extractInlineHtml(node, imageRegistry);
                const level = parseInt(tag[1]);

                if (level === 1) {
                    // h1 → title page style
                    elements.push({
                        type: "title",
                        tag: "h1",
                        content: `<h1>${content}</h1>`,
                        charCount: textContent.length,
                        lineNumber,
                        elementType: "t",
                        source: "epub",
                    });
                    titles.push([textContent, lineNumber, textContent, false]);
                } else {
                    // h2-h6 → heading
                    elements.push({
                        type: "heading",
                        tag: "h2",
                        content,
                        charCount: textContent.length,
                        lineNumber,
                        elementType: "h",
                        source: "epub",
                    });
                    titles.push([textContent, lineNumber, textContent, false]);
                }
                if (fragmentToLine && filePath && node.id) {
                    fragmentToLine[`${filePath}#${node.id}`] = lineNumber;
                }
                continue;
            }

            // Tables
            if (tag === "table") {
                const content = this.#extractTableHtml(node, imageRegistry);
                if (content.trim()) {
                    elements.push({
                        type: "table",
                        tag: "table",
                        content,
                        charCount: textContent.length,
                        lineNumber,
                        elementType: "b",
                        source: "epub",
                    });
                    if (fragmentToLine && filePath && node.id) {
                        fragmentToLine[`${filePath}#${node.id}`] = lineNumber;
                    }
                }
                continue;
            }

            // Lists
            if (tag === "ul" || tag === "ol") {
                const content = this.#extractListHtml(node, imageRegistry);
                if (content.trim()) {
                    elements.push({
                        type: "list",
                        tag,
                        content,
                        charCount: textContent.length,
                        lineNumber,
                        elementType: "l",
                        source: "epub",
                    });
                    if (fragmentToLine && filePath && node.id) {
                        fragmentToLine[`${filePath}#${node.id}`] = lineNumber;
                    }
                }
                continue;
            }

            // Blockquotes
            if (tag === "blockquote") {
                const content = this.#extractInlineHtml(node, imageRegistry);
                if (content.trim()) {
                    elements.push({
                        type: "quote",
                        tag: "blockquote",
                        content,
                        charCount: textContent.length,
                        lineNumber,
                        elementType: "q",
                        source: "epub",
                    });
                    if (fragmentToLine && filePath && node.id) {
                        fragmentToLine[`${filePath}#${node.id}`] = lineNumber;
                    }
                }
                continue;
            }

            // Paragraphs and divs
            if (["p", "div", "li", "td", "th", "dt", "dd"].includes(tag)) {
                const content = this.#extractInlineHtml(node, imageRegistry);
                if (content.trim()) {
                    elements.push({
                        type: "paragraph",
                        tag: "p",
                        content,
                        charCount: textContent.length,
                        lineNumber,
                        elementType: "p",
                        source: "epub",
                    });
                    if (fragmentToLine && filePath && node.id) {
                        fragmentToLine[`${filePath}#${node.id}`] = lineNumber;
                    }
                }
                continue;
            }

            // Preformatted blocks
            if (tag === "pre") {
                const content = node.textContent || "";
                elements.push({
                    type: "preformatted",
                    tag: "pre",
                    content,
                    charCount: content.length,
                    lineNumber,
                    elementType: "c",
                    source: "epub",
                });
                if (fragmentToLine && filePath && node.id) {
                    fragmentToLine[`${filePath}#${node.id}`] = lineNumber;
                }
                continue;
            }

            // Line breaks / horizontal rules
            if (tag === "br" || tag === "hr") {
                elements.push({
                    type: "empty",
                    tag: "span",
                    content: "",
                    charCount: 0,
                    lineNumber,
                    elementType: "e",
                    source: "epub",
                });
                continue;
            }

            // Default: treat as paragraph
            if (textContent.trim()) {
                const content = this.#extractInlineHtml(node, imageRegistry);
                elements.push({
                    type: "paragraph",
                    tag: "p",
                    content,
                    charCount: textContent.length,
                    lineNumber,
                    elementType: "p",
                    source: "epub",
                });
                if (fragmentToLine && filePath && node.id) {
                    fragmentToLine[`${filePath}#${node.id}`] = lineNumber;
                }
            }
        }

        return { elements, titles };
    }

    /**
     * Create a flat list of block-level elements from a container
     * Skips nested block elements to avoid double-counting
     * @param {Element} container
     * @returns {Element[]}
     */
    static #createBlockWalker(container) {
        const blockTags = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
            "blockquote", "ul", "ol", "li", "table", "tr", "td", "th",
            "dl", "dt", "dd", "figure", "figcaption", "pre", "hr", "br",
            "section", "article", "header", "footer", "nav", "aside"]);

        const result = [];
        const skipChildren = new Set();

        for (const child of container.children) {
            if (skipChildren.has(child)) continue;

            const tag = child.tagName?.toLowerCase();

            // Skip non-content containers
            if (["script", "style", "svg"].includes(tag)) continue;

            // Keep lists as whole blocks (processed as a "list" line type)
            if (tag === "ul" || tag === "ol") {
                result.push(child);
                continue;
            }

            // For definition lists
            if (tag === "dl") {
                for (const item of child.children) {
                    if (item.tagName?.toLowerCase() === "dt" || item.tagName?.toLowerCase() === "dd") {
                        result.push(item);
                        skipChildren.add(item);
                    }
                }
                continue;
            }

            // Keep tables as whole blocks
            if (tag === "table") {
                result.push(child);
                continue;
            }

            // For sections/articles/divs, recurse to get block children.
            // Divs are included here (not pushed whole) so that wrappers like
            // <div class="chapter"><p>...</p><ul>...</ul></div> preserve their
            // inner block structure instead of being flattened to one paragraph.
            // If recursion yields nothing (e.g. div with only inline text), fall
            // back to pushing the div itself so its content is still rendered.
            if (["section", "article", "header", "footer", "nav", "aside", "div"].includes(tag)) {
                const subItems = this.#createBlockWalker(child);
                if (subItems.length > 0) {
                    result.push(...subItems);
                } else {
                    result.push(child);
                }
                continue;
            }

            result.push(child);
        }

        return result;
    }

    /**
     * Extract table HTML, preserving only table/thead/tbody/tr/th/td structure.
     * @param {Node} node
     * @returns {string} HTML string
     */
    static #extractTableHtml(node, imageRegistry = null) {
        const serializeRow = (row) => {
            let html = "<tr>";
            for (const cell of row.querySelectorAll(":scope > th, :scope > td")) {
                const cellTag = cell.tagName.toLowerCase();
                const colspan = cell.getAttribute("colspan");
                const rowspan = cell.getAttribute("rowspan");
                let attrs = "";
                if (colspan && /^\d+$/.test(colspan)) attrs += ` colspan="${colspan}"`;
                if (rowspan && /^\d+$/.test(rowspan)) attrs += ` rowspan="${rowspan}"`;
                html += `<${cellTag}${attrs}>${this.#extractInlineHtml(cell, imageRegistry)}</${cellTag}>`;
            }
            html += "</tr>";
            return html;
        };

        let html = "<table>";
        for (const section of node.querySelectorAll(":scope > thead, :scope > tbody, :scope > tfoot")) {
            const sectionTag = section.tagName.toLowerCase();
            html += `<${sectionTag}>`;
            for (const row of section.querySelectorAll(":scope > tr")) {
                html += serializeRow(row);
            }
            html += `</${sectionTag}>`;
        }
        for (const row of node.querySelectorAll(":scope > tr")) {
            html += serializeRow(row);
        }
        html += "</table>";
        return html;
    }

    /**
     * Extract list HTML, preserving only ul/ol/li structure and inline marks.
     * @param {Node} node
     * @returns {string} HTML string
     */
    static #extractListHtml(node, imageRegistry = null) {
        const tag = node.tagName?.toLowerCase();
        if (tag !== "ul" && tag !== "ol") return "";

        let html = `<${tag}>`;
        for (const li of node.querySelectorAll(":scope > li")) {
            html += "<li>";
            for (const child of li.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    html += this.#escapeHtml(child.textContent);
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    const childTag = child.tagName?.toLowerCase();
                    if (childTag === "ul" || childTag === "ol") {
                        html += this.#extractListHtml(child, imageRegistry);
                    } else {
                        html += this.#extractInlineHtml(child, imageRegistry);
                    }
                }
            }
            html += "</li>";
        }
        html += `</${tag}>`;
        return html;
    }

    /**
     * Extract inline HTML from a node, preserving em/strong/a/b/i/u/sub/sup marks
     * @param {Node} node
     * @returns {string} HTML string
     */
    static #extractInlineHtml(node, imageRegistry = null) {
        const allowedTags = new Set(["em", "strong", "a", "b", "i", "u", "sub", "sup", "small", "mark", "span", "br", "img"]);

        let html = "";
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                html += this.#escapeHtml(child.textContent);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();

                // Inline image: substitute with an inlined data: URL when
                // available, otherwise drop it (no broken-image placeholder).
                if (tag === "img") {
                    const imgHtml = this.#renderInlineImage(child, imageRegistry);
                    if (imgHtml) html += imgHtml;
                    continue;
                }

                // Handle <br>
                if (tag === "br") {
                    html += "<br>";
                    continue;
                }

                if (allowedTags.has(tag)) {
                    // Preserve the tag with safe attributes
                    const attrs = this.#getSafeAttributes(child);
                    html += `<${tag}${attrs}>${this.#extractInlineHtml(child, imageRegistry)}</${tag}>`;
                } else {
                    // For non-allowed tags, just extract their text content
                    html += this.#extractInlineHtml(child, imageRegistry);
                }
            }
        }
        return html;
    }

    /**
     * Get safe HTML attributes from an element (class, href, title only).
     * Class values are filtered against a whitelist so an attacker-crafted
     * EPUB cannot inject arbitrary classes (e.g. "dropCap", "author") that
     * would hijack reader CSS.
     * @param {Element} el
     * @returns {string} Attribute string like ' class="foo" href="bar"'
     */
    static #getSafeAttributes(el) {
        const SAFE_CLASSES = new Set([
            "dropCap", "first", "noIndent", "author", "end-page", "synthetic-page", "title",
        ]);
        let attrs = "";
        const tag = el.tagName?.toLowerCase();
        const safeAttrs = ["class", "title"];
        for (const name of safeAttrs) {
            const val = el.getAttribute(name);
            if (val !== null && val !== "") {
                if (name === "class") {
                    const filtered = val.split(/\s+/).filter((c) => SAFE_CLASSES.has(c)).join(" ");
                    if (filtered) {
                        attrs += ` class="${this.#escapeHtml(filtered)}"`;
                    }
                } else {
                    attrs += ` ${name}="${this.#escapeHtml(val)}"`;
                }
            }
        }

        // href is allowed only for <a> with safe schemes
        const href = el.getAttribute("href");
        if (href !== null && tag === "a" && this.#isAllowedHref(href)) {
            attrs += ` href="${this.#escapeHtml(href)}"`;
        }

        // id is allowed only as a fragment anchor (e.g., <a id="note">)
        const id = el.getAttribute("id");
        if (id !== null && /^[a-zA-Z][\w\-:.]*$/.test(id)) {
            attrs += ` id="${this.#escapeHtml(id)}"`;
        }

        return attrs;
    }

    /**
     * Escape HTML special characters
     * @param {string} str
     * @returns {string}
     */
    static #escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /**
     * Check whether an href value is safe to preserve
     * @param {string} href
     * @returns {boolean}
     */
    static #isAllowedHref(href) {
        if (!href) return false;
        // Strip ASCII control chars and whitespace (0x00-0x20, 0x7f) before
        // scheme check: browsers strip these when navigating, so a value like
        // `java\nscript:alert(1)` would still execute as `javascript:`.
        const lower = href.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
        // Reject dangerous URL schemes
        const dangerousSchemes = ["javascript:", "data:", "vbscript:", "file:", "about:"];
        for (const scheme of dangerousSchemes) {
            if (lower.startsWith(scheme)) return false;
        }
        // Reject protocol-relative URLs (e.g. //evil.com) which would navigate
        // the reader tab to an external site on click.
        if (lower.startsWith("//")) return false;
        return true;
    }

    /**
     * Resolve a relative href against a base path within the EPUB
     * @param {string} href - Relative or absolute href
     * @param {string} basePath - The path of the referencing file
     * @returns {string} Resolved path relative to zip root
     */
    static #resolveHref(href, basePath) {
        // Reject dangerous hrefs early
        if (!this.#isAllowedHref(href)) return "";

        // Strip fragment identifiers
        const cleanHref = href.split("#")[0];
        if (!cleanHref) return basePath;

        // If already absolute (starts with /), use as-is (minus leading /)
        if (cleanHref.startsWith("/")) return cleanHref.substring(1);

        // Resolve relative to basePath's directory
        const baseDir = basePath.includes("/") ? basePath.substring(0, basePath.lastIndexOf("/")) : "";
        if (!baseDir) return cleanHref;

        // Simple path resolution
        const parts = (baseDir + "/" + cleanHref).split("/");
        const resolved = [];
        for (const part of parts) {
            if (part === "..") {
                resolved.pop();
            } else if (part !== "." && part !== "") {
                resolved.push(part);
            }
        }
        return resolved.join("/");
    }
}
