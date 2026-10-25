import assert from "node:assert/strict";
import { withBrowserTest } from "./helpers/browser.mjs";

await withBrowserTest(async ({ browser, baseURL, productionURL }) => {
    const page = await browser.newPage();
    await page.goto(baseURL);
    const passed = await page.evaluate(async () => {
        const { DBManager } = await import("/client/src/modules/database/db-manager.js");
        const { BookshelfDB, bookshelf } = await import("/client/src/modules/bookshelf/bookshelf.js");
        const { fontpool } = await import("/client/src/modules/font/fontpool.js");
        const CONFIG = await import("/client/src/config/index.js");
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        const passed = [];
        const config = { dbName: `storage-regression-${Date.now()}`, dbVersion: 1,
            objectStores: ["raw", "processed", "fonts"].map((name) => ({ name, index: 0, options: { keyPath: "name" } })) };
        const manager = new DBManager(config);
        const originalChunkSize = DBManager.CHUNK_SIZE;
        const originalThreshold = DBManager.CHUNK_THRESHOLD;
        DBManager.CHUNK_SIZE = 10;
        DBManager.CHUNK_THRESHOLD = 1;
        const bookKey = "regression-book";
        const original = new File(["original bytes"], "original.txt");
        const open = (name, version) => new Promise((resolve, reject) => {
            const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
            req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
        });
        const request = (req) => new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
        });
        const read = async (store, key) => {
            const db = await open(config.dbName);
            try { return await request(db.transaction(store).objectStore(store).get(key)); } finally { db.close(); }
        };
        const list = async (store) => {
            const db = await open(config.dbName);
            try { return await request(db.transaction(store).objectStore(store).getAll()); } finally { db.close(); }
        };
        try {
            for (const count of [1, 5, 6, 12]) {
                const lines = Array.from({ length: count }, (_, i) => `line-${i}-long`);
                await manager.put({ name: bookKey }, { stores: {
                    raw: () => ({ name: bookKey, file: original, processed: true }),
                    processed: () => ({ name: bookKey, lines }),
                } });
                check(JSON.stringify((await manager.get(["processed"], bookKey)).lines) === JSON.stringify(lines), `chunk round trip ${count}`);
                const rows = await list("processed");
                check(rows.length === count + 1, `old chunks cleaned after rewrite ${count}`);
                check(await (await read("raw", bookKey)).file.text() === "original bytes", "original File preserved");
            }
            passed.push("1/5/6/12 chunks commit and round-trip; rewritten chunks are cleaned");

            // One invalid write in the second store must roll back the first.
            const before = await read("raw", bookKey);
            let failed = false;
            try { await manager.put({}, { stores: {
                raw: () => ({ name: bookKey, processed: false, file: original }),
                processed: () => ({ noKey: true }),
            } }); } catch { failed = true; }
            check(failed && (await read("raw", bookKey)).processed === before.processed, "multi-store put rollback");
            check((await manager.get(["processed"], bookKey)).lines.length === 12, "old cache survives failed replacement");
            passed.push("multi-store put failure keeps original and previous cache intact");

            // Deletion must also be atomic when another requested store is invalid.
            try { await manager.delete(["raw", "processed", "missing"], bookKey); } catch { /* expected */ }
            check(Boolean(await read("raw", bookKey)), "failed delete removed raw book");
            await manager.delete(["raw", "processed"], bookKey);
            check(!(await read("raw", bookKey)) && (await list("processed")).length === 0, "delete removes all chunks");
            await manager.put({ name: bookKey }, { stores: { fonts: (data) => ({ ...data, font: "kept" }) } });
            await manager.clear(["raw", "processed"]);
            check(Boolean(await read("fonts", bookKey)), "clear affected unrelated font store");
            passed.push("delete and clear are atomic and scoped to requested stores");

            // A late abort after request success must never be acknowledged as committed.
            const wrapper = `const put=IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put=function(value,...args){const req=put.call(this,value,...args);
                    if(value.name==='late-abort') req.addEventListener('success',()=>this.transaction.abort());return req;};
                await import(${JSON.stringify(new URL("/client/src/modules/database/db-worker.js", location.href).href)});
                self.postMessage({ready:true});`;
            const url = URL.createObjectURL(new Blob([wrapper], { type: "text/javascript" }));
            const worker = new Worker(url, { type: "module" });
            try {
                await new Promise((resolve, reject) => { worker.onmessage = resolve; worker.onerror = reject; });
                const response = new Promise((resolve) => { worker.onmessage = ({ data }) => resolve(data); });
                worker.postMessage({ type: "putMany", data: { id: 1, ...config, dbVersion: config.dbVersion,
                    records: [{ storeName: "raw", data: { name: "late-abort", content: "must rollback" } }] } });
                check((await response).type === "error", "late abort reported success");
                check(!(await read("raw", "late-abort")), "late aborted record persisted");
            } finally { worker.terminate(); URL.revokeObjectURL(url); }
            passed.push("request success followed by transaction abort reports failure");

            // An older open manager and worker must release on versionchange.
            const upgrade = await Promise.race([open(config.dbName, 2), new Promise((_, reject) => setTimeout(() => reject(new Error("upgrade blocked")), 3000))]);
            upgrade.close();
            passed.push("versionchange closes owned main/worker connections without blocking upgrade");
        } finally {
            DBManager.CHUNK_SIZE = originalChunkSize; DBManager.CHUNK_THRESHOLD = originalThreshold;
            manager.dispose();
            await new Promise((resolve, reject) => { const req = indexedDB.deleteDatabase(config.dbName); req.onsuccess = resolve; req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error("test cleanup blocked")); });
        }

        // Real BookshelfDB metadata updates must retain derived content and raw bytes.
        const books = new BookshelfDB();
        const name = `cache-language-${Date.now()}.txt`;
        const rawStore = CONFIG.CONST_DB.DB_STORES[0].name;
        const processedStore = CONFIG.CONST_DB.DB_STORES[1].name;
        try {
            await books.put({ name }, { stores: {
                [rawStore]: () => ({ name, data: original, processed: true }),
                [processedStore]: () => ({ name, file_content_chunks: ["cached content"], all_titles: [["title", 0]], page_breaks: [0], total_pages: 1 }),
            } });
            await books.updateBookLanguage(name, true);
            let cached = await books.getBook(name);
            check(cached.processed && cached.file_content_chunks[0] === "cached content", "language update erased parsed cache");
            await books.invalidateProcessedBook(name);
            cached = await books.getBook(name);
            check(!cached.processed && await cached.data.text() === "original bytes", "invalidate changed original File");
            await books.put({ name }, { stores: {
                [processedStore]: () => ({ name, file_content_chunks: ["chunk_1"] }),
            } });
            cached = await books.getBook(name);
            check(!cached.processed && await cached.data.text() === "original bytes", "missing derived chunk prevented original recovery");
            passed.push("language update preserves cache; invalid/missing derived cache recovers original File");
        } finally { await books.removeBook(name); books.dispose(); }

        // Worker error, timeout, send failure and disposal must all settle RPCs.
        const NativeWorker = window.Worker;
        const stubs = [];
        window.Worker = class {
            constructor() { stubs.push(this); }
            postMessage() { if (this.sendError) throw new Error("send failed"); }
            terminate() { this.terminated = true; }
        };
        try {
            for (const mode of ["error", "messageerror", "timeout", "dispose", "send"]) {
                const db = new DBManager({ ...config, dbName: `${config.dbName}-${mode}`, workerTimeoutMs: 30 });
                const stub = stubs.at(-1);
                if (mode === "send") stub.sendError = true;
                const outcome = db.get(["raw"], "missing").then(() => "resolved", () => "rejected");
                // Let initialization finish before injecting failures.
                await db.init();
                if (mode === "error") stub.onerror({ message: "crashed" });
                if (mode === "messageerror") stub.onmessageerror();
                if (mode === "dispose") db.dispose();
                check(await outcome === "rejected", `RPC ${mode} did not reject`);
                db.dispose();
                await new Promise((resolve) => { indexedDB.deleteDatabase(`${config.dbName}-${mode}`).onsuccess = resolve; });
            }
            passed.push("worker error/messageerror/timeout/dispose/send failure reject pending RPCs");
        } finally { window.Worker = NativeWorker; }

        // Font load success waits for FontFace.load and failures leave other fonts usable.
        const wasEnabled = fontpool.enabled;
        fontpool.enabled = true;
        const family = `StorageRegressionFont-${Date.now()}`;
        const bytes = await fetch("/client/fonts/LXGWWenKaiScreen_sub.woff2").then((r) => r.arrayBuffer());
        check(bytes.byteLength > 1000 && !new TextDecoder().decode(bytes.slice(0, 20)).includes("html"), "font fixture failed to load");
        {
            const fontData = { name: "regression.woff2", data: new Blob([bytes], { type: "font/woff2" }), en: family, zh: family };
            const originalDB = fontpool.db;
            fontpool.db = { getFont: async (name) => name === "bad" ? { ...fontData, en: family + "-bad", zh: family + "-bad", data: new Blob(["invalid font"]) } : fontData };
            try {
                const [ok, face] = await fontpool.loadFont("good");
                check(ok && face.status === "loaded" && document.fonts.has(face), "font returned before ready");
                const [bad] = await fontpool.loadFont("bad");
                check(bad === false && document.fonts.has(face), "broken font masked successful font or reported success");
                passed.push("real FontFace loads before URL release and registry notification");
            } finally { fontpool.db = originalDB; document.fonts.forEach((face) => { if (face.family === family) document.fonts.delete(face); }); delete CONFIG.VARS.CUSTOM_FONTS[family]; }
        }
        fontpool.enabled = wasEnabled;
        return passed;
    });
    for (const result of passed) console.log(`✓ ${result}`);
    assert.ok(passed.length >= 7);
    await page.close();

    // Build output must load DB workers below the deployment prefix too.
    for (const prefix of ["/", "/reader/"]) {
        const p = await browser.newPage();
        await p.addInitScript(() => {
            const NativeWorker = window.Worker;
            window.__storageWorkerURLs = [];
            window.Worker = class extends NativeWorker {
                constructor(url, options) { super(url, options); window.__storageWorkerURLs.push(String(url)); }
            };
        });
        // Isolate storage from unrelated UI/font bootstrapping. Exercise the
        // exact assets-directory URL that the Vite bundle supplies at runtime.
        await p.goto(productionURL + prefix + "version.json");
        const roundTrip = await p.evaluate(async ({ prefix }) => {
            const { createWorker } = await import(prefix + "client/src/utils/helpers/worker.js");
            const health = createWorker("client/src/modules/database/db-worker.js", new URL(prefix + "assets/index-test.js", location.href).href);
            try {
                const response = new Promise((resolve, reject) => { health.onmessage = ({ data }) => resolve(data); health.onerror = reject; });
                health.postMessage({ type: "checkSize", data: { id: 1, data: "health", threshold: 1 } });
                const result = await response;
                if (result.type !== "success" || result.result.size !== 6) throw new Error("assets caller Worker health failed");
            } finally { health.terminate(); }
            const { DBManager } = await import(prefix + "client/src/modules/database/db-manager.js");
            const db = new DBManager({ dbName: `subpath-${Date.now()}`, dbVersion: 1,
                objectStores: [{ name: "books", index: 0, options: { keyPath: "name" } }] });
            try {
                await db.put({ name: "book", content: "round trip" }, { stores: { books: (book) => book } });
                return (await db.get(["books"], "book")).content;
            } finally { db.dispose(); }
        }, { prefix });
        assert.equal(roundTrip, "round trip");
        const workerURLs = await p.evaluate(() => window.__storageWorkerURLs);
        assert.ok(workerURLs.length >= 2 && workerURLs.every((url) => new URL(url).pathname.startsWith(prefix + "client/")), `production workers lost prefix ${prefix}: ${workerURLs}`);
        console.log(`✓ production ${prefix} bundled Worker URLs and IDB round trip`);
        await p.close();
    }
});
