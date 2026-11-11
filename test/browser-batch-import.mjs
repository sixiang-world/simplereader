import assert from "node:assert/strict";
import JSZip from "jszip";
import { withBrowserTest } from "./helpers/browser.mjs";

const zip = new JSZip();
zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
zip.file("book.opf", '<package><metadata><title>Batch EPUB</title><language>en</language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
zip.file("chapter.xhtml", "<html><body><h1>Chapter One</h1><p>Only rendered after opening from the shelf.</p></body></html>");
const epub = await zip.generateAsync({ type: "base64" });

await withBrowserTest(async ({ browser, baseURL }) => {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL);
    await page.waitForFunction(async () => {
        const { bookshelf } = await import("/client/src/modules/bookshelf/bookshelf.js");
        return bookshelf.enabled && document.querySelector("#dropzone-text")?.classList.contains("dropzone-text-text");
    }, null, { timeout: 20000 });

    const drop = async (names) => {
        await page.evaluate(async ({ names, epub }) => {
            const C = await import("/client/src/config/index.js");
            const transfer = new DataTransfer();
            for (const name of names) {
                const isEpub = name.endsWith(".epub");
                const bytes = isEpub ? Uint8Array.from(atob(epub), char => char.charCodeAt(0)) : "Chapter One\n\nSample text.\n";
                transfer.items.add(new File([bytes], name, {
                    type: isEpub ? "application/epub+zip" : name.endsWith(".log") ? "" : "text/plain",
                }));
            }
            const overlay = C.DOM_ELEMENT.DROPZONE_OVERLAY;
            window.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
            overlay.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
            overlay.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }, { names, epub });
    };
    const readState = () => page.evaluate(async () => {
        const C = await import("/client/src/config/index.js");
        const { bookshelf } = await import("/client/src/modules/bookshelf/bookshelf.js");
        const rows = await bookshelf.db.getBookList();
        const records = await Promise.all(rows.map(row => bookshelf.db.getBook(row.name)));
        return {
            current: C.VARS.FILENAME,
            open: C.VARS.IS_BOOK_OPENED,
            rendered: C.DOM_ELEMENT.CONTENT_CONTAINER.textContent,
            visibility: getComputedStyle(C.DOM_ELEMENT.CONTENT_CONTAINER).visibility,
            lastOpened: localStorage.getItem("STR-Filename"),
            books: records.map(({ name, displayName, processed, is_epub }) => ({ name, displayName, processed, is_epub })),
        };
    });

    await drop(["batch.txt", "batch.epub", "second.epub"]);
    await page.locator('.bookshelf [data-filename="second.epub"]').waitFor({ state: "visible" });
    const batch = await readState();
    assert.equal(batch.open, false);
    assert.equal(batch.rendered.trim(), "");
    assert.ok(!batch.lastOpened);
    assert.equal(batch.books.length, 3);
    for (const record of batch.books) {
        assert.equal(record.processed, false);
        assert.equal(record.is_epub, record.displayName.endsWith(".epub"));
    }

    const epubId = batch.books.find(book => book.displayName === "batch.epub").name;
    const opened = await page.evaluate(async id => {
        const { bookshelf } = await import("/client/src/modules/bookshelf/bookshelf.js");
        return bookshelf.openBook(id);
    }, epubId);
    assert.equal(opened, true);
    const current = await readState();
    assert.equal(current.current, "batch.epub");
    assert.match(current.rendered, /Only rendered after opening from the shelf/);

    await drop(["another.txt", "another.epub"]);
    await page.locator('.bookshelf [data-filename="another.epub"]').waitFor({ state: "attached" });
    const after = await readState();
    assert.equal(after.books.length, 5);
    assert.equal(after.current, current.current);
    assert.equal(after.lastOpened, current.lastOpened);
    assert.equal(after.rendered, current.rendered);
    assert.equal(after.visibility, "visible");

    await drop(["single.log"]);
    await page.locator('#content[data-reader-mode="log"]').getByText("Sample text.").waitFor({ state: "visible" });
    assert.equal((await readState()).current, "single.log");
    const dialogMounted = await page.evaluate(async () => {
        const { goLine } = await import("/client/src/modules/reader/go-line.js");
        const { reader } = await import("/client/src/modules/reader/reader.js");
        goLine.showDialog(line => reader.gotoLine(line, false));
        return Boolean(document.querySelector("#goLineDlg input"));
    });
    assert.equal(dialogMounted, true, "quick jump mounts an input");
    const jump = page.locator("#goLineDlg input");
    assert.match(await jump.getAttribute("placeholder"), /50%/);
    await jump.fill("1abc");
    await jump.press("Enter");
    assert.equal(await jump.evaluate(input => input.validity.customError), true);
    await jump.fill("５０％");
    await jump.press("Enter");
    await jump.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    await page.close();
});
console.log("Mixed batch drops store raw books, preserve the current reader, and leave single-file opening intact.");
