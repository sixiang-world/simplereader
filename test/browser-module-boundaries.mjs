import assert from 'node:assert/strict';
import {withBrowserTest} from './helpers/browser.mjs';
await withBrowserTest(async({browser,baseURL})=>{
 const page=await browser.newPage();await page.goto(baseURL);await page.waitForFunction(()=>document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
 const result=await page.evaluate(async()=>{
  const {settings}=await import('/client/src/modules/settings/settings.js');const {SettingsMenu}=await import('/client/src/modules/settings/settings-menu.js');
  const facade=await import('/client/src/modules/bookshelf/bookshelf.js');const data=await import('/client/src/modules/bookshelf/bookshelf-db.js');
  const {reader}=await import('/client/src/modules/reader/reader.js');const {TextProcessorDOM}=await import('/client/src/modules/text/text-processor-dom.js');const C=await import('/client/src/config/index.js');
  const original=reader.gotoChapterTitleLine;let navigated;
  reader.gotoChapterTitleLine=async line=>{navigated=line;};
  try{const [heading]=TextProcessorDOM.createFromStructure({type:'heading',content:'Heading',source:'epub',lineNumber:7});C.DOM_ELEMENT.CONTENT_CONTAINER.replaceChildren(heading);heading.querySelector('a').click();await Promise.resolve();}
  finally{reader.gotoChapterTitleLine=original;}
  return {menu:settings.settingsMenu instanceof SettingsMenu,db:facade.BookshelfDB===data.BookshelfDB,navigated};
 });
 assert.deepEqual(result,{menu:true,db:true,navigated:7});await page.close();console.log('Public settings/bookshelf facades and delegated heading navigation remain compatible');
});
