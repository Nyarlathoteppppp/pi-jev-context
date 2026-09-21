// Real-session checkpoint replay through AgentSession.compact(). Raw content stays private.
import { SessionManager } from './runtime.ts';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { isolatedSession } from './runtime.ts';
import { resolveTransport } from '../experimental/jev.ts';
const settings = JSON.parse(readFileSync(join(homedir(),'.pi/agent/pi-jev-context.json'),'utf8'));
const transport=resolveTransport(process.env,settings.envFile);
if(!transport||!transport.url.includes('typesafe.ai'))throw new Error('Official Jev transport required');
process.env.TYPESAFE_API_KEY=transport.key;
const upstream = process.env.WANG_EXTENSION ?? '/tmp/pi-jev-compaction-mvp/extensions/index.ts';
const files:string[]=[];
function walk(dir:string){ for(const item of readdirSync(dir,{withFileTypes:true})){const p=join(dir,item.name);if(item.isDirectory())walk(p);else if(p.endsWith('.jsonl'))files.push(p);} }
walk(join(homedir(),'.pi/agent/sessions'));
const cases:any[]=[];
for(const file of files.sort()) {
 const entries=readFileSync(file,'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s));
 const point=entries.findIndex(e=>e.type==='compaction');
 if(point<0)continue;
 const before=entries.slice(0,point);const count=before.filter(e=>e.type==='message').length;
 if(JSON.stringify(before.filter(e=>e.type==='message')).length<20000)continue;
 if(count<20)continue;
 cases.push({id:`C${cases.length+1}`,entries:before,leaf:entries[point].parentId});
 if(cases.length===5)break;
}
mkdirSync('results-private',{recursive:true});
writeFileSync('results-private/compaction-mvp-inputs.json',JSON.stringify(cases));
const results:any[]=[];
for(const c of cases) for(const mode of ['native','wang']) {
 const manager=SessionManager.inMemory(process.cwd(),undefined,structuredClone(c.entries)); manager.branch(c.leaf);
 const session=await isolatedSession(process.cwd(),manager,mode==='wang'?[upstream]:[]);
 const started=Date.now();
 try {
  const result=await session.compact();
  const row={case:c.id,mode,ms:Date.now()-started,summaryChars:result.summary.length,estimatedTokensAfter:result.estimatedTokensAfter,tokensBefore:result.tokensBefore,firstKeptEntryId:result.firstKeptEntryId,source:(result.details as any)?.source??'native'};
  results.push(row);console.log(JSON.stringify({...row,details:undefined}));
  writeFileSync(`results-private/compaction-${c.id}-${mode}.json`,JSON.stringify(result,null,2));
 }catch(error){const row={case:c.id,mode,error:String(error)};results.push(row);console.log(JSON.stringify(row));}
 finally{session.dispose();writeFileSync('results/compaction-mvp.json',JSON.stringify(results,null,2));}
}
