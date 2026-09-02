/**
 * @fileoverview TextProcessorDOM module for handling DOM-related text processing tasks.
 * This class is designed to run in the main thread and perform all UI-related processing,
 * using data provided by TextProcessorCore.
 *
 * @module client/src/modules/text/text-processor-dom
 * @requires client/src/modules/features/reader
 */

import { reader } from "../reader/reader.js";

/**
 * @class TextProcessorDOM
 * @description Class for creating DOM elements from text processing structures.
 */
export class TextProcessorDOM {
    /**
     * Create DOM element from structure
     * @param {Object} structure - The structure object containing type, tag, content, lineNumber, elementType, dropCap, and className.
     * @returns {Array} An array containing the created DOM element and its type.
     * @public
     */
    static createFromStructure(structure) {
        const { type, tag, content, lineNumber, elementType, dropCap, className, source, synthetic } = structure;

        // Helper to set data-line-num on an element
        const setLineNum = (el) => {
            if (lineNumber !== undefined && lineNumber !== null) {
                el.setAttribute("data-line-num", lineNumber);
            }
            return el;
        };

        switch (type) {
            case "title": {
                if (synthetic) {
                    // Synthetic title/end pages: render the provided HTML safely.
                    const wrapper = document.createElement("div");
                    wrapper.innerHTML = this.#sanitizeHtml(content);
                    const container = document.createElement("div");
                    container.id = `line${lineNumber}`;
                    container.setAttribute("data-source", "epub");
                    container.classList.add("synthetic-page");
                    for (const child of [...wrapper.children]) {
                        container.appendChild(child);
                    }
                    return [setLineNum(container), elementType];
                }

                // content is expected to be a structural HTML tag like <h1>...</h1> or <span>...</span>.
                // Parse via a detached template to avoid executing inline event handlers or <script>.
                const wrapper = document.createElement("div");
                wrapper.innerHTML = source === "epub" ? this.#sanitizeHtml(content) : content;
                // Drop any element that isn't h1/span (the only structural tags the title branch
                // is designed to handle); this also removes <script>, <img onerror=...>, etc.
                for (const node of [...wrapper.children]) {
                    const t = node.tagName.toLowerCase();
                    if (t !== "h1" && t !== "span") {
                        node.remove();
                    }
                }
                // Force the wrapper's text into a fresh element to neutralize any attributes
                // (e.g. onload/onerror) that survived the whitelist.
                const tempElement = wrapper.firstElementChild
                    ? (() => {
                          const clean = document.createElement(wrapper.firstElementChild.tagName.toLowerCase());
                          clean.textContent = wrapper.firstElementChild.textContent;
                          return clean;
                      })()
                    : (() => {
                          const clean = document.createElement("span");
                          clean.textContent = wrapper.textContent;
                          return clean;
                      })();
                const tempAnchor = document.createElement("a");
                tempAnchor.href = `#line${lineNumber}`;
                tempAnchor.classList.add("prevent-select", "title");
                if (source === "epub" && wrapper.firstElementChild) {
                    tempAnchor.innerHTML = this.#stripColonsFromHtml(wrapper.firstElementChild.innerHTML);
                } else {
                    tempAnchor.textContent = tempElement.textContent;
                }
                this.#addTitleClickHandler(tempAnchor);
                tempElement.innerHTML = "";
                tempElement.appendChild(tempAnchor);
                return [setLineNum(tempElement), elementType];
            }

            case "heading": {
                const tempAnchor = document.createElement("a");
                tempAnchor.href = `#line${lineNumber}`;
                tempAnchor.classList.add("prevent-select", "title");
                // For EPUB, content is an inline-HTML string; sanitize it and
                // preserve whitelisted inline markup (em/strong/etc.) in the
                // rendered heading. For TXT, content is plain text and the
                // escape is a no-op.
                if (source === "epub") {
                    tempAnchor.innerHTML = this.#stripColonsFromHtml(this.#sanitizeHtml(content));
                } else {
                    tempAnchor.textContent = this.#escapeHtml(content.replace(/:/g, "").replace(/：/g, ""));
                }
                this.#addTitleClickHandler(tempAnchor);
                const tempH2 = document.createElement("h2");
                tempH2.id = `line${lineNumber}`;
                tempH2.appendChild(tempAnchor);
                return [setLineNum(tempH2), elementType];
            }

            case "paragraph": {
                const tempP = document.createElement("p");
                tempP.id = `line${lineNumber}`;
                if (className) {
                    tempP.classList.add(className);
                }
                if (source === "epub") {
                    tempP.setAttribute("data-source", "epub");
                }

                if (dropCap) {
                    const tempSpan = document.createElement("span");
                    tempSpan.classList.add("dropCap");
                    tempSpan.innerText = dropCap.content;
                    tempP.appendChild(tempSpan);
                    if (source === "epub") {
                        tempP.insertAdjacentHTML("beforeend", this.#sanitizeHtml(content));
                    } else {
                        // Escape before assigning to innerHTML to prevent injected markup from running.
                        tempP.insertAdjacentHTML("beforeend", this.#escapeHtml(content));
                    }
                } else {
                    if (source === "epub") {
                        tempP.innerHTML = this.#sanitizeHtml(content);
                    } else {
                        tempP.textContent = content;
                    }
                }
                return [setLineNum(tempP), elementType];
            }

            case "list": {
                const tempDiv = document.createElement("div");
                tempDiv.id = `line${lineNumber}`;
                tempDiv.setAttribute("data-source", "epub");
                tempDiv.innerHTML = this.#sanitizeHtml(content);
                return [setLineNum(tempDiv), elementType];
            }

            case "quote": {
                const tempBlockquote = document.createElement("blockquote");
                tempBlockquote.id = `line${lineNumber}`;
                tempBlockquote.setAttribute("data-source", "epub");
                tempBlockquote.innerHTML = this.#sanitizeHtml(content);
                return [setLineNum(tempBlockquote), elementType];
            }

            case "preformatted": {
                const tempPre = document.createElement("pre");
                tempPre.id = `line${lineNumber}`;
                tempPre.setAttribute("data-source", "epub");
                tempPre.textContent = content;
                return [setLineNum(tempPre), elementType];
            }

            case "table": {
                const tempTable = document.createElement("table");
                tempTable.id = `line${lineNumber}`;
                tempTable.setAttribute("data-source", "epub");
                tempTable.innerHTML = this.#sanitizeHtml(content);
                return [setLineNum(tempTable), elementType];
            }

            case "empty":
            default: {
                const tempSpan = document.createElement("span");
                tempSpan.id = `line${lineNumber}`;
                tempSpan.textContent = content;
                return [setLineNum(tempSpan), elementType];
            }
        }
    }

    /**
     * Escape a string for safe insertion as HTML text content.
     * @param {string} str - Raw string to escape.
     * @returns {string} Escaped string safe to use in innerHTML/insertAdjacentHTML.
     * @private
     */
    static #escapeHtml(str) {
        if (str == null) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /**
     * Strip colon-like characters from text nodes in an HTML fragment while
     * leaving attributes intact. Used for chapter anchors where the original
     * TXT pipeline removed colons from TOC labels.
     * @param {string} html - Raw HTML string.
     * @returns {string} HTML string with colons removed from text nodes.
     * @private
     */
    static #stripColonsFromHtml(html) {
        if (html == null) return "";
        const temp = document.createElement("div");
        temp.innerHTML = html;
        const strip = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = node.textContent.replace(/:/g, "").replace(/：/g, "");
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                for (const child of node.childNodes) strip(child);
            }
        };
        for (const child of temp.childNodes) strip(child);
        return temp.innerHTML;
    }

    /**
     * Sanitize inline HTML for EPUB paragraphs.
     * Only allows a small whitelist of inline tags and safe attributes.
     * @param {string} html - Raw HTML string.
     * @returns {string} Sanitized HTML string.
     * @private
     */
    static #sanitizeHtml(html) {
        if (html == null) return "";
        const allowedTags = new Set([
            "em", "strong", "b", "i", "u", "a", "span", "small", "sub", "sup", "mark", "br",
            "code", "kbd", "samp",
            "ul", "ol", "li",
            "blockquote",
            "pre",
            "table", "thead", "tbody", "tfoot", "tr", "th", "td",
            "h1", "h2", "h3", "h4", "h5", "h6", "p",
        ]);
        // Parse the snippet in a detached <div>. This works reliably across
        // browsers and lightweight Node DOM implementations (e.g. linkedom) and
        // does not execute inline scripts.
        const temp = document.createElement("div");
        temp.innerHTML = html;

        const cleanNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return document.createTextNode(node.textContent);
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return null;
            }
            const tag = node.tagName.toLowerCase();
            // Drop executable/style content entirely.
            if (tag === "script" || tag === "style" || tag === "noscript") return null;
            if (!allowedTags.has(tag)) {
                const frag = document.createDocumentFragment();
                for (const child of node.childNodes) {
                    const cleaned = cleanNode(child);
                    if (cleaned) frag.appendChild(cleaned);
                }
                return frag;
            }
            const el = document.createElement(tag);
            if (tag === "a") {
                const href = node.getAttribute("href");
                let safe = false;
                if (href) {
                    // Strip ASCII control chars and whitespace (0x00-0x20, 0x7f)
                    // before scheme check: browsers strip these when navigating,
                    // so `java\nscript:alert(1)` would still execute as
                    // `javascript:`. Compare the cleaned value, but keep the
                    // original href verbatim when emitting.
                    const lower = href.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
                    // Reject protocol-relative URLs (//evil.com) — they navigate
                    // the reader tab to an external site on click.
                    if (lower.startsWith("//")) {
                        safe = false;
                    } else {
                        safe = lower.startsWith("http:") || lower.startsWith("https:") || lower.startsWith("mailto:") || lower.startsWith("#") || !/^[a-z][a-z0-9+.-]*:/i.test(lower);
                    }
                    if (safe) {
                        el.setAttribute("href", href);
                        // For external links, open in a new tab and cut the
                        // opener relationship to prevent reverse tabnabbing.
                        if (lower.startsWith("http:") || lower.startsWith("https:") || lower.startsWith("mailto:")) {
                            el.setAttribute("target", "_blank");
                            el.setAttribute("rel", "noopener noreferrer");
                        }
                    }
                }
                const title = node.getAttribute("title");
                if (title) el.setAttribute("title", title);
                if (!safe) {
                    // Unsafe href: unwrap to plain text rather than keep a bare <a>.
                    const frag = document.createDocumentFragment();
                    for (const child of node.childNodes) {
                        const cleaned = cleanNode(child);
                        if (cleaned) frag.appendChild(cleaned);
                    }
                    return frag;
                }
            }
            if (tag === "th" || tag === "td") {
                const colspan = node.getAttribute("colspan");
                const rowspan = node.getAttribute("rowspan");
                if (colspan && /^\d+$/.test(colspan)) el.setAttribute("colspan", colspan);
                if (rowspan && /^\d+$/.test(rowspan)) el.setAttribute("rowspan", rowspan);
            }
            const cls = node.getAttribute("class");
            if (cls) {
                // Filter class values against a whitelist so EPUB-injected
                // classes cannot hijack reader CSS (e.g. "dropCap", "author").
                const SAFE_CLASSES = new Set([
                    "dropCap", "first", "noIndent", "author", "end-page", "synthetic-page", "title",
                ]);
                const filtered = cls.split(/\s+/).filter((c) => SAFE_CLASSES.has(c)).join(" ");
                if (filtered) el.setAttribute("class", filtered);
            }
            for (const child of node.childNodes) {
                const cleaned = cleanNode(child);
                if (cleaned) el.appendChild(cleaned);
            }
            return el;
        };

        const container = document.createElement("div");
        for (const child of temp.childNodes) {
            const cleaned = cleanNode(child);
            if (cleaned) container.appendChild(cleaned);
        }
        return container.innerHTML;
    }

    /**
     * Add click handler to title anchor
     * @param {HTMLAnchorElement} anchor - The anchor element to add the click handler to.
     * @private
     */
    static #addTitleClickHandler(anchor) {
        anchor.addEventListener("click", async function (e) {
            e.preventDefault();
            const lineID = parseInt(this.parentElement.id.slice(4));
            await reader.gotoChapterTitleLine(lineID);
        });
    }
}
