import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

// Polyfill DOMParser and JSZip for Node so EpubConverter can run.
const linkedom = (await import("linkedom")).default || (await import("linkedom"));
globalThis.DOMParser = linkedom.DOMParser;
globalThis.Node = linkedom.Node;
globalThis.JSZip = JSZip;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EpubConverter = (await import("../client/src/modules/epub/epub-converter.js")).EpubConverter;

let passed = 0;
let failed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
    }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-epub-test-"));

async function buildEpub(name, contents) {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

    const manifestItems = [];
    const spineItems = [];
    let itemIndex = 0;
    for (const [href, xhtml, mediaType = "application/xhtml+xml"] of contents) {
        const id = `item${itemIndex++}`;
        zip.file(`OEBPS/${href}`, xhtml);
        manifestItems.push(`<item id="${id}" href="${href}" media-type="${mediaType}"${href.includes("nav") ? ' properties="nav"' : ""}/>`);
        spineItems.push(`<itemref idref="${id}"/>`);
    }

    zip.file("OEBPS/content.opf", `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator role="aut">Test Author</dc:creator>
    <dc:publisher>Test Publisher</dc:publisher>
    <dc:date>2026-01-01</dc:date>
    <dc:language>zh-CN</dc:language>
    <dc:description>A test description</dc:description>
    <dc:subject>Testing</dc:subject>
    <dc:identifier>urn:test:1</dc:identifier>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    ${manifestItems.join("\n    ")}
    <item id="cover-image" href="cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine>
    ${spineItems.join("\n    ")}
  </spine>
</package>`);

    zip.file("OEBPS/cover.jpg", "fake-image-bytes");

    const epubPath = path.join(tmpDir, name);
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    fs.writeFileSync(epubPath, buffer);
    return epubPath;
}

function fileFromPath(p) {
    const buffer = fs.readFileSync(p);
    return new File([buffer], path.basename(p), { type: "application/epub+zip" });
}

console.log("EPUB converter — metadata extraction\n");

await asyncTest("extracts full metadata including cover href", async () => {
    const epubPath = await buildEpub("metadata.epub", [
        ["ch1.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>
<body><h1>第一章</h1><p>内容。</p></body></html>`],
    ]);
    const result = await EpubConverter.convert(fileFromPath(epubPath));
    assert.equal(result.metadata.title, "Test Book");
    assert.equal(result.metadata.author, "Test Author");
    assert.equal(result.metadata.publisher, "Test Publisher");
    assert.equal(result.metadata.language, "zh-CN");
    assert.equal(result.metadata.description, "A test description");
    assert.deepEqual(result.metadata.subjects, ["Testing"]);
    assert.equal(result.metadata.identifier, "urn:test:1");
    assert.equal(result.metadata.coverHref, "OEBPS/cover.jpg");
});

console.log("\nEPUB converter — structure preservation\n");

await asyncTest("preserves inline HTML, lists, blockquotes, pre, tables", async () => {
    const epubPath = await buildEpub("structure.epub", [
        ["ch1.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>
<body>
  <p>This is <em>emphasis</em> and <strong>strong</strong>.</p>
  <p>Line one<br/>Line two</p>
  <ul><li>Item one</li><li>Item two</li></ul>
  <blockquote><p>A quote</p></blockquote>
  <pre>  code\n  line</pre>
  <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
</body></html>`],
    ]);
    const result = await EpubConverter.convert(fileFromPath(epubPath));
    const types = result.htmlLines.map((l) => l.type);
    assert.ok(types.includes("paragraph"));
    assert.ok(types.includes("list"));
    assert.ok(types.includes("quote"));
    assert.ok(types.includes("preformatted"));
    assert.ok(types.includes("table"));

    const paragraph = result.htmlLines.find((l) => l.type === "paragraph");
    assert.ok(paragraph.content.includes("<em>emphasis</em>"));
    assert.ok(paragraph.content.includes("<strong>strong</strong>"));

    const brParagraph = result.htmlLines.find((l) => l.type === "paragraph" && l.content.includes("<br>"));
    assert.ok(brParagraph);
});

console.log("\nEPUB converter — source flag and synthetic pages\n");

