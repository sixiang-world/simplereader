import { PaginationCalculator } from "../text/pagination-calculator.js";

/** The browser and build pipeline share the same complete-book title protocol. */
export function paginateEpub(result, config) {
    const lines = result.htmlLines;
    if (!lines.length) return [0];
    const byLine = new Map(result.titles.map(title => [title[1], [...title]]));
    // The calculator treats the final title as the end-page sentinel. EPUB's
    // visible TOC intentionally excludes that synthetic entry.
    const end = lines.length - 1;
    byLine.set(end, ["", end, "", false]);
    const titles = [...byLine.values()].sort((a, b) => a[1] - b[1]);
    return new PaginationCalculator(lines, titles, {
        ...config,
        PAGE_BREAK_ON_TITLE: config.PAGE_BREAK_ON_TITLE ?? true,
        COMPLETE_BOOK: true,
    }).calculate();
}
