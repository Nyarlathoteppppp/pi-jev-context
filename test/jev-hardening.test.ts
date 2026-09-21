import assert from 'node:assert/strict';
import {it} from 'node:test';
import {Jev,normalizeAnswer} from '../src/jev.ts';
import {planSieve} from '../src/sieve.ts';
import {createServer} from 'node:http';
it('wire probabilities outside [0,1] are rejected, never clamped to hide',()=>{
 for(const noul of [-1,1.1,NaN,Infinity,'0',null])assert.equal(normalizeAnswer({type:'noul',instructions:'needed?'},{noul}),undefined);
});
it('threshold equality keeps blocks; only strictly lower probability hides',async()=>{
 const text='ordinary diagnostic padding and progress\n'.repeat(500);
 for(const p of [0.099,0.10,0.101]){
  const result=await planSieve({async decide(_s,q){return {answers:Object.fromEntries(Object.keys(q).map(k=>[k,k==='need'?{type:'choice',choice:'outcome_only',probabilities:{outcome_only:1},confidence:1}:{type:'noul',noul:k==='user_asked'?0:p}])),ms:1};}},[],{toolName:'bash',toolCallId:'x',input:{command:'npm test'},text,isError:false},'t1');
  assert.equal(result.hidden.length>0,p<0.10);
 }
});
it('real HTTP timeout, malformed, 429 and 5xx all fail open',async()=>{
 const server=createServer((req,res)=>{if(req.url==='/timeout')return;res.setHeader('content-type','application/json');if(req.url==='/malformed'){res.end('{"answers":{"b":{"noul":-1}}}');return;}res.statusCode=Number(req.url!.slice(1));res.setHeader('retry-after','0');res.end('{}');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address() as any;for(const path of ['timeout','malformed','429','503']){const j=new Jev({url:`http://127.0.0.1:${address.port}/${path}`,key:'local-fixture',model:'fixture'});const r=await j.decide({}, {b:{type:'noul',instructions:'needed?'}},60);assert.ok(r.error,path);assert.equal(r.answers,undefined);}}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('missing credentials retain eligible output without creating originals',async()=>{
 const {setup}=await import('./harness.ts');const {pi,ext}=setup({env:{},settingsPath:'/nonexistent',config:{dedupe:'off',sieve:'on'}});
 assert.equal(ext.judge,undefined);
 const text='ordinary diagnostic progress\n'.repeat(500);
 const r=await pi.tool('bash',{command:'npm test'},text);assert.equal(r.patch,undefined);assert.equal(r.text,text);assert.equal(ext.originals.size,0);
});
