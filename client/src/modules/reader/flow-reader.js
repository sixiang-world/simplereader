/**
 * @fileoverview Flow mode (continuous scroll / auto-join) reader module
 *
 * Implements an accumulate-only continuous scroll renderer:
 *   - Enter: render current page + 1 page ahead as initial content
 *   - Scroll down: when approaching the bottom of rendered content,
 *     append the next page (only append, never remove)
 *   - Scroll up: all previously rendered content stays in DOM —
 *     zero jump/flash, just native scroll
 *   - Jump (TOC / progress bar): clear DOM, re-render from target
 *   - Exit: restore paged mode at the page matching current line
 *
 * The old sliding-window approach (preloadContent with symmetric
 * load/unload) had several bugs:
 *   1. Full DOM wipe on window-out-of-range → visual jump
 *   2. Scroll-position restoration via getBoundingClientRect unreliable
 *      after DOM bulk mutations
 *   3. PAGE_BREAKS-based window tracking didn't match flow-mode reality
 *   4. No mutual exclusion with infinite-scroll at schema level
 *
 * This rewrite fixes all of those by adopting a simpler accumulate-only
 * model: content grows downward, never shrinks. For extremely large
 * files (>50 000 lines), a future optimisation may add top-crop, but
 * modern browsers handle tens of thousands of DOM nodes without issue.
 *
 * @module client/src/modules/features/flow-reader
 * @requires client/src/config/index
 * @requires client/src/modules/text/text-processor
 * @requires client/src/modules/features/footnotes
 * @requires client/src/utils/helpers/reader
 */

import * as CONFIG from "../../config/index.js";
import { TextProcessor } from "../text/text-processor.js";
import { getFootnotes } from "./footnotes.js";
import { setHistory } from "../../utils/helpers/reader.js";

/**
 * Flow mode reader — accumulate-only continuous scroll renderer
 * @namespace
 */
