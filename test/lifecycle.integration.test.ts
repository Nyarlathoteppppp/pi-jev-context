import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionManager } from "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { createJevContext, ORIGINAL, LOG, type JevContextOptions } from "../src/index.ts";
import type { Answer, Judge } from "../src/jev.ts";
const output = Array.from({length:500},(_,i)=>`routine test output ${i} with stable diagnostic padding`).join("\n")+"\nTests: 500 passed";
const readText = Array.from({length:200},(_,i)=>`source line ${i}: const value${i} = ${i};`).join("\n");
function makeJudge() {
 let calls=0;
 const judge: Judge = { async decide(_state, questions) {
  calls++;
  // Yield so Promise.all exercises two aliases reserved before either decision completes.
  await new Promise(resolve=>setImmediate(resolve));
  const answers: Record<string,Answer> = {};
  for(const k of Object.keys(questions)) answers[k]=k==='need'?{type:'choice',choice:'specific_parts',probabilities:{specific_parts:1},confidence:1}:{type:'noul',noul:0.01};
  return {answers,ms:1};
 }};
 return {judge,get calls(){return calls;}};
}
class Harness {
 sm: SessionManager;
 handlers=new Map<string,Array<(e:any,c:any)=>any>>(); tools=new Map<string,any>(); failPersistence=false; seq=0;
 constructor(sm=SessionManager.inMemory()){this.sm=sm;}
 api() {return {
  on:(n:string,h:any)=>this.handlers.set(n,[...(this.handlers.get(n)??[]),h]),
  registerTool:(t:any)=>this.tools.set(t.name,t),registerCommand:()=>{},
  appendEntry:(type:string,data:any)=>{if(this.failPersistence&&type===ORIGINAL)throw Error('disk full');return this.sm.appendCustomEntry(type,data);},
 } as any;}
 ctx(){return {hasUI:false,sessionManager:this.sm,ui:{setStatus(){},notify(){}}};}
 async emit(n:string,e:any={}){let result;for(const h of this.handlers.get(n)??[]){const r=await h({type:n,...e},this.ctx());if(r!==undefined)result=r;}return result;}
 install(options:JevContextOptions={}){return createJevContext(this.api(),{env:{},settingsPath:'/nonexistent',...options});}
 originals(){return this.sm.getBranch().filter(e=>e.type==='custom'&&e.customType===ORIGINAL);}
 async recall(id:string){const r=await this.tools.get('context_recall').execute('recall',{id});return r.content[0].text as string;}
 async tool(toolName='bash',text=output,input:any={command:'npm test'}) {
  const id=`call-${++this.seq}`;
  this.sm.appendMessage({role:'assistant',content:[{type:'toolCall',id,name:toolName,arguments:input}],timestamp:Date.now()} as any);
  const content=[{type:'text',text}];
  const patch:any=await this.emit('tool_result',{toolCallId:id,toolName,input,content,isError:false});
  const message={role:'toolResult',toolCallId:id,toolName,content:patch?.content??content,isError:false,timestamp:Date.now()};
  this.sm.appendMessage(message as any);return {patch,message};
 }
}
function data(e:any){return e.data;}
describe('installed Pi SessionManager lifecycle',()=>{
 it('persists distinct parallel sieve originals and restores exact text in a new extension',async()=>{
  const h=new Harness(),j=makeJudge();h.install({judge:j.judge});
  const results=await Promise.all([h.tool(),h.tool('bash',output+'\nsecond-output')]);
  assert.ok(results.every(r=>r.patch));assert.equal(j.calls,2);
  const originals=h.originals();assert.equal(originals.length,2);assert.equal(new Set(originals.map(e=>data(e).alias)).size,2);
  const entries=structuredClone(h.sm.getEntries());
  const sm=SessionManager.inMemory(h.sm.getCwd(),undefined,entries);sm.branch(h.sm.getLeafId()!);
  const resumed=new Harness(sm);resumed.install({judge:j.judge});await resumed.emit('session_start');
  assert.equal(resumed.originals().length,2);
  assert.match((await resumed.tools.get('context_recall').execute('q',{query:'second-output',budget:1000})).content[0].text,/second-output/);
  for(const e of originals)assert.equal((await resumed.recall(data(e).alias)).split('\n').slice(1).join('\n'),data(e).text);
  assert.equal(j.calls,2);
 });
 it('keeps simultaneous read and sieve aliases distinct',async()=>{
  const h=new Harness();h.install({judge:makeJudge().judge});await h.tool('read',readText,{path:'a.ts'});
  const results=await Promise.all([h.tool(),h.tool('read',readText,{path:'a.ts'})]);
  assert.ok(results.every(r=>r.patch));assert.equal(h.originals().length,2);assert.equal(new Set(h.originals().map(e=>data(e).alias)).size,2);
 });
 it('hides sibling originals after fork/tree navigation and restores them on return',async()=>{
  const h=new Harness(),j=makeJudge();h.install({judge:j.judge});
  const root=h.sm.appendMessage({role:'user',content:'base',timestamp:Date.now()});
  await h.tool();const alias=data(h.originals()[0]).alias;const leaf=h.sm.getLeafId()!;
  h.sm.branch(root);h.sm.appendMessage({role:'user',content:'sibling',timestamp:Date.now()});await h.emit('session_tree');
  assert.equal(h.originals().length,0);assert.match(await h.recall(alias),/No shortened output/);
  assert.match((await h.tools.get('context_recall').execute('q',{query:'routine'})).content[0].text,/No saved originals/);
  h.sm.branch(leaf);await h.emit('session_tree');assert.equal(h.originals().length,1);assert.ok((await h.recall(alias)).endsWith(output));assert.equal(j.calls,1);
 });
 it('compaction and rebuild do not rejudge; compacted reads cannot authorize dedupe; new output still sieves',async()=>{
  const h=new Harness(),j=makeJudge();h.install({judge:j.judge});
  await h.tool('read',readText,{path:'a.ts'});await h.tool();const alias=data(h.originals()[0]).alias;
  const tail=h.sm.appendMessage({role:'user',content:'new task',timestamp:Date.now()});
  h.sm.appendCompaction('native summary',tail,10000);
  assert.equal(h.sm.buildContextEntries().filter(e=>e.type==='message').length,1);
  await h.emit('session_start');assert.equal(j.calls,1);assert.equal(h.originals().length,1);assert.ok((await h.recall(alias)).endsWith(output));
  assert.match((await h.tools.get('context_recall').execute('q',{query:'routine',budget:1000})).content[0].text,/routine test output/);
  assert.equal((await h.tool('read',readText,{path:'a.ts'})).patch,undefined);
  assert.ok((await h.tool()).patch);assert.equal(j.calls,2);assert.equal(h.originals().length,2);
 });
 it('always registers identical recall declarations and never a context handler',()=>{
  const declarations=[];
  for(const dedupe of ['on','off'] as const)for(const sieve of ['on','off'] as const){const h=new Harness();h.install({config:{dedupe,sieve}});assert.equal(h.handlers.has('context'),false);const {execute,...decl}=h.tools.get('context_recall');declarations.push(JSON.stringify(decl));}
  assert.equal(new Set(declarations).size,1);
 });
 it('persistence failures preserve full results without markers or original entries',async()=>{
  for(const tool of ['read','bash']){const h=new Harness();h.install({judge:makeJudge().judge});if(tool==='read')await h.tool('read',readText,{path:'a.ts'});h.failPersistence=true;
   const r=await h.tool(tool,tool==='read'?readText:output,tool==='read'?{path:'a.ts'}:{command:'npm test'});
   assert.equal(r.patch,undefined);assert.equal(r.message.content[0].text,tool==='read'?readText:output);assert.equal(h.originals().length,0);
   const last=h.sm.getBranch().at(-1);assert.equal(last?.type,'message');
  }
 });
 for(const failure of ['malformed','timeout','network'])it(`${failure} fails open and persists no original`,async()=>{
  const h=new Harness();h.install({judge:{async decide(){if(failure==='network')throw Error('network down');return failure==='timeout'?{error:'timeout',ms:2500}:{answers:{},ms:1};}}});
  const r=await h.tool();assert.equal(r.patch,undefined);assert.equal(r.message.content[0].text,output);assert.equal(h.originals().length,0);
  assert.ok(h.sm.getBranch().some(e=>e.type==='custom'&&e.customType===LOG));
 });
});
