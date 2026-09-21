import assert from 'node:assert/strict';
import {it} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {isolatedSession,SessionManager} from '../bench/live/runtime.ts';
it('actual SDK startup dispatch restores originals before a recall tool executes',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'jev-sdk-recall-'));
 const sm=SessionManager.inMemory(cwd);
 sm.appendCustomEntry('jev-context-original',{alias:'t1',toolCallId:'c1',tool:'bash',summary:'npm test',text:'AuthMiddleware region: au-southeast-2'});
 const session=await isolatedSession(cwd,sm,[resolve('src/index.ts')],['context_recall']);
 try{
  const before=JSON.stringify(session.messages);
  const tool=session.agent.state.tools.find(t=>t.name==='context_recall');assert.ok(tool);
  const result=await tool.execute('recall',{query:'AuthMiddleware'},undefined);
  assert.match(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'),/AuthMiddleware region: au-southeast-2/);
  assert.equal(JSON.stringify(session.messages),before);
 }finally{session.dispose();rmSync(cwd,{recursive:true,force:true});}
});
