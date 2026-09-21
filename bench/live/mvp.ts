// Two deterministic acceptance fixtures, two paired repetitions; isolated provider + extension only.
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isolatedSession } from './runtime.ts';
const results: any[] = [];
for (const scenario of ['reread-edit', 'delayed-fact']) for (let rep = 1; rep <= 2; rep++) for (const mode of rep === 1 ? ['off', 'on'] : ['on', 'off']) {
 const cwd = mkdtempSync(join(tmpdir(), 'jev-mvp-live-'));
 const lines = Array.from({length: 240}, (_,i)=>`record_${i+1} = "unchanged fixture value ${i+1}"`);
 lines[9] = 'region = "au-southeast-2"'; lines[99] = 'retry_limit = 7';
 writeFileSync(join(cwd,'fixture.txt'),lines.join('\n'));
 process.env.PI_JEV_CONTEXT_MODE = mode;
 const session = await isolatedSession(cwd, undefined, [resolve('src/index.ts')], ['read','write','edit','context_recall']);
 const started = Date.now();
 try {
  await session.prompt('Read fixture.txt with offset 1 and limit 200. Remember its content for my next instruction. Do not write anything yet.');
  // Fresh content must be preserved by dedupe when the second range arrives.
  lines[149] = 'status = "fresh-update"'; writeFileSync(join(cwd,'fixture.txt'),lines.join('\n'));
  await session.prompt(scenario === 'reread-edit'
   ? 'Read fixture.txt with offset 51 and limit 190. Then use edit to change only retry_limit from 7 to 9. Preserve every other line including the fresh status update.'
   : 'Read fixture.txt with offset 51 and limit 190. Write answer.json containing exactly {"region": <region from the first read>, "retry_limit": <current numeric retry limit>, "status": <current status>}.');
  const events = session.sessionManager.getBranch() as any[];
  const acted = events.filter(e=>e.customType==='jev-context' && e.data?.kind==='seen' && e.data.acted);
  let passed = false;
  if(scenario === 'reread-edit') { const expected=[...lines]; expected[99]='retry_limit = 9'; passed=readFileSync(join(cwd,'fixture.txt'),'utf8')===expected.join('\n'); }
  else { try { const a=JSON.parse(readFileSync(join(cwd,'answer.json'),'utf8'));passed=a.region==='au-southeast-2'&&a.retry_limit===7&&a.status==='fresh-update'&&Object.keys(a).length===3; }catch{} }
  const errors = events.filter(e=>e.message?.role==='assistant'&&e.message.stopReason==='error').map(e=>e.message.errorMessage);
  const row={scenario,rep,mode,passed,acted:acted.length,savedTokens:acted.reduce((s,e)=>s+e.data.from-e.data.to,0),errors,ms:Date.now()-started}; results.push(row);console.log(JSON.stringify(row));
 }catch(error){results.push({scenario,rep,mode,error:String(error)});console.log(String(error));}
 finally {session.dispose(); mkdirSync('results',{recursive:true});writeFileSync('results/live-mvp.json',JSON.stringify(results,null,2));}
}
