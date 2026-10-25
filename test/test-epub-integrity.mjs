import assert from "node:assert/strict";
import JSZip from "jszip";
import { DOMParser, Node } from "linkedom";
import { EpubConverter } from "../client/src/modules/epub/epub-converter.js";
import { resolveEpubHref } from "../shared/core/file/epub-path.js";
import { paginateEpub } from "../shared/core/file/epub-pagination.js";
import { FileProcessorCore } from "../shared/core/file/file-processor-core.js";
import { CONST_PAGINATION } from "../client/src/config/constants.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

globalThis.JSZip = JSZip;
globalThis.DOMParser = DOMParser;
globalThis.Node = Node;

async function epubFixture(chapters, metadata = "Review") {
    const zip = new JSZip();
    zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>');
    const manifest = chapters.map((c, i) => `<item id="c${i}" href="${c.href}" media-type="application/xhtml+xml"/>`).join("");
    zip.file("OPS/content.opf", `<package><metadata><title>${metadata}</title></metadata><manifest>${manifest}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`);
    for (const chapter of chapters) zip.file(`OPS/${chapter.path}`, `<html xmlns:epub="http://www.idpf.org/2007/ops"><body>${chapter.body}</body></html>`);
    return new File([await zip.generateAsync({ type: "uint8array" })], "fixture.epub");
}

assert.deepEqual(resolveEpubHref("../Images/a%20b.png#%E7%AB%A0", "OPS/Text/ch1.xhtml"), {
    path: "OPS/Images/a b.png", fragment: "章", key: "OPS/Images/a b.png#章",
});
assert.equal(resolveEpubHref("../../../../escape", "OPS/Text/ch1.xhtml"), null);
assert.equal(resolveEpubHref("%2Fescape", "OPS/Text/ch1.xhtml"), null);
assert.equal(resolveEpubHref("broken%zz", "OPS/Text/ch1.xhtml"), null);
assert.equal(resolveEpubHref("https://example.com", "OPS/Text/ch1.xhtml"), null);
assert.equal(resolveEpubHref("#same", "OPS/Text/ch1.xhtml").key, "OPS/Text/ch1.xhtml#same");

const book = await epubFixture([
    { path: "Text/ch 1.xhtml", href: "Text/ch%201.xhtml", body: '<p id="intro">Intro</p><aside epub:type="footnote" id="note"><p>First note</p></aside><p><a href="#note" epub:type="noteref">1</a></p>' },
    { path: "Text/ch2.xhtml", href: "Text/ch2.xhtml", body: '<section id="wrapper"><h1 id="second">Chapter two <span id="nested">anchor</span></h1></section><aside epub:type="footnote" id="note"><p>Second note</p></aside>' },
]);
const result = await EpubConverter.convert(book);
assert.deepEqual(result.missingFiles, []);
const second = result.htmlLines.find(l => l.content.includes("Chapter two"));
assert.equal(result.fragmentToLine["OPS/Text/ch2.xhtml#second"], second.lineNumber);
assert.equal(result.fragmentToLine["OPS/Text/ch2.xhtml#wrapper"], second.lineNumber);
assert.equal(result.fragmentToLine["OPS/Text/ch2.xhtml#nested"], second.lineNumber);
assert.equal(result.fileToLine["OPS/Text/ch 1.xhtml"], 1);
assert.equal(result.spineRanges[0].start, 1);
assert.equal(result.spineRanges[0].end, result.spineRanges[1].start);
assert.equal(second.spinePath, "OPS/Text/ch2.xhtml");
assert.match(result.footnoteMap["OPS/Text/ch 1.xhtml#note"], /First note/);
assert.match(result.footnoteMap["OPS/Text/ch2.xhtml#note"], /Second note/);
assert(!result.htmlLines.some(l => /First note|Second note/.test(l.content)));
const oddImage = await EpubConverter.convert(await epubFixture([{ path: "odd.xhtml", href: "odd.xhtml", body: '<p><img src="constructor"/></p>' }]));
assert(oddImage.htmlLines.some(l => l.content.includes("epub-image-missing")), "resource dictionaries must not treat prototype keys as image data");

const long = await EpubConverter.convert(await epubFixture([{ path: "long.xhtml", href: "long.xhtml", body: '<h1>Long</h1>' + '<p>Long paragraph with enough text</p>'.repeat(200) }]));
const breaks = paginateEpub(long, { ...CONST_PAGINATION, MAX_LINES: 20, MIN_LINES: 5, USE_CHAR_COUNT: false });
assert(breaks.length > 1);
assert.equal(breaks[0], 0);
assert(breaks.every((v, i) => i === 0 || v > breaks[i - 1]));

