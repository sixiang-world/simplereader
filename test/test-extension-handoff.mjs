import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client/src/extension/activate.js', import.meta.url), 'utf8');
const stored = {};
const navigations = [];
let quotaError = false;
let navigationError = false;
let listener;
const api = {
    runtime: { getURL: (path) => `chrome-extension://reader/${path}`, lastError: null,
        onMessage: { addListener(fn) { listener = fn; } } },
    action: { onClicked: { addListener() {} } },
    storage: { local: {
        set(value, cb) {
            if (quotaError) api.runtime.lastError = { message: 'Storage quota exceeded' };
            else Object.assign(stored, structuredClone(value));
            cb(); api.runtime.lastError = null;
        },
        get(key, cb) { cb(structuredClone({ [key]: stored[key] })); },
        remove(key, cb) { delete stored[key]; cb(); },
    } },
    tabs: {
        get(id, cb) { cb(navigations.findLast((tab) => tab.id === id)); },
        update(id, data, cb) {
            if (navigationError) api.runtime.lastError = { message: 'Tab closed' };
            else navigations.push({ id, ...data });
            cb({ id }); api.runtime.lastError = null;
        },
        onRemoved: { addListener() {} },
    },
};
function boot() { vm.runInNewContext(source, { chrome: api, URL, crypto: globalThis.crypto, console }); }
function send(message, tabId = 1, url = navigations.findLast((tab) => tab.id === tabId)?.url) {
    return new Promise((resolve) => listener(message, { tab: { id: tabId }, url }, resolve));
}
function sendFromExtensionPage(message, url = navigations.findLast((tab) => tab.id === message.tabId)?.url) {
    return new Promise((resolve) => listener(message, { url }, resolve));
}
const file = { action: 'replaceCurrentTab', fileName: 'read.txt', fileType: 'text/plain', fileContent: 'SGVsbG8=' };
boot();
const first = await send(file, 1, 'file:///read.txt');
assert.equal(first.success, true);
assert.equal(navigations[0].url, `chrome-extension://reader/index.html?extensionRequest=${first.requestId}`);
const second = await send({ ...file, fileContent: '' }, 2, 'file:///empty.txt');
assert.equal(second.success, true, 'empty TXT can be handed off');
assert.equal((await send({ action: 'claimPendingFile', requestId: first.requestId }, 2)).success, false, 'tab isolation');
boot(); // background worker restarts, only persistent storage survives
const claim = await sendFromExtensionPage({ action: 'claimPendingFile', requestId: first.requestId, tabId: 1 });
assert.equal((await sendFromExtensionPage({ action: 'claimPendingFile', requestId: first.requestId, tabId: 2 }, navigations[0].url)).success, false, 'extension page cannot claim another tab');
assert.equal((await sendFromExtensionPage({ action: 'claimPendingFile', requestId: first.requestId, tabId: 1 }, 'chrome-extension://reader/index.html.evil?extensionRequest=' + first.requestId)).success, false, 'reader URL must match exact path');
assert.equal((await send({ action: 'claimPendingFile', requestId: first.requestId, tabId: 1 }, 2)).success, false, 'sender tab always wins over a claimed tabId');
assert.equal(claim.file.fileContent, 'SGVsbG8=');
assert.ok(stored['pendingReaderFile:1'], 'claim is retryable until acknowledged');
assert.equal((await send({ action: 'claimPendingFile', requestId: first.requestId }, 1, 'file:///read.txt')).success, false);
await sendFromExtensionPage({ action: 'ackPendingFile', requestId: first.requestId, tabId: 1 });
assert.equal(stored['pendingReaderFile:1'], undefined);
assert.equal((await sendFromExtensionPage({ action: 'restorePendingFile', requestId: second.requestId, tabId: 2 })).success, true);
assert.equal(navigations.at(-1).url, 'file:///empty.txt?readerSkip=1');
assert.equal(stored['pendingReaderFile:2'], undefined);
quotaError = true;
const before = navigations.length;
assert.equal((await send(file, 3, 'file:///read.txt')).success, false);
assert.equal(navigations.length, before, 'storage failure must never navigate away from original TXT');
quotaError = false;
navigationError = true;
assert.equal((await send(file, 4, 'file:///read.txt')).success, false);
assert.equal(stored['pendingReaderFile:4'], undefined, 'failed navigation cleans pending state');
navigationError = false;

// Failed content-script handoff leaves the original page visible and readable.
const contentScript = readFileSync(new URL('../client/src/extension/contentScript.js', import.meta.url), 'utf8');
const style = {};
let calls = 0;
const contentAPI = { runtime: { lastError: null, sendMessage(_msg, cb) { calls++; cb({ success: false, error: 'quota exceeded' }); } } };
const context = { chrome: contentAPI, URL, location: { href: 'file:///read.txt' },
    document: { readyState: 'complete', documentElement: { style }, body: { textContent: 'Original text' }, querySelector: () => null },
    TextEncoder, btoa: globalThis.btoa, console: { error() {} } };
await vm.runInNewContext(contentScript, context);
assert.equal(calls, 1);
assert.deepEqual(style, {});
context.location.href = 'file:///read.txt?readerSkip=1';
await vm.runInNewContext(contentScript, context);
assert.equal(calls, 1, 'recovery URL must bypass interception');
console.log('Extension handoff: durable claims, ACK, isolation, recovery, empty file and quota failures passed');
