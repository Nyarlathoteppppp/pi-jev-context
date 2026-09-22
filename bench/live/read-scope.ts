// Synthetic source-navigation experiment informed by local aggregate read inventory.
// Frozen grade: exact answers over three turns, preserving current source; no output pruning.
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {isolatedSession} from './runtime.ts';
import {estimateTokens,textOf} from '../../src/extract.ts';
const {values}=parseArgs({options:{out:{type:'string'},reps:{type:'string',default:'2'}}});
if(!values.out||existsSync(values.out))throw Error('Supply a new --out');
const source=(rate:number)=>[
 '// Service policy registry. Values are independent unless explicitly referenced.',
 'const defaultRegion = "au-southeast-2";',
 'const baseRetentionDays = 14;',
 ...Array.from({length:100},(_,i)=>{
 const name=i===31?'checkoutPolicy':i===78?'auditPolicy':`servicePolicy${i}`;
 return [`export function ${name}() {`, '  return {',`    name: "${name}",`,`    rate: ${i===31?rate:i+1},`,`    region: ${i===31?'defaultRegion':'"us-east-1"'},`,`    retentionDays: ${i===78?'baseRetentionDays * 3':7+i},`,'    enabled: true,','    retries: 2,','    backoffMs: 100,','    format: "json",','  };','}',''].join('\n');
 })].join('\n');
const rows:any[]=[];
for(let rep=1;rep<=Number(values.reps);rep++)for(const condition of (rep%2?['whole','scoped']:['scoped','whole'])){
 const cwd=mkdtempSync(join(tmpdir(),'jev-read-scope-')),v1=source(7),v2=source(11);writeFileSync(join(cwd,'policies.ts'),v1);
 process.env.PI_JEV_CONTEXT_DEDUPE='on';process.env.PI_JEV_CONTEXT_SIEVE='on';
 const session=await isolatedSession(cwd,undefined,[resolve('src/index.ts')],['read','bash','write','context_recall']);
 const policy=condition==='whole'?'For each question, use read to retrieve the complete policies.ts before answering.':'Use source search to locate relevant definitions, then read the ranges and dependencies needed for the question. You may read more if needed.';
 const tasks=[
 'Write answer1.json with exactly the checkoutPolicy rate and resolved region: {"rate":number,"region":string}.',
 'policies.ts has now been updated externally. Write answer2.json with exactly {"previousRate":number,"currentRate":number,"region":string} for checkoutPolicy. previousRate means the value you observed in the first question; currentRate must come from the current file.',
 'Now investigate auditPolicy, which was not requested earlier. Resolve its retentionDays expression and write answer3.json with exactly {"retentionDays":number}.',
 ];
 const expected=[{rate:7,region:'au-southeast-2'},{previousRate:7,currentRate:11,region:'au-southeast-2'},{retentionDays:42}];
 const phases:any[]=[];let error:string|undefined,turns=0;
 session.subscribe((e:any)=>{if(e.type==='turn_end'&&++turns>=30){error='30-turn ceiling';void session.abort();}});
 for(let phase=0;phase<3;phase++){
  if(phase===1)writeFileSync(join(cwd,'policies.ts'),v2);
  const before=session.sessionManager.getBranch().length,start=Date.now();
  const timer=setTimeout(()=>{error='90s phase deadline';void session.abort();},90000);
  try{await session.prompt(`${policy} Do not modify policies.ts. ${tasks[phase]}`);}catch(e){error=String(e);}finally{clearTimeout(timer);}
  const entries=session.sessionManager.getBranch().slice(before) as any[],msgs=entries.filter(e=>e.type==='message').map(e=>e.message);
  let filesystemPassed=false;try{const got=JSON.parse(readFileSync(join(cwd,`answer${phase+1}.json`),'utf8'));const want=expected[phase] as any;filesystemPassed=Object.keys(got).length===Object.keys(want).length&&Object.entries(want).every(([k,v])=>got[k]===v);}catch{}
  const results=msgs.filter(m=>m.role==='toolResult'),usage=msgs.filter(m=>m.role==='assistant');
  const providerErrors=usage.filter(m=>m.stopReason==='error').map(m=>m.errorMessage);
  const logs=entries.filter(e=>e.customType==='jev-context').map(e=>e.data),sieve=logs.filter(e=>e.kind==='sieve');
  phases.push({phase:phase+1,passed:filesystemPassed&&!error&&!providerErrors.length,filesystemPassed,error,providerErrors,ms:Date.now()-start,reads:results.filter(m=>m.toolName==='read').length,bashCalls:results.filter(m=>m.toolName==='bash').length,toolErrors:results.filter(m=>m.isError).length,toolErrorMessages:results.filter(m=>m.isError).map(m=>textOf(m.content).replaceAll(cwd,'<fixture>')),actions:msgs.filter(m=>m.role==='assistant').flatMap(m=>m.content??[]).filter(c=>c.type==='toolCall').map(c=>({name:c.name,args:JSON.parse(JSON.stringify(c.arguments).replaceAll(cwd,'<fixture>'))})),returnedTokens:results.filter(m=>['read','bash','context_recall'].includes(m.toolName)).reduce((s,m)=>s+estimateTokens(textOf(m.content)),0),inputTokens:usage.reduce((s,m)=>s+(m.usage?.input??0),0),cacheRead:usage.reduce((s,m)=>s+(m.usage?.cacheRead??0),0),rewrites:logs.filter(e=>e.acted).length,hiddenTokens:logs.filter(e=>e.acted).reduce((s,e)=>s+(e.from??0)-(e.to??0),0),jevDecisions:sieve.length,jevFailures:sieve.filter(e=>/unavailable|invalid|failure/i.test(e.skip??'')).length,recalls:results.filter(m=>m.toolName==='context_recall').length});
  console.log(JSON.stringify({condition,rep,...phases.at(-1)}));if(error)break;
 }
 const sourcePreserved=readFileSync(join(cwd,'policies.ts'),'utf8')===v2;
 rows.push({condition,rep,passed:phases.length===3&&phases.every(p=>p.passed)&&sourcePreserved,sourcePreserved,phases});session.dispose();
 writeFileSync(values.out,JSON.stringify({model:'antigravity/gemini-3.8-flash',method:'Synthetic 100-function source registry, same tools and active production plugin. Whole-file instruction vs task-directed search/ranges. Three sequential filesystem-graded questions: initial dependency, changed current vs historical value, delayed previously unrequested dependency. Paired repetitions with reversed order on even reps. No private content sent. This tests tool use, not semantic compression.',sourceLines:v1.split('\n').length,sourceTokens:estimateTokens(v1),rows},null,2));
}
