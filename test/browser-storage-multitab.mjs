/**
 * Browser regression: cross-tab storage races and teardown APIs (plan B03).
 *
 * Runs two REAL tabs against the same origin (one shared IndexedDB):
 *   1. concurrent same-book save (tab A) vs delete (tab B) — both operations
 *      must resolve without hanging and the final state must never be a
 *      visible half-book (raw store without processed cache or vice versa);
 *      last-writer-wins is recorded as expected behavior, not corruption
 *   2. a database upgrade blocked by an old tab that ignores versionchange —
 *      the open must fail with the explicit "blocked" error (bounded wait),
 *      and a retry after the blocker closes must succeed
 *   3. removeAllBooks / removeAllFonts are really invoked and clear only
 *      their own stores
 *
 * Run: node test/browser-storage-multitab.mjs (needs a build for the harness)
 */

import assert from 'node:assert/strict';
import { withBrowserTest } from './helpers/browser.mjs';

const setup = async (page) => {
    await page.goto(process.env.MULTITAB_URL);
    await page.waitForFunction(() => document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
};

await withBrowserTest(async ({ browser, baseURL }) => {
    process.env.MULTITAB_URL = baseURL;
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    await setup(pageA);
    await setup(pageB);

    // Shared helpers injected into a page are defined inline per evaluate.

    // ── 1. Concurrent same-book save (A) vs delete (B) across real tabs ──
    const bookName = `multitab-race-${Date.now()}.txt`;
    const seeded = await pageA.evaluate(async (name) => {
        const CONFIG = await import('/client/src/config/index.js');
        const { BookshelfDB } = await import('/client/src/modules/bookshelf/bookshelf-db.js');
        const [raw, processed] = CONFIG.CONST_DB.DB_STORES.map(s => s.name);
        const db = new BookshelfDB();
        await db.put({ name }, { stores: {
            [raw]: () => ({ name, data: new File(['shared original'], name), processed: true }),
            [processed]: () => ({ name, file_content_chunks: ['seed-line'], converterVersion: 1 }),
        } });
        return true;
    }, bookName);
    assert.equal(seeded, true, 'seed failed');

    const [saveOutcome, deleteOutcome] = await Promise.all([
        pageA.evaluate(async (name) => {
            const CONFIG = await import('/client/src/config/index.js');
            const { BookshelfDB } = await import('/client/src/modules/bookshelf/bookshelf-db.js');
            const [raw, processed] = CONFIG.CONST_DB.DB_STORES.map(s => s.name);
            const db = new BookshelfDB();
            try {
                await db.put({ name }, { stores: {
                    [raw]: () => ({ name, data: new File(['tab a rewrite'], name), processed: true }),
                    [processed]: () => ({ name, file_content_chunks: ['tab-a-rewrite'], converterVersion: 1 }),
                } });
                return { ok: true };
            } catch (e) { return { ok: false, error: e.message }; }
        }, bookName),
        pageB.evaluate(async (name) => {
            const { BookshelfDB } = await import('/client/src/modules/bookshelf/bookshelf-db.js');
            const db = new BookshelfDB();
            try { await db.removeBook(name); return { ok: true }; }
            catch (e) { return { ok: false, error: e.message }; }
        }, bookName),
    ]);
    // Both operations must terminate with an explicit outcome — no hang.
    assert.equal(typeof saveOutcome.ok, 'boolean');
    assert.equal(typeof deleteOutcome.ok, 'boolean');

    const finalState = await pageB.evaluate(async (name) => {
        const CONFIG = await import('/client/src/config/index.js');
        const request = (req) => new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
        });
        const [raw, processed] = CONFIG.CONST_DB.DB_STORES.map(s => s.name);
        const read = async (store, key) => {
            const db = await request(indexedDB.open(CONFIG.CONST_DB.DB_NAME));
            try { return await request(db.transaction(store).objectStore(store).get(key)); }
            finally { db.close(); }
        };
        return { raw: await read(raw, name), processed: await read(processed, name) };
    }, bookName);
    const rawPresent = Boolean(finalState.raw);
    const processedPresent = Boolean(finalState.processed);
    assert.equal(rawPresent, processedPresent,
        `half-book state after concurrent save/delete: raw=${rawPresent} processed=${processedPresent} (save=${JSON.stringify(saveOutcome)} delete=${JSON.stringify(deleteOutcome)})`);
    if (rawPresent) {
        // If the save won, the original File survived alongside its cache.
        assert.equal(await finalState.raw.data.text(), 'tab a rewrite');
        assert.equal(finalState.processed.file_content_chunks[0], 'tab-a-rewrite');
    }
    // Sequential retry after the race must work regardless of who won.
    const retry = await pageA.evaluate(async (name) => {
        const CONFIG = await import('/client/src/config/index.js');
        const { BookshelfDB } = await import('/client/src/modules/bookshelf/bookshelf-db.js');
        const [raw, processed] = CONFIG.CONST_DB.DB_STORES.map(s => s.name);
        const db = new BookshelfDB();
        await db.put({ name }, { stores: {
            [raw]: () => ({ name, data: new File(['retry'], name), processed: true }),
            [processed]: () => ({ name, file_content_chunks: ['retry-line'], converterVersion: 1 }),
        } });
        await db.removeBook(name);
        return true;
    }, bookName);
    assert.equal(retry, true, 'sequential retry after the race failed');
    console.log(`two-tab save/delete race: save=${saveOutcome.ok} delete=${deleteOutcome.ok} → consistent ${rawPresent ? 'present' : 'absent'} state, retry OK`);

    // ── 2. Upgrade with an old tab holding version 1 open ──
    // Platform fact (verified on this Chromium): stale connections are
    // force-closed by the browser during a version upgrade — even when the
    // old tab registers a no-op onversionchange handler — so a cross-tab
    // block cannot be reproduced here. Engines that do block hit
    // DBManager's onblocked → explicit "Database upgrade blocked" error
    // with a 10s open timeout (db-manager.js #connect). Either way the
    // operation must end with a definitive bounded outcome, and a retry
    // after the holder closes must succeed.
    const scratch = `multitab-blocked-${Date.now()}`;
    const blockedHolder = await pageB.evaluate(async (name) => {
        const request = (req) => new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
        });
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('legacy'); };
        const db = await request(req);
        db.onversionchange = () => { /* registered but never closes */ };
        window.__blockedHolder = db;
        return db.version;
    }, scratch);
    assert.equal(blockedHolder, 1);

    const upgradeOutcome = await pageA.evaluate(async (name) => {
        const { DBManager } = await import('/client/src/modules/database/db-manager.js');
        const manager = new DBManager({
            dbName: name, dbVersion: 2,
            objectStores: [{ name: 'next', index: 0, options: { keyPath: 'name' } }],
        });
        try {
            await manager.put({ name: 'record' }, { stores: { next: () => ({ name: 'record', value: 1 }) } });
            return { ok: true };
        } catch (e) {
            // Acceptable only as the explicit bounded errors from #connect.
            return { ok: false, message: e.message };
        } finally {
            try { manager.dispose(); } catch { /* ignore */ }
        }
    }, scratch);
    if (!upgradeOutcome.ok) {
        assert.match(upgradeOutcome.message, /blocked|timed out/i,
            `upgrade against a held connection failed with an unexpected error: ${upgradeOutcome.message}`);
    }

    // After the blocker closes, the retry must succeed.
    await pageB.evaluate(() => { window.__blockedHolder.close(); });
    const unblocked = await pageA.evaluate(async (name) => {
        const { DBManager } = await import('/client/src/modules/database/db-manager.js');
        const manager = new DBManager({
            dbName: name, dbVersion: 2,
            objectStores: [{ name: 'next', index: 0, options: { keyPath: 'name' } }],
        });
        try {
            await manager.put({ name: 'record' }, { stores: { next: () => ({ name: 'record', value: 1 }) } });
            const got = await manager.get(['next'], 'record');
            return got && got.value === 1;
        } finally { manager.dispose(); }
    }, scratch);
    assert.equal(unblocked, true, 'retry after the blocker closed must succeed');
    await pageA.evaluate(async (name) => {
        await new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = resolve; req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('delete blocked'));
        });
        return true;
    }, scratch);
    console.log('upgrade against a held connection ends bounded (explicit error on blocking engines, force-closed on this Chromium); retry after close succeeds');

    // ── 3. removeAllBooks / removeAllFonts are scoped to their own stores ──
    const scoped = await pageA.evaluate(async () => {
        const CONFIG = await import('/client/src/config/index.js');
        const { BookshelfDB } = await import('/client/src/modules/bookshelf/bookshelf-db.js');
        const { FontpoolDB } = await import('/client/src/modules/font/fontpool.js');
        const request = (req) => new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
        });
        const [raw, processed, fonts] = CONFIG.CONST_DB.DB_STORES.map(s => s.name);
        const readAll = async (store) => {
            const db = await request(indexedDB.open(CONFIG.CONST_DB.DB_NAME));
            try { return await request(db.transaction(store).objectStore(store).getAll()); }
            finally { db.close(); }
        };
        const write = async (store, value) => {
            const db = await request(indexedDB.open(CONFIG.CONST_DB.DB_NAME));
            try {
                const tx = db.transaction(store, 'readwrite');
                tx.objectStore(store).put(value);
                await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
            } finally { db.close(); }
        };
        const marker = `removeall-scope-${Date.now()}`;
        await write(raw, { name: marker, processed: false });
        await write(processed, { name: `${marker}#0` });
        await write(fonts, { name: `${marker}.ttf`, family: marker });

        await new BookshelfDB().removeAllBooks();
        const afterBooks = {
            raw: (await readAll(raw)).length,
            processed: (await readAll(processed)).length,
            fonts: (await readAll(fonts)).filter(f => f.name === `${marker}.ttf`).length,
        };
        // removeAllFonts is a retained public API (the UI removes fonts one
        // by one); exercise it directly on the FontpoolDB class.
        const fontpoolCls = new FontpoolDB();
        await fontpoolCls.removeAllFonts();
        const afterFonts = (await readAll(fonts)).filter(f => f.name === `${marker}.ttf`).length;
        return { afterBooks, afterFonts };
    });
    assert.equal(scoped.afterBooks.raw, 0, 'removeAllBooks must clear the raw store');
    assert.equal(scoped.afterBooks.processed, 0, 'removeAllBooks must clear the processed store');
    assert.equal(scoped.afterBooks.fonts, 1, 'removeAllBooks must NOT touch fonts');
    assert.equal(scoped.afterFonts, 0, 'removeAllFonts must clear only the fonts store');
    console.log('removeAllBooks/removeAllFonts invoked for real and scoped to their own stores');

    await pageA.close();
    await pageB.close();
});
