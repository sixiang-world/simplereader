/**
 * IndexedDB operations run in this worker. A request succeeds only after its
 * transaction commits. Related stores and chunk records share one transaction.
 * The on-disk chunk naming/layout stays compatible with existing books.
 */
const connections = new Map();

self.onmessage = async ({ data: message }) => {
    const { type, data = {} } = message;
    try {
        let result;
        if (type === "checkSize") {
            const size = calculateSize(data.data);
            result = { size, needsChunking: size > data.threshold };
        } else {
            const db = await openDatabase(data.dbName, data.dbVersion, data.objectStores);
            switch (type) {
                case "put":
                case "putMany": {
                    const records = type === "put" ? [{ storeName: data.storeName, data: data.storeData }] : data.records;
                    const save = (rows) => runTransaction(db, rows.map((row) => row.storeName), "readwrite", async (tx) => {
                        // Read existing references before replacing them. Old chunks and
                        // their replacements commit together, including smaller rewrites.
                        await Promise.all(rows.map(async ({ storeName, data: record }) => {
                            const store = tx.objectStore(storeName);
                            const key = record[store.keyPath];
                            const previous = await wrapRequest(store.get(key));
                            await deleteRecordChunks(store, key, previous);
                            const next = { ...record };
                            for (const [field, value] of Object.entries(next)) {
                                if (Array.isArray(value) && !isChunkRefs(value) && value.length) {
                                    const size = calculateSize(value);
                                    if (size > (data.chunkThreshold ?? 50 * 1024 * 1024)) {
                                        next[field] = await storeChunksData(store, key, field, value,
                                            data.chunkSize ?? 64 * 1024 * 1024, size);
                                    }
                                }
                            }
                            await wrapRequest(store.put(next));
                        }));
                        return rows.map(() => true);
                    });
                    result = data.allowPartialSuccess
                        ? await Promise.all(records.map((row) => save([row]).then(() => true, () => false)))
                        : await save(records);
                    break;
                }
                case "get": {
                    const names = normalizeStores(data.storeNames);
                    result = await runTransaction(db, names, "readonly", (tx) => Promise.all(names.map(async (storeName) => {
                        const store = tx.objectStore(storeName);
                        const record = await wrapRequest(store.get(data.key));
                        if (record && typeof record === "object") {
                            await Promise.all(Object.entries(record).map(async ([field, value]) => {
                                if (isChunkRefs(value)) record[field] = await loadChunksData(store, data.key, field, value);
                            }));
                        }
                        return { storeName, data: record };
                    })));
                    break;
                }
                case "delete": {
                    const names = normalizeStores(data.storeNames);
                    const remove = (stores) => runTransaction(db, stores, "readwrite", async (tx) => {
                        await Promise.all(stores.map(async (storeName) => {
                            const store = tx.objectStore(storeName);
                            const record = await wrapRequest(store.get(data.key));
                            await deleteRecordChunks(store, data.key, record);
                            await wrapRequest(store.delete(data.key));
                        }));
                        return stores.map(() => true);
                    });
                    result = data.allowPartialSuccess
                        ? await Promise.all(names.map((name) => remove([name]).then(() => true, () => false)))
                        : await remove(names);
                    break;
                }
                case "clear": {
                    const names = normalizeStores(data.storeNames);
                    result = await runTransaction(db, names, "readwrite", async (tx) => {
                        await Promise.all(names.map((name) => wrapRequest(tx.objectStore(name).clear())));
                        return true;
                    });
                    break;
                }
                // Compatibility for callers that explicitly request chunk storage.
                case "storeChunks":
                    result = await runTransaction(db, [data.storeName], "readwrite", (tx) =>
                        storeChunksData(tx.objectStore(data.storeName), data.key, data.fieldName,
                            data.data, data.chunkSize, data.size));
                    break;
                default:
                    throw new Error(`Unknown database operation: ${type}`);
            }
        }
        self.postMessage({ type: "success", id: data.id, result });
    } catch (error) {
        self.postMessage({ type: "error", id: data.id, error: error.message });
    }
};

