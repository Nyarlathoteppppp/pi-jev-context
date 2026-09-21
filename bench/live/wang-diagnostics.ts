import { readFileSync,writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { isolatedSession, SessionManager } from './runtime.ts';
import { resolveTransport } from '../experimental/jev.ts';
const settings=JSON.parse(readFileSync(join(homedir(),'.pi/agent/pi-jev-context.json'),'utf8'));
const transport=resolveTransport(process.env,settings.envFile);if(!transport)throw new Error('No Jev transport');
process.env.TYPESAFE_API_KEY=transport.key;
const cases=JSON.parse(readFileSync('results-private/compaction-mvp-inputs.json','utf8'));
const results=[];
for(const c of cases){
 const sm=SessionManager.inMemory(process.cwd(),undefined,structuredClone(c.entries));sm.branch(c.leaf);
 const session=await isolatedSession(process.cwd(),sm,[resolve('bench/live/wang-observer.ts')]);
 try{await session.compact();}catch(error){if(!String(error).includes('cancel'))console.error(String(error));}
 const row={case:c.id,events:sm.getBranch().filter((e:any)=>e.customType==='wang-probe').map((e:any)=>e.data)};
 console.log(JSON.stringify(row));results.push(row);session.dispose();
 writeFileSync('results/wang-mvp-diagnostics.json',JSON.stringify(results,null,2));
}
