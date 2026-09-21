// Exact v0.6 tool declaration ablation; same original store and line-recall implementation.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import extension from '../../src/index.ts';
export default function(pi:ExtensionAPI){
 const proxy=Object.create(pi);
 proxy.registerTool=(tool:any)=>{
  const parameters=Type.Object({id:Type.String({description:'The id from the [pi-jev-context] header, e.g. t3'}),offset:Type.Optional(Type.Number({description:'First output line to return (1-based, not file line)'})),limit:Type.Optional(Type.Number({description:'Maximum number of lines (default 2000)'}))});
  pi.registerTool({...tool,parameters,description:'Return the full original text of a tool output that pi-jev-context shortened. Use the id from the collapse marker.',promptSnippet:'context_recall: get the full original of a tool output shortened by pi-jev-context'});
 };
 extension(proxy);
}
