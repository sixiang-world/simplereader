/** Find the first matching visible-text line and its nonempty match ranges.
 * Kept independent of DOM and Worker APIs so worker behavior is testable.
 */
export function findMatchingLine(lines, pattern) {
    let regex;
    try {
        regex = new RegExp(pattern, "gi");
    } catch {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    }
    for (const { lineNumber, text } of lines) {
        regex.lastIndex = 0;
        const ranges = [];
        for (const match of text.matchAll(regex)) {
            if (match[0].length) ranges.push([match.index, match.index + match[0].length]);
        }
        if (ranges.length) return { lineNumber, ranges };
    }
    return null;
}