export const flowReader = {
    /** @type {boolean} Whether flow mode is currently active */
    _active: false,

    /** @type {number} Last rendered line index (0-based). New content is appended after this. */
    _renderedEnd: -1,

    /** @type {number} Content chunk length at last full render (detect file reload) */
    _lastChunkLength: 0,

    /** @type {number|null} Throttle timer ID for onScrollAppend */
    _scrollTimer: null,

    // ===== Public API =====

    /**
     * Enter flow mode: render initial content block around current position
     */
    enter() {
        // Re-entry guard: if content changed (file reload), force re-enter
        if (this._active) {
            const chunkLen = CONFIG.VARS.FILE_CONTENT_CHUNKS.length;
            if (chunkLen > 0 && chunkLen !== this._lastChunkLength) {
                this._active = false;
            } else {
                return;
            }
        }
        this._active = true;
        this._renderedEnd = -1;

        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;
        content.setAttribute("data-page-mode", "flow");

        // Disable infinite-scroll (overscroll page-turn) in flow mode
        this._disableInfiniteScroll();

        // Determine start line from current page position
        const startLine = this._getFirstLineOfCurrentPage();
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        const totalPages = CONFIG.VARS.TOTAL_PAGES;
        const currentLine = startLine;

        // Render from current page start through 1 page ahead
        const currentPage = CONFIG.VARS.CURRENT_PAGE || 1;
        const aheadPage = Math.min(currentPage + 1, totalPages);
        const endLine = pageBreaks[aheadPage] || CONFIG.VARS.FILE_CONTENT_CHUNKS.length - 1;

        content.innerHTML = "";
        this._renderLines(currentLine, endLine);

        CONFIG.VARS.FLOW_CURRENT_LINE = currentLine;
        this._renderedEnd = endLine;
        this._lastChunkLength = CONFIG.VARS.FILE_CONTENT_CHUNKS.length;

        // Scroll to the start position
        const targetEl = CONFIG.DOM_ELEMENT.GET_LINE(currentLine);
        if (targetEl) {
            targetEl.scrollIntoView({ behavior: "instant", block: "start" });
        }

        getFootnotes();
    },

    /**
     * Exit flow mode: restore paged mode at the page containing current line
     * @returns {{ targetPage: number, targetLine: number }|null}
     */
    exit() {
        if (!this._active) return null;
        this._active = false;
        this._renderedEnd = -1;

        this._cancelScrollTimer();

        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;
        content.removeAttribute("data-page-mode");

        this._restoreInfiniteScroll();

        // Determine current position before clearing state
        const curLine = this.getCurrentLineNumber();

        // Reset flow state
        CONFIG.VARS.FLOW_CURRENT_LINE = 0;
        this._lastChunkLength = 0;

        // Map current line → page number
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

        return { targetPage, targetLine: curLine };
    },

    /**
     * Check if flow mode is currently active
     * @returns {boolean}
     */
    isActive() {
        return this._active;
    },

    // ===== Scroll-driven content appending =====

    /**
     * Called on scroll events (throttled). Checks if the user is near
     * the bottom of rendered content and appends the next page.
     * @param {number} [lineNumber] - Current visible line (optional hint)
     */
    onScrollAppend(lineNumber) {
        if (!this._active) return;

        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;
        const chunks = CONFIG.VARS.FILE_CONTENT_CHUNKS;
        const totalLines = chunks.length - 1;

        // Nothing more to append if we've already rendered everything
        if (this._renderedEnd >= totalLines) return;

        // Check proximity to bottom of rendered content.
        // If the last rendered element's bottom edge is within 2 viewport
        // heights of the visible area, it's time to append.
        const lastEl = CONFIG.DOM_ELEMENT.GET_LINE(this._renderedEnd);
        if (lastEl) {
            const lastRect = lastEl.getBoundingClientRect();
            const viewportHeight = content.clientHeight || window.innerHeight;
            if (lastRect.top > viewportHeight * 2) {
                // Still far from bottom — no need to append yet
                return;
            }
        }

        // Append next page of content
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        const currentPage = this._getPageOfLine(this._renderedEnd);
        const nextPage = currentPage + 1;
        const nextEnd = nextPage <= CONFIG.VARS.TOTAL_PAGES
            ? (pageBreaks[nextPage] || totalLines)
            : totalLines;

        // Only append if there's actually new content
        if (nextEnd > this._renderedEnd) {
            this._renderLines(this._renderedEnd + 1, nextEnd);
            this._renderedEnd = nextEnd;
            getFootnotes();
        }
    },

    /**
     * Schedule a throttled onScrollAppend call.
     * Uses ~100ms throttle to avoid excessive DOM mutations during fast scrolling.
     */
    scheduleScrollAppend() {
        if (!this._active) return;
        if (this._scrollTimer !== null) return; // already scheduled

        this._scrollTimer = setTimeout(() => {
            this._scrollTimer = null;
            const curLine = this.getCurrentLineNumber();
            this.onScrollAppend(curLine);
        }, 100);
    },

    /**
     * Cancel any pending throttled scroll-append timer
     * @private
     */
    _cancelScrollTimer() {
        if (this._scrollTimer !== null) {
            clearTimeout(this._scrollTimer);
            this._scrollTimer = null;
        }
    },

    // ===== Navigation =====

    /**
     * Jump to a specific line in flow mode.
     * If the line is already in the DOM, just scroll to it.
     * If not (e.g. TOC click to distant chapter), do a full reload from that point.
     *
     * @param {number} lineNumber - Target line number (0-based)
     * @param {boolean} [isTitle=false] - Whether this is a TOC navigation
     * @returns {boolean} Success
     */
    gotoLine(lineNumber, isTitle = false) {
        if (!this._active) return false;

        const maxLine = CONFIG.VARS.FILE_CONTENT_CHUNKS.length - 1;
        lineNumber = Math.max(0, Math.min(lineNumber, maxLine));

        // Check if target line is already rendered in DOM
        const el = CONFIG.DOM_ELEMENT.GET_LINE(lineNumber);
        if (el) {
            // Already in DOM — just scroll
            el.scrollIntoView({ behavior: "instant", block: "start" });
            CONFIG.VARS.FLOW_CURRENT_LINE = lineNumber;
            setHistory(CONFIG.VARS.FILENAME, lineNumber);
            return true;
        }

        // Target not in DOM — full reload from target position
        // (This happens for distant TOC jumps or progress-bar jumps)
        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        const totalPages = CONFIG.VARS.TOTAL_PAGES;

        const targetPage = this._getPageOfLine(lineNumber);
        const aheadPage = Math.min(targetPage + 1, totalPages);
        const endLine = pageBreaks[aheadPage] || maxLine;

        // Save scroll offset ratio so we can roughly restore position
        // after clearing DOM (only needed for progress-bar jumps where
        // we don't know the exact target line yet)
        content.scrollTop = 0;
        content.innerHTML = "";
        this._renderedEnd = -1;

        this._renderLines(lineNumber, endLine);
        this._renderedEnd = endLine;

        const targetEl = CONFIG.DOM_ELEMENT.GET_LINE(lineNumber);
        if (targetEl) {
            targetEl.scrollIntoView({ behavior: "instant", block: "start" });
        }

        CONFIG.VARS.FLOW_CURRENT_LINE = lineNumber;
        setHistory(CONFIG.VARS.FILENAME, lineNumber);
        getFootnotes();
        return true;
    },

    /**
     * Get the line number of the last visible line in the viewport.
     * Used for progress tracking and scroll-append decisions.
     * @returns {number} Line number (0-based), or 0 if none found
     */
    getCurrentLineNumber() {
        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;
        const viewportHeight = window.innerHeight;
        const contentTop = content.getBoundingClientRect().top;

        let lastVisible = 0;

        for (const child of content.children) {
            if (!child.id || !child.id.startsWith("line")) continue;
            const rect = child.getBoundingClientRect();
            // Element is visible if any part is within the viewport
            if (rect.bottom >= contentTop && rect.top <= viewportHeight) {
                const num = parseInt(child.id.replace("line", ""));
                if (num > lastVisible) lastVisible = num;
            }
        }

        if (lastVisible > 0) return lastVisible;

        // Fallback: estimate from scroll ratio (rare — only if DOM is empty
        // or all elements are off-screen, e.g. during a jump transition)
        const scrollable = content.scrollHeight - content.clientHeight;
        if (scrollable > 0) {
            const ratio = content.scrollTop / scrollable;
            const maxLine = CONFIG.VARS.FILE_CONTENT_CHUNKS.length - 1;
            return Math.round(ratio * maxLine);
        }
        return 0;
    },

    // ===== Private helpers =====

    /**
     * Render a range of lines [startLine, endLine] into the content container.
     * Lines are appended to the end of the container (accumulate-only).
     * Skips lines that already exist in the DOM (prevents duplicates).
     *
     * @param {number} startLine - First line index (inclusive, 0-based)
     * @param {number} endLine   - Last line index (inclusive, 0-based)
     * @private
     */
    _renderLines(startLine, endLine) {
        const chunks = CONFIG.VARS.FILE_CONTENT_CHUNKS;
        const content = CONFIG.DOM_ELEMENT.CONTENT_CONTAINER;

        for (let j = startLine; j <= endLine; j++) {
            const currentLine = chunks[j];
            if (!currentLine) continue;

            // Skip if element already exists (prevent duplicates)
            const existingEl = CONFIG.DOM_ELEMENT.GET_LINE(j);
            if (existingEl && content.contains(existingEl)) continue;

            try {
                if (typeof currentLine === "object") {
                    const [processedContent, lineType] = TextProcessor.createDOM(currentLine);
                    if (lineType === "e" && processedContent.innerHTML.trim() === "") continue;
                    content.appendChild(processedContent);
                } else {
                    // String content fallback (v1.6.3)
                    if (currentLine.trim()) {
                        const isTitlePage =
                            j < CONFIG.VARS.TITLE_PAGE_LINE_NUMBER_OFFSET || j === chunks.length - 1;
                        const [processedContent, lineType] = TextProcessor.processAndCreateDOM(
                            currentLine,
                            j,
                            isTitlePage
                        );
                        if (lineType === "e" && processedContent.innerHTML.trim() === "") continue;
                        content.appendChild(processedContent);
                    }
                }
            } catch (e) {
                console.error("Flow mode: error rendering line", j, e);
                break;
            }
        }
    },

    /**
     * Get the first line index of the current page (for initial entry).
     * @returns {number} 0-based line index
     * @private
     */
    _getFirstLineOfCurrentPage() {
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        return pageBreaks[CONFIG.VARS.CURRENT_PAGE - 1] || 0;
    },

    /**
     * Get the page number (1-based) that contains the given line.
     * @param {number} line - 0-based line index
     * @returns {number} 1-based page number
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
     * Disable the infinite-scroll (overscroll page-turn) wheel handler.
     * @private
     */
    _disableInfiniteScroll() {
        if (reader && reader._destroyPageScroll) {
            reader._destroyPageScroll();
        }
    },

    /**
     * Re-enable infinite scroll if it was configured before entering flow mode.
     * @private
     */
    _restoreInfiniteScroll() {
        if (CONFIG.CONST_CONFIG.INFINITE_SCROLL_MODE && reader && reader.toggleInfiniteScroll) {
            reader.toggleInfiniteScroll();
        }
    },
};

// Lazy reference to reader — used only for _disableInfiniteScroll/_restoreInfiniteScroll.
// Imported at module level to avoid circular dependency at call time.
import { reader } from "./reader.js";
