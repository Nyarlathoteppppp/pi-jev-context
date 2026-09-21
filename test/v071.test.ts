import assert from 'node:assert/strict';
import { it } from 'node:test';
import { classifyBashCommand } from '../src/sieve.ts';
import { literalCommandArgs } from '../src/bash-command.ts';
import { searchOriginals } from '../src/recall.ts';
it('recognizes common literal directory, environment and stderr wrappers',()=>{
 for(const c of ['cd "my repo" && npm test',"cd 'my repo' && pnpm test",'cd -- ./repo && npm run test','CI=1 npm test','CI=1 env NODE_ENV=test npm test','npm test\n','env CI=1 npm test',"CI='true' NODE_ENV=test npm test",'npm test 2>&1','cd "my repo" && CI=1 npm test 2>&1','npm test -- --grep "a && b; cat"','npx --no-install vitest run','npx -y vitest run','npm run test:unit','npm run test-integration'])assert.equal(classifyBashCommand(c),'test',c);
 assert.deepEqual(literalCommandArgs('cd my\\ repo && CI="1" npm test 2>&1'),['npm','test']);
 assert.equal(classifyBashCommand('npm run build:production'),'build');
 assert.equal(classifyBashCommand('cd repo && CI=1 npm run build 2>&1'),'build');
});
it('does not confuse operands, quote boundaries, or other shell programs with tests',()=>{
 for(const c of ['npm exec echo npm test','echo "npm test"','npm run unknown npm test','npm test && cat config.json','npm test | tail -100','npm test; cat config.json','npm test >result.log','npm test 2>&1 && cat config.json','CI=$(cat config) npm test','CI=`cat config` npm test','cd "$ROOT" && npm test',"cd 'unterminated && npm test",'npm test\ncat config','npm test &','npm test # comment','cd - && npm test','env -S "npm test"','npm test <input','npm test 2>&10'])assert.equal(classifyBashCommand(c),undefined,c);
 assert.equal(classifyBashCommand('npm test "literal $HOME"'),undefined);
 assert.equal(classifyBashCommand("npm test 'literal $HOME'"),'test');
});
it('distinguishes an empty branch, no lexical match, and partial entity matches',()=>{
 const sources=[{alias:'t1',summary:'npm test',text:'AuthMiddleware deployment region: au-southeast-2'}];
 assert.match(searchOriginals([],'region').text,/No saved originals/);
 const absent=searchOriginals(sources,'DatabaseMigration');
 assert.equal(absent.hits,0);assert.match(absent.text,/Available sources: t1/);assert.match(absent.text,/does not establish absence/);
 const partial=searchOriginals(sources,'DatabaseMigration deployment region');
 assert.equal(partial.hits,1);assert.match(partial.text,/No exact identifier match: DatabaseMigration/);assert.match(partial.text,/AuthMiddleware deployment/);assert.match(partial.text,/inspect original lines/);
 const exact=searchOriginals([{...sources[0],text:'AuthMiddleware: ready'}],'AuthMiddleware');assert.doesNotMatch(exact.text,/No exact identifier match/);
 assert.doesNotMatch(searchOriginals(sources,'AuthMiddleware.').text,/No exact identifier match/);
 assert.doesNotMatch(searchOriginals([{alias:'t2',summary:'npm test',text:'/src/auth.ts:42 reported'}],'/src/auth.ts').text,/No exact identifier match/);
});
it('gives exact line access when a chunk cannot fit and reports exhausted pagination',()=>{
 const sources=[{alias:'t1',summary:'npm test',text:'AuthMiddleware '+ 'padding '.repeat(500)}];
 const small=searchOriginals(sources,'AuthMiddleware',5);assert.equal(small.returned,0);assert.match(small.text,/increase budget/);assert.match(small.text,/offset 1, limit 1/);
 assert.match(searchOriginals(sources,'AuthMiddleware',800,2).text,/No further ranked chunks/);
});
