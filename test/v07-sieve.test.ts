import assert from 'node:assert/strict';
import { it } from 'node:test';
import { setup } from './harness.ts';
import { classifyBashCommand } from '../src/sieve.ts';
import type { Judge, Answer } from '../src/jev.ts';
const judge:Judge={async decide(_s,qs){return {ms:1,answers:Object.fromEntries(Object.keys(qs).map(k=>[k,k==='need'?{type:'choice',choice:'specific_parts',confidence:1,probabilities:{specific_parts:1}}:{type:'noul',noul:0}])) as Record<string,Answer>};}};
it('expands known Python, Go and Cargo diagnostics without admitting shell compositions',()=>{
 for(const c of ['python -m pytest','python3 -m pytest -q','cd repo && python3 -m pytest','go build ./...','go vet ./...','cargo check','cargo clippy'])assert.ok(classifyBashCommand(c),c);
 for(const c of ['python report.py','cargo check && cat secret','go build | cat','npm install'])assert.equal(classifyBashCommand(c),undefined);
});
it('failed commands hide only independent PASS blocks and preserve all remaining evidence/status',async()=>{
 const {pi}=setup({judge});
 const evidence='unexpected custom diagnostic with no standard error keyword\nFAIL auth.test.ts\nError: broken\n    at run (auth.ts:7:1)\nCommand exited with code 1';
 const output=Array.from({length:450},(_,i)=>`PASS ordinary_case_${i} completed with routine diagnostic padding`).join('\n')+'\n'+evidence;
 const result=await pi.tool('bash',{command:'npm test'},output,{isError:true});
 assert.ok(result.patch);assert.ok(result.text.includes(evidence));
 assert.equal(pi.entries.at(-1)?.message.isError,true);
 const alias=pi.logs('sieve')[0].alias;assert.ok((await pi.recall({id:alias})).endsWith(output));
});
it('upstream truncation keeps the received text intact and avoids Jev',async()=>{
 const {pi}=setup({judge:{async decide(){throw Error('must not call');}}});
 const text='PASS normal line\n'.repeat(500)+'[Showing lines 501-1000 of 1000. Full output: /tmp/example.log]';
 assert.equal((await pi.tool('bash',{command:'npm test'},text)).patch,undefined);
});
