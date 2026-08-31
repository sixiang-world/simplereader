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
     * @returns {Promise<{source: Object, htmlLines: Array, titles: Array, titlesInd: Object, metadata: Object, spineBreaks: Array}>}
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
        const { htmlLines, titles: spineTitles, spineBreaks, fileToLine, fragmentToLine } = await this.#processSpine(zip, spine, manifest, opfPath);
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
                const [filePath, fragment] = resolved.split("#");
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
        return {
            source: { type: "epub", filename: file.name, size_bytes: buffer.byteLength },
            htmlLines,
            titles,
            titlesInd,
            metadata,
            spineBreaks,
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
        // Use getElementsByTagNameNS to handle namespaced elements (dc:title, dc:creator)
        const metadata = {};
        const getDcText = (tag, preferRole) => {
            const els = doc.getElementsByTagNameNS("*", tag);
            if (preferRole) {
                for (const el of els) {
                    const role = el.getAttributeNS("http://www.idpf.org/2007/opf", "role");
                    if (role === preferRole) return el.textContent?.trim() || "";
                }
            }
            return els[0]?.textContent?.trim() || "";
        };
        const getDcAll = (tag) => Array.from(doc.getElementsByTagNameNS("*", tag))
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
    /**
     * Resolve a spine manifest item to a processable HTML/XML item using OPF fallback chain.
     * @param {Object} item - Spine manifest item
     * @param {Object} manifest - Full manifest
     * @param {number} depth - Recursion guard
     * @returns {Object|null} Processable item or null
     */
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

    static async #processSpine(zip, spine, manifest, opfPath) {
        const htmlLines = [];
        const titles = [];
        const spineBreaks = [0]; // First page always starts at 0
        const fileToLine = {};   // {filePath: startLineNumber}
        const fragmentToLine = {}; // {filePath#id: lineNumber}
        const missingFiles = [];
        let lineNumber = 0;
        console.log(`[EPUB] Processing ${spine.length} spine items...`);
        for (const [idx, item] of spine.entries()) {
            const filePath = this.#resolveHref(item.href, opfPath);
            let file = zip.file(filePath);

            if (!file) {
                missingFiles.push(filePath);
                console.log(`[EPUB]   [${idx}] NOT FOUND: ${filePath}`);
                continue;
            }

            // Resolve fallback chain for non-HTML/XML spine items
            const effectiveItem = this.#resolveSpineItem(item, manifest);
            if (!effectiveItem) {
                console.log(`[EPUB]   [${idx}] SKIP: ${filePath} (${item.mediaType}, no HTML/XML fallback)`);
                continue;
            }

            const effectivePath = effectiveItem === item ? filePath : this.#resolveHref(effectiveItem.href, opfPath);
            if (effectiveItem !== item) {
                file = zip.file(effectivePath);
                if (!file) {
                    missingFiles.push(effectivePath);
                    console.log(`[EPUB]   [${idx}] NOT FOUND (fallback): ${effectivePath}`);
                    continue;
                }
                console.log(`[EPUB]   [${idx}] FALLBACK: ${filePath} → ${effectivePath}`);
            }

            // Record spine boundary (skip index 0 since spineBreaks already starts with 0)
            if (lineNumber > 0) {
                spineBreaks.push(lineNumber);
            }

            // Map the normalized file path to its starting line number for NCX matching
            fileToLine[effectivePath] = lineNumber;

            const xhtml = await file.async("text");
            const t1 = performance.now();
            const result = this.#processXhtml(xhtml, lineNumber, effectivePath, fragmentToLine);
            const elapsed = (performance.now() - t1).toFixed(1);

            htmlLines.push(...result.elements);
            titles.push(...result.titles);
            lineNumber += result.elements.length;

            if (result.elements.length > 0 || result.titles.length > 0) {
                console.log(`[EPUB]   [${idx}] ${effectivePath}: ${result.elements.length} els, ${result.titles.length} titles (${elapsed}ms)`);
            }
        }

        if (missingFiles.length > 0) {
            throw new Error(`Invalid EPUB: missing spine file(s): ${missingFiles.join(", ")}`);
        }

        return { htmlLines, titles, spineBreaks, fileToLine, fragmentToLine };
    }

    /**
     * Process a single XHTML file into structure objects
     * @param {string} xhtml - The XHTML content
     * @param {number} lineOffset - Starting line number
     * @param {string} [filePath] - Path of the XHTML file within the EPUB
     * @param {Object} [fragmentToLine] - Map to populate with file#id → lineNumber
     * @returns {{elements: Array, titles: Array}}
     */
    static #processXhtml(xhtml, lineOffset, filePath, fragmentToLine) {
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
            if (["script", "style", "svg", "img", "figure", "figcaption"].includes(tag)) continue;

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
                const content = this.#extractTableHtml(node);
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
                const content = this.#extractListHtml(node);
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
                const content = this.#extractInlineHtml(node);
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
                const content = this.#extractInlineHtml(node);
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
                const content = this.#extractInlineHtml(node);
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
     * Extract table HTML, preserving only table/thead/tbody/tr/th/td structure.
     * @param {Node} node
     * @returns {string} HTML string
     */
    static #extractTableHtml(node) {
        const serializeRow = (row) => {
            let html = "<tr>";
            for (const cell of row.querySelectorAll(":scope > th, :scope > td")) {
                const cellTag = cell.tagName.toLowerCase();
                const colspan = cell.getAttribute("colspan");
                const rowspan = cell.getAttribute("rowspan");
                let attrs = "";
                if (colspan && /^\d+$/.test(colspan)) attrs += ` colspan="${colspan}"`;
                if (rowspan && /^\d+$/.test(rowspan)) attrs += ` rowspan="${rowspan}"`;
                html += `<${cellTag}${attrs}>${this.#extractInlineHtml(cell)}</${cellTag}>`;
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
    static #extractListHtml(node) {
        const tag = node.tagName?.toLowerCase();
        if (tag !== "ul" && tag !== "ol") return "";

        let html = `<${tag}>`;
        for (const li of node.querySelectorAll(":scope > li")) {
            html += "<li>";
            // Nested lists
            for (const child of li.children) {
                const childTag = child.tagName?.toLowerCase();
                if (childTag === "ul" || childTag === "ol") {
                    html += this.#extractListHtml(child);
                } else {
                    html += this.#extractInlineHtml(child);
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
        const tag = el.tagName?.toLowerCase();
        const safeAttrs = ["class", "title"];
        for (const name of safeAttrs) {
            const val = el.getAttribute(name);
            if (val !== null) {
                attrs += ` ${name}="${this.#escapeHtml(val)}"`;
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
        const lower = href.trim().toLowerCase();
        // Reject dangerous URL schemes
        const dangerousSchemes = ["javascript:", "data:", "vbscript:", "file:", "about:"];
        for (const scheme of dangerousSchemes) {
            if (lower.startsWith(scheme)) return false;
        }
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
