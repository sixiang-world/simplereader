/**
 * Regression tests for the seal decoration on generated title/end pages.
 *
 * Bug: the seal line (<div ... class='prevent-select seal'><img id='seal_front'>…)
 * was classified as a generic "span" structure, which the DOM layer rendered
 * with textContent — so the raw HTML showed up as literal text at the start
 * and end of the book. The fix gives it a dedicated "seal" structure type and
 * rebuilds the fixed markup explicitly.
 *
 * @module test/test-seal-rendering
 */

import assert from "node:assert/strict";

// TextProcessorCore is pure JS — import directly.
const { TextProcessorCore } = await import("../shared/core/text/text-processor-core.js");

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

const { TextProcessorDOM } = await import("../client/src/modules/text/text-processor-dom.js");

const SEAL_FRONT_LINE = `
    <div id=line2 class='prevent-select seal'>
        <img id='seal_front'></img>
    </div>
`;
const SEAL_END_LINE = `
    <div id=line5303 class='prevent-select seal'>
        <img id='seal_end'></img>
    </div>
`;

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

console.log("Seal rendering — structure classification + DOM rebuild\n");

test("process() classifies seal div lines as type 'seal'", () => {
    const front = TextProcessorCore.process(SEAL_FRONT_LINE, 2, true);
    assert.equal(front.type, "seal");
    assert.equal(front.tag, "div");
    assert.equal(front.elementType, "e");
    assert.equal(front.charCount, 0, "seal carries no page-filling text");

    const end = TextProcessorCore.process(SEAL_END_LINE, 5303, true);
    assert.equal(end.type, "seal");
    assert.equal(end.tag, "div");
    assert.equal(end.elementType, "e");
});

test("process() still classifies h1 title-page lines as 'title'", () => {
    const h1 = TextProcessorCore.process("<h1 id=line0 style='margin-bottom:0'>Book</h1>", 0, true);
    assert.equal(h1.type, "title");
    assert.equal(h1.elementType, "t");
});

test("seal_front structure rebuilds div.seal > img#seal_front", () => {
    const structure = TextProcessorCore.process(SEAL_FRONT_LINE, 2, true);
    const [el, lineType] = TextProcessorDOM.createFromStructure(structure);

    assert.equal(lineType, "e");
    assert.equal(el.tagName.toLowerCase(), "div");
    assert.equal(el.id, "line2");
    assert.ok(el.classList.contains("seal"), "must keep the .seal class (reader.css positions it)");
    assert.ok(el.classList.contains("prevent-select"));
    const img = el.querySelector("img");
    assert.ok(img, "seal img must exist");
    assert.equal(img.id, "seal_front");
    assert.equal(el.getAttribute("data-line-num"), "2");
});

test("seal_end structure rebuilds img#seal_end", () => {
    const structure = TextProcessorCore.process(SEAL_END_LINE, 5303, true);
    const [el] = TextProcessorDOM.createFromStructure(structure);

    assert.equal(el.id, "line5303");
    const img = el.querySelector("img");
    assert.ok(img);
    assert.equal(img.id, "seal_end");
});

test("seal renders as markup, never as escaped literal text", () => {
    const structure = TextProcessorCore.process(SEAL_FRONT_LINE, 2, true);
    const [el] = TextProcessorDOM.createFromStructure(structure);

    assert.ok(!el.textContent.includes("<div"), "raw HTML must not leak as text");
    assert.ok(!el.textContent.includes("seal_front"), "no markup residue in text content");
});

test("legacy stored 'span' structures containing seal markup still render as seal", () => {
    // Books saved before the fix persisted the seal as a generic span structure.
    const [el] = TextProcessorDOM.createFromStructure({
        type: "span",
        tag: "span",
        content: SEAL_FRONT_LINE.trim(),
        charCount: 0,
        lineNumber: 2,
        elementType: "e",
    });
    assert.equal(el.tagName.toLowerCase(), "div");
    assert.ok(el.classList.contains("seal"));
    assert.equal(el.querySelector("img")?.id, "seal_front");
});

test("generic span structures without seal markup keep plain-text escaping", () => {
    const [el] = TextProcessorDOM.createFromStructure({
        type: "empty",
        tag: "span",
        content: "<script>alert(1)</script>",
        charCount: 0,
        lineNumber: 9,
        elementType: "e",
    });
    assert.ok(!el.querySelector("script"), "untrusted content must not become markup");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
