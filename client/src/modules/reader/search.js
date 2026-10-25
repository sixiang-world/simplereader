/**
 * @fileoverview Full text search module
 *
 * Provides a search dialog for finding text within the loaded document.
 * Supports regex search with forward/backward navigation and match highlighting.
 * Ported from simplereader-enhance's showSearch() and adapted for cnb's
 * ES modules architecture and structured FILE_CONTENT_CHUNKS.
 *
 * @module client/src/modules/features/search
 * @requires client/src/config/index
 * @requires client/src/utils/helpers-reader
 * @requires client/src/modules/features/flow-reader
 */

import * as CONFIG from "../../config/index.js";
import { setHistory } from "../../utils/helpers/reader.js";
import { flowReader } from "./flow-reader.js";

/** @type {HTMLElement|null} The search dialog element */
let searchDlg = null;

/** @type {number} Line number where next search should start */
let searchStartLine = 0;

/** @type {Element|null} Currently highlighted element */
let currentHighlight = null;
let activeSearch = null;
let searchChunks = null;

function cancelSearch() {
    activeSearch?.abort();
    activeSearch = null;
}

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

        cancelSearch();
        this.clearHighlight();

        // Restore original keydown handler
        document.onkeydown = searchDlg._savedKeydown;

        searchDlg.remove();
        searchDlg = null;
        searchStartLine = 0;
    },

    /**
     * Clear the current search highlight
     */
    clearHighlight() {
        if (currentHighlight) {
            for (const mark of currentHighlight.querySelectorAll("mark[data-search-highlight]")) {
                mark.replaceWith(document.createTextNode(mark.textContent));
            }
            currentHighlight.normalize();
            currentHighlight = null;
        }
    },
};

/**
 * Perform search in FILE_CONTENT_CHUNKS
 * @param {boolean} down - Search direction (true = forward, false = backward)
 */
async function doSearch(down = true) {
    if (!searchDlg) return;
    const input = searchDlg.querySelector(".search-txt");
    const pattern = input.value.trim();
    if (!pattern) return;

    cancelSearch();
    const controller = new AbortController();
    activeSearch = controller;
    const chunks = CONFIG.VARS.FILE_CONTENT_CHUNKS;
    if (chunks !== searchChunks) {
        searchStartLine = 0;
        searchChunks = chunks;
    }
    const totalLines = chunks.length;
    if (!totalLines) return;
    search.clearHighlight();

    // Execute all regular expressions off the main thread. Terminating the
    // worker also stops catastrophic backtracking, which yielding cannot do.
    const worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
    const timeout = setTimeout(() => controller.abort(), 2000);
    let finishBatch;
    const abort = () => {
        worker.terminate();
        finishBatch?.(null);
    };
    controller.signal.addEventListener("abort", abort, { once: true });
    const template = document.createElement("template");
    const isCurrent = () => !controller.signal.aborted && searchDlg && chunks === CONFIG.VARS.FILE_CONTENT_CHUNKS;
    try {
        let offset = 0;
        while (offset < totalLines && isCurrent()) {
            const lines = [];
            for (let count = 0; count < 128 && offset < totalLines; count++, offset++) {
                const step = down ? offset + 1 : -offset - 1;
                const lineNumber = ((searchStartLine + step) % totalLines + totalLines) % totalLines;
                const chunk = chunks[lineNumber];
                if (!chunk || (typeof chunk === "object" && ["image", "seal"].includes(chunk.type))) continue;
                // A template is inert: parsing book HTML here cannot request
                // resources or execute handlers. Only visible text is searched.
                let text;
                if (typeof chunk === "object" && chunk.source !== "epub" && chunk.type !== "title") {
                    text = (chunk.dropCap?.content || "") + (chunk.content || "");
                } else {
                    template.innerHTML = typeof chunk === "object" ? chunk.content || "" : chunk;
                    text = template.content.textContent || "";
                }
                lines.push({ lineNumber, text });
            }
            const result = await new Promise(resolve => {
                finishBatch = resolve;
                worker.onmessage = ({ data }) => resolve(data.result || null);
                worker.onerror = () => { controller.abort(); resolve(null); };
                worker.postMessage({ lines, pattern });
            });
            finishBatch = null;
            if (!isCurrent()) return;
            if (result) {
                await navigateToLine(result.lineNumber, isCurrent);
                if (!isCurrent()) return;
                highlightLine(result.lineNumber, result.ranges);
                searchStartLine = result.lineNumber;
                return;
            }
        }
    } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abort);
        worker.terminate();
        if (activeSearch === controller) activeSearch = null;
    }
}

/**
 * Navigate to a specific line (handles both flow and page mode)
 * @param {number} lineNumber
 */
async function navigateToLine(lineNumber, isCurrent = () => true) {
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

        // Await navigation so the result exists before applying highlights.
        const { reader } = await import("./reader.js");
        if (!isCurrent()) return;
        if (targetPage !== CONFIG.VARS.CURRENT_PAGE) {
            reader.gotoPage(targetPage, "top");
        }
        const el = CONFIG.DOM_ELEMENT.GET_LINE(lineNumber);
        if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    }
    if (isCurrent()) setHistory(CONFIG.VARS.FILENAME, lineNumber);
}

/**
 * Highlight a matched line with <mark> tags
 * @param {number} lineNumber
 * @param {Array<[number, number]>} ranges
 */
function highlightLine(lineNumber, ranges) {
    const el = CONFIG.DOM_ELEMENT.GET_LINE(lineNumber);
    if (!el) return;
    currentHighlight = el;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let position = 0;
    for (const node of nodes) {
        const text = node.textContent;
        const end = position + text.length;
        const matches = ranges.filter(([start, stop]) => start < end && stop > position);
        if (matches.length) {
            const fragment = document.createDocumentFragment();
            let offset = 0;
            for (const [start, stop] of matches) {
                const from = Math.max(start - position, 0);
                const to = Math.min(stop - position, text.length);
                fragment.append(document.createTextNode(text.slice(offset, from)));
                const mark = document.createElement("mark");
                mark.dataset.searchHighlight = "";
                mark.textContent = text.slice(from, to);
                fragment.append(mark);
                offset = to;
            }
            fragment.append(document.createTextNode(text.slice(offset)));
            node.replaceWith(fragment);
        }
        position = end;
    }
}
