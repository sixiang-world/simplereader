/** One page-boundary contract for reader, search and quick-jump navigation.
 * @param {number} lineNumber
 * @param {number[]} starts Sorted page starts (not an end-of-document sentinel).
 * @param {number} totalPages
 */
export function pageForLine(lineNumber, starts, totalPages = starts.length) {
    if (!Number.isFinite(lineNumber) || !starts.length) return 1;
    let low = 0, high = starts.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (starts[middle] <= lineNumber) low = middle + 1;
        else high = middle;
    }
    return Math.max(1, Math.min(low, totalPages || starts.length));
}
