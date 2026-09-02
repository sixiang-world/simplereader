/**
 * @fileoverview File handler for processing text files and managing book content
 *
 * This module provides utility functions for:
 * - Processing single and multiple file uploads
 * - File content reading and encoding detection
 * - Book metadata extraction
 * - Content processing and pagination
 * - Bookshelf management
 *
 * @module client/src/modules/file/file-handler
 * @requires client/src/config/index
 * @requires shared/utils/logger
 * @requires client/src/modules/features/reader
 * @requires shared/core/callback/callback-registry
 * @requires client/src/modules/text/text-processor
 * @requires client/src/modules/file/file-processor
 * @requires client/src/modules/components/popup-manager
 * @requires client/src/utils/base
 * @requires client/src/utils/helpers-ui
 * @requires client/src/utils/helpers-bookshelf
 * @requires client/src/utils/helpers-reader
 * @requires client/src/utils/helpers-fonts
 */

import * as CONFIG from "../../config/index.js";
import { Logger } from "../../../../shared/utils/logger.js";
import { reader } from "../reader/reader.js";
import { cbReg } from "../../../../shared/core/callback/callback-registry.js";
import { hooks } from "../../core/hooks.js";
import { TextProcessor } from "../text/text-processor.js";
import { FileProcessor } from "./file-processor.js";
import { EpubConverter } from "../epub/epub-converter.js";
import { PaginationCalculator } from "../../../../shared/core/text/pagination-calculator.js";
import { PopupManager } from "../../components/popup-manager.js";
import { getFootnotes } from "../reader/footnotes.js";
import {
    removeFileExtension,
    randomFloatFromInterval,
    formatBytes,
    addFootnotesToDOM,
    pairAnchorsAndFootnotes,
    constructNotificationMessageFromArray,
    isSafari,
} from "../../utils/base.js";
import {
    hideDropZone,
    resetDropZoneState,
    updatePaginationCalculations,
    showLoadingScreen,
    hideLoadingScreen,
    hideContent,
    showContent,
    resetUI,
    resetVars,
    getCurrentDisplayLanguage,
} from "../../utils/helpers/ui.js";
import {
    getIsFromLocal,
    getIsOnServer,
    setIsFromLocal,
    setIsOnServer,
    setBookLastReadTimestamp,
} from "../../utils/helpers/bookshelf.js";
import {
    GetScrollPositions,
    getHistory,
    getHistoryAndSetChapterTitleActive,
    setTitle,
} from "../../utils/helpers/reader.js";
import { validateFontFile } from "../../utils/helpers/fonts.js";

/**
 * @class FileHandler
 * @classdesc Handles file uploads and processing
 */
export class FileHandler {
    /**
     * Logger
     * @private
     * @type {Logger}
     */
    static #logger = Logger.getLogger(this, false);

    /**
     * Flag for database save complete
     * @private
     * @type {boolean}
     */
    static #dbSaveComplete = false;

    /**
     * Flag for processing complete
     * @private
     * @type {boolean}
     */
    static #processingComplete = false;

    /**
     * Mark database save complete
     */
    static markDBSaveComplete() {
        this.#logger.log("FileHandler markDBSaveComplete");
        this.#dbSaveComplete = true;
        this.#checkShowBookshelfBtn();
    }

    /**
     * Mark processing complete
     */
    static markProcessingComplete() {
        this.#logger.log("FileHandler markProcessingComplete");
        this.#processingComplete = true;
        this.#checkShowBookshelfBtn();
    }