await asyncTest("every line has source: epub and synthetic pages are added", async () => {
    const epubPath = await buildEpub("source.epub", [
        ["ch1.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>
<body><p>Content.</p></body></html>`],
    ]);
    const result = await EpubConverter.convert(fileFromPath(epubPath));
    assert.ok(result.htmlLines.every((l) => l.source === "epub"));
    assert.ok(result.htmlLines.length >= 3, "expected synthetic title + content + end page");
    assert.ok(result.htmlLines[0].synthetic, "first line should be synthetic title");
    assert.ok(result.htmlLines[result.htmlLines.length - 1].synthetic, "last line should be synthetic end");
});

console.log("\nEPUB converter — TOC fragment anchors\n");

await asyncTest("resolves TOC fragment anchors to line numbers", async () => {
    const epubPath = await buildEpub("toc.epub", [
        ["nav.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Nav</title></head>
<body><nav epub:type="toc"><ol><li><a href="ch1.xhtml#section2">Section 2</a></li></ol></nav></body></html>`],
        ["ch1.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>
<body><h1>Chapter 1</h1><p id="section2">Target paragraph</p></body></html>`],
    ]);
    const result = await EpubConverter.convert(fileFromPath(epubPath));
    const tocEntry = result.titles.find(([label]) => label === "Section 2");
    assert.ok(tocEntry, "TOC fragment entry should be mapped to a title");
    const targetLine = result.htmlLines.find((l) => l.content.includes("Target paragraph"));
    assert.ok(targetLine);
    assert.equal(tocEntry[1], targetLine.lineNumber);
});

console.log("\nEPUB converter — NCX TOC in subdirectory\n");

await asyncTest("NCX TOC hrefs resolve against NCX path, not OPF path", async () => {
    // NCX lives in OEBPS/nav/toc.ncx and references ../ch1.xhtml. If the
    // converter wrongly resolves against opfPath (OEBPS/content.opf), the
    // href would become OEBPS/ch1.xhtml — which doesn't exist — and the
    // TOC entry would be dropped. Correct resolution against ncxPath
    // yields OEBPS/../ch1.xhtml = ch1.xhtml... but we put ch1 in OEBPS/,
    // so correct resolution is OEBPS/ch1.xhtml. Construct so the two
    // resolutions produce different paths.
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
    zip.file("OEBPS/content.opf", `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>NCX Subdir Book</dc:title>
    <dc:creator>Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="nav/toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`);
    zip.file("OEBPS/ch1.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>
<body><h1>Chapter 1</h1><p>Content.</p></body></html>`);
    // NCX in subdirectory; its src is relative to the NCX file, so ../ch1.xhtml
    // resolves to OEBPS/ch1.xhtml. If resolved against opfPath (OEBPS/content.opf),
    // ../ch1.xhtml would resolve to ch1.xhtml (wrong).
    zip.file("OEBPS/nav/toc.ncx", `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint><navLabel><text>Chapter 1</text></navLabel><content src="../ch1.xhtml"/></navPoint>
  </navMap>
</ncx>`);
    const epubPath = path.join(tmpDir, "ncx-subdir.epub");
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    fs.writeFileSync(epubPath, buffer);

    const result = await EpubConverter.convert(fileFromPath(epubPath));
    const tocEntry = result.titles.find(([label]) => label === "Chapter 1");
    assert.ok(tocEntry, "NCX entry from subdirectory should be mapped, not dropped");
});

console.log("\nEPUB converter — div-wrapped block structure\n");

await asyncTest("div wrapping ul/table/blockquote preserves block structure", async () => {
    const epubPath = await buildEpub("div-wrap.epub", [
        ["ch1.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>
<body><div class="chapter">
  <p>Intro</p>
  <ul><li>One</li><li>Two</li></ul>
  <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
</div></body></html>`],
    ]);
    const result = await EpubConverter.convert(fileFromPath(epubPath));
    const types = result.htmlLines.map((l) => l.type);
    assert.ok(types.includes("list"), "ul inside div should be preserved as a list line, not flattened");
    assert.ok(types.includes("table"), "table inside div should be preserved as a table line");
});

console.log("\nEPUB converter — missing spine files are non-fatal\n");

await asyncTest("missing spine file skips with warning, does not discard whole book", async () => {
    // Build an EPUB whose spine references a chapter that doesn't exist in the zip.
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
    zip.file("OEBPS/content.opf", `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Missing Spine Book</dc:title><dc:creator>Author</dc:creator><dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ghost" href="ghost.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ghost"/></spine>
</package>`);
    zip.file("OEBPS/ch1.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>
<body><p>Real content.</p></body></html>`);
    // ghost.xhtml intentionally not present
    const epubPath = path.join(tmpDir, "missing-spine.epub");
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    fs.writeFileSync(epubPath, buffer);

    const result = await EpubConverter.convert(fileFromPath(epubPath));
    // The book should still open with the real chapter's content.
    const paragraph = result.htmlLines.find((l) => l.type === "paragraph" && l.content.includes("Real content"));
    assert.ok(paragraph, "real spine items should still be processed when a sibling is missing");
});

console.log("\nEPUB converter — security\n");

await asyncTest("strips dangerous href schemes", async () => {
    const epubPath = await buildEpub("xss.epub", [
        ["ch1.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>
<body><p><a href="javascript:alert(1)">bad</a> <a href="chapter.xhtml#note">good</a></p></body></html>`],
    ]);
    const result = await EpubConverter.convert(fileFromPath(epubPath));
    const paragraph = result.htmlLines.find((l) => l.type === "paragraph");
    assert.ok(paragraph);
    assert.ok(!paragraph.content.includes("javascript:"), "dangerous href should be removed");
    assert.ok(paragraph.content.includes("chapter.xhtml#note"), "safe href should be preserved");
});

try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (_e) {
    // ignore
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
