import assert from 'node:assert/strict';
import { it } from 'node:test';
import { recallChunks, searchOriginals } from '../src/recall.ts';
import { hiddenReferences } from '../src/hints.ts';
import { setup } from './harness.ts';
import { ORIGINAL } from '../src/index.ts';
it('partitions exact original lines and keeps stack regions across nominal chunk boundaries',()=>{
 const text=Array(22).fill('padding').concat('Traceback (most recent call last):','  File "auth.py", line 7, in auth','    refresh(token)','ValueError: expired','','tail').join('\n');
 const chunks=recallChunks(text);assert.equal(chunks.map(c=>c.text).join('\n'),text);
 assert.ok(chunks.some(c=>c.text.includes('Traceback')&&c.text.includes('ValueError')));
});
it('search ranks identifiers, respects whole chunk budgets, and paginates without losing matches',()=>{
 const text=Array.from({length:72},(_,i)=>`AuthMiddleware line ${i}`).join('\n');
 const sources=[{alias:'t1',summary:'npm test',text}];
 const a=searchOriginals(sources,'AuthMiddleware',220);assert.equal(a.hits,3);assert.equal(a.returned,1);assert.match(a.text,/offset 2/);
 const b=searchOriginals(sources,'AuthMiddleware',220,2);assert.match(b.text,/lines 25-48/);
 const tiny=searchOriginals(sources,'AuthMiddleware',1);assert.equal(tiny.returned,0);assert.match(tiny.text,/increase budget/);assert.match(tiny.text,/limit 24/);
 assert.equal(searchOriginals(sources,'unmatched').hits,0);
});
it('hints contain only original references, no invented topic summary',()=>{
 assert.equal(hiddenReferences('plain ordinary words'), '');
 const hint=hiddenReferences('PASS auth.test.ts ERR_TOKEN refreshSession');
 for(const term of ['auth.test.ts','ERR_TOKEN','refreshSession'])assert.ok(hint.includes(term));
});
it('query search reuses persisted originals, source filters, and preserves id-only recall',async()=>{
 const {pi}=setup();pi.entries.push({type:'custom',customType:ORIGINAL,data:{alias:'t1',toolCallId:'c1',tool:'bash',summary:'npm test',text:'JWT_EXPIRED: refreshSession'}});
 await pi.emit('session_start');assert.match(await pi.recall({query:'JWT_EXPIRED'}),/JWT_EXPIRED: refreshSession/);
 assert.match(await pi.recall({id:'c1',query:'JWT'}),/JWT_EXPIRED/);
 assert.match(await pi.recall({id:'unknown',query:'JWT'}),/No lexical matches/);
 assert.ok((await pi.recall({id:'t1'})).endsWith('JWT_EXPIRED: refreshSession'));
 assert.match(await pi.recall({}),/Provide query/);
});
it('closes half-full chunks at blank lines and preserves trailing newlines',()=>{
 const text=Array(13).fill('paragraph').join('\n')+'\n\n'+Array(20).fill('next paragraph').join('\n')+'\n';
 const chunks=recallChunks(text);assert.equal(chunks[0].to,14);assert.equal(chunks.map(c=>c.text).join('\n'),text);
});