await assert.rejects(() => EpubConverter.convert(book, null, { limits: { maxEntries: 1 } }), /EPUB_LIMIT/);
await assert.rejects(() => EpubConverter.convert(book, null, { limits: { maxEntryBytes: 32 } }), /EPUB_LIMIT/);
await assert.rejects(() => EpubConverter.convert(book, null, { limits: { maxTotalBytes: 400 } }), /EPUB_LIMIT/);
await assert.rejects(() => EpubConverter.convert(book, null, { limits: { maxFileBytes: 1 } }), /EPUB_LIMIT/);
await assert.rejects(() => EpubConverter.convert(book, null, { limits: { maxDocumentNodes: 2 } }), /EPUB_LIMIT/);
await assert.rejects(() => EpubConverter.convert(book, null, { limits: { maxDepth: 2 } }), /EPUB_LIMIT/);
await assert.rejects(() => EpubConverter.convert(book, null, { limits: { maxLines: 1 } }), /EPUB_LIMIT/);
const imageSource = await epubFixture([{ path: "image.xhtml", href: "image.xhtml", body: '<p><img src="big.png"/></p>' }]);
const imageZip = await JSZip.loadAsync(await imageSource.arrayBuffer());
imageZip.file("OPS/big.png", new Uint8Array(4096));
const imageBook = new File([await imageZip.generateAsync({ type: "uint8array" })], "image.epub");
await assert.rejects(() => EpubConverter.convert(imageBook, null, { limits: { maxEntryBytes: 2048 } }), /EPUB_LIMIT/, "image budget failures must not be downgraded to placeholders");
// Image count budget: counts every rendered <img>/<svg> across the spine
// (registry-inlined, inline data: URLs, and SVG blocks alike).
const manyImages = await epubFixture([
    { path: "img1.xhtml", href: "img1.xhtml", body: '<p><img src="data:image/png;base64,iVBORw0KGgo="/></p><p><img src="data:image/png;base64,iVBORw0KGgo="/></p>' },
]);
await assert.rejects(() => EpubConverter.convert(manyImages, null, { limits: { maxImages: 1 } }), /EPUB_LIMIT/, "too many images must fail explicitly, including inline data: URLs");
const svgImages = await epubFixture([
    { path: "svg.xhtml", href: "svg.xhtml", body: '<p><svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg></p><p><svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg></p>' },
]);
await assert.rejects(() => EpubConverter.convert(svgImages, null, { limits: { maxImages: 1 } }), /EPUB_LIMIT/, "SVG blocks must count toward the image budget");
// A single image stays within the default budget.
const oneImage = await EpubConverter.convert(manyImages);
assert(oneImage.htmlLines.some(l => l.type === "image" || /<img/.test(l.content || "")), "single inline image must still convert normally");
const abort = new AbortController();
abort.abort();
await assert.rejects(() => EpubConverter.convert(book, null, { signal: abort.signal }), { name: "AbortError" });
const abortMid = new AbortController();
await assert.rejects(() => EpubConverter.convert(book, step => {
    if (step === "spine-item") abortMid.abort();
}, { signal: abortMid.signal }), { name: "AbortError" });

const log = await FileProcessorCore.processChunkStatic(new Blob(["  indented\n\n\tchild\nlast   \n"]), { extraContent: {}, logMode: true, title_page_line_number_offset: 0 });
assert.deepEqual(log.htmlLines.map(l => l.content), ["  indented", "", "\tchild", "last   ", ""]);
assert.deepEqual(log.htmlLines.map(l => l.lineNumber), [0, 1, 2, 3, 4]);
const crlfLog = await FileProcessorCore.processChunkStatic(new Blob(["a\r\nb\rc"]), { extraContent: {}, logMode: true, title_page_line_number_offset: 0 });
assert.deepEqual(crlfLog.htmlLines.map(l => l.content), ["a", "b", "c"]);

let xhtmlParses = 0;
globalThis.DOMParser = class extends DOMParser {
    parseFromString(input, type) {
        if (type === "application/xhtml+xml") xhtmlParses++;
        return super.parseFromString(input, type);
    }
};
await EpubConverter.convert(book);
assert.equal(xhtmlParses, 2, "each of two spines is parsed once, including image extraction");
globalThis.DOMParser = DOMParser;

// Exercise the real build pipeline, not a source extraction or replacement.
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "epub-integrity-"));
try {
    const input = path.join(tmp, "books");
    const output = path.join(tmp, "out");
    await fs.mkdir(input);
    const svgBook = await epubFixture([{ path: "long.xhtml", href: "long.xhtml", body: '<h1>Long</h1><svg xmlns="http://www.w3.org/2000/svg"><circle r="3"/></svg>' + '<p>A long paragraph of text</p>'.repeat(200) }]);
    await fs.writeFile(path.join(input, "long.epub"), Buffer.from(await svgBook.arrayBuffer()));
    const { preprocessBooks } = await import("../build-tools/preprocess-books.mjs");
    const stats = await preprocessBooks({ booksDir: input, outDir: output });
    assert.equal(stats.failed, 0);
    const built = JSON.parse(await fs.readFile(path.join(output, "long.json"), "utf8"));
    assert(built.total_pages > 1, "long EPUB build must actually paginate");
    assert(built.processedLines.some(l => l.type === "image" && l.content.includes("data:image/svg+xml;base64,")), "Node DOM adapter must serialize a small SVG");
    const converted = await EpubConverter.convert(svgBook);
    assert.deepEqual(built.page_breaks, [...paginateEpub(converted, { ...CONST_PAGINATION, IS_EASTERN_LAN: false, BOOK_AND_AUTHOR: { bookName: "Review", author: "" } })]);
} finally {
    await fs.rm(tmp, { recursive: true, force: true });
}
console.log("EPUB integrity: URI, indices, semantic notes, pagination, budgets, cancellation, single parse, Node SVG and log fidelity passed");
