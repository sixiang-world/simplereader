import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const temp=mkdtempSync(resolve(tmpdir(),'reader-typecheck-'));
try {
 const file=resolve(temp,'probe.js');const config=resolve(temp,'jsconfig.json');
 writeFileSync(config,JSON.stringify({extends:resolve('jsconfig.checked.json'),files:[file],include:[]}));
 const check=()=>spawnSync(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--noEmit','-p',config],{encoding:'utf8'});
 writeFileSync(file,'missingVariable.read(); "text".missingMethod();\n');const bad=check();
 assert.notEqual(bad.status,0);assert.match(bad.stdout+bad.stderr,/missingVariable/);assert.match(bad.stdout+bad.stderr,/missingMethod/);
 writeFileSync(file,'const value=1; Number.isFinite(value);\n');assert.equal(check().status,0);
 console.log('Checked JS semantic gate rejects undefined symbols and invalid methods; positive fixture passes');
}finally {rmSync(temp,{recursive:true,force:true});}
