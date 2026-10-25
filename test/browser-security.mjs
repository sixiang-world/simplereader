import assert from 'node:assert/strict';
import { withBrowserTest } from './helpers/browser.mjs';
await withBrowserTest(async ({browser,baseURL})=>{
    const page=await browser.newPage();await page.goto(baseURL);
    await page.waitForFunction(()=>document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
    const result=await page.evaluate(async()=>{
        const C=await import('/client/src/config/index.js');const {reader}=await import('/client/src/modules/reader/reader.js');
        const {PopupManager}=await import('/client/src/components/popup-manager.js');
        const {TextProcessorDOM}=await import('/client/src/modules/text/text-processor-dom.js');
        const text='<img src=x onerror="window.__securityMarker=1">';
        C.VARS.ALL_TITLES=[[text,0,text,false]];C.VARS.ALL_TITLES_IND={0:0};reader.processTOC();
        PopupManager.showNotification({iconName:'BOOK',text,timer:5});
        const [node]=TextProcessorDOM.createFromStructure({type:'paragraph',source:'epub',lineNumber:0,content:'<span style="constructor:abc">hello</span>'});
        await new Promise(resolve=>setTimeout(resolve,100));
        return {executed:window.__securityMarker||0,title:document.querySelector('#span0')?.textContent,unexpectedImages:document.querySelectorAll('#toc-list img[onerror],.custom-notification img[onerror]').length,body:node.textContent};
    });
    assert.equal(result.executed,0);assert.equal(result.title,'<img src=x onerror="window.__securityMarker=1">');assert.equal(result.unexpectedImages,0);assert.equal(result.body,'hello');
    await page.close();console.log('Untrusted TOC/notification text and inherited CSS property browser regressions passed');
});
