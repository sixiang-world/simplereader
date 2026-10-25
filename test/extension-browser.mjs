import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const build=spawnSync('python3',['build-tools/build.py','--extension'],{stdio:'pipe',encoding:'utf8'});
assert.equal(build.status,0,build.stderr || build.stdout);
const profile=await mkdtemp(resolve(tmpdir(),'reader-extension-'));
const extension=resolve('dist/extensions/Chrome');
const executablePath=process.env.CHROMIUM_EXECUTABLE_PATH || (existsSync(chromium.executablePath()) ? chromium.executablePath() : ['/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync));
const context=await chromium.launchPersistentContext(profile,{headless:true,...(executablePath?{executablePath}:{}),ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:10000}).catch(()=>{throw new Error('Unpacked extension did not start. Check ExtensionInstallBlocklist policy and use an extension-enabled Chromium. This test is not skipped.');});
 const id=new URL(worker.url()).host;const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`chrome-extension://${id}/index.html`);
 await page.waitForFunction(()=>document.querySelector('#dropzone-text')?.classList.contains('dropzone-text-text'));
 const tabId=await page.evaluate(()=>new Promise(resolve=>chrome.tabs.getCurrent(tab=>resolve(tab.id))));
 const requestId='browser-handoff';const text='Chapter 1\nExtension handoff survived background readiness\n';
 await worker.evaluate(async({tabId,requestId,text})=>{await chrome.storage.local.set({['pendingReaderFile:'+tabId]:{requestId,createdAt:Date.now(),originalUrl:'file:///tmp/original.txt',file:{action:'loadFile',fileName:'extension.txt',fileType:'text/plain',fileContent:btoa(text)}}})},{tabId,requestId,text});
 await page.goto(`chrome-extension://${id}/index.html?extensionRequest=${requestId}`);
 await page.waitForFunction(()=>document.querySelector('#content')?.textContent.includes('Extension handoff survived'),null,{timeout:15000});
 const pending=await worker.evaluate(async tabId=>(await chrome.storage.local.get('pendingReaderFile:'+tabId))['pendingReaderFile:'+tabId],tabId);
 assert.equal(pending,undefined,'ACK clears durable bytes only after successful load');
 assert.deepEqual(errors,[],'extension startup and load must not have uncaught errors');
 console.log('Real Chromium MV3 reader page claims durable tab data, opens TXT and acknowledges successfully');
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