function normalizeStores(names) {
    return [...new Set(Array.isArray(names) ? names : [names])];
}

/** One owned connection per database/version, closed before another tab upgrades. */
function openDatabase(name, version, objectStores = []) {
    const key = JSON.stringify([name, version]);
    if (connections.has(key)) return connections.get(key);
    const connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        let settled = false;
        const timer = setTimeout(() => fail(new Error("Database open timed out; close other reader tabs and retry")), 10000);
        function fail(error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            connections.delete(key);
            reject(error);
        }
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new Error("Database upgrade blocked; close other reader tabs and retry"));
        request.onupgradeneeded = () => {
            // A late open after timeout must not perform an unexpected upgrade.
            if (settled) { request.transaction.abort(); return; }
            for (const store of objectStores) {
                if (store.index < version && !request.result.objectStoreNames.contains(store.name)) {
                    request.result.createObjectStore(store.name, store.options);
                }
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            if (settled) { db.close(); return; }
            settled = true;
            clearTimeout(timer);
            const close = () => { db.close(); connections.delete(key); };
            db.onversionchange = close;
            db.onclose = () => connections.delete(key);
            resolve(db);
        };
    });
    connections.set(key, connection);
    return connection;
}

function wrapRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Attach handlers before issuing requests: request success is not commit. */
async function runTransaction(db, names, mode, work) {
    const tx = db.transaction(normalizeStores(names), mode);
    const committed = new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error("Database transaction aborted"));
        tx.onerror = () => {}; // Request errors abort the transaction; onabort settles it.
    });
    // A request may fail before work's promise rejects. Handle the completion
    // rejection immediately so that it cannot become an unhandled rejection.
    committed.catch(() => {});
    try {
        const result = await work(tx);
        await committed;
        return result;
    } catch (error) {
        try { tx.abort(); } catch { /* Already aborted or committed. */ }
        await committed.catch(() => {});
        throw error;
    }
}

function isChunkRefs(value) {
    return Array.isArray(value) && value.length > 0 &&
        value.every((item) => typeof item === "string" && /^chunk_\d+$/.test(item));
}

function calculateSize(data) {
    if (data instanceof Blob) return data.size;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (typeof data === "string") return new Blob([data]).size;
    if (Array.isArray(data)) return new Blob([JSON.stringify(data)]).size;
    return 0;
}

/** Queue all chunks without yielding to another task, which would end the tx. */
async function storeChunksData(store, key, fieldName, originalData, chunkSize, size) {
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) throw new Error("Invalid database chunk size");
    if (!originalData.length) return [];
    const numChunks = Math.min(originalData.length, Math.max(1, Math.ceil((size || calculateSize(originalData)) / chunkSize)));
    const itemsPerChunk = Math.ceil(originalData.length / numChunks);
    const refs = [];
    const requests = [];
    for (let start = 0; start < originalData.length; start += itemsPerChunk) {
        const ref = `chunk_${refs.length + 1}`;
        refs.push(ref);
        requests.push(wrapRequest(store.put({
            [store.keyPath]: `${key}_${fieldName}_${ref}`,
            [fieldName]: originalData.slice(start, start + itemsPerChunk),
        })));
    }
    await Promise.all(requests);
    return refs;
}

async function loadChunksData(store, key, fieldName, refs) {
    const chunks = await Promise.all(refs.map((ref) => wrapRequest(store.get(`${key}_${fieldName}_${ref}`))));
    const result = [];
    for (const chunk of chunks) {
        if (!chunk || !Array.isArray(chunk[fieldName])) throw new Error(`Incomplete cached book: ${key}/${fieldName}`);
        for (const item of chunk[fieldName]) result.push(item);
    }
    return result;
}

async function deleteRecordChunks(store, key, record) {
    if (!record || typeof record !== "object") return;
    await Promise.all(Object.entries(record).flatMap(([field, value]) => isChunkRefs(value)
        ? value.map((ref) => wrapRequest(store.delete(`${key}_${field}_${ref}`))) : []));
}
