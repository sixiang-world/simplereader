/**
 * @fileoverview EPUB Reader module for rendering and navigating EPUB books
 *
 * This module provides EPUB reading functionality using epub.js,
 * integrating with the SimpleTextReader UI for a seamless experience.
 *
 * Features:
 * - EPUB file loading and rendering
 * - Table of contents navigation
 * - Reading progress tracking (CFI-based)
 * - Dark mode support
 * - Keyboard navigation
 * - Font size adjustment
 * - Sidebar TOC
 *
 * @module client/app/modules/epub/epub-reader
 * @requires client/app/config/index
 * @requires shared/core/callback/callback-registry
 */

import * as CONFIG from "../../config/index.js";
import { cbReg } from "../../../../shared/core/callback/callback-registry.js";

/**
 * EPUB Reader module
 * @public
 * @namespace
 */
export const EpubReader = {
    /**
     * Reference to the epub.js Book instance
     * @type {Object|null}
     * @private
     */
    _book: null,

    /**
     * Reference to the epub.js Rendition instance
     * @type {Object|null}
     * @private
     */
    _rendition: null,

    /**
     * Current CFI location for progress tracking
     * @type {string}
     * @private
     */
    _currentCfi: "",

    /**
     * Whether the reader is initialized
     * @type {boolean}
     * @private
     */
    _initialized: false,

    /**
     * The current theme (light/dark)
     * @type {string}
     * @private
     */
    _currentTheme: "light",

    /**
     * Current font size in em
     * @type {number}
     * @private
     */
    _fontSize: 1.2,

    /**
     * Check if epub.js is available
     * @returns {boolean}
     * @private
     */
    _isEpubJsAvailable() {
        return typeof ePub !== "undefined";
    },

    /**
     * Initialize the EPUB reader
     * Sets up the DOM container and keyboard listeners
     * @public
     */
    init() {
        if (!this._isEpubJsAvailable()) {
            console.warn("[EpubReader] epub.js library not loaded");
            return;
        }
        this._initialized = true;
        this._setupKeyboardNavigation();
        this._setupResizeHandler();
        console.log("[EpubReader] Initialized");
    },

    /**
     * Open an EPUB file and start rendering
     * @param {File|ArrayBuffer} input - The EPUB file or ArrayBuffer
     * @param {string} fileName - The filename for progress tracking
     * @public
     */
    async openBook(input, fileName) {
        if (!this._initialized) {
            this.init();
        }

        if (!this._isEpubJsAvailable()) {
            console.error("[EpubReader] epub.js library not available");
            return;
        }

        try {
            // Destroy previous book if any
            await this.closeBook();

            // Show the EPUB container, hide the TXT reader
            this._showEpubContainer();

            // Create the Book instance
            let bookInput;
            if (input instanceof ArrayBuffer) {
                bookInput = input;
            } else if (input instanceof File) {
                bookInput = input;
            } else {
                bookInput = input;
            }

            this._book = ePub(bookInput);
            CONFIG.VARS.EPUB_BOOK = this._book;
            CONFIG.VARS.IS_EPUB = true;
            CONFIG.VARS.FILENAME = fileName;
            CONFIG.VARS.IS_BOOK_OPENED = true;

            // Wait for the book to be ready
            await this._book.ready;

            // Get metadata
            const metadata = await this._book.loaded.metadata;
            CONFIG.VARS.EPUB_TITLE = metadata.title || fileName.replace(/\.epub$/i, "");
            CONFIG.VARS.EPUB_AUTHOR = metadata.creator || "";
            CONFIG.VARS.BOOK_AND_AUTHOR = {
                bookName: CONFIG.VARS.EPUB_TITLE,
                author: CONFIG.VARS.EPUB_AUTHOR,
                bookNameRE: CONFIG.VARS.EPUB_TITLE,
                authorRE: CONFIG.VARS.EPUB_AUTHOR,
            };

            // Set document title
            document.title = CONFIG.VARS.EPUB_TITLE;

            // Get navigation/TOC
            const navigation = await this._book.loaded.navigation;
            CONFIG.VARS.EPUB_TOC = navigation.toc || [];

            // Render the book
            const container = document.getElementById("epub-reader-container");
            if (!container) {
                console.error("[EpubReader] Container element not found");
                return;
            }

            this._rendition = this._book.renderTo(container, {
                width: "100%",
                height: "100%",
                spread: "none",
                flow: "paginated",
            });

            CONFIG.VARS.EPUB_RENDITION = this._rendition;

            // Detect current theme from document
            const currentTheme = document.documentElement.getAttribute("data-theme");
            this._currentTheme = currentTheme === "dark" ? "dark" : "light";

            // Apply current theme
            this._applyTheme();

            // Display the first page or restore position
            const savedCfi = this._getSavedPosition(fileName);
            if (savedCfi) {
                try {
                    await this._rendition.display(savedCfi);
                } catch (e) {
                    console.warn("[EpubReader] Failed to restore position, starting from beginning:", e);
                    await this._rendition.display();
                }
            } else {
                await this._rendition.display();
            }

            // Set up location tracking
            this._rendition.on("relocated", (location) => {
                this._onLocationChanged(location);
            });

            // Set up click handlers for internal links
            this._rendition.on("click", (e) => {
                // Hide any open popups or settings when clicking in the reader
                if (CONFIG.VARS.IS_SETTINGS_MENU_SHOWN) {
                    cbReg.go("toggleSettingsMenu");
                }
            });

            // Generate TOC
            this._renderTOC();

            // Update progress display
            this._updateProgressDisplay();

            console.log(`[EpubReader] Book opened: "${CONFIG.VARS.EPUB_TITLE}" by ${CONFIG.VARS.EPUB_AUTHOR}`);

        } catch (error) {
            console.error("[EpubReader] Error opening book:", error);
            this.closeBook();
            throw error;
        }
    },

    /**
     * Open an EPUB book from an ArrayBuffer (for bookshelf restore)
     * @param {ArrayBuffer} arrayBuffer - The EPUB file data
     * @param {string} fileName - The filename
     * @param {Object} metadata - Book metadata
     * @public
     */
    async openBookFromBuffer(arrayBuffer, fileName, metadata = {}) {
        await this.openBook(arrayBuffer, fileName);

        // Restore saved position if available
        if (metadata.epubCfi) {
            try {
                await this._rendition.display(metadata.epubCfi);
            } catch (e) {
                console.warn("[EpubReader] Could not restore saved position:", e);
            }
        }
    },

    /**
     * Close the current EPUB book and clean up
     * @public
     */
    async closeBook() {
        // Save current position before closing
        if (this._rendition && CONFIG.VARS.FILENAME) {
            this._savePosition(CONFIG.VARS.FILENAME, this._currentCfi);
        }

        if (this._rendition) {
            try {
                this._rendition.destroy();
            } catch (e) {
                // Ignore destroy errors
            }
            this._rendition = null;
        }

        if (this._book) {
            try {
                this._book.destroy();
            } catch (e) {
                // Ignore destroy errors
            }
            this._book = null;
        }

        CONFIG.VARS.EPUB_BOOK = null;
        CONFIG.VARS.EPUB_RENDITION = null;
        CONFIG.VARS.IS_EPUB = false;

        this._currentCfi = "";
        this._hideEpubContainer();

        // Clear TOC
        const tocContainer = document.getElementById("epub-toc-list");
        if (tocContainer) {
            tocContainer.innerHTML = "";
        }

        console.log("[EpubReader] Book closed");
    },

    /**
     * Navigate to the next page
     * @public
     */
    nextPage() {
        if (this._rendition) {
            this._rendition.next();
        }
    },

    /**
     * Navigate to the previous page
     * @public
     */
    prevPage() {
        if (this._rendition) {
            this._rendition.prev();
        }
    },

    /**
     * Navigate to a specific CFI location
     * @param {string} cfi - The EPUB CFI location
     * @public
     */
    async gotoCfi(cfi) {
        if (this._rendition && cfi) {
            try {
                await this._rendition.display(cfi);
            } catch (e) {
                console.warn("[EpubReader] Failed to navigate to CFI:", cfi, e);
            }
        }
    },

    /**
     * Navigate to a specific href (chapter)
     * @param {string} href - The chapter href
     * @public
     */
    async gotoHref(href) {
        if (this._rendition && href) {
            try {
                await this._rendition.display(href);
            } catch (e) {
                console.warn("[EpubReader] Failed to navigate to href:", href, e);
            }
        }
    },

    /**
     * Set the font size for the EPUB reader
     * @param {number} size - Font size in em units
     * @public
     */
    setFontSize(size) {
        this._fontSize = size;
        if (this._rendition) {
            this._rendition.themes.fontSize(`${size}em`);
        }
    },

    /**
     * Increase font size
     * @public
     */
    increaseFontSize() {
        const newSize = Math.min(this._fontSize + 0.1, 3.0);
        this.setFontSize(newSize);
    },

    /**
     * Decrease font size
     * @public
     */
    decreaseFontSize() {
        const newSize = Math.max(this._fontSize - 0.1, 0.5);
        this.setFontSize(newSize);
    },

    /**
     * Set dark or light theme
     * @param {boolean} isDark - Whether to use dark mode
     * @public
     */
    setDarkMode(isDark) {
        this._currentTheme = isDark ? "dark" : "light";
        this._applyTheme();
        // Also update the document attribute for CSS
        document.documentElement.setAttribute("data-theme", this._currentTheme);
    },

    /**
     * Apply the current theme to the rendition
     * @private
     */
    _applyTheme() {
        if (!this._rendition) return;

        this._rendition.themes.register("light", {
            body: {
                "background-color": "#ffffff !important",
                "color": "#333333 !important",
                "padding": "0 !important",
            },
            "p, div, span, h1, h2, h3, h4, h5, h6, li, a, td, th, blockquote, pre": {
                "color": "#333333 !important",
            },
        });

        this._rendition.themes.register("dark", {
            body: {
                "background-color": "#1a1a2e !important",
                "color": "#e0e0e0 !important",
                "padding": "0 !important",
            },
            "p, div, span, h1, h2, h3, h4, h5, h6, li, a, td, th, blockquote, pre": {
                "color": "#e0e0e0 !important",
            },
            "a, a:link": {
                "color": "#6c9ef7 !important",
            },
            img: {
                "opacity": "0.9",
            },
        });

        this._rendition.themes.select(this._currentTheme);
        this._rendition.themes.fontSize(`${this._fontSize}em`);
    },

    /**
     * Get the current reading progress as a percentage
     * @returns {number} Progress percentage (0-100)
     * @public
     */
    getProgress() {
        return CONFIG.VARS.EPUB_PERCENTAGE;
    },

    /**
     * Get the current CFI location
     * @returns {string} Current CFI
     * @public
     */
    getCurrentCfi() {
        return this._currentCfi;
    },

    /**
     * Check if an EPUB book is currently open
     * @returns {boolean}
     * @public
     */
    isBookOpen() {
        return CONFIG.VARS.IS_EPUB && this._book !== null;
    },

    /**
     * Handle location change events from epub.js
     * @param {Object} location - The location object from epub.js
     * @private
     */
    _onLocationChanged(location) {
        if (location && location.start) {
            this._currentCfi = location.start.cfi;
            CONFIG.VARS.EPUB_CURRENT_CFI = this._currentCfi;
            CONFIG.VARS.EPUB_PERCENTAGE = location.start.percentage
                ? Math.round(location.start.percentage * 100)
                : 0;

            // Save position
            if (CONFIG.VARS.FILENAME) {
                this._savePosition(CONFIG.VARS.FILENAME, this._currentCfi);
            }

            // Update progress display
            this._updateProgressDisplay();

            // Update progress bar fill
            const progressFill = document.getElementById("epub-progress-fill");
            if (progressFill) {
                progressFill.style.width = `${CONFIG.VARS.EPUB_PERCENTAGE}%`;
            }

            // Update active TOC item
            this._updateActiveTOCItem(location);
        }
    },

    /**
     * Update the progress display
     * @private
     */
    _updateProgressDisplay() {
        const progressTitle = document.getElementById("epub-progress-title");
        const progressContent = document.getElementById("epub-progress-content");
        const progressPercentage = document.getElementById("epub-progress-percentage");

        if (progressTitle) {
            progressTitle.textContent = CONFIG.VARS.EPUB_TITLE || "";
        }
        if (progressContent) {
            const author = CONFIG.VARS.EPUB_AUTHOR;
            progressContent.textContent = author ? `${author}` : "";
        }
        if (progressPercentage) {
            progressPercentage.textContent = `${CONFIG.VARS.EPUB_PERCENTAGE}%`;
        }

        // Also update the original progress elements for compatibility
        const origProgressTitle = document.getElementById("progress-title");
        const origProgressContent = document.getElementById("progress-content");
        if (origProgressTitle) {
            origProgressTitle.textContent = CONFIG.VARS.EPUB_TITLE || "";
        }
        if (origProgressContent) {
            origProgressContent.textContent = `${CONFIG.VARS.EPUB_PERCENTAGE}%`;
        }
    },

    /**
     * Render the Table of Contents in the sidebar
     * @private
     */
    _renderTOC() {
        const tocContainer = document.getElementById("epub-toc-list");
        if (!tocContainer) return;

        tocContainer.innerHTML = "";

        const toc = CONFIG.VARS.EPUB_TOC;
        if (!toc || toc.length === 0) {
            const emptyMsg = document.createElement("div");
            emptyMsg.className = "epub-toc-empty";
            emptyMsg.textContent = "No Table of Contents available";
            tocContainer.appendChild(emptyMsg);
            return;
        }

        // Build TOC recursively
        const buildTOCItems = (items, parentElement, depth = 0) => {
            items.forEach((item) => {
                const tocItem = document.createElement("div");
                tocItem.className = `epub-toc-item epub-toc-depth-${depth}`;
                tocItem.dataset.href = item.href;

                const link = document.createElement("a");
                link.className = "epub-toc-link";
                link.textContent = item.label.trim();
                link.href = "#";
                link.addEventListener("click", async (e) => {
                    e.preventDefault();
                    await this.gotoHref(item.href);
                    // Update active state
                    tocContainer.querySelectorAll(".epub-toc-link").forEach((l) => l.classList.remove("active"));
                    link.classList.add("active");
                });

                tocItem.appendChild(link);
                parentElement.appendChild(tocItem);

                // Recursively add sub-items
                if (item.subitems && item.subitems.length > 0) {
                    buildTOCItems(item.subitems, parentElement, depth + 1);
                }
            });
        };

        buildTOCItems(toc, tocContainer);
    },

    /**
     * Update the active TOC item based on current location
     * @param {Object} location - The current location
     * @private
     */
    _updateActiveTOCItem(location) {
        const tocContainer = document.getElementById("epub-toc-list");
        if (!tocContainer) return;

        const toc = CONFIG.VARS.EPUB_TOC;
        if (!toc || toc.length === 0) return;

        // Find the current chapter based on href
        const currentHref = location.start?.href;
        if (!currentHref) return;

        const links = tocContainer.querySelectorAll(".epub-toc-link");
        links.forEach((link) => {
            const itemHref = link.parentElement.dataset.href;
            if (itemHref && (currentHref.includes(itemHref.split("#")[0]) || itemHref.includes(currentHref.split("#")[0]))) {
                links.forEach((l) => l.classList.remove("active"));
                link.classList.add("active");
            }
        });
    },

    /**
     * Show the EPUB reader container and hide the TXT reader
     * @private
     */
    _showEpubContainer() {
        // Show EPUB container
        const epubContainer = document.getElementById("epub-reader-wrapper");
        if (epubContainer) {
            epubContainer.style.display = "flex";
        }

        // Show EPUB sidebar
        const epubSidebar = document.getElementById("epub-toc-sidebar");
        if (epubSidebar) {
            epubSidebar.style.display = "block";
        }

        // Hide the TXT reader sidebar content
        const txtContent = document.getElementById("content");
        const txtPagination = document.getElementById("pagination");
        if (txtContent) txtContent.style.display = "none";
        if (txtPagination) txtPagination.style.display = "none";

        // Show EPUB pagination
        const epubPagination = document.getElementById("epub-pagination");
        if (epubPagination) {
            epubPagination.style.display = "flex";
        }
    },

    /**
     * Hide the EPUB reader container and show the TXT reader
     * @private
     */
    _hideEpubContainer() {
        const epubContainer = document.getElementById("epub-reader-wrapper");
        if (epubContainer) {
            epubContainer.style.display = "none";
        }

        const epubSidebar = document.getElementById("epub-toc-sidebar");
        if (epubSidebar) {
            epubSidebar.style.display = "none";
        }

        // Show the TXT reader content
        const txtContent = document.getElementById("content");
        const txtPagination = document.getElementById("pagination");
        if (txtContent) txtContent.style.display = "";
        if (txtPagination) txtPagination.style.display = "";

        // Hide EPUB pagination
        const epubPagination = document.getElementById("epub-pagination");
        if (epubPagination) {
            epubPagination.style.display = "none";
        }
    },

    /**
     * Save reading position to localStorage
     * @param {string} fileName - The book filename
     * @param {string} cfi - The CFI location
     * @private
     */
    _savePosition(fileName, cfi) {
        if (!fileName || !cfi) return;
        try {
            const key = `epub_position_${fileName}`;
            localStorage.setItem(key, cfi);
        } catch (e) {
            // Ignore storage errors
        }
    },

    /**
     * Get saved reading position from localStorage
     * @param {string} fileName - The book filename
     * @returns {string|null} The saved CFI location
     * @private
     */
    _getSavedPosition(fileName) {
        if (!fileName) return null;
        try {
            const key = `epub_position_${fileName}`;
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    },

    /**
     * Set up keyboard navigation for EPUB reader
     * @private
     */
    _setupKeyboardNavigation() {
        document.addEventListener("keydown", (e) => {
            if (!CONFIG.VARS.IS_EPUB || !this._rendition) return;

            // Don't handle if focused on input
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

            switch (e.key) {
                case "ArrowLeft":
                    if (CONFIG.CONST_CONFIG.SHORTCUTS.arrow_left) {
                        e.preventDefault();
                        this.prevPage();
                    }
                    break;
                case "ArrowRight":
                    if (CONFIG.CONST_CONFIG.SHORTCUTS.arrow_right) {
                        e.preventDefault();
                        this.nextPage();
                    }
                    break;
                case "PageUp":
                    if (CONFIG.CONST_CONFIG.SHORTCUTS.page_up) {
                        e.preventDefault();
                        this.prevPage();
                    }
                    break;
                case "PageDown":
                    if (CONFIG.CONST_CONFIG.SHORTCUTS.page_down) {
                        e.preventDefault();
                        this.nextPage();
                    }
                    break;
                case "Escape":
                    if (CONFIG.CONST_CONFIG.SHORTCUTS.esc) {
                        e.preventDefault();
                        this.closeBook();
                        cbReg.go("resetUI", { refreshBookshelf: true });
                    }
                    break;
                case "+":
                case "=":
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.increaseFontSize();
                    }
                    break;
                case "-":
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.decreaseFontSize();
                    }
                    break;
            }
        });
    },

    /**
     * Set up resize handler for the rendition
     * @private
     */
    _setupResizeHandler() {
        let resizeTimeout;
        window.addEventListener("resize", () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this._rendition) {
                    // Resize is handled automatically by epub.js
                }
            }, 250);
        });
    },

    /**
     * Get book cover URL if available
     * @returns {Promise<string|null>} Cover URL or null
     * @public
     */
    async getCoverUrl() {
        if (!this._book) return null;
        try {
            const coverUrl = await this._book.coverUrl();
            return coverUrl;
        } catch (e) {
            return null;
        }
    },

    /**
     * Get the total number of locations (pages)
     * @returns {Promise<number>}
     * @public
     */
    async getTotalLocations() {
        if (!this._book) return 0;
        try {
            const locations = await this._book.locations.generate(1024);
            return this._book.locations.length();
        } catch (e) {
            console.warn("[EpubReader] Could not generate locations:", e);
            return 0;
        }
    },
};

/**
 * Initialize the EPUB reader
 * @public
 */
export function initEpubReader() {
    EpubReader.init();
}
