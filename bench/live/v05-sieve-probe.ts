// Diagnostic eligibility probe, not a model capability benchmark.
import {Jev,resolveTransport} from '../../src/jev.ts';
import {planSieve} from '../../src/sieve.ts';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
const settings=JSON.parse(readFileSync(join(homedir(),'.pi/agent/pi-jev-context.json'),'utf8'));
const transport=resolveTransport(process.env,settings.envFile);if(!transport)throw Error('No key');
const judge=new Jev(transport);
let probabilities:number[]=[];let need:unknown;
const text=Array.from({length:480},(_,i)=>`PASS routine case ${i} completed successfully with ordinary diagnostic padding`).join('\n')+'\nFAIL auth: must be enabled\nError: disabled\n    at auth (suite.js:22:3)\nTests: 1 failed, 480 passed';
const plan=await planSieve({async decide(s,q,t){const r=await judge.decide(s,q,t);need=r.answers?.need;probabilities=Object.entries(r.answers??{}).filter(([k])=>k.startsWith('b')).map(([,v])=>(v as any).noul);return r;}},[{role:'user',content:'Fix auth.'}],{toolName:'bash',toolCallId:'probe',input:{command:'npm test'},text,isError:false},'t1');
console.log(JSON.stringify({skip:plan.skip,need,blocks:plan.blocks.length,hardKeep:plan.blocks.filter(b=>b.hardKeep).length,hidden:plan.hidden.length,probabilities}));
