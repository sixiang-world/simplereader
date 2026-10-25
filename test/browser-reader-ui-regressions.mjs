// Real-browser regressions against production module APIs served by Vite.
// Full built-application smoke tests separately exercise productionURL.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { withBrowserTest } from "./helpers/browser.mjs";

await withBrowserTest(async ({ browser, baseURL, productionURL }) => {
    let passed = 0;
    let failed = 0;
    async function test(name, run) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(baseURL, { waitUntil: "domcontentloaded" });
            await page.waitForFunction(() => typeof HyperList !== 'undefined' &&
                document.querySelector("#dropzone-text")?.classList.contains("dropzone-text-text"), null, { timeout: 15000 });
            assert.deepEqual(errors, [], "reader fixture startup must complete without uncaught errors");
            await run(page, errors);
            console.log(`✓ ${name}`);
            passed++;
        } catch (error) {
            console.error(`✗ ${name}: ${error.stack}; startup errors: ${JSON.stringify(errors)}`);
            failed++;
        } finally {
            await page.close();
        }
    }
    await test('TOC labels are rendered as text', async page => {
        const result = await page.evaluate(async () => {
            const C = await import('/client/src/config/index.js');
            const { reader } = await import('/client/src/modules/reader/reader.js');
            const payload = '<img src=x onerror="window.__tocXss=1">';
            C.VARS.ALL_TITLES = [[payload, 0, payload, false]];
            reader.processTOC();
            await new Promise(resolve => setTimeout(resolve, 100));
            return { images: document.querySelectorAll('#toc-list img').length, text: document.querySelector('#span0')?.textContent, executed: !!window.__tocXss, payload };
        });
        assert.equal(result.images, 0);
        assert.equal(result.text, result.payload);
        assert.equal(result.executed, false);
    });
    await test('notification text is inert and timeout releases key listener', async page => {
        const result = await page.evaluate(async () => {
            const { PopupManager } = await import('/client/src/components/popup-manager.js');
            let adds = 0, removes = 0;
            const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
            document.addEventListener = (type, ...args) => { if (type === 'keydown') adds++; return add(type, ...args); };
            document.removeEventListener = (type, ...args) => { if (type === 'keydown') removes++; return remove(type, ...args); };
            const payload = '<img src=x onerror="window.__notificationXss=1">\nnext';
            PopupManager.showNotification({ iconName: 'BOOK', text: payload, timer: 100 });
            const text = document.querySelector('.custom-notification-text').textContent;
            const images = document.querySelectorAll('.custom-notification-text img').length;
            await new Promise(resolve => setTimeout(resolve, 1100));
            return { text, payload, images, executed: !!window.__notificationXss, adds, removes, remaining: document.querySelectorAll('.custom-notification-popup').length };
        });
        assert.equal(result.images, 0);
        assert.equal(result.text, result.payload);
        assert.equal(result.executed, false);
        assert.equal(result.adds, result.removes);
        assert.equal(result.remaining, 0);
    });
    await test('rebuilding TOC destroys detached HyperList loops', async page => {
        const result = await page.evaluate(async () => {
            const C = await import('/client/src/config/index.js');
            const { reader } = await import('/client/src/modules/reader/reader.js');
            C.VARS.ALL_TITLES = [['Chapter', 0, 'Chapter', false]];
            const lists = [], create = HyperList.create;
            HyperList.create = function (...args) { const list = create.apply(this, args); lists.push(list); return list; };
            for (let i = 0; i < 3; i++) reader.processTOC();
            const frames = lists.map(list => list._renderAnimationFrame);
            await new Promise(resolve => setTimeout(resolve, 100));
            return lists.map((list, i) => ({ connected: list._element.isConnected, scheduled: list._renderAnimationFrame !== frames[i] }));
        });
        assert.deepEqual(result.map(list => list.connected), [false, false, true]);
        assert.deepEqual(result.map(list => list.scheduled), [false, false, true]);
    });
    await test('flow replaces equal-size documents', async page => {
        const result = await page.evaluate(async () => {
            const C = await import('/client/src/config/index.js');
            const { reader } = await import('/client/src/modules/reader/reader.js');
            const { flowReader } = await import('/client/src/modules/reader/flow-reader.js');
            C.VARS.PAGE_BREAKS = [0]; C.VARS.TOTAL_PAGES = 1; C.VARS.CURRENT_PAGE = 1;
            C.VARS.FILE_CONTENT_CHUNKS = [{ type: 'paragraph', content: 'Old book', lineNumber: 0 }];
            flowReader.enter();
            C.VARS.FILE_CONTENT_CHUNKS = [{ type: 'paragraph', content: 'New book', lineNumber: 0 }];
            reader.showCurrentPageContent();
            return C.DOM_ELEMENT.CONTENT_CONTAINER.textContent;
        });
        assert.equal(result, 'New book');
    });
    await test('EPUB text footnotes have finite positioning', async (page, errors) => {
        const result = await page.evaluate(async () => {
            const C = await import('/client/src/config/index.js');
            const { getFootnotes } = await import('/client/src/modules/reader/footnotes.js');
            C.VARS.FOOTNOTE_MAP = { 'OPS/chapter.xhtml#note': 'Safe note' };
            C.VARS.FILE_CONTENT_CHUNKS = [{ spinePath: 'OPS/chapter.xhtml' }];
            const line = document.createElement('p'); line.dataset.lineNum = '0';
            const anchor = document.createElement('a'); anchor.rel = 'footnote'; anchor.href = '#note'; anchor.textContent = 'Note'; line.append(anchor); document.body.append(line);
            getFootnotes(); anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            const div = document.querySelector('#footnotediv');
            return { text: div?.textContent, left: div?.style.left, top: div?.style.top };
        });
        assert.equal(result.text, 'Safe note');
        assert.match(result.left, /^-?[\d.]+px$/);
        assert.match(result.top, /^-?[\d.]+px$/);
        assert.deepEqual(errors, []);
    });
    await test('unknown inherited CSS keys cannot crash rendering', async page => {
        const result = await page.evaluate(async () => {
            const { TextProcessorDOM } = await import('/client/src/modules/text/text-processor-dom.js');
            const [element] = TextProcessorDOM.createFromStructure({ type: 'paragraph', source: 'epub', lineNumber: 0, content: '<span style="constructor:abc;__proto__:x;text-align:center">Safe</span>' });
            return { text: element.textContent, align: element.querySelector('span').style.textAlign };
        });
        assert.equal(result.text, 'Safe');
        assert.equal(result.align, 'center');
    });
    await test('cross-page search highlights after navigation and clears every mark', async page => {
        const result = await page.evaluate(async () => {
            const C = await import('/client/src/config/index.js');
            const { reader } = await import('/client/src/modules/reader/reader.js');
            const { search } = await import('/client/src/modules/reader/search.js');
            C.VARS.FILE_CONTENT_CHUNKS = [{ type: 'paragraph', content: 'First', lineNumber: 0 }, { type: 'paragraph', source: 'epub', content: 'Needle <em>needle</em><img src="data:image/png;base64,aGVsbG8=">', lineNumber: 1 }];
            C.VARS.PAGE_BREAKS = [0, 1]; C.VARS.TOTAL_PAGES = 2; C.VARS.CURRENT_PAGE = 1;
            C.VARS.ALL_TITLES = [['Chapter', 0, 'Chapter', false]]; C.VARS.ALL_TITLES_IND = { 0: 0 };
            reader.showCurrentPageContent();
            search.showDialog(); document.querySelector('.search-txt').value = 'needle'; document.querySelector('.search-down').click();
            await new Promise(resolve => setTimeout(resolve, 150));
            const element = document.querySelector('#line1'), before = element?.querySelectorAll('mark').length;
            search.clearHighlight();
            const after = element?.querySelectorAll('mark').length;
            document.querySelector('.search-txt').value = 'png'; document.querySelector('.search-down').click();
            await new Promise(resolve => setTimeout(resolve, 100));
            const src = element?.querySelector('img')?.getAttribute('src');
            search.close();
            return { before, after, src };
        });
        assert.equal(result.before, 2);
        assert.equal(result.after, 0);
        assert.equal(result.src, 'data:image/png;base64,aGVsbG8=');
    });
    await test('search cancels runaway regex and remains responsive', async page => {
        const result = await page.evaluate(async () => {
            const C = await import('/client/src/config/index.js');
            const { search } = await import('/client/src/modules/reader/search.js');
            C.VARS.FILE_CONTENT_CHUNKS = [{ type: 'paragraph', content: 'a'.repeat(40) + '!', lineNumber: 0 }];
            C.VARS.PAGE_BREAKS = [0]; C.VARS.CURRENT_PAGE = 1; C.VARS.TOTAL_PAGES = 1;
            const OriginalWorker = window.Worker;
            let terminated = 0, heartbeats = 0;
            window.Worker = class extends OriginalWorker { terminate() { terminated++; super.terminate(); } };
            const heartbeat = setInterval(() => heartbeats++, 20);
            search.showDialog(); document.querySelector('.search-txt').value = '(a+)+$'; document.querySelector('.search-down').click();
            await new Promise(resolve => setTimeout(resolve, 2300));
            search.close();
            clearInterval(heartbeat); window.Worker = OriginalWorker;
            return { terminated, heartbeats, marks: document.querySelectorAll('mark[data-search-highlight]').length };
        });
        assert.ok(result.terminated >= 1, 'deadline terminates regex worker');
        assert.ok(result.heartbeats > 20, 'main thread remains responsive');
        assert.equal(result.marks, 0);
    });
    await test('internal EPUB links resolve relative paths in their own chapter', async page => {
        const result = await page.evaluate(async () => {
            const C = await import('/client/src/config/index.js');
            const { reader } = await import('/client/src/modules/reader/reader.js');
            C.VARS.FILE_CONTENT_CHUNKS = [
                { type: 'paragraph', source: 'epub', spinePath: 'OPS/Text/one.xhtml', lineNumber: 0, content: '<a href="two.xhtml#same">Next</a>' },
                { type: 'paragraph', source: 'epub', spinePath: 'OPS/Text/two.xhtml', lineNumber: 1, content: '<a href="#same">Own</a>' },
            ];
            C.VARS.FRAGMENT_TO_LINE = { 'OPS/Text/one.xhtml#same': 0, 'OPS/Text/two.xhtml#same': 1 };
            C.VARS.FILE_TO_LINE = { 'OPS/Text/one.xhtml': 0, 'OPS/Text/two.xhtml': 1 };
            C.VARS.PAGE_BREAKS = [0, 1]; C.VARS.TOTAL_PAGES = 2; C.VARS.CURRENT_PAGE = 1;
            C.VARS.ALL_TITLES = [['Chapter', 0, 'Chapter', false]]; C.VARS.ALL_TITLES_IND = { 0: 0 };
            reader.initInternalLinks(); reader.showCurrentPageContent();
            document.querySelector('#line0 a').click();
            await new Promise(resolve => setTimeout(resolve, 100));
            const crossChapterPage = C.VARS.CURRENT_PAGE;
            document.querySelector('#line1 a').click();
            await new Promise(resolve => setTimeout(resolve, 100));
            return { crossChapterPage, ownChapterPage: C.VARS.CURRENT_PAGE };
        });
        assert.equal(result.crossChapterPage, 2);
        assert.equal(result.ownChapterPage, 2);
    });
    await test('built search worker runs under a production subpath', async page => {
        const files = await readdir(new URL("../dist/assets/", import.meta.url));
        const workerFile = files.find(name => /^search-worker-.*\.js$/.test(name));
        assert.ok(workerFile, 'Vite must emit the search worker');
        await page.goto(productionURL + '/reader/');
        const result = await page.evaluate(async url => {
            const worker = new Worker(url, { type: 'module' });
            try {
                return await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Production search worker timed out')), 3000);
                    worker.onmessage = ({ data }) => { clearTimeout(timeout); resolve(data.result); };
                    worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)); };
                    worker.postMessage({ lines: [{ lineNumber: 7, text: 'Needle needle' }], pattern: 'needle' });
                });
            } finally { worker.terminate(); }
        }, productionURL + '/reader/assets/' + workerFile);
        assert.deepEqual(result, { lineNumber: 7, ranges: [[0, 6], [7, 13]] });
    });
    console.log(`${passed} passed, ${failed} failed`);
    assert.equal(failed, 0, "Reader/UI browser regressions failed");
});
