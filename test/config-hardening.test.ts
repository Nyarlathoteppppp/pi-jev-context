import assert from 'node:assert/strict';
import {it} from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setup} from './harness.ts';
import {CONFIG} from '../src/index.ts';
it('independent options > environment > file > mode; commands are session overrides',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jev-config-'));const settingsPath=join(dir,'settings.json');
 try{
  writeFileSync(settingsPath,JSON.stringify({mode:'off',dedupe:'on',sieve:'off'}));
  let x=setup({settingsPath});assert.equal(x.ext.config.dedupe,'on');assert.equal(x.ext.config.sieve,'off');
  x=setup({settingsPath,env:{PI_JEV_CONTEXT_MODE:'shadow',PI_JEV_CONTEXT_DEDUPE:'off',PI_JEV_CONTEXT_SIEVE:'on'}});assert.equal(x.ext.config.dedupe,'off');assert.equal(x.ext.config.sieve,'on');
  x=setup({settingsPath,env:{PI_JEV_CONTEXT_DEDUPE:'off',PI_JEV_CONTEXT_SIEVE:'on'},config:{dedupe:'on',sieve:'off'}});
  await x.pi.command('/context mode off');await x.pi.command('/context mode shadow');assert.equal(x.ext.config.dedupe,'on');assert.equal(x.ext.config.sieve,'off');
  await x.pi.command('/context sieve on');await x.pi.command('/context dedupe off');
  const records=x.pi.entries.filter(e=>e.customType===CONFIG);assert.deepEqual(records.slice(-2).map(e=>e.data),[{sieve:'on'},{dedupe:'off'}]);
  for(const event of ['session_start','session_tree']){await x.pi.emit(event);assert.equal(x.ext.config.dedupe,'off');assert.equal(x.ext.config.sieve,'on');}
 }finally{rmSync(dir,{recursive:true});}
});
it('mode-only old sessions retain off/shadow/on mapping',async()=>{
 for(const mode of ['off','shadow','on']){const {pi,ext}=setup();pi.entries.push({type:'custom',customType:CONFIG,data:{mode}});await pi.emit('session_start');assert.equal(ext.config.dedupe,mode==='off'?'off':'on');assert.equal(ext.config.sieve,mode==='on'?'on':'off');}
});
