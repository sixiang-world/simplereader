import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { TextProcessorDOM } from '../client/src/modules/text/text-processor-dom.js';
const {document,Node}=parseHTML('<html><body></body></html>');
globalThis.document=document;globalThis.Node=Node;
const originalCreate=URL.createObjectURL, originalRevoke=URL.revokeObjectURL;
let created=0; const revoked=[];
URL.createObjectURL=()=>`blob:test-${++created}`;URL.revokeObjectURL=url=>revoked.push(url);
try {
 const content='<img src="data:image/png;base64,'+'AAAA'.repeat(530000)+'" alt="image">';
 const structure={type:'image',tag:'div',source:'epub',elementType:'img',content,lineNumber:1};
 const first=TextProcessorDOM.createFromStructure(structure)[0].querySelector('img').getAttribute('src');
 const second=TextProcessorDOM.createFromStructure(structure)[0].querySelector('img').getAttribute('src');
 assert.equal(created,1);assert.equal(first,second);
 TextProcessorDOM.revokeBlobUrls();assert.deepEqual(revoked,[first]);
 const third=TextProcessorDOM.createFromStructure(structure)[0].querySelector('img').getAttribute('src');
 assert.equal(created,2);assert.notEqual(third,first);TextProcessorDOM.revokeBlobUrls();
 console.log('Repeated large images reuse one session URL; reset revokes and releases cache');
} finally {URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
