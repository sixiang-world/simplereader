/**
 * @fileoverview FileProcessorWorker module for handling file processing tasks
 * that do not involve DOM manipulation. This class is designed to run in a
 * background worker and perform all non-UI related processing.
 *
 * @module client/src/modules/file/file-processor-worker
 * @requires client/src/utils/helpers-worker
 * @requires shared/core/file/file-processor-core
 * @requires client/src/config/constants
 * @requires client/src/config/variables
 * @requires shared/utils/logger
 */

/**
 * Worker message handler
 */
self.onmessage = async function (e) {
    const {
        id,
        operation = null,
        file = null,
        metadata = null,
        extraContent = null,
        encoding = "utf-8",
        isEasternLan = true,
        title_page_line_number_offset = 0,
        pageBreakOnTitle = false,
        styles = null,
        logMode = false,
    } = e.data;
    try {
        const { importDependencies } = await import("../../utils/helpers/worker.js");
        const [FileProcessorCore, CONSTANTS, VARS, Logger] = await importDependencies(
            [
                "shared/core/file/file-processor-core.js",
                "client/src/config/constants.js",
                "client/src/config/variables.js",
                "shared/utils/logger.js",
            ],
            import.meta.url
        );
        const CONFIG = { ...CONSTANTS, VARS };
        const logger = Logger.getLogger("FileProcessorWorker", true);

        switch (operation) {
            case "processMetadata": {
                const { fileName } = e.data;
                const { bookName, author, bookNameRE, authorRE } = FileProcessorCore.getBookNameAndAuthor(fileName);

                self.postMessage({
                    id,
                    type: "processMetadataComplete",
                    bookName,
                    author,
                    bookNameRE,
                    authorRE,
                });
                break;
            }

            case "processBook": {
                CONFIG.VARS.IS_EASTERN_LAN = isEasternLan;
                CONFIG.VARS.BOOK_AND_AUTHOR = metadata;
                const result = await FileProcessorCore.processChunkStatic(file, {
                    extraContent,
                    title_page_line_number_offset,
                    pageBreakOnTitle,
                    CONFIG,
                    encoding,
                    isInitialChunk: false,
                    forcePatternDetection: !logMode,
                    patternDetectionOptions: { fileSize: file.size, initialChunkSize: 1024 * 1024 },
                    logMode,
                });
                self.postMessage({ id, type: "processBookComplete", ...result });
                break;
            }

            case "generateTitlePage": {
                const { metadata, styles } = e.data;
                const titlePageLines = FileProcessorCore.generateTitlePage(metadata, styles);

                self.postMessage({
                    id,
                    type: "generateTitlePageComplete",
                    titlePageLines,
                });
                break;
            }

            default:
                throw new Error(`Unknown operation: ${operation}`);
        }
    } catch (error) {
        console.error("Worker error:", error);
        self.postMessage({
                    id,
            type: "error",
            error: error.message,
            operation,
        });
    }
};
