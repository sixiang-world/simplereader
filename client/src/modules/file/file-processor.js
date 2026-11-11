/**
 * @fileoverview FileProcessor module for processing files
 *
 * @module client/src/modules/file/file-processor
 * @requires client/src/config/index
 * @requires shared/core/callback/callback-registry
 * @requires shared/core/file/file-processor-core
 * @requires client/src/modules/components/cover-animation
 * @requires client/src/utils/base
 * @requires client/src/utils/helpers-worker
 */

import * as CONFIG from "../../config/index.js";
import { cbReg } from "../../../../shared/core/callback/callback-registry.js";
import { FileProcessorCore } from "../../../../shared/core/file/file-processor-core.js";
import {
    randomFloatFromInterval,
} from "../../utils/base.js";
import { createWorker } from "../../utils/helpers/worker.js";
import { WorkerRequests } from "../../utils/helpers/worker-requests.js";

/**
 * Chunked file processor
 * @public
 */
export class FileProcessor extends FileProcessorCore {
    /**
     * Constructor
     * @param {File} file
     * @param {boolean} isEastern - Whether the file is in Eastern language
     * @param {string} encoding - File encoding
     * @public
     */
    constructor(file, isEastern = null, encoding = null, options = {}) {
        super(file.size, isEastern, encoding);

        this.file = file;
        this.worker = createWorker("client/src/modules/file/file-processor-worker.js", import.meta.url);
        this.requests = new WorkerRequests(this.worker);
        this.signal = options.signal;
        this.timeoutMs = options.timeoutMs;
        /** @type {boolean} Whether to process in log mode (skip title/footnote/optimize) */
        this.logMode = false;
    }

    /**
     * Detect file encoding and language
     * @returns {Promise<void>}
     * @public
     */
    async detectEncodingAndLanguage() {
        this.signal?.throwIfAborted();
        // console.log("detectEncodingAndLanguage");
        await super.detectEncodingAndLanguage(this.file);
        this.signal?.throwIfAborted();

        // Change UI language based on detected language... or not?
        // CONFIG.RUNTIME_VARS.RESPECT_USER_LANG_SETTING = (document.documentElement.getAttribute("respectUserLangSetting") === "true");
        // console.log("this.isEasternLan: ", this.isEasternLan);
        if (!CONFIG.RUNTIME_VARS.RESPECT_USER_LANG_SETTING) {
            cbReg.go("updateUILanguage", {
                lang: this.isEasternLan ? "zh" : "en",
                saveToLocalStorage: false,
            });
        }
    }

    /**
     * Process book metadata
     * @returns {Promise<void>}
     * @public
     */
    async processBookMetadata() {
        const { bookName, author, bookNameRE, authorRE } = await this.#sendWorkerMessage("processMetadata", {
            fileName: this.file.name,
        });

        this.bookMetadata = { bookName, author, bookNameRE, authorRE };
        this.title_page_line_number_offset = author !== "" ? 3 : 2;
        this.seal_rotate_en = `${randomFloatFromInterval(-50, 80)}deg`;
        this.seal_left = randomFloatFromInterval(0, 1);
    }

    /** Parse the complete file in one cancellable worker request. */
    async processBook() {
        const titlePage = this.logMode ? null : await this.#generateTitlePage();
        return this.#processContent({
            titlePageLines: titlePage?.lines ?? null,
            titlePageTitles: titlePage?.titles ?? null,
            // The shared core computes the actual final line after parsing.
            endPageLines: titlePage ? [] : null,
            endPageTitles: titlePage ? [[CONFIG.RUNTIME_VARS.STYLE.ui_endPage, 0, CONFIG.RUNTIME_VARS.STYLE.ui_endPage, false]] : null,
        });
    }

    /**
     * Process complete content in background
     * @param {Object} extraContent - Additional content for processing
     * @returns {Promise<{lines: Array<string>, titles: Array<Array<number>>, footnotes: Array<Array<string>>, footnoteCounter: number, pageBreaks: Array<number>}>}
     * @private
     */
    async #processContent(extraContent) {
        const result = await this.#sendWorkerMessage("processBook", {
            file: this.file,
            extraContent,
            title_page_line_number_offset: this.title_page_line_number_offset,
            pageBreakOnTitle: CONFIG.RUNTIME_CONFIG.PAGE_BREAK_ON_TITLE,
            logMode: this.logMode,
        });

        // Merge processing results
        this.processedLines = result.htmlLines;
        this.titles = result.titles;
        this.titles_ind = result.titles_ind;
        this.footnotes = result.footnotes;
        this.footnoteCounter = result.footnoteCounter;
        this.pageBreaks = result.pageBreaks;

        this.isProcessingComplete = true;

        return result;
    }

    /**
     * Generate title page
     * @returns {Promise<{lines: Array<string>, titles: Array<Array<number>>}>}
     * @private
     */
    async #generateTitlePage() {
        const { titlePageLines } = await this.#sendWorkerMessage("generateTitlePage", {
            styles: {
                h1_lineHeight: CONFIG.RUNTIME_VARS.STYLE.h1_lineHeight,
            },
        });

        return {
            lines: titlePageLines,
            titles: [[CONFIG.RUNTIME_VARS.STYLE.ui_titlePage, 0, CONFIG.RUNTIME_VARS.STYLE.ui_titlePage, false]],
        };
    }

    /**
     * Set progress callback
     * @param {Function} callback
     * @public
     */
    setProgressCallback(callback) {
        this.onProgress = callback;
    }

    /**
     * Sends a message to the Worker and handles the response
     * @param {string} operation - Type of operation to perform
     * @param {Object} [data={}] - Additional data to send
     * @returns {Promise<any>} Result of the operation
     * @private
     */
    async #sendWorkerMessage(operation, data = {}) {
        const { type: _type, id: _id, ...result } = await this.requests.request({
            operation,
            encoding: this.encoding,
            isEasternLan: this.isEasternLan,
            metadata: this.bookMetadata,
            ...data,
        }, {
            signal: this.signal,
            timeoutMs: this.timeoutMs,
        });
        return result;
    }

    /**
     * Destroy the file processor
     * @public
     */
    destroy() {
        if (!this.worker) return;
        this.requests.dispose();
        this.worker = null;
    }
}
