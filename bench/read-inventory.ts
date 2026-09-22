// Local aggregate inventory. Never emits session text, paths, or arguments.
import {readdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,basename} from 'node:path';
import {parseArgs} from 'node:util';
import {textOf,estimateTokens} from '../src/extract.ts';
const {values}=parseArgs({options:{out:{type:'string'}}});
if(!values.out||existsSync(values.out))throw Error('Supply a new --out');
const root=join(homedir(),'.pi/agent/sessions');
const groups:Record<string,any>={};let sessions=0;
for(const file of readdirSync(root,{recursive:true,encoding:'utf8'}).filter(f=>f.endsWith('.jsonl')&&!/(?:private-tmp|--tmp-|pi-itest)/.test(f))){
 sessions++;const nodes=new Map<string,any>();
 for(const line of readFileSync(join(root,file),'utf8').split('\n')){
  let e:any;try{e=JSON.parse(line);}catch{continue;}if(!e.id)continue;nodes.set(e.id,e);
  const m=e.message;if(e.type!=='message'||m?.role!=='toolResult'||m.toolName!=='read'||m.isError||!Array.isArray(m.content)||m.content.some((c:any)=>c.type!=='text'))continue;
  let args:any,users=0,prior:any;const earlier:any[]=[];
  for(let p=nodes.get(e.parentId);p;p=nodes.get(p.parentId)){
   const pm=p.message;if(pm?.role==='user')users++;
   if(pm?.role==='assistant')for(const c of pm.content??[])if(c.type==='toolCall'&&c.id===m.toolCallId)args=c.arguments;
   earlier.push({p,users});
  }
  if(typeof args?.path!=='string')continue;
  const text=textOf(m.content),tokens=estimateTokens(text),path=args.path;
  const kind=/^(?:SKILL|AGENTS)\.md$/i.test(basename(path))?'agent-instructions':/\.(?:md|txt|rst)$/i.test(path)?'docs':/\.(?:json|jsonl|ya?ml|toml|lock)$/i.test(path)?'structured-data':/\.(?:ts|tsx|js|jsx|py|go|rs|swift|sh|css|html)$/i.test(path)?'source-code':'other';
  const g=groups[kind]??={reads:0,tokens:0,longReads:0,longTokens:0,exactRepeatReads:0,exactRepeatTokens:0,crossUserRepeatReads:0,crossUserRepeatTokens:0,unboundedReads:0,unboundedTokens:0,truncated:0};
  g.reads++;g.tokens+=tokens;if(args.offset===undefined&&args.limit===undefined){g.unboundedReads++;g.unboundedTokens+=tokens;}if(tokens>=3000){g.longReads++;g.longTokens+=tokens;}g.truncated+=Number(/\[Showing |output truncated/i.test(text));
  // Match exact supplied path + offset + limit, on ancestor branch only. Potential redundancy, not safe-removal evidence.
  const calls=new Map<string,any>();for(const {p} of earlier)if(p.message?.role==='assistant')for(const c of p.message.content??[])if(c.type==='toolCall')calls.set(c.id,c.arguments);
  for(const {p,users:u} of earlier){const pm=p.message,a=calls.get(pm?.toolCallId);if(pm?.role==='toolResult'&&pm.toolName==='read'&&a?.path===path&&(a.offset??1)===(args.offset??1)&&a.limit===args.limit){prior={text:textOf(pm.content),users:u};break;}}
  if(prior?.text===text){g.exactRepeatReads++;g.exactRepeatTokens+=tokens;if(prior.users){g.crossUserRepeatReads++;g.crossUserRepeatTokens+=tokens;}}
 }
}
const result={scope:'Local non-temporary sessions; all read entries, ancestry-only comparisons to latest read of identical literal path/offset/limit. No visibility, age, mutation or compaction safety inference. Tokens estimated as chars/4.',sessions,groups};
writeFileSync(values.out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
