/**
 * Browser regression: color picker lifecycle (plan task B02).
 *
 * Verifies on the real app page (Vite dev server serves the patched
 * client/lib/yaireo/color-picker.js and the rewritten wrapper):
 *   1. the patched upstream destroy() really detaches the per-instance
 *      document.body click and window keydown listeners — a click/Escape
 *      after destroy must not reach onClickOutside (pre-patch it did,
 *      leaking one listener set per settings-menu rebuild)
 *   2. wrapper initialization is idempotent across wrapper instances
 *      (live inputs keep their existing picker instance)
 *   3. wrapper destroy() releases only what it owns: scratch inputs lose
 *      _colorPicker, scopes leave the DOM, app-owned pickers stay intact
 *   4. 20 create/destroy cycles return to baseline with no leftovers
 *
 * Run: node test/browser-color-picker-lifecycle.mjs (needs build for the
 * production server helper; the assertions themselves run on baseURL).
 */

import assert from 'node:assert/strict';
import { withBrowserTest } from './helpers/browser.mjs';

await withBrowserTest(async ({ browser, baseURL }) => {
    const page = await browser.newPage();
    await page.goto(baseURL);
    await page.waitForFunction(() => document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));

    const result = await page.evaluate(async () => {
        const out = {};

        // ── 1. Patched upstream lib: destroy() detaches document/window listeners ──
        const CP = window.ColorPicker.default;
        let outsideCalls = 0;
        const inst = new CP({
            color: '#ff0000',
            onClickOutside: () => { outsideCalls++; },
        });
        document.body.appendChild(inst.DOM.scope);
        document.body.click();
        const beforeDestroy = outsideCalls;
        inst.destroy();
        document.body.click();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        out.libDetaches = beforeDestroy >= 1 && outsideCalls === beforeDestroy;
        out.libScopeRemoved = !document.body.contains(inst.DOM.scope);
        out.libDestroyIdempotent = (inst.destroy(), true);

        // ── 2. Wrapper idempotency across instances ──
        const { getColorPicker } = await import('/client/src/components/custom-color-picker.js');
        const appInputs = [...document.querySelectorAll('.myColor')];
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline && appInputs.some((el) => !el._colorPicker)) {
            await new Promise((r) => setTimeout(r, 100));
        }
        const appPickersBefore = appInputs.map((el) => el._colorPicker);
        out.appInputCount = appInputs.length;
        out.appPickersAttached = appPickersBefore.every(Boolean);

        const noop = () => {};
        const w1 = getColorPicker({ callbackOnInput: noop, callbackOnChange: noop });
        out.idempotentAcrossWrappers = appInputs.every((el, i) => el._colorPicker === appPickersBefore[i]);

        // ── 3. destroy() releases only what the wrapper owns ──
        const scratch = document.createElement('input');
        scratch.className = 'myColor';
        scratch.value = '#00ff00';
        scratch.dataset.swatches = 'false';
        document.body.appendChild(scratch);
        const w2 = getColorPicker({ callbackOnInput: noop, callbackOnChange: noop });
        out.scratchAttached = Boolean(scratch._colorPicker);
        // A third wrapper sees the same live input and must not double-attach.
        const w3 = getColorPicker({ callbackOnInput: noop, callbackOnChange: noop });
        const scratchPicker = scratch._colorPicker;
        w2.destroy();
        out.scratchReleased = scratch._colorPicker === undefined;
        out.scratchScopeGone = !document.body.contains(scratchPicker?.DOM?.scope);
        document.body.click(); // must not resurrect anything
        out.noResurrectAfterDestroy = scratch._colorPicker === undefined;
        w3.destroy(); // empty ownership — must be safe and harmless
        w1.destroy(); // owns nothing (app inputs belong to the app's wrapper)
        out.appPickersIntact = appInputs.every((el, i) => el._colorPicker === appPickersBefore[i]);
        scratch.remove();

        // ── 4. 20 real create/destroy cycles return to baseline ──
        out.cyclesClean = true;
        for (let i = 0; i < 20; i++) {
            const input = document.createElement('input');
            input.className = 'myColor';
            input.value = '#0000ff';
            input.dataset.swatches = 'false';
            document.body.appendChild(input);
            const w = getColorPicker({ callbackOnInput: noop, callbackOnChange: noop });
            const picker = input._colorPicker;
            document.body.click(); // exercise the click path while live
            w.destroy();
            input.remove();
            if (input._colorPicker !== undefined || !picker || document.body.contains(picker.DOM.scope)) {
                out.cyclesClean = false;
                out.failedCycle = i;
                return out;
            }
        }
        return out;
    });

    assert.equal(result.libDetaches, true,
        'patched lib destroy() must detach body-click/keydown listeners (onClickOutside calls frozen)');
    assert.equal(result.libScopeRemoved, true, 'lib destroy() must remove the scope element');
    assert.equal(result.libDestroyIdempotent, true, 'double destroy() must be a no-op');
    assert.ok(result.appInputCount >= 1, 'settings color inputs should exist on the page');
    assert.equal(result.appPickersAttached, true, 'app did not attach pickers to its inputs in time');
    assert.equal(result.idempotentAcrossWrappers, true,
        'a second wrapper must reuse live instances instead of double-attaching');
    assert.equal(result.scratchAttached, true);
    assert.equal(result.scratchReleased, true, 'destroy() must clear _colorPicker');
    assert.equal(result.scratchScopeGone, true, 'destroy() must remove the popup scope from the DOM');
    assert.equal(result.noResurrectAfterDestroy, true, 'post-destroy clicks must not resurrect the picker');
    assert.equal(result.appPickersIntact, true,
        'destroying one wrapper must not release instances owned by other wrappers');
    assert.equal(result.cyclesClean, true, `create/destroy cycles must not leak (failed at cycle ${result.failedCycle})`);

    await page.close();
    console.log('Color picker lifecycle: idempotent init, ownership-scoped destroy, real listener detach — verified');
});
