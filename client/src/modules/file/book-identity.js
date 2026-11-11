const fileIds = new WeakMap();

export function associateBookFile(file, bookId) {
    fileIds.set(file, bookId);
    return bookId;
}

export function getBookId(file) {
    return fileIds.get(file);
}

export function allocateBookId(file) {
    return getBookId(file) ?? associateBookFile(file, "book:" + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join(""));
}
