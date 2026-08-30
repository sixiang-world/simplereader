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
        const { type, tag, content, lineNumber, elementType, dropCap, className } = structure;

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

                if (dropCap) {
                    const tempSpan = document.createElement("span");
                    tempSpan.classList.add("dropCap");
                    tempSpan.innerText = dropCap.content;
                    tempP.appendChild(tempSpan);
                    // Escape before assigning to innerHTML to prevent injected markup from running.
                    tempP.insertAdjacentHTML("beforeend", this.#escapeHtml(content));
                } else {
                    tempP.textContent = content;
                }
                return [setLineNum(tempP), elementType];
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
