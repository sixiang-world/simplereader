import assert from 'node:assert/strict';
import { withBrowserTest } from './helpers/browser.mjs';
await withBrowserTest(async ({browser,baseURL})=>{
    const page=await browser.newPage();await page.goto(baseURL);
    await page.waitForFunction(()=>document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
    const result=await page.evaluate(async()=>{
        const C=await import('/client/src/config/index.js');const {reader}=await import('/client/src/modules/reader/reader.js');
        const {PopupManager}=await import('/client/src/components/popup-manager.js');
        const {TextProcessorDOM}=await import('/client/src/modules/text/text-processor-dom.js');
        const {getFootnotes}=await import('/client/src/modules/reader/footnotes.js');
        const {pairAnchorsAndFootnotes}=await import('/client/src/utils/base/dom.js');
        const text='<img src=x onerror="window.__securityMarker=1">';
        C.VARS.ALL_TITLES=[[text,0,text,false]];C.VARS.ALL_TITLES_IND={0:0};reader.processTOC();
        PopupManager.showNotification({iconName:'BOOK',text,timer:5});
        const [node]=TextProcessorDOM.createFromStructure({type:'paragraph',source:'epub',lineNumber:0,content:'<span style="constructor:abc">hello</span>'});
        await new Promise(resolve=>setTimeout(resolve,100));
        // TXT footnote popup: the lookup returns raw file text (exactly what
        // pairAnchorsAndFootnotes stores from a TXT footnote line). The popup
        // renders its content as HTML, so raw markup here must not execute.
        const malicious='note<img src=x onerror="window.__fnExec=1">';
        const markerCode='9312'; // ①
        const timeline=[
            {type:C.CONST_FOOTNOTE.TYPES.ANCHOR,marker:'①',markerCode,lineNumber:1,index:0},
            {type:C.CONST_FOOTNOTE.TYPES.FOOTNOTE,marker:'①',markerCode,content:malicious},
        ];
        const paired=pairAnchorsAndFootnotes(timeline);
        getFootnotes().setFootnoteLookup((code,index)=>paired[code]?.[Number(index)]||C.CONST_FOOTNOTE.NOTFOUND);
        const anchor=document.createElement('a');
        anchor.rel='footnote';anchor.href='#fn-9312-0';
        anchor.dataset.markerCode=markerCode;anchor.dataset.index='0';
        document.body.appendChild(anchor);
        getFootnotes().setup();
        anchor.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,150));
        const popup=document.getElementById('footnotediv');
        const footnoteExec=window.__fnExec||0;
        const popupHasImg=popup?popup.querySelectorAll('img[onerror],img[src="x"]').length:0;
        const popupText=popup?popup.textContent:'';
        anchor.remove();popup?.remove();
        return {executed:window.__securityMarker||0,title:document.querySelector('#span0')?.textContent,unexpectedImages:document.querySelectorAll('#toc-list img[onerror],.custom-notification img[onerror]').length,body:node.textContent,footnoteExec,popupHasImg,popupText};
    });
    assert.equal(result.executed,0);assert.equal(result.title,'<img src=x onerror="window.__securityMarker=1">');assert.equal(result.unexpectedImages,0);assert.equal(result.body,'hello');
    assert.equal(result.footnoteExec,0,'TXT footnote markup must not execute in the popup');
    assert.equal(result.popupHasImg,0,'popup must not contain injected img elements');
    assert.ok(result.popupText.includes('note<img src=x'),'popup must show the malicious footnote as visible text');
    await page.close();console.log('Untrusted TOC/notification text and inherited CSS property browser regressions passed');
});
