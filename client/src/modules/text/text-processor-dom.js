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
        const { type, tag, content, lineNumber, elementType, dropCap, className, source } = structure;

        // Helper to set data-line-num on an element
        const setLineNum = (el) => {
            if (lineNumber !== undefined && lineNumber !== null) {
                el.setAttribute("data-line-num", lineNumber);
            }
            return el;
        };

        switch (type) {
            case "title": {
                // content is expected to be a structural HTML tag like <h1>...</h1> or <span>...</span>.
                // Parse via a detached template to avoid executing inline event handlers or <script>.
                const wrapper = document.createElement("div");
                wrapper.innerHTML = content;
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
                tempAnchor.textContent = tempElement.textContent;
                this.#addTitleClickHandler(tempAnchor);
                tempElement.innerHTML = "";
                tempElement.appendChild(tempAnchor);
                return [setLineNum(tempElement), elementType];
            }

            case "heading": {
                const tempAnchor = document.createElement("a");
                tempAnchor.href = `#line${lineNumber}`;
                tempAnchor.classList.add("prevent-select", "title");
                tempAnchor.textContent = this.#escapeHtml(content.replace(":", "").replace("：", ""));
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
     * Sanitize inline HTML for EPUB paragraphs.
     * Only allows a small whitelist of inline tags and safe attributes.
     * @param {string} html - Raw HTML string.
     * @returns {string} Sanitized HTML string.
     * @private
     */
    static #sanitizeHtml(html) {
        if (html == null) return "";
        const allowedTags = new Set(["em", "strong", "b", "i", "u", "a", "span", "small", "sub", "sup", "mark", "br", "code", "kbd", "samp"]);
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
        const root = doc.body.firstElementChild;
        if (!root) return this.#escapeHtml(html);

        const cleanNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return document.createTextNode(node.textContent);
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return null;
            }
            const tag = node.tagName.toLowerCase();
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
                if (href) {
                    const lower = href.trim().toLowerCase();
                    const safe = lower.startsWith("http:") || lower.startsWith("https:") || lower.startsWith("mailto:") || lower.startsWith("#") || !/^[a-z][a-z0-9+.-]*:/i.test(href);
                    if (safe) el.setAttribute("href", href);
                }
                const title = node.getAttribute("title");
                if (title) el.setAttribute("title", title);
            }
            const cls = node.getAttribute("class");
            if (cls) el.setAttribute("class", cls);
            for (const child of node.childNodes) {
                const cleaned = cleanNode(child);
                if (cleaned) el.appendChild(cleaned);
            }
            return el;
        };

        const container = document.createElement("div");
        for (const child of root.childNodes) {
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
