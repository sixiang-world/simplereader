/** Deterministic complexity/retention checks; timings are observations, not hardware-independent budgets. */
import assert from 'node:assert/strict';
import {withBrowserTest} from './helpers/browser.mjs';
await withBrowserTest(async({browser,baseURL})=>{
 const page=await browser.newPage();await page.goto(baseURL);await page.waitForFunction(()=>document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
 const measurements=await page.evaluate(async()=>{
  const C=await import('/client/src/config/index.js');const {flowReader}=await import('/client/src/modules/reader/flow-reader.js');const {BookshelfDB,bookshelf}=await import('/client/src/modules/bookshelf/bookshelf.js');
  const content=C.DOM_ELEMENT.CONTENT_CONTAINER;content.style.display='block';content.style.height='600px';
  const fragment=document.createDocumentFragment();for(let i=0;i<10000;i++){const el=document.createElement('p');el.id='line'+i;el.dataset.lineNum=String(i);el.textContent='Line '+i;fragment.appendChild(el);}content.replaceChildren(fragment);
  let geometry=0;const original=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){geometry++;return original.call(this);};
  let start=performance.now();try{flowReader.getCurrentLineNumber();}finally{Element.prototype.getBoundingClientRect=original;}
  const flowMs=performance.now()-start;
  start=performance.now();flowReader.getCurrentLineNumber();const warmMs=performance.now()-start;
  bookshelf.disable();
  const books=new BookshelfDB();await books.init();
  const db=await new Promise((res,rej)=>{const r=indexedDB.open(C.CONST_DB.DB_NAME);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const store=C.CONST_DB.DB_STORES[0].name;const blob=new File(['x'.repeat(1024)],'fixture.txt');const times=[];
  try{
   for(const count of [500,2000]){
    await new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');const s=tx.objectStore(store);s.clear();for(let i=0;i<count;i++)s.put({name:`perf-${i}.txt`,data:blob,isEastern:false});tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});
    start=performance.now();const rows=await books.getBookList();const elapsed=performance.now()-start;
    if(rows.length!==count||rows.some(row=>'data' in row||row.size!==1024))throw new Error('Metadata projection retained body or lost records');
    times.push({books:count,readMs:Number(elapsed.toFixed(2)),retainedBlobFields:0});
   }
  }finally{await new Promise(res=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=res;});db.close();books.dispose();}
  return {flow:{renderedLines:10000,geometryReads:geometry,coldLayoutAndLookupMs:Number(flowMs.toFixed(2)),warmLookupMs:Number(warmMs.toFixed(2))},metadata:times};
 });
 assert.ok(measurements.flow.geometryReads<=20,'flow must use logarithmic geometry reads');assert.equal(measurements.metadata.length,2);
 console.log('Performance observations (same machine; no fixed FPS/heap claim): '+JSON.stringify(measurements));await page.close();
});
