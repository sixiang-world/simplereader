const prefix = "simplereader:book:";
const legacySuffix = { line: "", progress: "_progressText", finished: "_isFinished", opened: "_lastopened" };

function key(bookId, field) {
    return prefix + encodeURIComponent(bookId) + ":" + field;
}

export function readBookProgress(bookId, field) {
    if (!bookId) return null;
    const value = localStorage.getItem(key(bookId, field));
    if (value !== null) return value;
    // Existing rows retain their legacy storage key. Only recognizable book
    // filenames can fall back to the old unscoped progress; leave old keys intact.
    if (!bookId.startsWith("book:") && /\.(txt|epub|log)$/i.test(bookId)) {
        return localStorage.getItem(bookId + legacySuffix[field]);
    }
    return null;
}

export function writeBookProgress(bookId, field, value) {
    if (bookId) localStorage.setItem(key(bookId, field), value);
}

export function clearBookProgress(bookId) {
    if (!bookId) return;
    // Tombstones prevent an old unscoped progress value from resurfacing.
    for (const field of Object.keys(legacySuffix)) localStorage.setItem(key(bookId, field), "");
}

export function clearAllBookProgress() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const storageKey = localStorage.key(i);
        if (storageKey?.startsWith(prefix)) localStorage.setItem(storageKey, "");
    }
}
