import assert from 'node:assert/strict';
import {consumePendingFile} from '../client/src/core/extension-handoff.js';
const file={fileName:'empty.txt',fileType:'text/plain',fileContent:''};let loaded=false;let calls=[];
const send=async m=>{calls.push(m.action);if(m.action==='claimPendingFile')return {success:true,file};if(m.action==='ackPendingFile'){assert.equal(loaded,true);return {success:true};}return {success:true};};
assert.equal((await consumePendingFile('id',send,async f=>{assert.equal(f.fileContent,'');loaded=true;})).status,'loaded');
assert.deepEqual(calls,['claimPendingFile','ackPendingFile']);calls=[];
assert.equal((await consumePendingFile('id',send,async()=>{throw new Error('parse failed')})).status,'restored');assert.deepEqual(calls,['claimPendingFile','restorePendingFile']);
assert.equal((await consumePendingFile('id',async()=>{throw new Error('offline')},async()=>{})).status,'failed');
console.log('Reader handoff readiness, empty files, ACK ordering and restoration passed');
