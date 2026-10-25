import assert from 'node:assert/strict';
import { withBrowserTest } from './helpers/browser.mjs';
await withBrowserTest(async ({browser, productionURL}) => {
    for (const prefix of ['/', '/reader/']) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(productionURL + prefix);
        await page.waitForFunction(() => document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'), null, {timeout:15000});
        assert.deepEqual(errors, [], `startup errors at ${prefix}`);
        for (const path of ['version.json','client/lib/opencc/full.js','client/src/modules/file/file-processor-worker.js']) {
            const response = await page.request.get(productionURL + prefix + path);
            assert.equal(response.status(),200,`${prefix}${path}`);
            assert.ok(!response.headers()['content-type']?.includes('text/html'));
        }
        await context.close();
    }
    console.log('Production startup and runtime assets at root/subpath passed');
});
