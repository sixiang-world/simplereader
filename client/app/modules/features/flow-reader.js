/**
 * @fileoverview Flow mode (continuous scroll) reader module
 *
 * Implements a sliding-window renderer that loads/unloads pages of content
 * as the user scrolls, providing a seamless continuous reading experience.
 * Ported from simplereader-enhance's preloadContentFlow() and adapted for
 * cnb's ES modules architecture and structured FILE_CONTENT_CHUNKS.
 *
 * @module client/app/modules/features/flow-reader
 * @requires client/app/config/index
 * @requires client/app/modules/text/text-processor
 * @requires client/app/modules/features/footnotes
 * @requires client/app/utils/base
 * @requires client/app/utils/helpers-reader
 */

import * as CONFIG from "../../config/index.js";
import { TextProcessor } from "../text/text-processor.js";
import { getFootnotes } from "./footnotes.js";
import { isInViewport, enableScroll, disableScroll, isElementInContainer } from "../../utils/base.js";
import { getTopLineNumber, setHistory, GetScrollPositions } from "../../utils/helpers-reader.js";

/**
 * Flow mode reader — sliding-window continuous scroll renderer
 * @namespace
 */
export const flowReader = {
    /** @type {boolean} Whether flow mode is currently active */
    _active: false,

    /** @type {number} Content chunk length at last render (to detect content reload) */
    _lastChunkLength: 0,

    /** @type {Function|null} Saved wheel event handler for infinite scroll (to restore on exit) */
    _savedWheelHandler: null,

    /**
     * Enter flow mode: render content as continuous scroll
     */
    enter() {
        // If already active, check if content has changed (e.g., file reloaded)
        // and re-render if needed. This handles the case where flow mode was
        // activated on initial page load (with no content) before a file is opened.
        if (this._active) {
            const chunkLen = CONFIG.VARS.FILE_CONTENT_CHUNKS.length;
            if (chunkLen > 0 && chunkLen !== this._lastChunkLength) {
                this._active = false; // Force re-entry with new content
            } else {
                return;
            }
        }
        this._active = true;

        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;
        content.setAttribute("data-page-mode", "flow");

        // Disable cnb's infinite scroll (overscroll page-turn) in flow mode
        // Flow mode has its own continuous scrolling
        this._disableInfiniteScroll();

        // Render initial window around current page's first line
        const startLine = this._getFirstLineOfCurrentPage();
        const windowSize = CONFIG.CONST_CONFIG.CONTINUOUS_SCROLL_WINDOW_SIZE;
        const pageSize = this._getPageSize();
        const begin = Math.max(0, startLine - pageSize);
        const end = Math.min(
            CONFIG.VARS.FILE_CONTENT_CHUNKS.length - 1,
            startLine + pageSize * (windowSize - 1)
        );

        content.innerHTML = "";
        CONFIG.VARS.FLOW_PRELOAD_BEGIN = this._getPageOfLine(begin);
        CONFIG.VARS.FLOW_PRELOAD_END = this._getPageOfLine(end);
        this.renderRange(begin, end, null);

        CONFIG.VARS.FLOW_CURRENT_LINE = startLine;
        const targetEl = CONFIG.DOM_ELEMENT.GET_LINE(startLine);
        if (targetEl) {
            targetEl.scrollIntoView({ behavior: "instant" });
        }

        this._lastChunkLength = CONFIG.VARS.FILE_CONTENT_CHUNKS.length;

        getFootnotes();
    },

    /**
     * Exit flow mode: restore paged mode
     */
    exit() {
        if (!this._active) return;
        this._active = false;

        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;
        content.removeAttribute("data-page-mode");

        // Re-enable infinite scroll if it was configured
        this._restoreInfiniteScroll();

        // Record current scroll position as the line to restore in paged mode
        const curLine = this.getCurrentLineNumber();
        CONFIG.VARS.FLOW_PRELOAD_BEGIN = 0;
        CONFIG.VARS.FLOW_PRELOAD_END = 0;
        CONFIG.VARS.FLOW_CURRENT_LINE = 0;
        this._lastChunkLength = 0;

        // Find which page contains the current line and switch to it
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        let targetPage = 1;
        for (let i = 0; i < pageBreaks.length - 1; i++) {
            if (curLine >= pageBreaks[i] && curLine < pageBreaks[i + 1]) {
                targetPage = i + 1;
                break;
            }
        }
        if (curLine >= (pageBreaks[pageBreaks.length - 1] || 0)) {
            targetPage = CONFIG.VARS.TOTAL_PAGES;
        }

        // Return target page so caller can navigate there
        return { targetPage, targetLine: curLine };
    },

    /**
     * Check if flow mode is active
     * @returns {boolean}
     */
    isActive() {
        return this._active;
    },

    // ===== Core sliding-window rendering =====

    /**
     * Preload content around the given line number (sliding window).
     * Call this on scroll events to dynamically load/unload content.
     * @param {number} lineNumber - The currently visible line number
     */
    preloadContent(lineNumber) {
        if (!this._active) return;

        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        const totalPages = CONFIG.VARS.TOTAL_PAGES;
        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;
        const windowSize = CONFIG.CONST_CONFIG.CONTINUOUS_SCROLL_WINDOW_SIZE;

        // Find which page the line belongs to
        const page = this._getPageOfLine(lineNumber);
        const preloadBegin = CONFIG.VARS.FLOW_PRELOAD_BEGIN;
        const preloadEnd = CONFIG.VARS.FLOW_PRELOAD_END;

        let loadRange = null;
        let unloadRange = null;
        let insertBefore = null;

        if (page < preloadBegin || page > preloadEnd) {
            // Outside preload range — full reload
            const newBegin = Math.max(1, page - 1);
            const newEnd = Math.min(totalPages, page + windowSize - 2);
            CONFIG.VARS.FLOW_PRELOAD_BEGIN = newBegin;
            CONFIG.VARS.FLOW_PRELOAD_END = newEnd;
            loadRange = this._getPagesLineRange(newBegin, newEnd);

            // Reset scroll position BEFORE clearing — prevents stale scrollTop
            // from causing scroll position mismatch after re-render
            content.scrollTop = 0;

            content.innerHTML = "";
            insertBefore = null;

            // After full reload, scroll to the target line
            this.renderRange(loadRange.begin, loadRange.end, null);
            const targetEl = CONFIG.DOM_ELEMENT.GET_LINE(lineNumber);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: "instant", block: "start" });
            }
            getFootnotes();
            return;
        } else if (page === preloadEnd && preloadEnd < totalPages) {
            // At the end edge — append next page, remove oldest
            CONFIG.VARS.FLOW_PRELOAD_END++;
            loadRange = this._getPagesLineRange(CONFIG.VARS.FLOW_PRELOAD_END, CONFIG.VARS.FLOW_PRELOAD_END);
            unloadRange = this._getPagesLineRange(preloadBegin, preloadBegin);
            CONFIG.VARS.FLOW_PRELOAD_BEGIN++;
            insertBefore = null;
        } else if (page === preloadBegin && preloadBegin > 1) {
            // At the start edge — prepend previous page, remove newest
            CONFIG.VARS.FLOW_PRELOAD_BEGIN--;
            loadRange = this._getPagesLineRange(CONFIG.VARS.FLOW_PRELOAD_BEGIN, CONFIG.VARS.FLOW_PRELOAD_BEGIN);
            unloadRange = this._getPagesLineRange(preloadEnd, preloadEnd);
            CONFIG.VARS.FLOW_PRELOAD_END--;
            insertBefore = content.firstElementChild;
        } else {
            // Within range — no action needed
            return;
        }

        // Save current scroll position (line + pixel offset)
        const savedLine = this.getCurrentLineNumber();
        const savedEl = CONFIG.DOM_ELEMENT.GET_LINE(savedLine);
        const savedOffset = savedEl ? savedEl.getBoundingClientRect().top : 0;

        // Load new content
        if (loadRange) {
            this.renderRange(loadRange.begin, loadRange.end, insertBefore);
        }

        // Unload distant content
        if (unloadRange) {
            for (let i = unloadRange.begin; i <= unloadRange.end; i++) {
                const el = CONFIG.DOM_ELEMENT.GET_LINE(i);
                if (el) el.remove();
            }
        }

        // Restore scroll position
        if (savedEl) {
            const newEl = CONFIG.DOM_ELEMENT.GET_LINE(savedLine);
            if (newEl) {
                const newOffset = newEl.getBoundingClientRect().top;
                content.scrollBy({ top: newOffset - savedOffset, behavior: "instant" });
            }
        }

        getFootnotes();
    },

    /**
     * Render a range of lines into the content container.
     * @param {number} startLine - First line index (inclusive)
     * @param {number} endLine - Last line index (inclusive)
     * @param {Element|null} insertBefore - If set, insert before this element (prepend mode)
     */
    renderRange(startLine, endLine, insertBefore) {
        const chunks = CONFIG.VARS.FILE_CONTENT_CHUNKS;
        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;

        for (let j = startLine; j <= endLine; j++) {
            const currentLine = chunks[j];
            if (!currentLine) continue;

            // Safety: skip lines whose element already exists in the DOM
            // Prevents duplicates from sliding-window edge cases (e.g., when
            // preloadContent and wheel events overlap at content boundaries)
            const existingEl = CONFIG.DOM_ELEMENT.GET_LINE(j);
            if (existingEl && content.contains(existingEl)) continue;

            try {
                if (typeof currentLine === "object") {
                    const [processedContent, lineType] = TextProcessor.createDOM(currentLine);
                    if (lineType === "e" && processedContent.innerHTML.trim() === "") {
                        continue;
                    }
                    if (insertBefore) {
                        content.insertBefore(processedContent, insertBefore);
                    } else {
                        content.appendChild(processedContent);
                    }
                } else {
                    // v1.6.3 fallback (string content)
                    if (currentLine.trim()) {
                        const isTitlePage =
                            j < CONFIG.VARS.TITLE_PAGE_LINE_NUMBER_OFFSET || j === chunks.length - 1;
                        const [processedContent, lineType] = TextProcessor.processAndCreateDOM(
                            currentLine,
                            j,
                            isTitlePage
                        );
                        if (lineType === "e" && processedContent.innerHTML.trim() === "") {
                            continue;
                        }
                        if (insertBefore) {
                            content.insertBefore(processedContent, insertBefore);
                        } else {
                            content.appendChild(processedContent);
                        }
                    }
                }
            } catch (e) {
                console.error("Flow mode: error rendering line", j, e);
                break;
            }
        }
    },

    // ===== Navigation =====

    /**
     * Go to a specific line in flow mode.
     * Loads the page containing the line if not already loaded.
     * @param {number} lineNumber - Target line number
     * @param {boolean} [isTitle=false] - Whether this is a title navigation
     * @returns {boolean} Success
     */
    gotoLine(lineNumber, isTitle = false) {
        if (!this._active) return false;

        const maxLine = CONFIG.VARS.FILE_CONTENT_CHUNKS.length - 1;
        lineNumber = Math.max(0, Math.min(lineNumber, maxLine));
        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;

        // Check if line is currently rendered
        let el = CONFIG.DOM_ELEMENT.GET_LINE(lineNumber);
        if (!el) {
            // Need to load the page containing this line
            const page = this._getPageOfLine(lineNumber);
            const windowSize = CONFIG.CONST_CONFIG.CONTINUOUS_SCROLL_WINDOW_SIZE;
            const halfWindow = Math.floor(windowSize / 2);
            const beginPage = Math.max(1, page - halfWindow);
            const endPage = Math.min(CONFIG.VARS.TOTAL_PAGES, page + halfWindow);
            const range = this._getPagesLineRange(beginPage, endPage);

            // Reset scroll position BEFORE clearing — prevents stale scrollTop
            // from interfering with scrollIntoView after re-render
            content.scrollTop = 0;

            content.innerHTML = "";
            CONFIG.VARS.FLOW_PRELOAD_BEGIN = beginPage;
            CONFIG.VARS.FLOW_PRELOAD_END = endPage;
            this.renderRange(range.begin, range.end, null);
            getFootnotes();

            el = CONFIG.DOM_ELEMENT.GET_LINE(lineNumber);
        }

        if (el) {
            el.scrollIntoView({ behavior: "instant", block: "start" });
            CONFIG.VARS.FLOW_CURRENT_LINE = lineNumber;
            setHistory(CONFIG.VARS.FILENAME, lineNumber);
            return true;
        }

        return false;
    },

    /**
     * Get the line number of the first visible line in the content container.
     * @returns {number} Line number, or 0 if none found
     */
    getCurrentLineNumber() {
        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;
        const viewportHeight = window.innerHeight;

        let firstVisible = 0;
        let lastVisible = 0;

        for (const child of content.children) {
            if (!child.id || !child.id.startsWith("line")) continue;
            const rect = child.getBoundingClientRect();
            if (rect.bottom >= 0 && rect.top <= viewportHeight) {
                const num = parseInt(child.id.replace("line", ""));
                if (firstVisible === 0) firstVisible = num;
                lastVisible = num;
            }
        }

        // If no elements are visible (user scrolled past rendered content),
        // estimate current line from scroll position
        if (firstVisible === 0 && lastVisible === 0) {
            const scrollable = content.scrollHeight - content.clientHeight;
            if (scrollable > 0) {
                const ratio = content.scrollTop / scrollable;
                const maxLine = CONFIG.VARS.FILE_CONTENT_CHUNKS.length - 1;
                return Math.round(ratio * maxLine);
            }
            return 0;
        }

        // In flow mode, always return the last visible line (bottom of viewport)
        // to accurately track reading position. Using firstVisible causes the
        // sliding window to incorrectly think we're at earlier content and
        // triggers unnecessary full reloads or edge-case re-renders.
        return lastVisible || firstVisible;
    },

    // ===== Private helpers =====

    /**
     * Get the first line index of the current page (for initial flow mode entry).
     * @returns {number}
     * @private
     */
    _getFirstLineOfCurrentPage() {
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        return pageBreaks[CONFIG.VARS.CURRENT_PAGE - 1] || 0;
    },

    /**
     * Get the page number (1-based) that contains the given line.
     * @param {number} line
     * @returns {number}
     * @private
     */
    _getPageOfLine(line) {
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        for (let i = pageBreaks.length - 1; i >= 0; i--) {
            if (line >= pageBreaks[i]) return i + 1;
        }
        return 1;
    },

    /**
     * Get the average page size (lines per page) from PAGE_BREAKS.
     * @returns {number}
     * @private
     */
    _getPageSize() {
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        if (pageBreaks.length < 2) return 200;
        return Math.round(
            (pageBreaks[pageBreaks.length - 1] - pageBreaks[0]) / (pageBreaks.length - 1)
        );
    },

    /**
     * Convert a page range to a line range using PAGE_BREAKS.
     * @param {number} firstPage - First page (1-based, inclusive)
     * @param {number} lastPage - Last page (1-based, inclusive)
     * @returns {{begin: number, end: number}}
     * @private
     */
    _getPagesLineRange(firstPage, lastPage) {
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        const maxLine = CONFIG.VARS.FILE_CONTENT_CHUNKS.length - 1;
        const begin = pageBreaks[firstPage - 1] || 0;
        const end = Math.min(pageBreaks[lastPage] || maxLine, maxLine);
        return { begin, end };
    },

    /**
     * Disable cnb's overscroll infinite scroll to avoid conflicts.
     * @private
     */
    _disableInfiniteScroll() {
        if (reader && reader._destroyPageScroll) {
            reader._destroyPageScroll();
        }
    },

    /**
     * Restore cnb's infinite scroll if it was configured.
     * @private
     */
    _restoreInfiniteScroll() {
        if (CONFIG.CONST_CONFIG.INFINITE_SCROLL_MODE && reader && reader.toggleInfiniteScroll) {
            reader.toggleInfiniteScroll();
        }
    },
};

// Import reader at module level to avoid circular dependency issues.
// This is a lazy reference — used only for _disableInfiniteScroll/_restoreInfiniteScroll.
import { reader } from "./reader.js";
