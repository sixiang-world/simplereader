/** Limits apply to actual decompressed bytes, not ZIP header size claims. */
export const EPUB_LIMITS = Object.freeze({
    maxFileBytes: 50 * 1024 * 1024,
    maxEntries: 5000,
    maxEntryBytes: 32 * 1024 * 1024,
    maxTotalBytes: 128 * 1024 * 1024,
    maxDocumentNodes: 100000,
    maxDepth: 128,
    maxLines: 100000,
    // Total <img>/<svg> occurrences across the spine. Byte/entry budgets
    // already bound image *data*; this bounds the number of rendered image
    // elements (each becomes a pagination/DOM entry).
    maxImages: 2000,
});

export function checkEpubAbort(signal) {
    if (signal?.aborted) {
        const error = new Error("EPUB conversion cancelled");
        error.name = "AbortError";
        throw error;
    }
}

export function epubLimit(message) {
    return Object.assign(new Error(`EPUB_LIMIT: ${message}`), { code: "EPUB_LIMIT" });
}

export function rethrowEpubControlError(error) {
    if (error?.name === "AbortError" || error?.code === "EPUB_LIMIT") throw error;
}

export function epubLimits(overrides = {}) {
    const limits = { ...EPUB_LIMITS, ...overrides };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Invalid EPUB limit: ${name}`);
    }
    return limits;
}

/** Small read-only ZIP adapter that caps every stream before accumulating it. */
export function guardedEpubArchive(zip, limits, signal) {
    if (Object.keys(zip.files).length > limits.maxEntries) throw epubLimit("too many ZIP entries");
    let total = 0;
    const readEntries = new Set();
    return {
        files: zip.files,
        checkDocument(doc) { checkEpubDocument(doc, limits, signal); },
        file(path) {
            checkEpubAbort(signal);
            const entry = zip.file(path);
            if (!entry) return null;
            return {
                async async(type) {
                    checkEpubAbort(signal);
                    const countTotal = !readEntries.has(path);
                    const bytes = await new Promise((resolve, reject) => {
                        let size = 0;
                        const chunks = [];
                        const stream = entry.internalStream("uint8array");
                        let settled = false;
                        const cleanup = () => signal?.removeEventListener("abort", abort);
                        const fail = error => {
                            if (settled) return;
                            settled = true;
                            stream.pause();
                            chunks.length = 0;
                            cleanup();
                            reject(error);
                        };
                        const abort = () => {
                            try { checkEpubAbort(signal); } catch (error) { fail(error); }
                        };
                        signal?.addEventListener("abort", abort, { once: true });
                        if (signal?.aborted) { abort(); return; }
                        stream.on("data", chunk => {
                            if (settled) return;
                            size += chunk.byteLength;
                            if (size > limits.maxEntryBytes || (countTotal && total + size > limits.maxTotalBytes)) {
                                fail(epubLimit(`decompressed resource exceeds budget: ${path}`));
                                return;
                            }
                            chunks.push(chunk);
                        }).on("error", fail).on("end", () => {
                            if (settled) return;
                            settled = true;
                            cleanup();
                            const output = new Uint8Array(size);
                            let offset = 0;
                            for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
                            if (countTotal) { total += size; readEntries.add(path); }
                            resolve(output);
                        }).resume();
                    });
                    checkEpubAbort(signal);
                    if (type === "text") return new TextDecoder().decode(bytes);
                    if (type === "base64") {
                        const parts = [];
                        for (let i = 0; i < bytes.length; i += 0x8000) {
                            parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
                        }
                        return btoa(parts.join(""));
                    }
                    throw new TypeError(`Unsupported EPUB read type: ${type}`);
                },
            };
        },
    };
}

export function checkEpubDocument(doc, limits, signal) {
    const stack = [{ node: doc, depth: 0 }];
    let count = 0;
    while (stack.length) {
        checkEpubAbort(signal);
        const { node, depth } = stack.pop();
        if (++count > limits.maxDocumentNodes || depth > limits.maxDepth) throw epubLimit("document is too complex");
        for (let child = node.firstChild; child; child = child.nextSibling) stack.push({ node: child, depth: depth + 1 });
    }
}
