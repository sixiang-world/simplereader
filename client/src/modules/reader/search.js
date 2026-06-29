/**
 * @fileoverview Full text search module
 *
 * Provides a search dialog for finding text within the loaded document.
 * Supports regex search with forward/backward navigation and match highlighting.
 * Ported from simplereader-enhance's showSearch() and adapted for cnb's
 * ES modules architecture and structured FILE_CONTENT_CHUNKS.
 *
 * @module client/app/modules/features/search
 * @requires client/app/config/index
 * @requires client/app/utils/helpers-reader
 * @requires client/app/modules/features/flow-reader
 */

import * as CONFIG from "../../config/index.js";
import { setHistory } from "../../utils/helpers-reader.js";
import { flowReader } from "./flow-reader.js";

/** @type {HTMLElement|null} The search dialog element */
let searchDlg = null;

/** @type {number} Line number where next search should start */
let searchStartLine = 0;

/** @type {Element|null} Currently highlighted element */
let currentHighlight = null;

/**
 * Search module
 * @namespace
 */
export const search = {
    /**
     * Show the search dialog
     */
    showDialog() {
        // Prevent duplicate dialogs
        if (searchDlg) return;

        searchDlg = document.createElement("div");
        searchDlg.id = "searchDlg";
        searchDlg.innerHTML = `
            <div class="search-header">
                <span>全文搜索</span>
                <button class="close-btn" title="关闭 (Esc)">✕</button>
            </div>
            <div class="search-body">
                <input type="text" class="search-txt" placeholder="输入搜索内容（支持正则）" />
                <button class="search-btn search-up" title="向上搜索">▲</button>
                <button class="search-btn search-down" title="向下搜索">▼</button>
            </div>
        `;

        document.body.appendChild(searchDlg);

        const input = searchDlg.querySelector(".search-txt");
        const btnClose = searchDlg.querySelector(".close-btn");
        const btnUp = searchDlg.querySelector(".search-up");
        const btnDown = searchDlg.querySelector(".search-down");

        // Focus input
        setTimeout(() => input.focus(), 50);

        // Event handlers
        btnClose.addEventListener("click", () => this.close());
        btnUp.addEventListener("click", () => doSearch(false));
        btnDown.addEventListener("click", () => doSearch(true));
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                doSearch(true);
            } else if (e.key === "Escape") {
                e.preventDefault();
                this.close();
            }
        });

        // Store reference to the original onkeydown
        const savedKeydown = document.onkeydown;
        document.onkeydown = (e) => {
            if (e.key === "Escape") {
                this.close();
            }
        };
        searchDlg._savedKeydown = savedKeydown;
    },

    /**
     * Close the search dialog and clean up
     */
    close() {
        if (!searchDlg) return;

        this.clearHighlight();

        // Restore original keydown handler
        if (searchDlg._savedKeydown) {
            document.onkeydown = searchDlg._savedKeydown;
        }

        searchDlg.remove();
        searchDlg = null;
        searchStartLine = 0;
    },

    /**
     * Clear the current search highlight
     */
    clearHighlight() {
        if (currentHighlight) {
            const mark = currentHighlight.querySelector("mark");
            if (mark) {
                mark.replaceWith(document.createTextNode(mark.textContent));
            }
            currentHighlight = null;
        }
    },
};

/**
 * Perform search in FILE_CONTENT_CHUNKS
 * @param {boolean} down - Search direction (true = forward, false = backward)
 */
function doSearch(down = true) {
    if (!searchDlg) return;

    const input = searchDlg.querySelector(".search-txt");
    const pattern = input.value.trim();
    if (!pattern) return;

    let regex;
    try {
        regex = new RegExp(pattern, "gi");
    } catch (e) {
        // Invalid regex — try as literal string
        try {
            regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        } catch (e2) {
            return;
        }
    }

    const chunks = CONFIG.VARS.FILE_CONTENT_CHUNKS;
    const totalLines = chunks.length;
    if (totalLines === 0) return;

    // Clear previous highlight
    search.clearHighlight();

    // Search through content chunks
    let found = false;
    if (down) {
        // Forward search from searchStartLine
        for (let j = searchStartLine + 1; j < totalLines; j++) {
            const chunk = chunks[j];
            const text = typeof chunk === "object" ? chunk.content : chunk;
            if (text && regex.test(text)) {
                regex.lastIndex = 0; // Reset regex state
                navigateToLine(j);
                highlightLine(j, regex);
                searchStartLine = j;
                found = true;
                break;
            }
        }
        // Wrap around
        if (!found) {
            for (let j = 0; j <= searchStartLine; j++) {
                const chunk = chunks[j];
                const text = typeof chunk === "object" ? chunk.content : chunk;
                if (text && regex.test(text)) {
                    regex.lastIndex = 0;
                    navigateToLine(j);
                    highlightLine(j, regex);
                    searchStartLine = j;
                    found = true;
                    break;
                }
            }
        }
    } else {
        // Backward search from searchStartLine
        for (let j = searchStartLine - 1; j >= 0; j--) {
            const chunk = chunks[j];
            const text = typeof chunk === "object" ? chunk.content : chunk;
            if (text && regex.test(text)) {
                regex.lastIndex = 0;
                navigateToLine(j);
                highlightLine(j, regex);
                searchStartLine = j;
                found = true;
                break;
            }
        }
        // Wrap around
        if (!found) {
            for (let j = totalLines - 1; j >= searchStartLine; j--) {
                const chunk = chunks[j];
                const text = typeof chunk === "object" ? chunk.content : chunk;
                if (text && regex.test(text)) {
                    regex.lastIndex = 0;
                    navigateToLine(j);
                    highlightLine(j, regex);
                    searchStartLine = j;
                    found = true;
                    break;
                }
            }
        }
    }
}

/**
 * Navigate to a specific line (handles both flow and page mode)
 * @param {number} lineNumber
 */
function navigateToLine(lineNumber) {
    if (flowReader.isActive()) {
        flowReader.gotoLine(lineNumber, false);
    } else {
        // Page mode: find which page contains the line and navigate
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        let targetPage = 1;
        for (let i = 0; i < pageBreaks.length - 1; i++) {
            if (lineNumber >= pageBreaks[i] && lineNumber < pageBreaks[i + 1]) {
                targetPage = i + 1;
                break;
            }
        }
        if (lineNumber >= (pageBreaks[pageBreaks.length - 1] || 0)) {
            targetPage = CONFIG.VARS.TOTAL_PAGES;
        }

        // Import reader dynamically to avoid circular dependency
        import("./reader.js").then(({ reader }) => {
            if (targetPage !== CONFIG.VARS.CURRENT_PAGE) {
                reader.gotoPage(targetPage, "top");
            }
            const el = CONFIG.DOM_ELEMENT.GET_LINE(lineNumber);
            if (el) {
                el.scrollIntoView({ behavior: "instant", block: "start" });
            }
        });
    }
    setHistory(CONFIG.VARS.FILENAME, lineNumber);
}

/**
 * Highlight a matched line with <mark> tags
 * @param {number} lineNumber
 * @param {RegExp} regex
 */
function highlightLine(lineNumber, regex) {
    const el = CONFIG.DOM_ELEMENT.GET_LINE(lineNumber);
    if (!el) return;

    currentHighlight = el;
    const originalHTML = el.innerHTML;
    // Replace matches with <mark> wrapped text
    const highlighted = originalHTML.replace(regex, (match) => `<mark>${match}</mark>`);
    el.innerHTML = highlighted;
}
