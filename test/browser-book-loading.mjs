import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { withBrowserTest } from './helpers/browser.mjs';
const zip=new JSZip();
zip.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
zip.file('OPS/book.opf','<package><metadata><title>Book integrity</title><language>en</language></metadata><manifest><item id="a" href="Text/chapter%201.xhtml" media-type="application/xhtml+xml"/><item id="b" href="Text/chapter2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>');
zip.file('OPS/Text/chapter 1.xhtml','<html xmlns:epub="http://www.idpf.org/2007/ops"><body><p>First paragraph</p><h2 id="first">First chapter</h2><p><a href="chapter2.xhtml#second">Next chapter</a><a epub:type="noteref" href="#note">Note</a></p><aside epub:type="footnote" id="note"><p>Footnote body</p></aside></body></html>');
zip.file('OPS/Text/chapter2.xhtml','<html><body><h2 id="second">Second chapter</h2><p>Last paragraph</p></body></html>');
const bytes=[...await zip.generateAsync({type:'uint8array'})];
await withBrowserTest(async({browser,baseURL})=>{
 const page=await browser.newPage();await page.goto(baseURL);await page.waitForFunction(()=>document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
 const result=await page.evaluate(async bytes=>{
  const C=await import('/client/src/config/index.js');const {FileHandler}=await import('/client/src/modules/file/file-handler.js');const {cbReg}=await import('/shared/core/callback/callback-registry.js');
  let saved;const token=cbReg.add('saveProcessedBook',data=>{saved=structuredClone(data);return data;},{priority:10000});
  try{
   await FileHandler.handleEpubFile(new File([Uint8Array.from(bytes)],'integrity.epub',{type:'application/epub+zip'}));
   const key='OPS/Text/chapter2.xhtml#second';const line=C.VARS.FRAGMENT_TO_LINE[key];
   const initial={mapped:line,actual:C.VARS.FILE_CONTENT_CHUNKS.findIndex(l=>l.content.includes('Second chapter')),notes:Object.keys(C.VARS.FOOTNOTE_MAP),ranges:C.VARS.SPINE_RANGES.length,version:saved.epubConverterVersion};
   C.VARS.FOOTNOTE_MAP={wrong:'wrong'};C.VARS.FRAGMENT_TO_LINE={wrong:99};
   await FileHandler.handleProcessedBook(saved);
   const restored={notes:Object.keys(C.VARS.FOOTNOTE_MAP),mapped:C.VARS.FRAGMENT_TO_LINE[key],ranges:C.VARS.SPINE_RANGES.length};
   const a=FileHandler.handleEpubFile(new File([Uint8Array.from(bytes)],'cancelled.epub'));
   const b=FileHandler.handleEpubFile(new File([Uint8Array.from(bytes)],'latest.epub'));
   const outcomes=await Promise.allSettled([a,b]);
   return {initial,restored,cancelled:outcomes[0].status,last:outcomes[1].status,current:C.VARS.FILENAME,rendered:document.querySelector('#content')?.textContent};
  }finally{cbReg.rm(token);}
 },bytes);
 assert.equal(result.initial.mapped,result.initial.actual);assert.equal(result.initial.ranges,2);assert.ok(result.initial.notes.includes('OPS/Text/chapter 1.xhtml#note'));assert.equal(result.initial.version,4);
 assert.equal(result.restored.mapped,result.initial.mapped);assert.deepEqual(result.restored.notes,result.initial.notes);assert.equal(result.restored.ranges,2);
 assert.equal(result.cancelled,'rejected');assert.equal(result.last,'fulfilled');assert.equal(result.current,'latest.epub');
 await page.close();console.log('EPUB transform/index save/restore, cache switch and cancelled-load isolation passed');
});