    /**
     * Check and show bookshelf trigger button
     */
    static #checkShowBookshelfBtn() {
        this.#logger.log("FileHandler #checkShowBookshelfBtn");
        if (this.#dbSaveComplete && this.#processingComplete) {
            this.#logger.log("FileHandler #checkShowBookshelfBtn callbackRegistry.fire");
            cbReg.go("showBookshelfTriggerBtn");
            this.#dbSaveComplete = false;
            this.#processingComplete = false;
        }
    }

    /**
     * Handles multiple file uploads with bookshelf integration
     * @param {FileList} fileList - List of files to process
     * @param {boolean} isFromLocal - Whether files are from local storage
     * @param {boolean} isOnServer - Whether files are stored on server
     * @param {boolean} loadFiles - Whether to load files into memory
     * @returns {Promise<void>}
     */
    static async handleMultipleFiles(fileList, isFromLocal = true, isOnServer = false, loadFiles = true) {
        // Show loading screen
        hideDropZone();
        hideContent();
        showLoadingScreen();

        // Processing input files
        const allFiles = Array.from(fileList);

        // Separate EPUB files from the rest. A file "looks like an EPUB" only
        // when BOTH conditions hold: its name ends with `.epub` AND its magic
        // number is a ZIP signature. Files that merely have the .epub extension
        // but aren't actually zips (commonly mis-named TXTs) fall through to
        // the TXT path below, so the user still gets to read them instead of
        // hitting an opaque JSZip "Can't find end of central directory" error.
        const epubCandidates = allFiles.filter((file) => file.name.toLowerCase().endsWith(CONFIG.CONST_FILE.SUPPORTED_EPUB_EXT));
        const epubFiles = [];
        const nonEpubFiles = [];
        for (const file of epubCandidates) {
            if (await FileHandler.#isLikelyEpub(file)) {
                epubFiles.push(file);
            } else {
                // Misnamed .epub — treat as TXT so user can still read it.
                // Override the .type so the TXT branch accepts it (File.type
                // is empty when the OS didn't recognize the extension).
                nonEpubFiles.push(file);
            }
        }
        for (const file of allFiles) {
            if (!file.name.toLowerCase().endsWith(CONFIG.CONST_FILE.SUPPORTED_EPUB_EXT)) {
                nonEpubFiles.push(file);
            }
        }

        // Handle EPUB files (first one wins, same as TXT single-file behavior)
        if (epubFiles.length > 0) {
            resetVars();
            const epubFile = epubFiles[0];
            setIsFromLocal(epubFile.name, getIsFromLocal(epubFile.name) || isFromLocal);
            setIsOnServer(epubFile.name, getIsOnServer(epubFile.name) || isOnServer);
            setBookLastReadTimestamp(epubFile.name);
            await FileHandler.handleEpubFile(epubFile);

            // If there are also TXT files, notify user that only one type is handled at a time
            if (nonEpubFiles.length > 0) {
                PopupManager.showNotification({
                    iconName: "BOOK",
                    text: CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_wrongFileType || "EPUB file opened. TXT files were ignored.",
                    iconColor: "info",
                });
            }
            return;
        }

        let txtFiles = nonEpubFiles.filter((file) => file.type === CONFIG.CONST_FILE.SUPPORTED_FILE_TYPE);
        // Files we reclassified from .epub → TXT path above have .type set by
        // the browser as "application/epub+zip" (because of the extension),
        // not "text/plain". If we left them in otherFiles they'd be sent to
        // the font validator and rejected as invalid fonts. Pick them out
        // here and treat as TXT so the user can still read the content.
        // BUT: a misnamed .epub that isn't actually a zip may also not be
        // text (e.g. a renamed image). Reading such bytes as TXT produces
        // garbage, so run a text/binary heuristic and surface an
        // epubInvalid notification for the ones that fail.
        const misnamedEpubCandidates = nonEpubFiles.filter(
            (file) => file.name.toLowerCase().endsWith(CONFIG.CONST_FILE.SUPPORTED_EPUB_EXT) &&
                       !txtFiles.includes(file)
        );
        const misnamedEpubs = [];
        for (const file of misnamedEpubCandidates) {
            if (await FileHandler.#isLikelyText(file)) {
                misnamedEpubs.push(file);
            } else {
                PopupManager.showNotification({
                    iconName: "WRONG_FILE_TYPE",
                    iconColor: "error",
                    text: constructNotificationMessageFromArray(
                        CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_epubInvalid,
                        [file.name],
                        { language: getCurrentDisplayLanguage(), maxItems: 1 }
                    ),
                });
            }
        }
        txtFiles = txtFiles.concat(misnamedEpubs);
        const otherFiles = nonEpubFiles.filter(
            (file) => file.type !== CONFIG.CONST_FILE.SUPPORTED_FILE_TYPE &&
                       !misnamedEpubCandidates.includes(file)
        );
        // const fontFiles = allFiles.filter((file) => CONFIG.CONST_FONT.SUPPORTED_FONT_TYPES.includes(file.type));

        // Validate font files
        const fontValidationResults = await Promise.all(
            otherFiles.map(async (file) => {
                const isSupportedType = CONFIG.CONST_FONT.SUPPORTED_FONT_TYPES.includes(file.type);
                const validation = await validateFontFile(file);
                const isValidFont = validation.isValid;
                const reason = validation.reason;

                // console.log(`File: ${file.name}, isSupportedType: ${isSupportedType}, isValidFont: ${isValidFont}`);
                // return isSupportedType || isValidFont;
                // return isValidFont;
                return validation;
            })
        );
        // console.log("fontValidationResults: ", fontValidationResults);

        // Filter out invalid font files
        // const fontFiles = otherFiles.filter((_, index) => fontValidationResults[index].isValid);
        const fontFiles = [];
        const incorrectFonts = [];
        const invalidFiles = [];
        fontValidationResults.forEach((result, index) => {
            if (result.isValid) {
                fontFiles.push(otherFiles[index]);
            } else {
                if (result.type === 0) {
                    incorrectFonts.push(otherFiles[index].name);
                } else {
                    invalidFiles.push(otherFiles[index].name);
                }
            }
        });

        // console.groupCollapsed("[Input Files]");
        // console.log("allFiles: ", allFiles);
        // console.log("txtFiles: ", txtFiles);
        // console.log("fontFiles: ", fontFiles);
        // console.log("incorrectFonts: ", incorrectFonts);
        // console.log("invalidFiles: ", invalidFiles);
        // console.groupEnd();

        // Handle incorrect font files
        if (incorrectFonts.length > 0) {
            if (isSafari()) {
                PopupManager.showNotification({
                    iconName: "SAFARI",
                    iconColor: "error",
                    text: constructNotificationMessageFromArray(
                        CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_fontNotSupportedInSafari,
                        incorrectFonts,
                        {
                            language: getCurrentDisplayLanguage(),
                            maxItems: 3,
                            messageSuffix: CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_andMore,
                        }
                    ),
                });
            } else {
                PopupManager.showNotification({
                    iconName: "FONT_FILE_INVALID",
                    iconColor: "error",
                    text: constructNotificationMessageFromArray(
                        CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_fontFileInvalid,
                        incorrectFonts,
                        {
                            language: getCurrentDisplayLanguage(),
                            maxItems: 3,
                            messageSuffix: CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_andMore,
                        }
                    ),
                });
            }
        }

        // Handle invalid files
        if (invalidFiles.length > 0) {
            PopupManager.showNotification({
                iconName: "WRONG_FILE_TYPE",
                iconColor: "error",
                text: constructNotificationMessageFromArray(
                    CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_wrongFileType,
                    invalidFiles,
                    {
                        language: getCurrentDisplayLanguage(),
                        maxItems: 3,
                        messageSuffix: CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_andMore,
                    }
                ),
            });
        }

        // Handle text file size limit
        const largeTxtFiles = txtFiles.filter((file) => file.size > CONFIG.CONST_FILE.MAX_FILE_SIZE);
        if (largeTxtFiles.length > 0) {
            // Remove large txt files from txtFiles
            txtFiles = txtFiles.filter((file) => !largeTxtFiles.includes(file));

            PopupManager.showNotification({
                iconName: "WRONG_FILE_TYPE",
                iconColor: "error",
                text: constructNotificationMessageFromArray(
                    CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_fileSizeLimit,
                    largeTxtFiles.map((file) => file.name),
                    {
                        language: getCurrentDisplayLanguage(),
                        maxItems: 3,
                        messageSuffix: CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_andMore,
                    }
                ),
            });
        }

        // Check if there are no valid files
        if (txtFiles.length === 0 && fontFiles.length === 0 && fileList.length > 0) {
            // Hide loading screen
            resetDropZoneState();
            hideLoadingScreen();

            return;
        }

        // Handle font files
        if (fontFiles.length > 0) {
            // await resetUI();
            cbReg.go("handleMultipleFonts", {
                files: fontFiles,
            });
        }

        // Check if there are no valid text files
        if (txtFiles.length === 0) {
            // Hide loading screen
            resetDropZoneState();
            hideLoadingScreen();

            return;
        }

        // Handle text files
        if (txtFiles.length > 1 || isOnServer) {
            resetVars();
            // Trigger different events based on whether files should be loaded
            const eventName = loadFiles ? "handleMultipleBooks" : "handleMultipleBooksWithoutLoading";
            cbReg.go(eventName, {
                files: txtFiles,
                isFromLocal,
                isOnServer,
            });

            if (eventName !== "handleMultipleBooksWithoutLoading") {
                PopupManager.showNotification({
                    iconName: "BOOK",
                    text: constructNotificationMessageFromArray(
                        CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_bookAdded,
                        txtFiles.map((file) => file.name),
                        {
                            language: getCurrentDisplayLanguage(),
                            maxItems: 3,
                            messageSuffix: CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_andMore,
                        }
                    ),
                });
            }
        } else if (loadFiles && txtFiles.length === 1) {
            resetVars();
            const singleFile = txtFiles[0];
            setIsFromLocal(singleFile.name, getIsFromLocal(singleFile.name) || isFromLocal);
            setIsOnServer(singleFile.name, getIsOnServer(singleFile.name) || isOnServer);
            setBookLastReadTimestamp(singleFile.name);

            // PopupManager.showNotification({
            //     iconName: "BOOK",
            //     text: constructNotificationMessageFromArray(
            //         CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_bookAdded,
            //         [singleFile.name],
            //         {
            //             language: getCurrentDisplayLanguage(),
            //             maxItems: 3,
            //             messageSuffix: CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_andMore,
            //         }
            //     ),
            // });

            await FileHandler.handleSelectedFile(txtFiles);
        } else {
            console.log("No valid file selected.");
            await resetUI();
        }
    }

    /**
     * Handles a single selected file for reading using chunked processing
     * @param {FileList} fileList - List containing single file to process
     * @param {boolean} isEastern - Whether the file is eastern language
     * @param {string} encoding - The encoding of the file
     * @returns {Promise<void>}
     */
    static async handleSelectedFile(fileList, isEastern = null, encoding = null, forceRefresh = false) {
        /**
         * Metrics for file processing
         * @private
         * @type {Object}
         * @property {number} fileSize - Size of the file in bytes
         * @property {number} startTime - Start time of the file processing
         * @property {Object} timings - Timings for each step of the file processing
         */
        const metrics = {
            fileSize: 0,
            startTime: performance.now(),
            timings: {},
        };

        /**
         * Logs the timing for a specific label
         * @private
         * @param {string} label - Label for the timing
         * @param {number} startTime - Start time of the timing
         */
        function logTiming(label, startTime) {
            metrics.timings[label] = performance.now() - startTime;
        }

        /**
         * Finalizes and displays the metrics
         * @private
         * @returns {Promise<void>}
         */
        async function finalizeMetrics() {
            // Wait for one frame to ensure all rendering is complete
            await new Promise(requestAnimationFrame);

            const totalTime = performance.now() - metrics.startTime;

            const metricsData = {
                "File name": metrics.fileName,
                "File size": `${formatBytes(metrics.fileSize)}`,
                "Total time": `${(totalTime / 1000).toFixed(3)} sec`,
                ...Object.fromEntries(
                    Object.entries(metrics.timings)
                        .sort(([, a], [, b]) => b - a)
                        .map(([label, time]) => [label, `${(time / 1000).toFixed(3)} sec`])
                ),
            };

            console.groupCollapsed("[File Processing Metrics]");
            console.table(metricsData);
            console.groupEnd();
        }

        /**
         * Finalizes the file processing and displays the metrics
         * @private
         * @returns {Promise<void>}
         */
        async function finalProcessing() {
            // Ensure the file is valid before proceeding
            if (!CONFIG.VARS.FILENAME) {
                throw new Error("Error processing file. No filename found.");
            }

            // Data is ready — run file:afterProcess hooks (T2S et al.)
            // BEFORE showing content so the user sees converted text
            // on the very first render, not after a reload.
            await FileHandler.#applyFileAfterProcessHook();

            // Hide loading screen and show the (now-converted) content
            FileHandler.#deferUIUpdate(() => {
                hideDropZone(false);
                hideLoadingScreen(false);
                showContent();
            });
            await cbReg.go("fileAfter");

            // Trigger saveProcessedBook event
            cbReg.go("saveProcessedBook", {
                name: CONFIG.VARS.FILENAME,
                is_eastern_lan: CONFIG.VARS.IS_EASTERN_LAN,
                encoding: CONFIG.VARS.ENCODING,
                bookAndAuthor: CONFIG.VARS.BOOK_AND_AUTHOR,
                title_page_line_number_offset: CONFIG.VARS.TITLE_PAGE_LINE_NUMBER_OFFSET,
                seal_rotate_en: CONFIG.RUNTIME_VARS.STYLE.seal_rotate_en,
                seal_left: CONFIG.RUNTIME_VARS.STYLE.seal_left,
                file_content_chunks: CONFIG.VARS.FILE_CONTENT_CHUNKS,
                all_titles: CONFIG.VARS.ALL_TITLES,
                all_titles_ind: CONFIG.VARS.ALL_TITLES_IND,
                footnotes: CONFIG.VARS.FOOTNOTES,
                footnote_processed_counter: CONFIG.VARS.FOOTNOTE_PROCESSED_COUNTER,
                page_breaks: CONFIG.VARS.PAGE_BREAKS,
                total_pages: CONFIG.VARS.TOTAL_PAGES,
            });
            await finalizeMetrics();
        }

        /**
         * Logs the timing for a specific label
         * @private
         * @param {string} label - Label for the timing
         * @param {number} startTime - Start time of the timing
         */
        function logTiming(label, startTime) {
            metrics.timings[label] = performance.now() - startTime;
        }

        /** Start processing */
        if (!fileList.length || fileList[0].type !== CONFIG.CONST_FILE.SUPPORTED_FILE_TYPE) {
            PopupManager.showNotification({
                iconName: "WRONG_FILE_TYPE",
                text: CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_wrongFileType,
                iconColor: "error",
            });

            // Hide loading screen
            resetDropZoneState();
            hideLoadingScreen();

            return;
        }

        try {
            // Show loading screen
            hideDropZone();
            hideContent();
            showLoadingScreen();

            resetVars();

            const file = await cbReg.go("fileBefore", fileList[0]);
            metrics.fileSize = file.size;
            metrics.fileName = file.name;

            // Create processor
            const processor = new FileProcessor(file, isEastern, encoding);
            CONFIG.VARS.IS_BOOK_OPENED = true;

            // Only detect encoding if not provided
            // console.log("isEastern: ", isEastern);
            // console.log("encoding: ", encoding);
            if (isEastern === null || encoding === null) {
                const encodingStart = performance.now();
                await processor.detectEncodingAndLanguage();
                CONFIG.VARS.IS_EASTERN_LAN = processor.isEasternLan;
                CONFIG.VARS.ENCODING = processor.encoding;
                logTiming("Encoding detection", encodingStart);
                // console.log("Encoding:", processor.encoding);
                // console.log("isEasternLan:", processor.isEasternLan);
            } else {
                CONFIG.VARS.IS_EASTERN_LAN = isEastern;
                CONFIG.VARS.ENCODING = encoding;
                processor.isEasternLan = isEastern;
                processor.encoding = encoding;

                // Change UI language based on detected language... or not?
                // CONFIG.RUNTIME_VARS.RESPECT_USER_LANG_SETTING = (document.documentElement.getAttribute("respectUserLangSetting") === "true");
                cbReg.go("updateUILanguage", {
                    lang: getCurrentDisplayLanguage(),
                    saveToLocalStorage: false,
                });
            }

            // Process metadata
            const metadataStart = performance.now();
            await processor.processBookMetadata();
            CONFIG.VARS.BOOK_AND_AUTHOR = processor.bookMetadata;
            CONFIG.VARS.FILENAME = file.name && fileList[0].name;
            CONFIG.VARS.TITLE_PAGE_LINE_NUMBER_OFFSET = processor.title_page_line_number_offset;

            // Detect log mode
            if (CONFIG.CONST_CONFIG.LOG_MODE) {
                CONFIG.VARS.IS_LOG_MODE = true;
            } else if (CONFIG.CONST_CONFIG.LOG_FILENAME_RE?.test(CONFIG.VARS.FILENAME)) {
                // Auto-detect from filename even if log mode is off
                CONFIG.VARS.IS_LOG_MODE = true;
            } else {
                CONFIG.VARS.IS_LOG_MODE = false;
            }
            processor.logMode = CONFIG.VARS.IS_LOG_MODE;
            if (CONFIG.VARS.IS_LOG_MODE) {
                console.log("Log mode detected for:", CONFIG.VARS.FILENAME);
            }
            CONFIG.RUNTIME_VARS.STYLE.seal_rotate_en = processor.seal_rotate_en;
            CONFIG.RUNTIME_VARS.STYLE.seal_left = processor.seal_left;
            setTitle(CONFIG.VARS.BOOK_AND_AUTHOR.bookName);
            logTiming("Metadata processing", metadataStart);
            // console.log("Book metadata:", CONFIG.VARS.BOOK_AND_AUTHOR);

            // Process initial chunk
            const initialChunkStart = performance.now();
            const initialChunkResult = await processor.processInitialChunk();
            // console.log("initialChunkResult: ", initialChunkResult);

            // Update global state with initial chunk
            CONFIG.VARS.FILE_CONTENT_CHUNKS = initialChunkResult.htmlLines;
            CONFIG.VARS.ALL_TITLES = initialChunkResult.titles;
            CONFIG.VARS.ALL_TITLES_IND = initialChunkResult.titles_ind;
            FileHandler.#verifyTitleAndIndexCount("[handleSelectedFile initialChunk]");
            CONFIG.VARS.FOOTNOTES = initialChunkResult.footnotes;
            CONFIG.VARS.FOOTNOTE_PROCESSED_COUNTER = initialChunkResult.footnoteCounter;
            CONFIG.VARS.PAGE_BREAKS = initialChunkResult.pageBreaks;
            CONFIG.VARS.TOTAL_PAGES = CONFIG.VARS.PAGE_BREAKS.length;
            logTiming("Initial chunk processing", initialChunkStart);
            // console.log("CONFIG.VARS.PAGE_BREAKS: ", CONFIG.VARS.PAGE_BREAKS);
            // console.log("CONFIG.VARS.TOTAL_PAGES: ", CONFIG.VARS.TOTAL_PAGES);

            // Convert initial chunk data (T2S etc.) before the first render
            // so the user sees converted text immediately, not after a reload.
            await FileHandler.#applyFileAfterProcessHook();

            // Update UI with initial content
            const initialUIStart = performance.now();

            // Process TOC
            reader.initTOC();
            reader.processTOC();

            // Show initial content
            CONFIG.VARS.INIT = false;
            reader.showCurrentPageContent();
            reader.generatePagination();
            updatePaginationCalculations(false);
            GetScrollPositions(false);
            logTiming("Initial UI update", initialUIStart);

            // If bookshelf and fast open are enabled and history is found within 90% of the initial chunk, show content early without waiting for processing to complete
            const hasHistoryBeyondInitChunk =
                (await getHistory(CONFIG.VARS.FILENAME)) > CONFIG.VARS.FILE_CONTENT_CHUNKS.length * 0.9;
            if (
                CONFIG.RUNTIME_CONFIG.ENABLE_BOOKSHELF &&
                CONFIG.RUNTIME_CONFIG.ENABLE_FAST_OPEN &&
                !hasHistoryBeyondInitChunk
            ) {
                await getHistoryAndSetChapterTitleActive(reader.gotoLine.bind(reader));

                // Hide loading screen
                hideDropZone(false);
                hideLoadingScreen(false);
                showContent();
            }

            // Update pagination UI to show processing state
            if (file.size > processor.initialChunkSize) {
                // Hide bookshelf trigger button if bookshelf is opened
                cbReg.go("hideBookshelfTriggerBtn");

                // Set processing flag
                CONFIG.VARS.IS_PROCESSING = true;

                // Add processing indicator to pagination
                const paginationElement = document.querySelector(".pagination");
                if (paginationElement) {
                    const existingIndicator = CONFIG.DOM_ELEMENT.PAGINATION_INDICATOR;
                    if (!existingIndicator) {
                        const paginationIndicator = document.createElement("div");
                        paginationIndicator.id = "pagination-indicator";
                        const paginationIndicatorSpan = document.createElement("span");
                        paginationIndicatorSpan.classList.add("pagination-processing", "prevent-select");
                        paginationIndicator.appendChild(paginationIndicatorSpan);
                        paginationElement.appendChild(paginationIndicator);

                        // const paginationBorder = document.querySelector("#pagination");
                        // paginationBorder.style.borderColor = CONFIG.RUNTIME_VARS.STYLE.mainColor_active;
                    }
                }
                reader.generatePagination();

                // Process remaining content in background
                const remainingStart = performance.now();

                await processor
                    .processRemainingContent()
                    .then(async (remainingResult) => {
                        // Update global state
                        CONFIG.VARS.FILE_CONTENT_CHUNKS = remainingResult.htmlLines;
                        CONFIG.VARS.ALL_TITLES = remainingResult.titles;
                        CONFIG.VARS.ALL_TITLES_IND = remainingResult.titles_ind;
                        FileHandler.#verifyTitleAndIndexCount("[handleSelectedFile remainingContent]");
                        CONFIG.VARS.FOOTNOTES = remainingResult.footnotes;
                        CONFIG.VARS.FOOTNOTE_PROCESSED_COUNTER = remainingResult.footnoteCounter;
                        CONFIG.VARS.PAGE_BREAKS = remainingResult.pageBreaks;
                        CONFIG.VARS.TOTAL_PAGES = CONFIG.VARS.PAGE_BREAKS.length;
                        // console.log(CONFIG.VARS.PAGE_BREAKS);

                        // Run T2S (and other file:afterProcess hooks) on the
                        // freshly merged remaining data BEFORE updating the UI,
                        // so the user sees converted text immediately.
                        await FileHandler.#applyFileAfterProcessHook();

                        // Set processing flag to false
                        CONFIG.VARS.IS_PROCESSING = false;

                        // Remove the existing processing indicator
                        FileHandler.#deferUIUpdate(() => {
                            const paginationIndicator = CONFIG.DOM_ELEMENT.PAGINATION_INDICATOR;
                            if (paginationIndicator) {
                                paginationIndicator.remove();
                            }
                        });

                        // Update UI
                        FileHandler.#deferUIUpdate(() => {
                            requestAnimationFrame(() => {
                                reader.processTOC();

                                requestAnimationFrame(() => {
                                    reader.generatePagination();

                                    requestAnimationFrame(() => {
                                        updatePaginationCalculations(false);

                                        requestAnimationFrame(() => {
                                            GetScrollPositions(false);
                                        });
                                    });
                                });
                            });
                        });

                        logTiming("Remaining content processing", remainingStart);
                        // console.log("Background processing complete");
                    })
                    .catch((error) => {
                        throw new Error("Error processing remaining content: " + error);
                    });
            }

            // Show bookshelf trigger button
            // FileHandler.#deferUIUpdate(() => {
            //     cbReg.go("showBookshelfTriggerBtn");
            // });
            FileHandler.markProcessingComplete();

            // Mark DB save complete if forceRefresh is true
            // since when reprocessing, there's no DB event
            if (forceRefresh) {
                FileHandler.markDBSaveComplete();
            }

            // Retrieve reading history
            await getHistoryAndSetChapterTitleActive(reader.gotoLine.bind(reader));

            // Complete initial processing
            await finalProcessing();
        } catch (error) {
            CONFIG.VARS.IS_BOOK_OPENED = false;
            await resetUI();
            throw new Error("Error processing file: " + error);
        }
    }

    /**
     * Handles a processed book
     * @param {Object} book - Processed book data
     * @returns {Promise<void>}
     */
    static async handleProcessedBook(book) {
        // console.log("Processed book: ", book);
        if (book && book?.processed) {
            // Show loading screen
            hideDropZone();
            hideContent();
            showLoadingScreen();

            resetVars();

            CONFIG.VARS.IS_BOOK_OPENED = true;
            CONFIG.VARS.FILENAME = book.name;
            CONFIG.VARS.IS_EASTERN_LAN = book.is_eastern_lan ?? TextProcessor.getLanguage(book.file_content_chunks[0]);
            CONFIG.VARS.ENCODING = book.encoding ?? "utf-8";
            CONFIG.VARS.BOOK_AND_AUTHOR = book.bookAndAuthor;
            CONFIG.VARS.TITLE_PAGE_LINE_NUMBER_OFFSET = book.title_page_line_number_offset;
            CONFIG.RUNTIME_VARS.STYLE.seal_rotate_en = book.seal_rotate_en;
            CONFIG.RUNTIME_VARS.STYLE.seal_left = book.seal_left;
            CONFIG.VARS.FILE_CONTENT_CHUNKS = book.file_content_chunks;
            CONFIG.VARS.ALL_TITLES = book.all_titles;
            CONFIG.VARS.ALL_TITLES_IND = book.all_titles_ind;
            FileHandler.#verifyTitleAndIndexCount("[handleProcessedBook]");
            CONFIG.VARS.FOOTNOTES = book.footnotes;
            CONFIG.VARS.FOOTNOTE_PROCESSED_COUNTER = book.footnote_processed_counter;
            CONFIG.VARS.PAGE_BREAKS = book.page_breaks;
            CONFIG.VARS.TOTAL_PAGES = book.total_pages;

            // Set title
            setTitle(CONFIG.VARS.BOOK_AND_AUTHOR.bookName);

            // console.log("isEasternLan: ", CONFIG.VARS.IS_EASTERN_LAN);
            // Change UI language based on detected language... or not?
            // CONFIG.RUNTIME_VARS.RESPECT_USER_LANG_SETTING = (document.documentElement.getAttribute("respectUserLangSetting") === "true");
            cbReg.go("updateUILanguage", {
                lang: getCurrentDisplayLanguage(),
                saveToLocalStorage: false,
            });

            // [Deprecated] Add footnotes to DOM
            // addFootnotesToDOM(CONFIG.VARS.FOOTNOTES, CONFIG.DOM_ELEMENT.FOOTNOTE_CONTAINER);
            // [New] Set the lookup function for the current chunk/footnotes
            const pairedFootnotes = pairAnchorsAndFootnotes(CONFIG.VARS.FOOTNOTES);
            getFootnotes().setFootnoteLookup((markerCode, index) => {
                index = Number(index);
                return pairedFootnotes[markerCode]?.[index] || CONFIG.CONST_FOOTNOTE.NOTFOUND;
            });

            // Run the file:afterProcess hook pipeline (T2S, etc.) BEFORE
            // showing content so the user sees converted text on re-open.
            await FileHandler.#applyFileAfterProcessHook();

            // Process TOC
            reader.initTOC();
            reader.processTOC();

            // Show initial content
            CONFIG.VARS.INIT = false;
            reader.showCurrentPageContent();
            reader.generatePagination();
            updatePaginationCalculations(false);
            GetScrollPositions(false);

            // Retrieve reading history
            await getHistoryAndSetChapterTitleActive(reader.gotoLine.bind(reader));

            // Hide loading screen
            hideDropZone();
            hideLoadingScreen();
            showContent();
            await cbReg.go("fileAfter");
        } else if (book?.is_epub) {
            const epubFile = new File([book?.data], book.name, { type: "application/epub+zip" });
            await FileHandler.handleEpubFile(epubFile);
        } else {
            await FileHandler.handleSelectedFile([book?.data], null, null, true);
        }
    }

    /**
     * Checks if CONFIG.VARS.ALL_TITLES and CONFIG.VARS.ALL_TITLES_IND length match
     * @param {string} messageHeader - Message header
     * @throws {Error} If all titles and CONFIG.VARS.ALL_TITLES_IND length mismatch
     */

    /**
     * Handles an EPUB file by converting it to SimpleTextReader's content structure
     * @param {File} file - The EPUB file
     * @returns {Promise<void>}
     */
    static async handleEpubFile(file) {
        const metrics = {
            startTime: performance.now(),
        };
        this.#logger.log(`Starting: ${file.name}`);

        // Hoist loading-text helpers above the try block so the catch handler can
        // safely restore the original loading text even when the error occurs
        // before/inside the conversion call. Declaring them inside try would mask
        // the real error with a ReferenceError in catch.
        const loadingEl = CONFIG.DOM_ELEMENT.LOADING_SCREEN;
        const originalLoadingText = loadingEl?.style.getPropertyValue("--ui_dropZoneText_loading");
        const epubLoadingBase = (() => {
            if (!loadingEl) return "";
            const v = getComputedStyle(loadingEl).getPropertyValue("--ui_dropZoneText_loading_epub").trim();
            return v || "Parsing EPUB...";
        })();
        const setEpubLoadingText = (showEpub) => {
            if (loadingEl) {
                loadingEl.style.setProperty(
                    "--ui_dropZoneText_loading",
                    showEpub ? epubLoadingBase : originalLoadingText
                );
            }
        };

        try {
            // Enforce EPUB file size limit
            if (file.size > CONFIG.CONST_FILE.MAX_EPUB_FILE_SIZE) {
                PopupManager.showNotification({
                    iconName: "WRONG_FILE_TYPE",
                    iconColor: "error",
                    text: constructNotificationMessageFromArray(
                        CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_epubTooLarge,
                        [file.name],
                        {
                            language: getCurrentDisplayLanguage(),
                            maxItems: 1,
                        }
                    ),
                });
                const err = new Error(`EPUB file too large: ${file.size} bytes`);
                err.code = "EPUB_TOO_LARGE";
                throw err;
            }

            hideDropZone();
            hideContent();
            showLoadingScreen();

            CONFIG.VARS.IS_BOOK_OPENED = true;

            // Convert EPUB to content structure
            setEpubLoadingText(true);

            const convertResult = await EpubConverter.convert(file, (step) => {
                if (step !== "complete") {
                    setEpubLoadingText(true);
                }
            });

            // Normalize new envelope shape { source, htmlLines, ... } and legacy flat shape
            const result = convertResult.source?.type === "epub"
                ? convertResult
                : { ...convertResult, source: { type: "epub", filename: file.name, size_bytes: file.size } };
            this.#logger.log(`Convert returned: ${result.htmlLines.length} lines, ${result.titles.length} titles`);

            // Set metadata
            const bookName = result.metadata.title || removeFileExtension(file.name);
            const author = result.metadata.author || "";
            this.#logger.log(`Book: "${bookName}" by "${author}"`);
            CONFIG.VARS.BOOK_AND_AUTHOR = {
                bookName,
                author,
                bookNameRE: bookName,
                authorRE: author,
            };
            CONFIG.VARS.FILENAME = file.name;
            // Detect language from actual content, not just title/author
            const contentSample = result.htmlLines
                .filter(l => l.elementType === "p" || l.elementType === "h")
                .slice(0, 10)
                .map(l => l.content || "")
                .join(" ")
                .replace(/<[^>]*>/g, "")
                .slice(0, 500);
            const languageHint = result.metadata?.language || "";
            CONFIG.VARS.IS_EASTERN_LAN = TextProcessor.getLanguage(
                (bookName + " " + author + " " + languageHint + " " + contentSample).slice(0, 1000)
            );
            CONFIG.VARS.ENCODING = "utf-8";
            CONFIG.VARS.TITLE_PAGE_LINE_NUMBER_OFFSET = 0;

            // Set content
            CONFIG.VARS.FILE_CONTENT_CHUNKS = result.htmlLines;
            CONFIG.VARS.ALL_TITLES = result.titles;
            CONFIG.VARS.ALL_TITLES_IND = result.titlesInd;
            FileHandler.#verifyTitleAndIndexCount("[handleEpubFile]");
            CONFIG.VARS.FOOTNOTES = [];
            CONFIG.VARS.FOOTNOTE_PROCESSED_COUNTER = 0;

            // Set pagination using the shared PaginationCalculator
            const paginationConfig = {
                IS_EASTERN_LAN: CONFIG.VARS.IS_EASTERN_LAN,
                BOOK_AND_AUTHOR: CONFIG.VARS.BOOK_AND_AUTHOR,
                PAGE_BREAK_ON_TITLE: CONFIG.RUNTIME_CONFIG.PAGE_BREAK_ON_TITLE,
                COMPLETE_BOOK: true,
                MAX_LINES: CONFIG.CONST_PAGINATION.MAX_LINES,
                MIN_LINES: CONFIG.CONST_PAGINATION.MIN_LINES,
                MAX_CHARS: CONFIG.CONST_PAGINATION.MAX_CHARS,
                MIN_CHARS: CONFIG.CONST_PAGINATION.MIN_CHARS,
                USE_CHAR_COUNT: CONFIG.CONST_PAGINATION.USE_CHAR_COUNT,
                CHAR_MULTIPLIER: CONFIG.CONST_PAGINATION.CHAR_MULTIPLIER,
            };
            // PaginationCalculator requires at least one title; inject a synthetic one if needed
            const calculatorTitles = result.titles.length > 0 ? result.titles : [[bookName, 0, bookName, false]];
            const calculator = new PaginationCalculator(result.htmlLines, calculatorTitles, paginationConfig);
            const pageBreaks = calculator.calculate();

            CONFIG.VARS.PAGE_BREAKS = pageBreaks;
            CONFIG.VARS.TOTAL_PAGES = pageBreaks.length;
            CONFIG.VARS.CURRENT_PAGE = 1;
            this.#logger.log(`Pagination: ${pageBreaks.length} pages`);

            // Set title
            this.#logger.log("Setting title...");
            setTitle(bookName);

            // Update UI language
            this.#logger.log("Updating UI language...");
            cbReg.go("updateUILanguage", {
                lang: getCurrentDisplayLanguage(),
                saveToLocalStorage: false,
            });

            // Process TOC
            this.#logger.log("Processing TOC...");
            reader.initTOC();
            reader.processTOC();
            this.#logger.log(`TOC processed: ${reader.getTOCEntries?.()?.length || 'N/A'} entries`);

            // Show content
            this.#logger.log("Rendering content...");
            CONFIG.VARS.INIT = false;
            reader.showCurrentPageContent();
            this.#logger.log("showCurrentPageContent done");

            reader.generatePagination();
            this.#logger.log("generatePagination done");
            this.#logger.log("updatePaginationCalculations...");
            updatePaginationCalculations(false);
            this.#logger.log("GetScrollPositions...");
            GetScrollPositions(false);

            // Save to bookshelf DB (fire-and-forget, error is handled internally)
            this.#logger.log("saveProcessedBook (fire & forget)...");
            cbReg.go("saveProcessedBook", {
                name: file.name,
                is_epub: true,
                converted: true,
                epubConverterVersion: CONFIG.CONST_FILE.EPUB_CONVERTER_VERSION,
                processed: true,
                is_eastern_lan: CONFIG.VARS.IS_EASTERN_LAN,
                encoding: "utf-8",
                bookAndAuthor: CONFIG.VARS.BOOK_AND_AUTHOR,
                title_page_line_number_offset: 0,
                seal_rotate_en: "",
                seal_left: -1,
                file_content_chunks: result.htmlLines,
                all_titles: result.titles,
                all_titles_ind: result.titlesInd,
                footnotes: [],
                footnote_processed_counter: 0,
                page_breaks: pageBreaks,
                total_pages: pageBreaks.length,
                data: file,
            });

            FileHandler.markProcessingComplete();
            FileHandler.markDBSaveComplete();

            // Retrieve reading history (skip if no titles to avoid hanging on tocRendered)
            if (result.titles.length > 0) {
                this.#logger.log("Retrieving reading history...");
                await getHistoryAndSetChapterTitleActive(reader.gotoLine.bind(reader));
                this.#logger.log("History retrieved");
            } else {
                this.#logger.log("Skipping history (no titles in this EPUB)");
            }

            // Run the file:afterProcess hook pipeline (T2S, etc.) BEFORE
            // showing content so the user sees converted text on re-open.
            await FileHandler.#applyFileAfterProcessHook();

            // Finalize UI
            this.#logger.log("Hiding loading screen...");
            setEpubLoadingText(false);
            hideDropZone(false);
            hideLoadingScreen(false);
            showContent();
            this.#logger.log("UI finalized, triggering fileAfter...");
            await cbReg.go("fileAfter");
            this.#logger.log("Done.");

            const elapsed = (performance.now() - metrics.startTime) / 1000;
            this.#logger.log(`Book opened in ${elapsed.toFixed(3)}s: "${bookName}" by ${author}`);

        } catch (error) {
            setEpubLoadingText(false);
            CONFIG.VARS.IS_BOOK_OPENED = false;
            await resetUI();
            // EPUB_TOO_LARGE already surfaced a specific notification above;
            // skip the generic catch notification to avoid a double popup
            // whose generic message would overwrite the specific reason.
            if (error?.code !== "EPUB_TOO_LARGE") {
                const isZipError = /central directory|is this a zip/i.test(error?.message || "");
                PopupManager.showNotification({
                    iconName: isZipError ? "WRONG_FILE_TYPE" : "ERROR",
                    text: isZipError
                        ? (CONFIG.RUNTIME_VARS.STYLE.ui_notification_text_epubInvalid || "Invalid EPUB file (not a valid zip)")
                        : "Failed to open EPUB file. The file may be corrupted or DRM-protected.",
                    iconColor: "error",
                });
            }
            throw new Error("Error processing EPUB file: " + error);
        }
    }

    static #verifyTitleAndIndexCount(messageHeader) {
        if (CONFIG.VARS.ALL_TITLES.length !== Object.keys(CONFIG.VARS.ALL_TITLES_IND).length) {
            console.log("CONFIG.VARS.ALL_TITLES: ", CONFIG.VARS.ALL_TITLES.length, CONFIG.VARS.ALL_TITLES);
            console.log(
                "CONFIG.VARS.ALL_TITLES_IND: ",
                Object.keys(CONFIG.VARS.ALL_TITLES_IND).length,
                CONFIG.VARS.ALL_TITLES_IND
            );
            throw new Error(`${messageHeader} All titles and all titles indices length mismatch.`);
        }
    }

    /**
     * Quick magic-number check: is this File actually a ZIP (EPUB) container?
     * EPUBs are ZIP files; the first 4 bytes are `PK\x03\x04` (or `PK\x05\x06`
     * for an empty zip). Files that fail this check are almost certainly TXT
     * or other formats that were misnamed .epub — we let them fall through to
     * the TXT path instead of handing them to JSZip (which throws an opaque
     * "Can't find end of central directory" error).
     *
     * @private
     * @static
     * @param {File} file
     * @returns {Promise<boolean>} true if the file starts with a ZIP signature
     */
    static async #isLikelyEpub(file) {
        try {
            // Only need the first 4 bytes to check the magic number.
            // slice(0, 4) on a File returns a Blob; arrayBuffer() resolves to
            // a small ArrayBuffer regardless of original file size.
            const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
            // PK\x03\x04 = regular zip entry; PK\x05\x06 = empty archive
            return (
                head[0] === 0x50 && head[1] === 0x4b &&
                ((head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06))
            );
        } catch (e) {
            this.#logger.log("isLikelyEpub check failed:", e);
            return false;
        }
    }

    /**
     * Heuristic text/binary check for misnamed .epub files that are not
     * actually ZIPs. A file reclassified from .epub → TXT only because its
     * name ends in .epub may in fact be a renamed binary (e.g. an image or
     * office document). Feeding such bytes to the text decoder produces
     * unreadable garbage. We sample the first 1KB and count NUL bytes and
     * non-text bytes (outside tab/newline/cr and printable ASCII ranges);
     * either ratio above 30% ⇒ treat as binary, surface an epubInvalid
     * notification, and skip the TXT path.
     * @private
     * @static
     * @param {File} file
     * @returns {Promise<boolean>} true if the file looks like text
     */
    static async #isLikelyText(file) {
        try {
            const sample = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
            if (sample.length === 0) return true; // empty file ≈ empty text
            let nulls = 0;
            let nonText = 0;
            for (let i = 0; i < sample.length; i++) {
                const b = sample[i];
                if (b === 0) nulls++;
                // Allow tab(9), LF(10), CR(13), printable ASCII (32-126),
                // and high-bit bytes (≥128) which are typical of UTF-8/GBK
                // multibyte sequences in CJK text.
                if (
                    b !== 9 && b !== 10 && b !== 13 &&
                    !(b >= 32 && b <= 126) && b < 128
                ) {
                    nonText++;
                }
            }
            const n = sample.length;
            return nulls / n <= 0.3 && nonText / n <= 0.3;
        } catch (e) {
            this.#logger.log("isLikelyText check failed:", e);
            // On check failure, fall back to the historical behavior
            // (treat as text) so we don't regress the "still readable" case.
            return true;
        }
    }

    /**
     * Defers UI update if an animation is in progress
     * @param {Function} updateFn - The function to execute
     * @param {boolean} consoleLog - Whether to log to console
     */
    static #deferUIUpdate(updateFn, consoleLog = false) {
        if (PopupManager.isAnimating) {
            if (consoleLog) {
                // Extract operation name and categorize
                let operationName = updateFn
                    .toString()
                    .replace(/\s+/g, " ")
                    .match(/=>.*?{(.*?)}/)?.[1];

                // Add icon and categorize based on operation type
                let formattedOperation;
                if (operationName?.includes("requestAnimationFrame")) {
                    formattedOperation =
                        "🔄 Heavy UI Updates: " + operationName.match(/reader\.\w+|update\w+|Get\w+/g)?.join(" → ");
                } else if (operationName?.includes("hideDropZone") || operationName?.includes("showContent")) {
                    formattedOperation = "👁️ Visibility: " + operationName.match(/hide\w+|show\w+/g)?.join(", ");
                } else if (operationName?.includes("paginationIndicator")) {
                    formattedOperation = "🧹 Cleanup: remove pagination indicator";
                } else if (operationName?.includes("triggerCustomEvent") || operationName?.includes("cbReg.go")) {
                    formattedOperation = "🔔 Event: " + operationName.match(/"([^"]+)"/)?.[1];
                }

                console.log("[UI Update] Deferring:", {
                    operations: formattedOperation || "anonymous function",
                    time: new Date().toLocaleTimeString("en-US", {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                    }),
                    queueSize: PopupManager.pendingUIUpdates.size + 1,
                });
            }

            PopupManager.pendingUIUpdates.add(updateFn);
        } else {
            updateFn();
        }
    }

    /**
     * Run the file:afterProcess hook pipeline and mirror the (possibly
     * mutated) result back into CONFIG.VARS.
     *
     * This is the canonical transform hook for post-processing the
     * bookData before it gets saved to the bookshelf and rendered.
     * Currently used by:
     *   - client/src/core/t2s.js — Traditional→Simplified Chinese
     *
     * The hook receives `{ bookData, file }` and may return a mutated
     * bookData. We mirror the result back into CONFIG.VARS so downstream
     * consumers (saveProcessedBook, reader) see the converted content.
     *
     * Must be called from EVERY code path that finalizes a book open:
     *   - finalProcessing() (TXT path)
     *   - handleProcessedBook() (re-open from bookshelf)
     *   - handleEpubFile() (EPUB path)
     *
     * Hook errors are isolated by hooks.run() — a misbehaving hook will
     * be logged and skipped, leaving CONFIG.VARS unchanged.
     *
     * @private
     * @static
     * @returns {Promise<void>}
     */
    static async #applyFileAfterProcessHook() {
        // Defensive: if FILENAME is missing we can't construct the file
        // context, but still run the hook so it can observe the (incomplete)
        // state. Most hooks will early-return on missing bookData.
        if (!CONFIG.VARS.FILENAME) return;

        const bookDataSnapshot = {
            metadata: {
                title: CONFIG.VARS.BOOK_AND_AUTHOR?.bookName ?? "",
                author: CONFIG.VARS.BOOK_AND_AUTHOR?.author ?? "",
            },
            processedLines: CONFIG.VARS.FILE_CONTENT_CHUNKS,
            titles: CONFIG.VARS.ALL_TITLES,
            footnotes: CONFIG.VARS.FOOTNOTES,
        };
        const hookCtx = await hooks.run("file:afterProcess", {
            bookData: bookDataSnapshot,
            file: { name: CONFIG.VARS.FILENAME },
        });
        if (hookCtx && hookCtx.bookData) {
            if (hookCtx.bookData.processedLines) {
                CONFIG.VARS.FILE_CONTENT_CHUNKS = hookCtx.bookData.processedLines;
            }
            if (hookCtx.bookData.titles) {
                CONFIG.VARS.ALL_TITLES = hookCtx.bookData.titles;
            }
            if (hookCtx.bookData.footnotes) {
                CONFIG.VARS.FOOTNOTES = hookCtx.bookData.footnotes;
            }
            if (hookCtx.bookData.metadata && CONFIG.VARS.BOOK_AND_AUTHOR) {
                if (typeof hookCtx.bookData.metadata.title === "string") {
                    CONFIG.VARS.BOOK_AND_AUTHOR.bookName = hookCtx.bookData.metadata.title;
                }
                if (typeof hookCtx.bookData.metadata.author === "string") {
                    CONFIG.VARS.BOOK_AND_AUTHOR.author = hookCtx.bookData.metadata.author;
                }
            }
        }
    }
}
