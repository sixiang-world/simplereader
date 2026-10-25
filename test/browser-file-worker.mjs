import assert from 'node:assert/strict';
import { withBrowserTest } from './helpers/browser.mjs';
await withBrowserTest(async ({browser,baseURL})=>{
    const page=await browser.newPage();await page.goto(baseURL);
    await page.waitForFunction(()=>document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
    const result=await page.evaluate(async()=>{
        const {FileProcessor}=await import('/client/src/modules/file/file-processor.js');
        const file=new File(['第一章 测试\n正文内容\n'], 'worker.txt',{type:'text/plain'});
        const processor=new FileProcessor(file,true,'utf-8');
        let result;
        try {await processor.processBookMetadata();const data=await processor.processInitialChunk();result={name:processor.bookMetadata.bookName,lines:data.htmlLines.length,pending:processor.requests.pending.size};}
        finally {processor.destroy();}
        if(processor.worker!==null)throw new Error('Worker still owned after destroy');
        return result;
    });
    assert.ok(result.name);assert.ok(result.lines>0);assert.equal(result.pending,0);
    const failure=await page.evaluate(async()=>{
        const {FileProcessor}=await import('/client/src/modules/file/file-processor.js');const controller=new AbortController();
        const processor=new FileProcessor(new File(['data'],'cancel.txt'),true,'utf-8',{signal:controller.signal});
        controller.abort();try {await processor.processBookMetadata();return 'unexpected success';}catch(error){return error.name;}finally{processor.destroy();}
    });
    assert.equal(failure,'AbortError');await page.close();console.log('Real file Worker processing, pending cleanup, cancellation and disposal passed');
});
