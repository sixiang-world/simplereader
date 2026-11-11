import assert from 'node:assert/strict';
import { withBrowserTest } from './helpers/browser.mjs';
await withBrowserTest(async ({browser,baseURL})=>{
 const page=await browser.newPage(); await page.goto(baseURL);
 await page.waitForFunction(()=>document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
 const result=await page.evaluate(async()=>{
  const {bookshelf}=await import('/client/src/modules/bookshelf/bookshelf.js');
  const {FileHandler}=await import('/client/src/modules/file/file-handler.js');
  const C=await import('/client/src/config/index.js');
  const {settings}=await import('/client/src/modules/settings/settings.js');
  const {setHistory,getHistory,removeHistory}=await import('/client/src/utils/helpers/reader.js');
  settings.values.t2s_enabled=false;settings.applySettings();
  const body=label=>Array.from({length:30},(_,i)=>`${label} paragraph ${i}`).join('\n');
  await bookshelf.db.putBook('duplicate.txt',new File([body('legacy')],'duplicate.txt',{type:'text/plain'}));
  localStorage.setItem('duplicate.txt','3'); localStorage.setItem('p_fontSize','2em');
  if(!await bookshelf.openBook('duplicate.txt')) throw new Error('legacy reprocess failed');
  const legacyId=C.VARS.BOOK_ID;
  const legacyHistory=await getHistory(legacyId);
  const ids=[];
  for(const label of ['first','second']){
   await FileHandler.handleSelectedFile([new File([body(label)],'duplicate.txt',{type:'text/plain'})]);
   ids.push(C.VARS.BOOK_ID);
  }
  const rows=(await bookshelf.db.getBookList()).filter(r=>r.displayName==='duplicate.txt');
  const originals=await Promise.all(rows.map(async row=>({id:row.name,text:await (await bookshelf.db.getBook(row.name)).data.text()})));
  setHistory(ids[0],5);setHistory(ids[1],9);
  const positions=[await getHistory(ids[0]),await getHistory(ids[1])];
  removeHistory(legacyId);
  const cleared=await getHistory(legacyId);
  const oldUnchanged=localStorage.getItem('duplicate.txt');
  if(!await bookshelf.openBook(ids[0])) throw new Error('new cache reopen failed');
  const reopened={id:C.VARS.BOOK_ID,name:C.VARS.FILENAME,text:C.VARS.FILE_CONTENT_CHUNKS.map(l=>typeof l==='string'?l:l.content).join(' ')};
  return {legacyId,legacyHistory,ids,originals,positions,cleared,oldUnchanged,reopened,setting:localStorage.getItem('p_fontSize')};
 });
 assert.equal(result.legacyId,'duplicate.txt');assert.equal(result.legacyHistory,3);
 assert.equal(new Set(result.ids).size,2);assert.ok(result.ids.every(id=>id.startsWith('book:')));
 assert.equal(result.originals.length,3);
 for(const marker of ['legacy','first','second']) assert.ok(result.originals.some(row=>row.text.startsWith(marker+' paragraph')));
 assert.deepEqual(result.positions,[5,9]);assert.equal(result.cleared,0);assert.equal(result.oldUnchanged,'3');assert.equal(result.setting,'2em');
 assert.equal(result.reopened.id,result.ids[0]);assert.equal(result.reopened.name,'duplicate.txt');assert.match(result.reopened.text,/first paragraph/);
 await page.close();console.log('Legacy original/cache recovery, same-name isolation and independent progress passed');
});
