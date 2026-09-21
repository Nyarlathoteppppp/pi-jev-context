// Benchmark-only ablation: v0.6 recall declaration, same persistence and line retrieval.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import extension from '../../src/index.ts';
export default function(pi:ExtensionAPI){
 const proxy=Object.create(pi);
 proxy.registerTool=(tool:any)=>{
  const parameters=Type.Object({id:Type.String(),offset:Type.Optional(Type.Number()),limit:Type.Optional(Type.Number())});
  pi.registerTool({...tool,parameters,description:'Retrieve saved original output by id with optional offset and limit.',promptSnippet:'context_recall: retrieve original lines by id'});
 };
 extension(proxy);
}
