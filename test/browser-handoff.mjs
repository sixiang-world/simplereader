import assert from 'node:assert/strict';
import { withBrowserTest } from './helpers/browser.mjs';
await withBrowserTest(async ({browser,baseURL})=>{
 const context=await browser.newContext();
 await context.addInitScript(()=>{
  window.__handoffActions=[];
  window.chrome={runtime:{onMessage:{addListener(){}},sendMessage(message,respond){
   window.__handoffActions.push(message.action);
   if(message.action==='claimPendingFile')respond({success:true,file:{fileName:'extension.txt',fileType:'text/plain',fileContent:btoa('Chapter 1\nReady handoff body\n')}});
   else if(message.action==='ackPendingFile') {window.__ackSawContent=document.querySelector('#content')?.textContent.includes('Ready handoff body');respond({success:true});}
   else respond({success:false,error:'cannot restore'});
  }},tabs:{getCurrent(respond){respond({id:7})}}};
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(baseURL+'/?extensionRequest=fixture');
 await page.waitForFunction(()=>window.__handoffActions?.includes('ackPendingFile'),null,{timeout:15000});
 const result=await page.evaluate(()=>({actions:window.__handoffActions,visible:window.__ackSawContent}));
 assert.deepEqual(result.actions,['claimPendingFile','ackPendingFile']);assert.equal(result.visible,true);assert.deepEqual(errors,[]);
 await context.close();console.log('Reader readiness and real TXT Worker processing precede extension ACK (API transport stub)');
});
