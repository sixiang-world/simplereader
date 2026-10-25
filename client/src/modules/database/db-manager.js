/**
 * @fileoverview IndexedDB Manager Module
 *
 * This module provides a high-level abstraction for IndexedDB operations through the DBManager class.
 * It simplifies common database operations while providing robust error handling and transaction
 * management. The module supports:
 *
 * - Multiple object store operations in single transactions
 * - Cursor-based and direct data retrieval
 * - Flexible data filtering and transformation
 * - Hooks for operation lifecycle (before/after)
 * - Partial success handling for batch operations
 *
 * @module client/src/modules/database/db-manager
 * @requires IndexedDB
 * @requires shared/utils/logger
 * @requires client/src/utils/helpers-worker
 * @requires shared/core/callback/callback-registry
 */

import { Logger } from "../../../../shared/utils/logger.js";
import { createWorker } from "../../utils/helpers/worker.js";
import { cbReg } from "../../../../shared/core/callback/callback-registry.js";

/**
 * @class DBManager
 * @description A class for managing IndexedDB operations with support for multiple object stores
 * and transaction management. Provides a high-level API for common database operations.
 */
export class DBManager {
    /**
     * Variables
     * @private
     */
    #indexedDB =
        typeof window !== "undefined"
            ? window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB
            : self.indexedDB;
    #db = null;
    #dbVersion = 0;
    #dbName = "";
    #objectStores = [];
    #errorCallback = null;
    #worker = null;
    #pendingOperations = new Map();
    #operationId = 0;
    #connectionPromise = null;
    #disposed = false;
    #workerError = null;
    #workerTimeoutMs = 120000;
    #logger = Logger.getLogger("DBManager", false);

    /**
     * Constants for chunking
     * @static
     */
    static CHUNK_SIZE = 1024 * 1024 * 64; // 64MB
    static CHUNK_THRESHOLD = 1024 * 1024 * 50; // 50MB

