/**
 * @fileoverview EPUB Converter module for extracting content from EPUB files
 *
 * Converts EPUB files into SimpleTextReader's internal content structure
 * (FILE_CONTENT_CHUNKS + ALL_TITLES format) so all existing rendering,
 * pagination, TOC, and reading features work automatically.
 *
 * @module client/app/modules/epub/epub-converter
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
     * @returns {Promise<{htmlLines: Array, titles: Array, titlesInd: Object, metadata: Object}>}
     */
    static async convert(file) {
        const t0 = performance.now();
        console.log("[EPUB] Starting conversion...");

        // 1. Unzip
        console.log("[EPUB] Unzipping...");
        const buffer = await file.arrayBuffer();
        console.log(`[EPUB] File size: ${(buffer.byteLength / 1024).toFixed(0)}KB`);
        const zip = await JSZip.loadAsync(buffer);
        console.log(`[EPUB] Unzipped: ${Object.keys(zip.files).length} files`);

        // 2. Parse container → find OPF path
        console.log("[EPUB] Parsing container.xml...");
        const opfPath = await this.#parseContainer(zip);
        console.log(`[EPUB] OPF path: ${opfPath}`);

        // 3. Parse OPF → metadata, manifest, spine
        console.log("[EPUB] Parsing OPF...");
        const { metadata, manifest, spine } = await this.#parseOpf(zip, opfPath);
        console.log(`[EPUB] Spine: ${spine.length} items, Manifest: ${Object.keys(manifest).length} items`);

        // 4. Parse TOC (EPUB3 nav or EPUB2 NCX)
        console.log("[EPUB] Parsing TOC...");
        const tocEntries = await this.#parseToc(zip, manifest, opfPath);
        console.log(`[EPUB] TOC entries: ${tocEntries.length}`);

        // 5. Process spine items in order
        console.log("[EPUB] Processing spine...");
        const { htmlLines, titles: spineTitles, spineBreaks, fileToLine } = await this.#processSpine(zip, spine, manifest, opfPath);
        console.log(`[EPUB] Spine done: ${htmlLines.length} lines, ${spineTitles.length} titles, ${spineBreaks.length} spine breaks`);

        // 6. Build titles from NCX/TOC entries (using fileToLine mapping)
        //    Prefer NCX titles over auto-detected ones when available
        let titles;
        if (tocEntries.length > 0) {
            console.log(`[EPUB] Mapping ${tocEntries.length} TOC entries to line numbers...`);
            titles = [];
            const seenLines = new Set();
            for (const entry of tocEntries) {
                // Resolve the entry href relative to OPF path
                const resolved = this.#resolveHref(entry.href, opfPath);
                const normalized = resolved.split("#")[0];
                const lineNum = fileToLine[normalized];
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
            console.log(`[EPUB] TOC mapping produced ${titles.length} titles (${tocEntries.length - titles.length} unmapped)`);
        } else {
            titles = spineTitles;
        }

        // 7. Build titlesInd
        console.log("[EPUB] Building titlesInd...");
        const titlesInd = {};
        for (let i = 0; i < titles.length; i++) {
            titlesInd[titles[i][1]] = i;
        }

        const elapsed = performance.now() - t0;
        console.log(`[EPUB] Conversion complete in ${elapsed.toFixed(0)}ms`);
        return { htmlLines, titles, titlesInd, metadata, spineBreaks };
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
        // Use getElementsByTagNameNS to handle namespaced elements (dc:title, dc:creator)
        const metadata = {};
        const titleEl = doc.getElementsByTagNameNS("*", "title")[0];
        const creatorEl = doc.getElementsByTagNameNS("*", "creator")[0];
        metadata.title = titleEl?.textContent?.trim() || "";
        metadata.author = creatorEl?.textContent?.trim() || "";

        // --- Manifest ---
        // Use getElementsByTagNameNS("*", ...) to handle namespaced OPF (default xmlns)
        const manifest = {};
        const manifestEl = doc.getElementsByTagNameNS("*", "manifest")[0];
        const manifestItems = manifestEl ? manifestEl.getElementsByTagNameNS("*", "item") : doc.getElementsByTagNameNS("*", "item");
        for (const item of manifestItems) {
            const id = item.getAttribute("id");
            const href = item.getAttribute("href");
            const mediaType = item.getAttribute("media-type");
            if (id && href) {
                manifest[id] = { href, mediaType };
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
        // Try EPUB3 nav first
        const navEntry = Object.values(manifest).find(
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

        // Find <nav epub:type="toc">
        const navEl = doc.querySelector('nav[*|type="toc"]') || doc.querySelector("nav");
        if (!navEl) return [];

        const entries = [];
        const links = navEl.querySelectorAll("a, span");
        for (const link of links) {
            const href = link.getAttribute("href");
            const label = link.textContent?.trim();
            if (href && label) {
                entries.push({ label, href: this.#resolveHref(href, navPath) });
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
                    entries.push({ label, href: this.#resolveHref(src, opfPath) });
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
    static async #processSpine(zip, spine, manifest, opfPath) {
        const htmlLines = [];
        const titles = [];
        const spineBreaks = [0]; // First page always starts at 0
        const fileToLine = {};   // {filePath: startLineNumber}
        let lineNumber = 0;
        console.log(`[EPUB] Processing ${spine.length} spine items...`);
        for (const [idx, item] of spine.entries()) {
            const filePath = this.#resolveHref(item.href, opfPath);
            const file = zip.file(filePath);

            if (!file) {
                console.log(`[EPUB]   [${idx}] NOT FOUND: ${filePath}`);
                continue;
            }
            // Only process XHTML content
            if (!item.mediaType || (!item.mediaType.includes("html") && !item.mediaType.includes("xml"))) {
                console.log(`[EPUB]   [${idx}] SKIP: ${filePath} (${item.mediaType})`);
                continue;
            }

            // Record spine boundary (skip index 0 since spineBreaks already starts with 0)
            if (lineNumber > 0) {
                spineBreaks.push(lineNumber);
            }

            // Map the normalized file path to its starting line number for NCX matching
            fileToLine[filePath] = lineNumber;

            const xhtml = await file.async("text");
            const t1 = performance.now();
            const result = this.#processXhtml(xhtml, lineNumber);
            const elapsed = (performance.now() - t1).toFixed(1);

            htmlLines.push(...result.elements);
            titles.push(...result.titles);
            lineNumber += result.elements.length;

            if (result.elements.length > 0 || result.titles.length > 0) {
                console.log(`[EPUB]   [${idx}] ${filePath}: ${result.elements.length} els, ${result.titles.length} titles (${elapsed}ms)`);
            }
        }

        return { htmlLines, titles, spineBreaks, fileToLine };
    }

    /**
     * Process a single XHTML file into structure objects
     * @param {string} xhtml - The XHTML content
     * @param {number} lineOffset - Starting line number
     * @returns {{elements: Array, titles: Array}}
     */
    static #processXhtml(xhtml, lineOffset) {
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

            // Skip empty elements
            if (!textContent && tag !== "br" && tag !== "hr") continue;

            // Skip non-content elements
            if (["script", "style", "svg", "img", "table", "figure", "figcaption"].includes(tag)) continue;

            const lineNumber = lineOffset + elements.length;

            // Headings
            if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
                const content = this.#extractInlineHtml(node);
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
                    });
                    titles.push([textContent, lineNumber, textContent, false]);
                }
                continue;
            }

            // Paragraphs and divs
            if (["p", "div", "blockquote", "li", "td", "th", "dt", "dd"].includes(tag)) {
                const content = this.#extractInlineHtml(node);
                if (content.trim()) {
                    elements.push({
                        type: "paragraph",
                        tag: "p",
                        content,
                        charCount: textContent.length,
                        lineNumber,
                        elementType: "p",
                    });
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
                });
                continue;
            }

            // Default: treat as paragraph
            if (textContent.trim()) {
                const content = this.#extractInlineHtml(node);
                elements.push({
                    type: "paragraph",
                    tag: "p",
                    content,
                    charCount: textContent.length,
                    lineNumber,
                    elementType: "p",
                });
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

            // For lists, extract individual items
            if (tag === "ul" || tag === "ol") {
                for (const li of child.querySelectorAll("li")) {
                    result.push(li);
                    skipChildren.add(li);
                }
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

            // For tables, extract cell content as paragraphs
            if (tag === "table") {
                for (const cell of child.querySelectorAll("td, th")) {
                    result.push(cell);
                    skipChildren.add(cell);
                }
                continue;
            }

            // For sections/articles, recurse to get block children
            if (["section", "article", "header", "footer", "nav", "aside"].includes(tag)) {
                const subItems = this.#createBlockWalker(child);
                result.push(...subItems);
                continue;
            }

            result.push(child);
        }

        return result;
    }

    /**
     * Extract inline HTML from a node, preserving em/strong/a/b/i/u/sub/sup marks
     * @param {Node} node
     * @returns {string} HTML string
     */
    static #extractInlineHtml(node) {
        const allowedTags = new Set(["em", "strong", "a", "b", "i", "u", "sub", "sup", "small", "mark", "span", "br"]);

        let html = "";
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                html += this.#escapeHtml(child.textContent);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();

                // Skip images
                if (tag === "img") continue;

                // Handle <br>
                if (tag === "br") {
                    html += "<br>";
                    continue;
                }

                if (allowedTags.has(tag)) {
                    // Preserve the tag with safe attributes
                    const attrs = this.#getSafeAttributes(child);
                    html += `<${tag}${attrs}>${this.#extractInlineHtml(child)}</${tag}>`;
                } else {
                    // For non-allowed tags, just extract their text content
                    html += this.#extractInlineHtml(child);
                }
            }
        }
        return html;
    }

    /**
     * Get safe HTML attributes from an element (class, href, title only)
     * @param {Element} el
     * @returns {string} Attribute string like ' class="foo" href="bar"'
     */
    static #getSafeAttributes(el) {
        let attrs = "";
        const safeAttrs = ["class", "href", "title", "id"];
        for (const name of safeAttrs) {
            const val = el.getAttribute(name);
            if (val !== null) {
                attrs += ` ${name}="${this.#escapeHtml(val)}"`;
            }
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
     * Resolve a relative href against a base path within the EPUB
     * @param {string} href - Relative or absolute href
     * @param {string} basePath - The path of the referencing file
     * @returns {string} Resolved path relative to zip root
     */
    static #resolveHref(href, basePath) {
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
