// Local-only inventory. Publishes aggregates, never paths, arguments, or output text.
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { estimateTokens, textOf } from '../src/extract.ts';
import { eligibleFreshOutput } from '../src/sieve.ts';
const root=join(homedir(),'.pi/agent/sessions');
const files=readdirSync(root,{recursive:true,encoding:'utf8'}).filter(f=>f.endsWith('.jsonl'));
const groups:Record<string,{count:number,tokens:number,long:number,errors:number,repeatedLineTokens:number,truncated:number,eligible:number}>={};
let sessions=0;
const exclusions:Record<string,number>={};
for(const file of files){
 // Exclude disposable SDK/benchmark working directories; include all dates and branches.
 if(/(?:private-tmp|--tmp-|pi-itest)/.test(file))continue;
 sessions++;
 const calls=new Map<string,any>();
 for(const line of readFileSync(join(root,file),'utf8').split('\n')){
  let e:any;try{e=JSON.parse(line);}catch{continue;}
  const m=e.type==='message'?e.message:undefined;if(!m)continue;
  if(m.role==='assistant')for(const c of m.content??[])if(c.type==='toolCall')calls.set(c.id,c.arguments??{});
  if(m.role!=='toolResult'||!Array.isArray(m.content))continue;
  const text=textOf(m.content),tokens=estimateTokens(text),args=calls.get(m.toolCallId)??{};
  let kind=['read','edit','write','bash','context_recall'].includes(m.toolName)?m.toolName:'other';
  if(kind==='bash'){
   const c=String(args.command??'');
   kind='bash/'+(/\b(?:test|pytest|vitest|jest)\b/.test(c)?'test':/\b(?:build|typecheck|lint|tsc|check)\b/.test(c)?'build-check':/\b(?:rg|grep|find|ls|cat|sed|head|tail)\b/.test(c)?'view-search':/\b(?:install|add|ci)\b/.test(c)?'install':/\bgit\b/.test(c)?'git':'other');
  }
  const g=groups[kind]??={count:0,tokens:0,long:0,errors:0,repeatedLineTokens:0,truncated:0,eligible:0};
  g.count++;g.tokens+=tokens;g.long+=Number(tokens>=3000);g.errors+=Number(!!m.isError);
  const seen=new Set<string>();for(const l of text.split('\n')){if(seen.has(l))g.repeatedLineTokens+=estimateTokens(l);else seen.add(l);}
  g.truncated+=Number(/\[Showing |output truncated/i.test(text));
  g.eligible+=Number(!!eligibleFreshOutput(m.toolName,args,text,!!m.isError));
  if(m.toolName==='bash'&&tokens>=3000){
   const command=String(args.command??'');
   const reason=/[;&|\n]/.test(command)?'shell composition':/^(?:cat|rg|grep|sed|head|tail|find|ls|git)\b/.test(command.trim())?'viewer/search/git':'other unrecognized or guarded';
   exclusions[reason]=(exclusions[reason]??0)+1;
  }
 }
}
console.log(JSON.stringify({sessions,scope:'All local non-temporary session entries, all branches; heuristic bash categories. Repeated lines are not necessarily removable.',groups,longBashShapes:exclusions},null,2));
