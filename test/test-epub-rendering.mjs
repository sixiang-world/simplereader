import assert from "node:assert/strict";

// Provide a minimal DOM environment for TextProcessorDOM.
const linkedom = (await import("linkedom")).default || (await import("linkedom"));
const { DOMParser, Node, parseHTML } = linkedom;
const { document } = parseHTML("<!DOCTYPE html><html></html>");
document.styleSheets = [];
class MutationObserver {
    constructor() {}
    observe() {}
    disconnect() {}
}

const window = {
    location: { search: "" },
    innerWidth: 1024,
    localStorage: {
        _data: new Map(),
        getItem(k) { return this._data.get(k) ?? null; },
        setItem(k, v) { this._data.set(k, String(v)); },
        removeItem(k) { this._data.delete(k); },
        clear() { this._data.clear(); },
    },
    MutationObserver,
};
globalThis.document = document;
globalThis.DOMParser = DOMParser;
globalThis.Node = Node;
globalThis.window = window;
globalThis.localStorage = window.localStorage;
globalThis.MutationObserver = MutationObserver;

const modulePath = "../client/src/modules/text/text-processor-dom.js";
const TextProcessorDOM = (await import(modulePath)).TextProcessorDOM;

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

console.log("TextProcessorDOM — EPUB rendering\n");

test("EPUB paragraph renders whitelisted inline HTML", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "paragraph",
        tag: "p",
        content: "This is <em>italic</em> and <strong>bold</strong>.",
        lineNumber: 1,
        elementType: "p",
        source: "epub",
    });
    assert.equal(el.tagName.toLowerCase(), "p");
    assert.equal(el.getAttribute("data-source"), "epub");
    assert.ok(el.innerHTML.includes("<em>italic</em>"));
    assert.ok(el.innerHTML.includes("<strong>bold</strong>"));
});

test("TXT paragraph escapes inline HTML", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "paragraph",
        tag: "p",
        content: "This is <em>italic</em>.",
        lineNumber: 2,
        elementType: "p",
    });
    assert.ok(!el.innerHTML.includes("<em>"));
    assert.ok(el.textContent.includes("<em>italic</em>"));
});

test("EPUB list renders <ul>/<li>", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "list",
        tag: "ul",
        content: "<ul><li>one</li><li>two</li></ul>",
        lineNumber: 3,
        elementType: "l",
        source: "epub",
    });
    assert.equal(el.tagName.toLowerCase(), "div");
    const ul = el.querySelector("ul");
    assert.ok(ul);
    assert.equal(ul.querySelectorAll("li").length, 2);
});

test("EPUB blockquote renders <blockquote>", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "quote",
        tag: "blockquote",
        content: "A <em>quoted</em> line",
        lineNumber: 4,
        elementType: "q",
        source: "epub",
    });
    assert.equal(el.tagName.toLowerCase(), "blockquote");
    assert.equal(el.getAttribute("data-source"), "epub");
    assert.ok(el.innerHTML.includes("<em>quoted</em>"));
});

test("EPUB preformatted preserves whitespace", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "preformatted",
        tag: "pre",
        content: "  line1\n  line2",
        lineNumber: 5,
        elementType: "c",
        source: "epub",
    });
    assert.equal(el.tagName.toLowerCase(), "pre");
    assert.equal(el.textContent, "  line1\n  line2");
});

test("EPUB table renders rows and cells", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "table",
        tag: "table",
        content: "<table><tr><th>A</th><td>1</td></tr></table>",
        lineNumber: 6,
        elementType: "b",
        source: "epub",
    });
    assert.equal(el.tagName.toLowerCase(), "table");
    assert.equal(el.querySelectorAll("th").length, 1);
    assert.equal(el.querySelectorAll("td").length, 1);
});

test("EPUB paragraph strips non-whitelisted tags", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "paragraph",
        tag: "p",
        content: "Hello <script>alert(1)</script>world",
        lineNumber: 7,
        elementType: "p",
        source: "epub",
    });
    assert.ok(!el.innerHTML.includes("<script>"));
    assert.ok(el.textContent.includes("Hello world"));
});

test("EPUB paragraph strips dangerous href", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "paragraph",
        tag: "p",
        content: '<a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a>',
        lineNumber: 8,
        elementType: "p",
        source: "epub",
    });
    assert.equal(el.querySelectorAll("a").length, 1);
    assert.equal(el.querySelector("a").getAttribute("href"), "https://example.com");
});

test("synthetic title page renders HTML directly", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "title",
        tag: "div",
        content: "<h1>Test Book</h1><p class=\"author\">Tester</p>",
        lineNumber: 0,
        elementType: "t",
        source: "epub",
        synthetic: true,
    });
    assert.equal(el.classList.contains("synthetic-page"), true);
    assert.equal(el.querySelector("h1").textContent, "Test Book");
    assert.equal(el.querySelector(".author").textContent, "Tester");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
