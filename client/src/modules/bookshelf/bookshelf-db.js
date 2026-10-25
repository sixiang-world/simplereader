/** BookshelfDB boundary. Public facade remains unchanged. */
import * as CONFIG from "../../config/index.js";
import { Logger } from "../../../../shared/utils/logger.js";
import { DBManager } from "../database/db-manager.js";
import { TextProcessorCore as TextProcessor } from "../../../../shared/core/text/text-processor-core.js";

/**
 * @class BookshelfDB
 * @description Handles IndexedDB operations for book storage
 * @private
 */
export class BookshelfDB extends DBManager {
    /**
     * Logger instance
     * @type {Logger}
     * @private
     */
    #logger = Logger.getLogger(this, false);

    /**
     * Object store names
     * @type {Object}
     * @private
     */
    #objectStoreNames = {
        bookfiles: CONFIG.CONST_DB.DB_STORES[0].name,
        bookProcessed: CONFIG.CONST_DB.DB_STORES[1].name,
    };

    /**
     * Constructor for BookshelfDB
     * @constructor
     */
    constructor({ onError = () => {} } = {}) {
        super({
            dbName: CONFIG.CONST_DB.DB_NAME,
            dbVersion: CONFIG.CONST_DB.DB_VERSION,
            objectStores: CONFIG.CONST_DB.DB_STORES,
            errorCallback: onError,
        });
    }

    /**
     * Stores a book in the database
     * @async
     * @param {string} name - Book filename
     * @param {File} data - Book file data
     * @param {boolean} [isFromLocal=true] - Whether book is from local storage
     * @param {boolean} [isOnServer=false] - Whether book is stored on server
     * @returns {Promise<IDBValidKey>} Key of stored book
     * @throws {Error} When database initialization fails or transaction fails
     */
    async putBook(name, data, isFromLocal = true, isOnServer = false) {
        if (CONFIG.CONST_CONFIG.ANONYMOUS_MODE) {
            return false;
        }
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        // Get the language of the book
        let isEastern = data.isEastern ?? null;
        let encoding = data.encoding ?? null;
        if (isEastern === null || encoding === null) {
            ({ isEastern, encoding } = await TextProcessor.getLanguageAndEncodingFromBook(data));
        }

        try {
            const bookData = {
                name,
                data,
                isFromLocal,
                isOnServer,
                isEastern,
                encoding,
            };

            await this.put(bookData, {
                stores: {
                    [this.#objectStoreNames.bookfiles]: (inputData) => ({
                        name: inputData.name,
                        data: inputData.data,
                        isFromLocal: inputData.isFromLocal,
                        isOnServer: inputData.isOnServer,
                        processed: false,
                        pageBreakOnTitle: CONFIG.RUNTIME_CONFIG.PAGE_BREAK_ON_TITLE ?? true,
                        isEastern: inputData.isEastern,
                        createdAt: new Date().toISOString(),
                    }),
                    [this.#objectStoreNames.bookProcessed]: (inputData) => ({
                        name: inputData.name,
                        encoding: inputData.encoding,
                    }),
                },
            });

            return true;
        } catch (error) {
            console.error("Error putting book:", error);
            throw error;
        }
    }

    /**
     * Updates a processed book in the database
     * @async
     * @param {string} name - Book filename
     * @param {Object} processedData - Processed book data
     * @returns {Promise<boolean>} True when persisted; false when skipped (anonymous mode)
     * @throws {Error} When database initialization fails or transaction fails
     */
    async updateProcessedBook(name, processedData) {
        // Anonymous mode never persists books — putBook() no-ops the same way,
        // so skip instead of failing the open on a missing shelf entry.
        if (CONFIG.CONST_CONFIG.ANONYMOUS_MODE) {
            return false;
        }
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            let [existingBook, existingProcessedBook] = await Promise.all([
                this.get([this.#objectStoreNames.bookfiles], name),
                this.get([this.#objectStoreNames.bookProcessed], name),
            ]);

            // EPUB first save: bookfiles entry doesn't exist yet, create it
            if (!existingBook) {
                if (processedData.data) {
                    await this.putBook(name, processedData.data, true, false);
                    existingBook = await this.get([this.#objectStoreNames.bookfiles], name);
                    if (existingBook) {
                        existingBook.is_epub = processedData.is_epub || false;
                    }
                    existingProcessedBook = await this.get([this.#objectStoreNames.bookProcessed], name);
                } else {
                    throw new Error(`Book with name "${name}" not found in the database.`);
                }
            }

            // A bookfiles row can exist without its derived record (older saves
            // were not written atomically). Upsert it from the snapshot — the
            // final put fills every field — instead of failing the open.
            if (!existingProcessedBook) {
                existingProcessedBook = { name };
            }

            await this.put(
                { name, ...processedData },
                {
                    stores: {
                        [this.#objectStoreNames.bookfiles]: () => ({
                            ...existingBook,
                            processed: true,
                            pageBreakOnTitle: CONFIG.RUNTIME_CONFIG.PAGE_BREAK_ON_TITLE ?? true,
                        }),
                        [this.#objectStoreNames.bookProcessed]: () => ({
                            ...existingProcessedBook,
                            ...processedData,
                            processedAt: new Date().toISOString(),
                        }),
                    },
                }
            );

            return true;
        } catch (error) {
            console.error("Error updating processed book:", error);
            throw error;
        }
    }

    /**
     * Updates the language of a book
     * @async
     * @param {string} name - Book filename
     * @param {boolean} isEastern - Whether the book is in Eastern language
     * @returns {Promise<IDBValidKey>} Key of updated book
     * @throws {Error} When database initialization fails or transaction fails
     */
    async updateBookLanguage(name, isEastern) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            const existingBook = await this.get([this.#objectStoreNames.bookfiles], name);
            if (!existingBook) {
                throw new Error(`Book with name "${name}" not found in the database.`);
            }

            await this.put(
                { name, isEastern },
                {
                    stores: {
                        [this.#objectStoreNames.bookfiles]: () => ({
                            ...existingBook,
                            isEastern,
                        }),
                    },
                }
            );

            return true;
        } catch (error) {
            console.error("Error updating book language:", error);
            throw error;
        }
    }

    /** Invalidate derived content without touching the original File/Blob. */
    async invalidateProcessedBook(name) {
        const book = await this.get([this.#objectStoreNames.bookfiles], name);
        if (!book) return false;
        return this.put({ name }, {
            stores: { [this.#objectStoreNames.bookfiles]: () => ({ ...book, processed: false }) },
        });
    }

    /**
     * Retrieves a book from the database
     * @async
     * @param {string} name - Book filename
     * @returns {Promise<Object>} Book data
     * @throws {Error} When database initialization fails or transaction fails
     */
    async getBook(name) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            // Read original metadata and derived cache in the same snapshot.
            return await this.get([this.#objectStoreNames.bookfiles, this.#objectStoreNames.bookProcessed], name);
        } catch (error) {
            // A missing derived chunk is recoverable as long as the original
            // file remains. Return an invalid cache so openBook reprocesses it.
            if (error.message?.startsWith("Incomplete cached book:")) {
                const original = await this.get([this.#objectStoreNames.bookfiles], name);
                return original ? { ...original, processed: false } : null;
            }
            console.error("Error getting book:", error);
            throw error;
        }
    }

    /**
     * Retrieves all books from the database
     * @async
     * @returns {Promise<Array>} Array of all books
     * @throws {Error} When database initialization fails or transaction fails
     */
    /** Lightweight list projection; migrate old language metadata at the data boundary. */
    async getBookList() {
        const rows = await this.getAll([this.#objectStoreNames.bookfiles], {
            useCursor: true,
            transform: record => ({ name: record.name, size: record.data?.size ?? record.data?.byteLength ?? 0,
                isEastern: record.isEastern, isFromLocal: record.isFromLocal ?? false,
                isOnServer: record.isOnServer ?? false }),
        });
        for (const row of rows) {
            if (typeof row.isEastern === "boolean") continue;
            const original = await this.get([this.#objectStoreNames.bookfiles], row.name);
            row.isEastern = original?.data instanceof Blob
                ? (await TextProcessor.getLanguageAndEncodingFromBook(original.data)).isEastern
                : TextProcessor.getLanguage(row.name);
            await this.updateBookLanguage(row.name, row.isEastern);
        }
        return rows;
    }

    async getAllBooks() {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            await this.ensureStoresAvailable([this.#objectStoreNames.bookfiles, this.#objectStoreNames.bookProcessed]);
            this.#logger.log("Required stores are available");

            const allBooks = await this.getAll([this.#objectStoreNames.bookfiles], {
                useCursor: true,
            });
            this.#logger.log("Books:", allBooks);
            return allBooks;
        } catch (error) {
            console.error("Error getting all books:", error);
            return [];
        }
    }

    /**
     * Checks if a book exists in the database
     * @async
     * @param {string} name - Book filename
     * @returns {Promise<boolean>} Whether book exists
     * @throws {Error} When database initialization fails or transaction fails
     */
    async isBookExist(name) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        return await this.exists(this.#objectStoreNames.bookfiles, name);
    }

    /**
     * Removes a book from the database
     * @async
     * @param {string} name - Book filename
     * @throws {Error} When database initialization fails or transaction fails
     */
    async removeBook(name) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            await this.delete([this.#objectStoreNames.bookfiles, this.#objectStoreNames.bookProcessed], name);
            return true;
        } catch (error) {
            console.error("Error removing book:", error);
            throw error;
        }
    }

    /**
     * Removes all books from the database
     * @async
     * @throws {Error} When database initialization fails or transaction fails
     */
    async removeAllBooks() {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            await this.clear([this.#objectStoreNames.bookfiles, this.#objectStoreNames.bookProcessed]);
            return true;
        } catch (error) {
            console.error("Error removing all books:", error);
            throw error;
        }
    }

    /**
     * Upgrades the database schema
     * @async
     * @param {boolean} force - Whether to force upgrade
     * @throws {Error} When database initialization fails or transaction fails
     */
    async upgradeBookshelfDB(force = false) {
        this.#logger.log("upgradeBookshelfDB", { force });
        const currentDBVersion = await this.getDBVersion();
        const configuredDBVersion = this.getConfiguredDBVersion();

        if (currentDBVersion > configuredDBVersion) {
            throw new Error(
                `Database version mismatch! Current: ${currentDBVersion}, Expected: ${configuredDBVersion}`
            );
        } else if (currentDBVersion === configuredDBVersion && !force) {
            return;
        }

        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            const allBooks = await this.getAllBooks();
            for (const book of allBooks) {
                const { name } = book;
                const processedBook = await this.get([this.#objectStoreNames.bookProcessed], name);
                await this.put(book, {
                    stores: {
                        [this.#objectStoreNames.bookfiles]: () => ({
                            name: book.name,
                            data: book.data,
                            isFromLocal: book.isFromLocal ?? true,
                            isOnServer: book.isOnServer ?? false,
                            processed: book.processed ?? false,
                            pageBreakOnTitle:
                                book.pageBreakOnTitle ?? CONFIG.RUNTIME_CONFIG.PAGE_BREAK_ON_TITLE ?? true,
                            isEastern: book.isEastern ?? true,
                            createdAt: book.createdAt ?? new Date().toISOString(),
                        }),
                        [this.#objectStoreNames.bookProcessed]: () => ({
                            name: book.name,
                            ...(processedBook || {}),
                            bookAndAuthor: processedBook?.bookAndAuthor ?? { bookName: "", author: "" },
                            title_page_line_number_offset: processedBook?.title_page_line_number_offset ?? 0,
                            seal_rotate_en: processedBook?.seal_rotate_en ?? "0deg",
                            seal_left: processedBook?.seal_left ?? "0",
                            file_content_chunks: processedBook?.file_content_chunks ?? [],
                            all_titles: processedBook?.all_titles ?? [],
                            all_titles_ind: processedBook?.all_titles_ind ?? {},
                            footnotes: processedBook?.footnotes ?? [],
                            footnote_processed_counter: processedBook?.footnote_processed_counter ?? 0,
                            page_breaks: processedBook?.page_breaks ?? [],
                            total_pages: processedBook?.total_pages ?? 0,
                            is_eastern_lan: processedBook?.is_eastern_lan ?? true,
                            encoding: book.encoding ?? "utf-8",
                            processedAt: book.processedAt ?? new Date().toISOString(),
                        }),
                    },
                });
            }

            if (allBooks.length > 0) {
                await this.printAllDatabases();
                console.log("Database upgrade completed.");
            }

            return true;
        } catch (error) {
            console.error("Error upgrading database:", error);
            throw error;
        }
    }

    /**
     * Prints all records in both "bookfiles" and "bookProcessed" object stores
     * @async
     * @throws {Error} When database initialization fails
     */
    async printAllDatabases() {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        console.log("Printing all book-related database records...");

        try {
            await this.printStoreRecords({
                storeNames: [this.#objectStoreNames.bookfiles, this.#objectStoreNames.bookProcessed],
                preprocessors: {
                    [this.#objectStoreNames.bookfiles]: (record) => record,
                    [this.#objectStoreNames.bookProcessed]: (record) => {
                        const preprocessValue = (key, value) => {
                            if (key === "bookAndAuthor" && value && typeof value === "object") {
                                return `${value.bookName}, ${value.author}`;
                            } else if (Array.isArray(value)) {
                                return `Array(${value.length})`;
                            } else if (value && typeof value === "object") {
                                return `Object(${Object.keys(value).length})`;
                            }
                            return value;
                        };

                        return Object.fromEntries(
                            Object.entries(record).map(([key, value]) => [key, preprocessValue(key, value)])
                        );
                    },
                },
            });

            console.log("Finished printing all book-related database records.");
        } catch (error) {
            console.error("Error printing book-related databases:", error);
            throw error;
        }
    }
}
