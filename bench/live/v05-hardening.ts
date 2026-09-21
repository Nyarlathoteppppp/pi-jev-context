// Frozen filesystem acceptance fixtures. A=off, B=dedupe, C=dedupe+active Jev.
// Usage: node bench/live/v05-hardening.ts --reps 1 --out results/live-v05-hardening.json
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {isolatedSession} from './runtime.ts';
const {values}=parseArgs({options:{reps:{type:'string',default:'1'},out:{type:'string',default:'results/live-v05-hardening.json'},focused:{type:'boolean',default:false},scenarios:{type:'string',default:'failure-exit,multiple-failures,delayed-fact'}}});
const out=resolve(values.out!);if(existsSync(out))throw Error('Choose a new --out; refusing to overwrite previous benchmark');
const results:any[]=[];
for(const scenario of values.scenarios!.split(','))for(let rep=1;rep<=Number(values.reps);rep++)for(const condition of ['A','B','C']){
 const cwd=mkdtempSync(join(tmpdir(),'jev-v05-'));
 writeFileSync(join(cwd,'state.json'),JSON.stringify({auth:false,storage:false}));
 const source=Array.from({length:240},(_,i)=>`record_${i+1} = "stable value ${i+1}"`).join('\n');writeFileSync(join(cwd,'reference.txt'),source);
 const script=`const fs=require('fs');const s=JSON.parse(fs.readFileSync('state.json','utf8'));
for(let i=0;i<480;i++){
 console.log('PASS routine case '+i+' completed successfully with ordinary diagnostic padding');
 if(i===80&&!s.auth)console.log('FAIL auth: state.json auth must be true\\nError: auth disabled\\n    at verifyAuth (suite.js:82:3)');
 if(i===310&&!s.storage)console.log('FAIL storage: state.json storage must be true\\nError: storage disabled\\n    at verifyStorage (suite.js:312:3)');
 if(i===210)console.log('WARNING: deployment region must remain au-southeast-2');
 if(i===260)console.log('archived run label: cobalt-lantern-73');
}
console.log('Tests: '+((s.auth&&s.storage)?'482 passed':'2 failed, 480 passed'));
${scenario==='failure-exit'?'if(!s.auth||!s.storage)process.exitCode=1;':''}`;
 writeFileSync(join(cwd,'suite.cjs'),script);writeFileSync(join(cwd,'package.json'),JSON.stringify({scripts:{test:'node suite.cjs'}}));
 process.env.PI_JEV_CONTEXT_MODE='off';process.env.PI_JEV_CONTEXT_DEDUPE=condition==='A'?'off':'on';process.env.PI_JEV_CONTEXT_SIEVE=condition==='C'?'on':'off';
 const session=await isolatedSession(cwd,undefined,[resolve('src/index.ts')],['read','bash','edit','write','context_recall']);
 const start=Date.now();let error:string|undefined;
 try{
  await session.prompt(values.focused ? 'Investigate auth and storage failures. Read reference.txt (offset=1, limit=200), then run npm test. Do not edit yet.' : 'Read reference.txt with offset 1 limit 200. Then run npm test to inspect the diagnostics. Do not edit files yet.');
  await session.prompt(scenario==='delayed-fact'
   ? 'Read reference.txt with offset 51 limit 190. From the previous test output, write answer.json with exactly keys region and label: the deployment region and archived run label. Do not rerun commands or read suite.cjs; context_recall is allowed.'
   : 'Read reference.txt with offset 51 limit 190. Fix the two failures by changing only the boolean values in state.json, then run npm test to verify. Preserve all other files.');
 }catch(e){error=String(e);}finally{
 const entries=session.sessionManager.getBranch() as any[];const logs=entries.filter(e=>e.customType==='jev-context').map(e=>e.data);
 const sieve=logs.filter(e=>e.kind==='sieve');const acted=logs.filter(e=>e.acted);
 const messages=entries.filter(e=>e.type==='message').map(e=>e.message);
 let passed=false;try{if(scenario==='delayed-fact'){const a=JSON.parse(readFileSync(join(cwd,'answer.json'),'utf8'));passed=a.region==='au-southeast-2'&&a.label==='cobalt-lantern-73'&&Object.keys(a).length===2;}else{const s=JSON.parse(readFileSync(join(cwd,'state.json'),'utf8'));passed=s.auth===true&&s.storage===true&&Object.keys(s).length===2;}passed&&=readFileSync(join(cwd,'reference.txt'),'utf8')===source&&readFileSync(join(cwd,'suite.cjs'),'utf8')===script;}catch{}
 const violations=scenario==='delayed-fact'?messages.filter(m=>m.role==='assistant').flatMap(m=>m.content).filter(c=>c.type==='toolCall'&&((c.name==='read'&&c.arguments.path?.includes('suite.cjs')))).length:0;
 const usage=messages.filter(m=>m.role==='assistant').map(m=>m.usage??{});const sum=(key:string)=>usage.reduce((s,u)=>s+(u[key]??0),0);
 const row={scenario,rep,condition,passed:passed&&!error&&!violations,error,protocolViolations:violations,ms:Date.now()-start,rewrites:acted.length,dedupeRewrites:acted.filter(e=>e.kind==='seen').length,sieveRewrites:sieve.filter(e=>e.acted).length,hiddenTokens:acted.reduce((s,e)=>s+e.from-e.to,0),hiddenBlocks:sieve.reduce((s,e)=>s+e.hiddenBlocks,0),jevDecisions:sieve.length,jevFailures:sieve.filter(e=>/unavailable|invalid|failure/i.test(e.skip??'')).length,jevSkips:sieve.filter(e=>e.skip).map(e=>e.skip),jevLatencyMs:sieve.reduce((s,e)=>s+e.latencyMs,0),recalls:logs.filter(e=>e.kind==='recall').length,inputTokens:sum('input'),cacheRead:sum('cacheRead'),cacheWrite:sum('cacheWrite'),toolResultTokens:messages.filter(m=>m.role==='toolResult').reduce((s,m)=>s+Math.ceil(m.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n').length/4),0),providerErrors:messages.filter(m=>m.role==='assistant'&&m.stopReason==='error').map(m=>m.errorMessage)};
 results.push(row);console.log(JSON.stringify(row));session.dispose();mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({model:'antigravity/gemini-3.8-flash',reps:Number(values.reps),focused:values.focused,results},null,2));
 }
}
