import assert from 'node:assert/strict';
import {it} from 'node:test';
import {setup} from './harness.ts';
import {LOG, ORIGINAL} from '../src/index.ts';
import {Jev} from '../src/jev.ts';

it('id recall past EOF reports an empty page without inverted line coordinates',async()=>{
 const {pi}=setup();
 pi.entries.push({type:'custom',customType:ORIGINAL,data:{alias:'t1',toolCallId:'c1',summary:'npm test',tool:'bash',text:'first\nlast'}});
 await pi.emit('session_start');
 const text=await pi.recall({id:'t1',offset:3});
 assert.match(text,/beyond.*2 lines/);assert.doesNotMatch(text,/lines 3-2/);
 assert.ok((await pi.recall({id:'t1',offset:2,limit:1})).endsWith('\nlast'));
});

it('labels attach to the last filtering decision, never recalls or earlier labels',async()=>{
 const {pi}=setup();
 pi.entries.push({type:'custom',id:'decision',customType:LOG,data:{kind:'seen',acted:false,mode:'shadow'}});
 await pi.recall({id:'missing'});
 await pi.command('/context label bad inspect');
 await pi.command('/context label good revised');
 assert.deepEqual(pi.logs('label').map(r=>r.target),['decision','decision']);
 const empty=setup().pi;await empty.recall({id:'missing'});await empty.command('/context label bad');
 assert.equal(empty.logs('label').length,0);
});

it('report distinguishes sieve evaluations from network calls and missing transport',async()=>{
 const {pi}=setup({config:{sieve:'on'}});
 await pi.command('/context report');
 assert.match(pi.notes.at(-1)!,/Jev unavailable/);
 assert.match(pi.notes.at(-1)!,/Sieve evaluations: 0/);
 assert.doesNotMatch(pi.notes.at(-1)!,/Jev sieve calls/);
});

it('production transport backs off without Retry-After and measures body decoding',async(t)=>{
 const times:number[]=[];
 t.mock.method(globalThis,'fetch',async()=>{
  times.push(performance.now());
  if(times.length===1)return new Response('busy',{status:503});
  const response=new Response('{}');
  response.json=async()=>{await new Promise(r=>setTimeout(r,60));return {answers:{q:{noul:0.2}}};};
  return response;
 });
 const j=new Jev({url:'https://example.invalid',model:'fixture',key:'fixture'});
 const result=await j.decide({}, {q:{type:'noul',instructions:'needed?'}},2500);
 assert.ok(result.answers);assert.equal(times.length,2);
 assert.ok(times[1]!-times[0]!>=120,'missing header must use the 150ms backoff');
 assert.ok(result.ms>=200,'latency includes reading the response body');
});
