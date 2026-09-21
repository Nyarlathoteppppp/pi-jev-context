// Fixed retrieval ablation. Hidden content is deliberate, not evidence of sieve safety.
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {isolatedSession,SessionManager} from './runtime.ts';
import {hiddenReferences} from '../../src/hints.ts';
const {values}=parseArgs({options:{out:{type:'string'},reps:{type:'string',default:'1'}}});
if(!values.out||existsSync(values.out))throw Error('Supply a new --out');
const rows:any[]=[];
for(let rep=1;rep<=Number(values.reps);rep++)for(const scenario of ['needed','unnecessary','no-match'])for(const condition of ['A','B','C']){
 const cwd=mkdtempSync(join(tmpdir(),'jev-v07-')),sm=SessionManager.inMemory(cwd);
 const raw=Array.from({length:600},(_,i)=>i===311?'AuthMiddleware historical deployment region: au-southeast-2':`PASS routine_case_${i} completed successfully`).join('\n');
 const marker='[pi-jev-context t1] Historical test output: 600 lines hidden. Original available through context_recall id "t1".';
 const visible=condition==='A'?raw:marker+(condition==='C'?hiddenReferences(raw)+' Search saved original chunks with context_recall query.':'');
 sm.appendMessage({role:'user',content:'Inspect the previous diagnostic run. No changes yet.',timestamp:Date.now()});
 sm.appendMessage({role:'assistant',content:[{type:'toolCall',id:'historical-call',name:'bash',arguments:{command:'npm test'}}],timestamp:Date.now()} as any);
 sm.appendCustomEntry('jev-context-original',{alias:'t1',toolCallId:'historical-call',tool:'bash',summary:'npm test',text:raw});
 sm.appendMessage({role:'toolResult',toolCallId:'historical-call',toolName:'bash',content:[{type:'text',text:visible}],isError:false,timestamp:Date.now()} as any);
 process.env.PI_JEV_CONTEXT_DEDUPE='off';process.env.PI_JEV_CONTEXT_SIEVE='off';
 const session=await isolatedSession(cwd,sm,[resolve(condition==='B'?'bench/live/v07-legacy-recall-v06.ts':'src/index.ts')],['write','context_recall']);
 const start=Date.now();let error:string|undefined;
 let turns=0;
 session.subscribe((event:any)=>{if(event.type==='turn_end'){turns++;console.error(JSON.stringify({condition,scenario,turns,event:'turn_end'}));if(turns>=20){error='benchmark turn limit (20)';void session.abort();}}});
 const deadline=setTimeout(()=>{error='benchmark deadline (90s)';void session.abort();},90000);
 try{await session.prompt(scenario==='needed'?'Write answer.json with exactly {"region": <the AuthMiddleware deployment region from the historical diagnostic>}.':scenario==='unnecessary'?'Write answer.json with exactly {"status":"ready"}. No information from the prior diagnostic is needed.':'Determine whether the historical diagnostic specifies a DatabaseMigration deployment region. Write answer.json with exactly {"region":null} if it is absent, otherwise its stated region. Do not substitute a region from another component.');}catch(e){error=String(e);}
 clearTimeout(deadline);
 const entries=sm.getBranch() as any[],messages=entries.filter(e=>e.type==='message').map(e=>e.message);
 let passed=false;try{const expected=scenario==='needed'?{region:'au-southeast-2'}:scenario==='unnecessary'?{status:'ready'}:{region:null};passed=JSON.stringify(JSON.parse(readFileSync(join(cwd,'answer.json'),'utf8')))===JSON.stringify(expected);}catch{}
 const recalls=messages.filter(m=>m.role==='toolResult'&&m.toolName==='context_recall');
 const logs=entries.filter(e=>e.customType==='jev-context').map(e=>e.data);
 const usage=messages.filter(m=>m.role==='assistant').map(m=>m.usage??{});const sum=(k:string)=>usage.reduce((s,u)=>s+(u[k]??0),0);
 const row={condition,scenario,rep,passed:passed&&!error,filesystemPassed:passed,error,ms:Date.now()-start,recalls:recalls.length,toolErrors:recalls.filter(m=>m.isError).map(m=>m.content.map((c:any)=>c.text??'').join('\n').slice(0,300)),searches:logs.filter(e=>e.kind==='recall'&&e.query!==undefined).length,recallTokens:recalls.reduce((s,m)=>s+Math.ceil(m.content.map((c:any)=>c.text??'').join('\n').length/4),0),inputTokens:sum('input'),cacheRead:sum('cacheRead'),cacheWrite:sum('cacheWrite'),providerErrors:messages.filter(m=>m.role==='assistant'&&m.stopReason==='error').map(m=>m.errorMessage)};
 rows.push(row);console.log(JSON.stringify(row));writeFileSync(values.out,JSON.stringify({model:'antigravity/gemini-3.8-flash',method:'Fixed synthetic historical originals. A full output; B exact v0.6 id recall declaration; C query recall and hints. Only write and recall available. No live Jev in this retrieval ablation.',rows},null,2));session.dispose();
}
