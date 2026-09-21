// Frozen filesystem grade for common wrappers, using real bash and real Jev.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {isolatedSession} from './runtime.ts';
const {values}=parseArgs({options:{out:{type:'string'}}});
if(!values.out||existsSync(values.out))throw Error('Supply a new --out');
const rows:any[]=[];
for(const condition of ['v070','v071']){
 const cwd=mkdtempSync(join(tmpdir(),'jev-v071-cmd-')),app=join(cwd,'fixture app');mkdirSync(app);
 const script=`const fs=require('fs'); const s=JSON.parse(fs.readFileSync('state.json','utf8'));for(let i=0;i<480;i++)console.log('PASS routine case '+i+' completed successfully with ordinary diagnostic padding');if(!s.fixed)console.log('FAIL auth: state.json fixed must be true\\nError: disabled\\n    at auth (suite.cjs:1:1)');console.log('Tests: '+(s.fixed?'480 passed':'1 failed, 480 passed'));if(!s.fixed)process.exitCode=1;`;
 writeFileSync(join(app,'suite.cjs'),script);writeFileSync(join(app,'state.json'),'{"fixed":false}');const pkg=JSON.stringify({scripts:{test:'node suite.cjs'}});writeFileSync(join(app,'package.json'),pkg);
 process.env.PI_JEV_CONTEXT_DEDUPE='off';process.env.PI_JEV_CONTEXT_SIEVE='on';
 const session=await isolatedSession(cwd,undefined,[resolve(condition==='v070'?'bench/live/v071-baseline.ts':'src/index.ts')],['bash','read','write','edit','context_recall']);
 let error:string|undefined;const start=Date.now();const deadline=setTimeout(()=>{error='benchmark deadline (90s)';void session.abort();},90000);
 const command='cd "fixture app" && CI=1 npm test 2>&1';
 try{
  await session.prompt(`Investigate auth. Execute exactly this bash command: ${command}. Do not edit yet.`);
  if(!error)await session.prompt(`Repair only fixture app/state.json according to the diagnostic, then verify by executing exactly: ${command}. Preserve the test script and package.json.`);
 }catch(e){error=String(e);}finally{clearTimeout(deadline);}
 const entries=session.sessionManager.getBranch() as any[],msgs=entries.filter(e=>e.type==='message').map(e=>e.message),logs=entries.filter(e=>e.customType==='jev-context').map(e=>e.data);
 const commands=msgs.filter(m=>m.role==='assistant').flatMap(m=>m.content).filter(c=>c.type==='toolCall'&&c.name==='bash').map(c=>c.arguments.command);
 let filesystemPassed=false;try{filesystemPassed=JSON.stringify(JSON.parse(readFileSync(join(app,'state.json'),'utf8')))==='{"fixed":true}'&&readFileSync(join(app,'suite.cjs'),'utf8')===script&&readFileSync(join(app,'package.json'),'utf8')===pkg;}catch{}
 const sieve=logs.filter(e=>e.kind==='sieve'),rewrites=sieve.filter(e=>e.acted);
 const row={condition,passed:filesystemPassed&&!error&&commands.filter(c=>c===command).length>=2,filesystemPassed,error,ms:Date.now()-start,exactCommandRuns:commands.filter(c=>c===command).length,otherBashCommands:commands.filter(c=>c!==command).length,jevDecisions:sieve.length,jevFailures:sieve.filter(e=>/unavailable|invalid|failure/i.test(e.skip??'')).length,jevSkips:sieve.filter(e=>e.skip).map(e=>e.skip),rewrites:rewrites.length,hiddenTokens:rewrites.reduce((s,e)=>s+e.from-e.to,0),recalls:logs.filter(e=>e.kind==='recall').length};
 rows.push(row);console.log(JSON.stringify(row));writeFileSync(values.out,JSON.stringify({model:'antigravity/gemini-3.8-flash',command,rows},null,2));session.dispose();
}