    /**
     * Creates a new DBManager instance
     * @param {Object} config - Configuration object for the database
     * @param {string} config.dbName - Name of the database
     * @param {number} config.dbVersion - Version of the database
     * @param {Array<Object>} config.objectStores - Array of object store configurations
     * @param {string} config.objectStores[].name - Name of the object store
     * @param {Object} config.objectStores[].options - Options for the object store (e.g., keyPath)
     * @param {Function} [config.errorCallback] - Callback function for error handling
     * @throws {Error} When required configuration is missing
     */
    constructor(config) {
        if (!this.#indexedDB) {
            throw new Error("IndexedDB not supported in this environment");
        }

        this.#dbName = config.dbName;
        this.#dbVersion = config.dbVersion;
        this.#objectStores = config.objectStores;
        this.#errorCallback = config.errorCallback;
        this.#workerTimeoutMs = config.workerTimeoutMs ?? 120000;

        // Initialize worker
        this.#worker = createWorker("client/src/modules/database/db-worker.js", import.meta.url);
        this.#worker.onmessage = this.#handleWorkerMessage.bind(this);
        this.#worker.onerror = (event) => {
            event.preventDefault?.();
            this.#failWorker(new Error(event.message || "Database worker failed"));
        };
        this.#worker.onmessageerror = () => this.#failWorker(new Error("Invalid database worker response"));
    }

    /**
     * Handles messages from the worker
     * @private
     * @param {MessageEvent} e - The message event
     */
    #handleWorkerMessage(e) {
        const { type, id, error, result } = e.data || {};
        const operation = this.#pendingOperations.get(id);
        if (!operation) return;

        this.#pendingOperations.delete(id);
        clearTimeout(operation.timer);

        if (type === "error") {
            operation.reject(new Error(error));
        } else {
            operation.resolve(result);
        }
    }

    /**
     * Executes a database operation in the worker
     * @private
     * @async
     * @param {string} type - The type of operation to execute
     * @param {Object} data - The data for the operation
     * @returns {Promise<any>} The result of the operation
     */
    async #execInWorker(type, data) {
        if (this.#disposed) throw new Error("Database manager is disposed");
        if (this.#workerError) throw this.#workerError;
        const id = this.#operationId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.#failWorker(new Error("Database worker request timed out")), this.#workerTimeoutMs);
            this.#pendingOperations.set(id, { resolve, reject, timer });
            try {
                this.#worker.postMessage({
                    type,
                    data: { id, dbName: this.#dbName, dbVersion: this.#dbVersion,
                        objectStores: this.#objectStores, ...data },
                });
            } catch (error) {
                clearTimeout(timer);
                this.#pendingOperations.delete(id);
                reject(error);
            }
        });
    }

    #failWorker(error) {
        this.#workerError = error;
        this.#worker?.terminate();
        for (const operation of this.#pendingOperations.values()) {
            clearTimeout(operation.timer);
            operation.reject(error);
        }
        this.#pendingOperations.clear();
    }

    /** Release all resources owned by this manager. In-flight work rejects. */
    dispose() {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#failWorker(new Error("Database manager is disposed"));
        this.#db?.close();
        this.#db = null;
    }

    /**
     * Initializes the database connection and performs cleanup
     * @async
     * @returns {Promise<boolean>} True if initialization successful, false otherwise
     */
    async init() {
        try {
            if (this.#disposed) throw new Error("Database manager is disposed");
            if (!this.#db) {
                if (!this.#connectionPromise) {
                    this.#connectionPromise = this.#connect().finally(() => { this.#connectionPromise = null; });
                }
                this.#db = await this.#connectionPromise;
            }
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    /**
     * Establishes a connection to the IndexedDB database
     * @private
     * @async
     * @returns {Promise<IDBDatabase>} Database connection
     * @throws {Error} When connection fails or database creation fails
     */
    async #connect() {
        if (this.#db) return this.#db;
        return new Promise((resolve, reject) => {
            const req = this.#indexedDB.open(this.#dbName, this.#dbVersion);
            let settled = false;
            const timer = setTimeout(() => fail(new Error("Database open timed out; close other reader tabs and retry")), 10000);
            const fail = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            };
            req.onblocked = () => fail(new Error("Database upgrade blocked; close other reader tabs and retry"));

            req.onupgradeneeded = (e) => {
                if (settled || this.#disposed) { req.transaction.abort(); return; }
                const db = e.target.result;
                const oldVersion = e.oldVersion;

                console.log("Database upgrade needed!");
                console.log("Old version:", oldVersion);
                console.log("New version:", this.#dbVersion);

                const storesByVersion = [...this.#objectStores].sort((a, b) => a.index - b.index);
                this.#logger.log("storesByVersion", storesByVersion);
                storesByVersion.forEach((store) => {
                    if (store.index < this.#dbVersion) {
                        if (!db.objectStoreNames.contains(store.name)) {
                            console.log(`Creating store ${store.name} for version ${store.index + 1}`);
                            db.createObjectStore(store.name, store.options);
                        }
                    }
                });
            };

            req.onsuccess = (e) => {
                const db = e.target.result;
                if (settled || this.#disposed) { db.close(); fail(new Error("Database manager is disposed")); return; }
                settled = true;
                clearTimeout(timer);
                this.#db = db;
                db.onversionchange = () => { db.close(); if (this.#db === db) this.#db = null; };
                db.onclose = () => { if (this.#db === db) this.#db = null; };
                resolve(db);
            };
            req.onerror = (e) => {
                fail(e.target.error);
                if (this.#errorCallback) this.#errorCallback();
            };
        });
    }

    /**
     * Executes a database request
     * @private
     * @param {IDBRequest} request - The request to execute
     * @returns {Promise} Promise that resolves with the request result
     */
    async #exec(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Gets the database version
     * @async
     * @returns {Promise<number>} Database version
     * @throws {Error} When database operation fails
     */
    async getDBVersion() {
        const request = this.#indexedDB.open(this.#dbName);
        const db = await this.#exec(request);
        const version = db.version;
        db.close();
        return version;
    }

    /**
     * Checks if a store is available in the database
     * @async
     * @param {string} storeName - Name of the store to check
     * @returns {Promise<boolean>} Whether the store is available
     * @throws {Error} When database operation fails
     */
    async isStoreAvailable(storeName) {
        if (!this.#db) {
            await this.init();
        }
        return this.#db.objectStoreNames.contains(storeName);
    }

    /**
     * Ensures that the required stores are available in the database
     * @param {string[]} storeNames - Names of the stores to check
     * @returns {Promise<boolean>} Whether all stores are available
     * @throws {Error} When required stores are not available
     */
    async ensureStoresAvailable(storeNames) {
        if (!this.#db) {
            await this.init();
        }

        const unavailableStores = storeNames.filter((name) => !this.#db.objectStoreNames.contains(name));

        if (unavailableStores.length > 0) {
            throw new Error(`Required stores not available: ${unavailableStores.join(", ")}`);
        }

        return true;
    }

    /**
     * Gets the configured database version
     * @returns {number} The configured database version
     */
    getConfiguredDBVersion() {
        return this.#dbVersion;
    }

    /**
     * Gets data from specified object stores
     * @async
     * @param {string|string[]} storeNames - Name(s) of the object store(s)
     * @param {string|number} key - Key to retrieve
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.requireAll=false] - Whether all stores must have data
     * @param {Function} [options.mergeStrategy] - Custom function to merge results
     * @returns {Promise<Object|null>} Retrieved data or null if not found
     * @throws {Error} When database operation fails
     */
    async get(storeNames, key, options = {}) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            const results = await this.#execInWorker("get", {
                storeNames,
                key,
                allowPartialSuccess: options.allowPartialSuccess ?? false,
            });

            // Check if there are results
            const hasResults = results.some((r) => r.data !== undefined);
            if (!hasResults) return null;

            // Check if all stores must have data
            if (options.requireAll && results.some((r) => r.data === undefined)) {
                return null;
            }

            // Use custom merge strategy or default merge
            if (options.mergeStrategy) {
                return options.mergeStrategy(results);
            }

            // Merge all results into a single object
            return results.reduce(
                (merged, { data }) => ({
                    ...merged,
                    ...(data || {}),
                }),
                {}
            );
        } catch (error) {
            console.error("Error getting data from stores:", error);
            throw error;
        }
    }

    /**
     * Retrieves all records from specified object stores
     * @async
     * @param {string|string[]} storeNames - Name(s) of the object store(s)
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.useCursor=false] - Whether to use cursor for retrieval
     * @param {IDBKeyRange} [options.range] - Range of keys to retrieve
     * @param {Function} [options.filter] - Filter function for records
     * @param {Function} [options.transform] - Transform function for records
     * @returns {Promise<Array|Object>} Retrieved records
     * @throws {Error} When database operation fails
     */
    async getAll(storeNames, options = {}) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const transaction = this.#db.transaction(names, "readonly");
        const stores = names.reduce((acc, name) => {
            acc[name] = transaction.objectStore(name);
            return acc;
        }, {});

        try {
            if (options.useCursor) {
                return await this.#getAllWithCursor(stores, options);
            } else {
                return await this.#getAllDirect(stores, options);
            }
        } catch (error) {
            try { transaction.abort(); } catch { /* Read transaction already completed. */ }
            console.error("Error getting all records:", error);
            throw error;
        }
    }

    /**
     * Retrieves all records from stores using a cursor
     * @private
     * @async
     * @param {Object.<string, IDBObjectStore>} stores - Map of store names to object stores
     * @param {Object} options - Retrieval options
     * @param {IDBKeyRange} [options.range] - Range of keys to retrieve
     * @param {string} [options.indexName] - Name of the index to use
     * @param {Function} [options.filter] - Filter function for records
     * @param {Function} [options.transform] - Transform function for records
     * @returns {Promise<Array|Object.<string, Array>>} Records from stores
     * @throws {Error} When cursor operation fails
     */
    async #getAllWithCursor(stores, options) {
        const results = {};
        const storeNames = Object.keys(stores);

        await Promise.all(
            storeNames.map(async (storeName) => {
                const store = stores[storeName];
                const records = [];

                return new Promise((resolve, reject) => {
                    const request = options.indexName
                        ? store.index(options.indexName).openCursor(options.range)
                        : store.openCursor(options.range);

                    request.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            const record = cursor.value;

                            if (!options.filter || options.filter(record)) {
                                const transformedRecord = options.transform ? options.transform(record) : record;
                                records.push(transformedRecord);
                            }
                            cursor.continue();
                        } else {
                            results[storeName] = records;
                            resolve();
                        }
                    };

                    request.onerror = () => reject(request.error);
                });
            })
        );

        return storeNames.length === 1 ? results[storeNames[0]] : results;
    }

    /**
     * Retrieves all records from stores directly using getAll
     * @private
     * @async
     * @param {Object.<string, IDBObjectStore>} stores - Map of store names to object stores
     * @param {Object} options - Retrieval options
     * @param {IDBKeyRange} [options.range] - Range of keys to retrieve
     * @param {Function} [options.filter] - Filter function for records
     * @param {Function} [options.transform] - Transform function for records
     * @returns {Promise<Array|Object.<string, Array>>} Records from stores
     * @throws {Error} When getAll operation fails
     */
    async #getAllDirect(stores, options) {
        const results = {};
        const storeNames = Object.keys(stores);

        await Promise.all(
            storeNames.map(async (storeName) => {
                const store = stores[storeName];
                let records = await this.#exec(store.getAll(options.range));

                if (options.filter) {
                    records = records.filter(options.filter);
                }

                if (options.transform) {
                    records = records.map(options.transform);
                }

                results[storeName] = records;
            })
        );

        return storeNames.length === 1 ? results[storeNames[0]] : results;
    }

    /**
     * Puts data into multiple stores in a single transaction
     * @async
     * @param {Object} data - Data to store
     * @param {Object} options - Storage options
     * @param {Object.<string, Function>} options.stores - Map of store names to data transform functions
     * @param {Function} [options.beforePut] - Hook called before putting data
     * @param {Function} [options.afterPut] - Hook called after putting data
     * @param {boolean} [options.allowPartialSuccess=false] - Whether to allow some stores to fail
     * @returns {Promise<boolean>} Success status
     * @throws {Error} When database operation fails
     */
    async put(data, options) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            if (options.beforePut) {
                await options.beforePut(data);
            }

            const records = Object.entries(options.stores).map(([storeName, transform]) => ({
                storeName, data: transform(data),
            }));
            const results = await this.#execInWorker("putMany", {
                records,
                chunkSize: DBManager.CHUNK_SIZE,
                chunkThreshold: DBManager.CHUNK_THRESHOLD,
                allowPartialSuccess: options.allowPartialSuccess ?? false,
            });

            if (options.afterPut) {
                await options.afterPut(data, results);
            }

            // Trigger the callback after database save
            if (data.file_content_chunks) {
                await cbReg.go("afterDBSave");
            }

            return options.allowPartialSuccess
                ? results.some((success) => success)
                : results.every((success) => success);
        } catch (error) {
            console.error("Error putting data:", error);
            throw error;
        }
    }

    /**
     * Checks if a key exists in a store
     * @async
     * @param {string} storeName - Name of the store to check
     * @param {string|number} key - Key to check
     * @returns {Promise<boolean>} Whether the key exists
     * @throws {Error} When database operation fails
     */
    async exists(storeName, key) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            const result = await this.get([storeName], key);
            return !!result;
        } catch (error) {
            console.error("Error checking if key exists:", error);
            throw error;
        }
    }

    /**
     * Deletes data from multiple stores in a single transaction
     * @async
     * @param {string[]} storeNames - Names of stores to delete from
     * @param {string|number} key - Key to delete
     * @param {Object} [options] - Delete options
     * @param {Function} [options.beforeDelete] - Hook called before deletion
     * @param {Function} [options.afterDelete] - Hook called after deletion
     * @param {boolean} [options.allowPartialSuccess=false] - Whether to allow some deletes to fail
     * @returns {Promise<boolean>} Success status
     * @throws {Error} When database operation fails
     */
    async delete(storeNames, key, options = {}) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        try {
            if (options.beforeDelete) {
                await options.beforeDelete(key);
            }

            const results = await this.#execInWorker("delete", {
                storeNames,
                key,
                allowPartialSuccess: options.allowPartialSuccess ?? false,
            });

            if (options.afterDelete) {
                await options.afterDelete(key, results);
            }

            return options.allowPartialSuccess
                ? results.some((success) => success)
                : results.every((success) => success);
        } catch (error) {
            console.error("Error deleting data:", error);
            throw error;
        }
    }

    /** Clear selected stores atomically, including their chunk records. */
    async clear(storeNames) {
        if (!(await this.init())) throw new Error("Init local db error!");
        return this.#execInWorker("clear", { storeNames });
    }

    /**
     * Prints all records in specified stores
     * @async
     * @param {Object} options - Print options
     * @param {string[]} [options.storeNames=[]] - Names of stores to print
     * @param {Object.<string, Function>} [options.preprocessors] - Map of store names to record preprocessors
     * @returns {Promise<void>}
     * @throws {Error} When database operation fails
     */
    async printStoreRecords(options = {}) {
        if (!(await this.init())) {
            throw new Error("Init local db error!");
        }

        const { storeNames = [], preprocessors = {} } = options;

        for (const storeName of storeNames) {
            try {
                const records = await this.getAll([storeName], {
                    useCursor: true,
                });

                if (!records || records.length === 0) {
                    console.log(`No records found in ${storeName}.`);
                } else {
                    console.log(`All records in ${storeName}:`);

                    const processedRecords = preprocessors[storeName] ? records.map(preprocessors[storeName]) : records;

                    console.table(processedRecords);
                }
            } catch (error) {
                console.error(`Error printing ${storeName}:`, error);
            }
        }
    }
}
