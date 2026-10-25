// @ts-check
/** Disk names are retained for compatibility with existing IndexedDB books. */
const fields = {
    file_content_chunks: 'FILE_CONTENT_CHUNKS',
    all_titles: 'ALL_TITLES',
    all_titles_ind: 'ALL_TITLES_IND',
    footnotes: 'FOOTNOTES',
    footnote_processed_counter: 'FOOTNOTE_PROCESSED_COUNTER',
    page_breaks: 'PAGE_BREAKS',
    total_pages: 'TOTAL_PAGES',
    footnoteMap: 'FOOTNOTE_MAP',
    fragmentToLine: 'FRAGMENT_TO_LINE',
    fileToLine: 'FILE_TO_LINE',
    spineRanges: 'SPINE_RANGES',
    is_log_mode: 'IS_LOG_MODE',
};
/** @param {Record<string, any>} state @param {Record<string, any>} extra */
export function snapshotProcessedBook(state, extra = {}) {
    return { name: state.FILENAME, processed: true, book_contract_version: 1,
        is_eastern_lan: state.IS_EASTERN_LAN, encoding: state.ENCODING,
        bookAndAuthor: state.BOOK_AND_AUTHOR, title_page_line_number_offset: state.TITLE_PAGE_LINE_NUMBER_OFFSET,
        ...Object.fromEntries(Object.entries(fields).map(([disk, runtime]) => [disk, state[runtime]])), ...extra };
}
/** @param {Record<string, any>} book */
export function isProcessedBookComplete(book) {
    if (!book?.processed || !Array.isArray(book.file_content_chunks) || !Array.isArray(book.all_titles)
        || !book.all_titles_ind || !Array.isArray(book.page_breaks)
        || !book.page_breaks.length || book.total_pages !== book.page_breaks.length) return false;
    if (!book.bookAndAuthor || typeof book.bookAndAuthor.bookName !== 'string') return false;
    if (book.is_epub && (!book.footnoteMap || !book.fragmentToLine || !book.fileToLine || !Array.isArray(book.spineRanges))) return false;
    return true;
}
/** @param {Record<string, any>} state @param {Record<string, any>} book */
export function restoreProcessedBook(state, book) {
    if (!isProcessedBookComplete(book)) throw new Error('Incomplete processed book: reprocess the original file');
    const defaults = { FOOTNOTES: [], FOOTNOTE_PROCESSED_COUNTER: 0, FOOTNOTE_MAP: {}, FRAGMENT_TO_LINE: {}, FILE_TO_LINE: {}, SPINE_RANGES: [], IS_LOG_MODE: false };
    for (const [disk, runtime] of Object.entries(fields)) state[runtime] = book[disk] ?? defaults[runtime];
}
