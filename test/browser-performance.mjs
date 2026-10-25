/** Deterministic complexity/retention checks; timings are observations, not hardware-independent budgets. */
import assert from 'node:assert/strict';
import JSZip from 'jszip';
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

// ── C01 baseline: staged TXT processing + EPUB conversion shapes ────────
// Runs the SAME shared cores Node-side (the browser phase above covers
// DOM/IDB costs). Deterministic generated samples; timings are same-machine
// observations for before/after comparison, never thresholds. Only
// algorithmic properties are asserted. Override iteration count with
// PERF_BASELINE_RUNS (default 5, per the C01 acceptance).
{
 const RUNS=Math.max(1,Number(process.env.PERF_BASELINE_RUNS||5));
 const {FileProcessorCore}=await import('../shared/core/file/file-processor-core.js');
 const {PaginationCalculator}=await import('../shared/core/text/pagination-calculator.js');
 // EpubConverter consumes JSZip/DOMParser/Node as classic-script globals in
 // the browser; mirror that contract for the Node-side conversion timing
 // (same setup as test-epub-integrity.mjs).
 const {DOMParser,Node}=await import('linkedom');
 globalThis.JSZip=JSZip;globalThis.DOMParser=DOMParser;globalThis.Node=Node;
 const {EpubConverter}=await import('../client/src/modules/epub/epub-converter.js');
 const {CONST_PAGINATION}=await import('../client/src/config/constants.js');
 const config={CONST_PAGINATION,VARS:{IS_EASTERN_LAN:true,BOOK_AND_AUTHOR:{bookName:'性能基线',author:''}},RUNTIME_VARS:{STYLE:{}}};
 // Deterministic TXT: chapter headings every 40 lines, 180-char long lines,
 // circled footnote markers paired with footnote lines, whitespace lines.
 const makeTxt=(lineCount)=>{const parts=[];for(let i=0;i<lineCount;i++){
  if(i%40===0)parts.push(`第${i/40+1}章 章节标题${i}`);
  else if(i%37===0)parts.push('长'.repeat(180)+`行尾${i}`);
  else if(i%15===0)parts.push(`正文内容${i}，带脚注标记①`);
  else if(i%15===1)parts.push(`① 这是第${i}行的脚注内容。`);
  else if(i%9===0)parts.push('   ');
  else parts.push(`普通的正文行内容编号${i}，包含一些连续文本。`);
 }return parts.join('\n');};
 const median=(xs)=>{const s=[...xs].sort((a,b)=>a-b);return Number(s[Math.floor(s.length/2)].toFixed(1));};
 const runTxt=async(lineCount,runs)=>{
  const blob=new File([makeTxt(lineCount)],'perf.txt');
  const samples=[];let htmlLines=-1,titles=-1,pages=-1;
  for(let r=0;r<runs;r++){
   const t0=performance.now();
   const processor=new FileProcessorCore(blob.size,null,null);
   await processor.detectEncodingAndLanguage(blob);
   const t1=performance.now();
   const titlePageLines=FileProcessorCore.generateTitlePage({bookName:'性能基线',author:''},{});
   const endPageLines=[FileProcessorCore.generateEndPage(0)];
   const result=await FileProcessorCore.processChunkStatic(blob,{
    extraContent:{titlePageLines,titlePageTitles:titlePageLines.map((_,i)=>['',i]),endPageLines,endPageTitles:[['(end)',0,'(end)',false]]},
    title_page_line_number_offset:3,pageBreakOnTitle:true,CONFIG:config,
    encoding:processor.encoding,isInitialChunk:false,forcePatternDetection:true,
    patternDetectionOptions:{fileSize:blob.size,initialChunkSize:1024*1024},logMode:false,
   });
   const t2=performance.now();
   const breaks=new PaginationCalculator(result.htmlLines,result.titles,CONST_PAGINATION).calculate();
   const t3=performance.now();
   if(htmlLines===-1){htmlLines=result.htmlLines.length;titles=result.titles.length;pages=breaks.length;}
   else if(result.htmlLines.length!==htmlLines||result.titles.length!==titles)throw new Error('non-deterministic TXT processing');
   samples.push({decode:t1-t0,process:t2-t1,paginate:t3-t2});
  }
  return {lines:lineCount,htmlLines,titles,pages,
   coldMs:Number((samples[0].decode+samples[0].process+samples[0].paginate).toFixed(1)),
   hotMedianMs:{decode:median(samples.map(s=>s.decode)),process:median(samples.map(s=>s.process)),paginate:median(samples.map(s=>s.paginate))}};
 };
 const txt10k=await runTxt(10000,RUNS);
 // 50k keeps only a cold+hot pair: the 5x-input stage scales superlinearly
 // in this environment (a C03 finding — recorded in PERFORMANCE_BASELINE),
 // so five full runs would dominate every validate invocation.
 const txt50k=await runTxt(50000,2);

 // EPUB shapes: multi-short-chapter, single-long-chapter, illustrated
 // (one shared image — exercises the cross-spine dedup cache).
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
 const mkEpub=async(chapterParas,withImage)=>{
  const zip=new JSZip();
  zip.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>');
  const manifest=chapterParas.map((_,i)=>`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')+(withImage?'<item id="img" href="img.png" media-type="image/png"/>':'');
  zip.file('OPS/content.opf',`<package><metadata><title>Perf</title></metadata><manifest>${manifest}</manifest><spine>${chapterParas.map((_,i)=>`<itemref idref="c${i}"/>`).join('')}</spine></package>`);
  chapterParas.forEach((count,i)=>zip.file(`OPS/c${i}.xhtml`,`<html><body>${Array.from({length:count},(_,j)=>`<p>Chapter ${i} paragraph ${j} with some running text.</p>${withImage&&j%4===1?'<img src="img.png"/>':''}`).join('')}</body></html>`));
  if(withImage)zip.file('OPS/img.png',png);
  return new File([await zip.generateAsync({type:'uint8array'})],'perf.epub');
 };
 const runEpub=async(file,runs)=>{
  const samples=[];let htmlLines=-1,images=-1;
  for(let r=0;r<runs;r++){
   const t0=performance.now();
   const result=await EpubConverter.convert(file);
   samples.push(performance.now()-t0);
   const imgCount=result.htmlLines.filter(l=>l.type==='image'||l.elementType==='img').length;
   if(htmlLines===-1){htmlLines=result.htmlLines.length;images=imgCount;}
   else if(htmlLines!==result.htmlLines.length||images!==imgCount)throw new Error('non-deterministic EPUB conversion');
  }
  return {coldMs:Number(samples[0].toFixed(1)),medianMs:median(samples),htmlLines,imageLines:images};
 };
 const epub={multiShort:await runEpub(await mkEpub(Array.from({length:120},()=>8),false),2),
  singleLong:await runEpub(await mkEpub([3000],false),3),
  illustrated:await runEpub(await mkEpub(Array.from({length:40},()=>9),true),3)};

 assert.ok(txt10k.htmlLines>0&&txt50k.htmlLines>txt10k.htmlLines,'TXT processing must produce scaled output');
 assert.ok(txt10k.titles>=250&&txt50k.titles>=1250,'chapter detection must find the generated headings');
 assert.ok(epub.singleLong.htmlLines>2900&&epub.illustrated.imageLines===80,'EPUB shapes converted with expected structure');
 console.log('C01 staged baseline (Node '+process.version+'; observations not thresholds): '+JSON.stringify({runs:RUNS,txt10k,txt50k,epub}));
}
