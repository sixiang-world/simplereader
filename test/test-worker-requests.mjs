import assert from 'node:assert/strict';
import { WorkerRequests } from '../client/src/utils/helpers/worker-requests.js';
class FakeWorker extends EventTarget {
    messages = []; terminated = false;
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(message) { this.dispatchEvent(new MessageEvent('message', { data: message })); }
}
const worker = new FakeWorker(); const rpc = new WorkerRequests(worker);
const a = rpc.request({operation:'a'}); const b = rpc.request({operation:'b'});
worker.reply({id:2, type:'bComplete', value:2}); worker.reply({id:1, type:'aComplete', value:1});
assert.equal((await a).value,1); assert.equal((await b).value,2); assert.equal(rpc.pending.size,0);
await assert.rejects(rpc.request({}, {timeoutMs:5}), /timed out/); assert.equal(rpc.pending.size,0);
const controller = new AbortController(); const cancelled = rpc.request({}, {signal:controller.signal});
controller.abort(); await assert.rejects(cancelled, {name:'AbortError'}); assert.equal(rpc.pending.size,0);
const failed = rpc.request({}); worker.dispatchEvent(new Event('error'));
await assert.rejects(failed,/communication failed/); assert.equal(rpc.pending.size,0);
rpc.dispose(); assert.equal(worker.terminated,true);
const cloneWorker=new FakeWorker();cloneWorker.postMessage=()=>{throw new DOMException('clone failed','DataCloneError')};
const cloneRpc=new WorkerRequests(cloneWorker); await assert.rejects(cloneRpc.request({}),{name:'DataCloneError'});assert.equal(cloneRpc.pending.size,0);cloneRpc.dispose();
console.log('Worker request dispatcher: concurrency, timeout, abort, error, clone failure, dispose passed');
