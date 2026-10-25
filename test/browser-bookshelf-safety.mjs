import assert from 'node:assert/strict';
import {withBrowserTest} from './helpers/browser.mjs';
await withBrowserTest(async({browser,baseURL})=>{
 const page=await browser.newPage();await page.goto(baseURL);await page.waitForFunction(()=>document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
 const result=await page.evaluate(async()=>{
  const {bookshelf}=await import('/client/src/modules/bookshelf/bookshelf.js');
  const name='<img src=x onerror=window.__bookXss=77>.txt';
  const book=bookshelf.genBookItem({name,size:1,isEastern:false,isFromLocal:true},997);
  document.querySelector('.bookshelf .booklist').appendChild(book[0]);
  book.find('.dot-menu__checkbox').prop('checked',true);book[0].querySelector('.bookinfo-menu-btn').click();
  await new Promise(r=>setTimeout(r,100));
  return {executed:window.__bookXss||0,images:book[0].querySelectorAll('img[onerror]').length,name:book.attr('data-filename'),shown:book.find('.cover-hidden-text').first().text(),menu:book.find('.bookinfo-menu-item-info_filename').text()};
 });
 assert.equal(result.executed,0);assert.equal(result.images,0);assert.equal(result.name,'<img src=x onerror=window.__bookXss=77>.txt');assert.equal(result.shown,result.name);assert.equal(result.menu,result.name);
 await page.close();console.log('Book cards and info menus keep filenames and metadata as inert text');
});
