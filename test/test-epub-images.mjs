import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

// ── Polyfill DOMParser / JSZip / Node for EpubConverter (converter side) ──
const linkedom = (await import("linkedom")).default || (await import("linkedom"));
globalThis.DOMParser = linkedom.DOMParser;
globalThis.Node = linkedom.Node;
globalThis.JSZip = JSZip;

// ── DOM environment for TextProcessorDOM (rendering side) ──
const { DOMParser: DomParser2, Node: Node2, parseHTML } = linkedom;
const domDoc = parseHTML("<!DOCTYPE html><html><body></body></html>").document;
domDoc.styleSheets = [];
if (domDoc.documentElement && !domDoc.documentElement.getAttribute) {
    domDoc.documentElement.getAttribute = () => null;
    domDoc.documentElement.setAttribute = () => {};
}
class MutationObserverStub {
    constructor() {}
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
}
const win = {
    location: { search: "", href: "http://localhost/" },
    innerWidth: 1024,
    localStorage: {
        _data: new Map(),
        getItem(k) { return this._data.get(k) ?? null; },
        setItem(k, v) { this._data.set(k, String(v)); },
        removeItem(k) { this._data.delete(k); },
        clear() { this._data.clear(); },
    },
    MutationObserver: MutationObserverStub,
};
globalThis.document = domDoc;
globalThis.Node = Node2;
globalThis.window = win;
globalThis.localStorage = win.localStorage;
globalThis.MutationObserver = MutationObserverStub;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "", setProperty: () => {} });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EpubConverter = (await import("../client/src/modules/epub/epub-converter.js")).EpubConverter;
const TextProcessorDOM = (await import("../client/src/modules/text/text-processor-dom.js")).TextProcessorDOM;

let passed = 0;
let failed = 0;
async function test(name, fn) {
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-epub-img-"));

// A real 1x1 red PNG (base64).
const RED_PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pngBuffer = Buffer.from(RED_PNG_B64, "base64");

async function buildEpubWithImages() {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
    zip.file("OEBPS/content.opf", `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Img Test</dc:title><dc:creator>Author</dc:creator><dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="img1" href="Images/pic1.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`);
    zip.file("OEBPS/Images/pic1.png", pngBuffer);
    zip.file("OEBPS/chap1.xhtml", `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head>
<body>
  <h1>Chapter One</h1>
  <p>Text before image.</p>
  <img src="Images/pic1.png" alt="inline pic"/>
  <p>Before <img src="Images/pic1.png" alt="mid"/> after.</p>
  <figure><img src="Images/pic1.png" alt="figure pic"/><figcaption>A figure caption</figcaption></figure>
  <p>Text after.</p>
</body></html>`);
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const epubPath = path.join(tmpDir, "imgtest.epub");
    fs.writeFileSync(epubPath, buffer);
    return epubPath;
}

function fileFromPath(p) {
    const buffer = fs.readFileSync(p);
    return new File([buffer], path.basename(p), { type: "application/epub+zip" });
}

console.log("EPUB image rendering — converter inlining\n");

await test("standalone <img> becomes an image block with data: URL", async () => {
    const epubPath = await buildEpubWithImages();
    const result = await EpubConverter.convert(fileFromPath(epubPath));
    const imgBlocks = result.htmlLines.filter((l) => l.elementType === "img");
    assert.equal(imgBlocks.length, 2, "expected 2 image blocks (standalone img + figure)");
    const standalone = imgBlocks.find((b) => b.content.includes("<img"));
    assert.ok(standalone, "standalone img block present");
    assert.ok(standalone.content.includes("data:image/png;base64,"), "img inlined as data:image/png;base64");
    assert.equal(standalone.type, "image");
    assert.equal(standalone.charCount, 1, "image block counts as one line for pagination");
});

await test("<figure> preserves figcaption and inlines its img", async () => {
    const epubPath = await buildEpubWithImages();
    const result = await EpubConverter.convert(fileFromPath(epubPath));
    const figureBlock = result.htmlLines.find(
        (b) => b.content && b.content.includes("<figure>") && b.content.includes("<figcaption>")
    );
    assert.ok(figureBlock, "figure block preserved");
    assert.ok(figureBlock.content.includes("data:image/png;base64,"), "figure img inlined");
    assert.ok(figureBlock.content.includes("A figure caption"), "figcaption preserved");
});

await test("inline <img> inside a text paragraph is inlined and text preserved", async () => {
    const epubPath = await buildEpubWithImages();
    const result = await EpubConverter.convert(fileFromPath(epubPath));
    const mixed = result.htmlLines.find((b) => b.type === "paragraph" && b.content.includes("Before"));
    assert.ok(mixed, "paragraph with inline img present");
    assert.ok(mixed.content.includes("<img"), "inline img tag preserved");
    assert.ok(mixed.content.includes("data:image/png;base64,"), "inline img inlined");
    assert.ok(mixed.content.includes("Before") && mixed.content.includes("after"), "surrounding text preserved");
});

console.log("\nEPUB image rendering — sanitize security\n");

test("safe data:image png renders <img> with src/alt", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "image",
        tag: "img",
        content: `<img src="data:image/png;base64,${RED_PNG_B64}" alt="ok">`,
        lineNumber: 1,
        elementType: "img",
        source: "epub",
    });
    const img = el.querySelector("img");
    assert.ok(img, "img rendered");
    assert.ok(img.getAttribute("src").startsWith("data:image/png;base64,"), "src is data URL");
    assert.equal(img.getAttribute("alt"), "ok", "alt preserved");
});

test("external http(s) img src is stripped", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "image", tag: "img",
        content: '<img src="https://evil.example/x.png" alt="x">',
        lineNumber: 2, elementType: "img", source: "epub",
    });
    assert.equal(el.querySelector("img"), null, "external img removed");
});

test("javascript: img src is stripped", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "image", tag: "img",
        content: '<img src="javascript:alert(1)" alt="x">',
        lineNumber: 3, elementType: "img", source: "epub",
    });
    assert.equal(el.querySelector("img"), null, "javascript: img removed");
});

test("non-base64 / wrong-typed data: URLs are stripped", () => {
    const [a] = TextProcessorDOM.createFromStructure({
        type: "image", tag: "img",
        content: '<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="x">',
        lineNumber: 4, elementType: "img", source: "epub",
    });
    assert.equal(a.querySelector("img"), null, "non-base64 data URL removed");
    const [b] = TextProcessorDOM.createFromStructure({
        type: "image", tag: "img",
        content: '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" alt="x">',
        lineNumber: 5, elementType: "img", source: "epub",
    });
    assert.equal(b.querySelector("img"), null, "data:text/html must not survive as an img");
});

test("figure with safe img + figcaption renders intact", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "image", tag: "figure",
        content: `<figure><img src="data:image/png;base64,${RED_PNG_B64}" alt="fig"><figcaption>Cap</figcaption></figure>`,
        lineNumber: 6, elementType: "img", source: "epub",
    });
    assert.ok(el.querySelector("figure"), "figure wrapper preserved");
    assert.ok(el.querySelector("figcaption"), "figcaption preserved");
    assert.ok(el.querySelector("img"), "safe figure img preserved");
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
