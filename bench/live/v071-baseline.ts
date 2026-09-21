import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createJevContext } from '../../src/index.ts';
import { classifyBashCommand } from '../fixtures/v070/bash-classifier.ts';
import { searchOriginals } from '../fixtures/v070/recall.ts';
// Tool declaration, session storage and exact line retrieval are identical;
// only the search-result response uses the frozen v0.7.0 implementation.
export default function(pi:ExtensionAPI){
 let state:ReturnType<typeof createJevContext>;
 const proxy=Object.create(pi);
 proxy.on=(name:any,handler:any)=>pi.on(name,((event:any,ctx:any)=>{
  if(name==='tool_result'&&event.toolName==='bash'&&!classifyBashCommand(event.input.command??''))return;
  return handler(event,ctx);
 }) as any);
 proxy.registerTool=(tool:any)=>pi.registerTool({...tool,async execute(...args:any[]){
  const params=args[1];
  if(params.query===undefined)return tool.execute(...args);
  const source=params.id?[...state.originals.values()].find(s=>s.alias===params.id||s.toolCallId===params.id):undefined;
  const r=searchOriginals(params.id?(source?[source]:[]):state.originals.values(),params.query,params.budget??800,params.offset??1);
  pi.appendEntry('jev-context',{kind:'recall',alias:params.id??'*',query:params.query,found:r.hits>0});
  return {content:[{type:'text',text:r.text}],details:{hits:r.hits,returned:r.returned}};
 }});
 state=createJevContext(proxy);
}
