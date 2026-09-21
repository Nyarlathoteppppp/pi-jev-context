// Local, offline comparison. Only aggregates leave this process; never commands or output text.
import { readdirSync,readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { classifyBashCommand as oldClassify } from './fixtures/v070/bash-classifier.ts';
import { classifyBashCommand, eligibleFreshOutput } from '../src/sieve.ts';
import { literalCommandArgs } from '../src/bash-command.ts';
import { estimateTokens,textOf } from '../src/extract.ts';
const root=join(homedir(),'.pi/agent/sessions');
const counts={sessions:0,bashResults:0,longResults:0,oldClassified:0,newClassified:0,newlyClassified:0,noLongerClassified:0,newlyClassifiedLong:0,newEligible:0,newEligibleUntruncated:0};
const newlyClassifiedKinds:Record<string,number>={};
const noLongerClassifiedReasons:Record<string,number>={};
for(const file of readdirSync(root,{recursive:true,encoding:'utf8'}).filter(f=>f.endsWith('.jsonl')&&!/(?:private-tmp|--tmp-|pi-itest)/.test(f))){
 counts.sessions++;const calls=new Map<string,any>();
 for(const line of readFileSync(join(root,file),'utf8').split('\n')){
  let e:any;try{e=JSON.parse(line);}catch{continue;}
  const m=e.type==='message'?e.message:undefined;if(!m)continue;
  if(m.role==='assistant')for(const c of m.content??[])if(c.type==='toolCall')calls.set(c.id,c.arguments??{});
  if(m.role!=='toolResult'||m.toolName!=='bash'||!Array.isArray(m.content))continue;
  const input=calls.get(m.toolCallId)??{},command=String(input.command??''),text=textOf(m.content);
  const old=oldClassify(command),next=classifyBashCommand(command),long=estimateTokens(text)>=3000;
  counts.bashResults++;counts.longResults+=Number(long);counts.oldClassified+=Number(!!old);counts.newClassified+=Number(!!next);
  if(next&&!old){counts.newlyClassified++;counts.newlyClassifiedLong+=Number(long);newlyClassifiedKinds[next]=(newlyClassifiedKinds[next]??0)+1;}
  if(old&&!next){
   counts.noLongerClassified++;
   const args=literalCommandArgs(command);
   const reason=args?.[0]==='npx'&&['-y','--yes'].includes(args[1]??'')?'npx -y/--yes':command.includes('$')?'dynamic expansion outside supported literal grammar':/\b(?:exec|install|add)\b/.test(command)?'operand/subcommand mismatch':'other unsupported literal grammar';
   noLongerClassifiedReasons[reason]=(noLongerClassifiedReasons[reason]??0)+1;
  }
  const eligible=m.content.every((c:any)=>c.type==='text')&&!!eligibleFreshOutput('bash',input,text,!!m.isError);
  counts.newEligible+=Number(eligible);counts.newEligibleUntruncated+=Number(eligible&&!m.details?.truncation?.truncated&&!/\[Showing [^\n]*Full output:/.test(text));
 }
}
console.log(JSON.stringify({scope:'All branches in non-temporary local sessions; long means >=3000 estimated tokens. Eligibility also considers the production line threshold. No Jev calls or safety labels.',counts,newlyClassifiedKinds,noLongerClassifiedReasons},null,2));
