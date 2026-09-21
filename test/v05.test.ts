import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyBashCommand, eligibleFreshOutput, splitSieveBlocks, stackTraceLines } from "../src/sieve.ts";
import { DEFAULT_CONFIG, createJevContext } from "../src/index.ts";
import type { Answer, Judge } from "../src/jev.ts";
import { setup, FakePi } from "./harness.ts";

const output = Array.from({ length: 500 }, (_, i) => `routine test output line ${i + 1} with stable diagnostic padding`).join("\n") + "\nTests: 500 passed (500)";
const judge: Judge = {
    async decide(_state, questions) {
        const answers: Record<string, Answer> = {};
        for (const key of Object.keys(questions)) answers[key] = key === "need" ? { type: "choice", choice: "specific_parts", probabilities: { specific_parts: 0.99 }, confidence: 0.99 } : { type: "noul", noul: key === "user_asked" ? 0 : 0.01 };
        return { answers, ms: 1, inputTokens: 100, cost: 0 };
    },
};

describe("v0.5 fresh-output eligibility", () => {
    it("accepts explicit test/build/lint/diagnostic commands and rejects viewers/search", () => {
        assert.equal(classifyBashCommand("npm test"), "test");
        assert.equal(classifyBashCommand("echo test"), undefined);
        assert.equal(classifyBashCommand("printf build"), undefined);
        assert.equal(classifyBashCommand("cd repo && npm run build"), "build");
        assert.equal(classifyBashCommand("npx eslint src"), "lint");
        assert.equal(classifyBashCommand("npm run typecheck"), "diagnostic");
        assert.equal(classifyBashCommand("./run-tests.sh"), "test");
        for (const command of ["cat big.log", "sed -n 1,200p src/a.ts", "git diff", "git show HEAD", "grep error log", "find .", "ls -la", "npm test | tee log", "echo npm test", "npm test && curl example.com", "npm test; python dump.py"]) assert.equal(classifyBashCommand(command), undefined, command);
    });

    it("requires a long successful text output", () => {
        assert.equal(eligibleFreshOutput("bash", { command: "npm test" }, "short", false), undefined);
        assert.equal(eligibleFreshOutput("bash", { command: "npm test" }, output, true), undefined);
        assert.equal(eligibleFreshOutput("bash", { command: "npm test" }, output, false), "test");
    });

    it("protects stack traces as regions, including frames split across blocks", () => {
        const js = "Error: request failed\n    at authenticate (src/auth.ts:42:9)\n    at processRequest (src/server.ts:88:11)\n    at async main (src/main.ts:20:1)\n\nordinary progress";
        const python = "Traceback (most recent call last):\n  File \"src/auth.py\", line 42, in authenticate\n    return refresh(token)\nValueError: invalid token\n\nordinary progress";
        const java = "java.lang.IllegalStateException: bad state\n    at app.Main.run(Main.java:10)\nCaused by: java.io.IOException: broken pipe\n    at app.Client.send(Client.java:20)\n\nordinary progress";
        const go = "panic: invalid state\n\ngoroutine 1 [running]:\nmain.handleRequest(...)\n    /repo/server.go:88 +0x123\n\nordinary progress";
        for (const text of [js, python, java, go]) {
            const lines = stackTraceLines(text);
            assert.ok(lines.size >= 3);
            assert.ok([...lines].some((n) => text.split("\n")[n] === "ordinary progress") === false);
        }
        const split = splitSieveBlocks(js.replace("\n\n", "\n"), { ...DEFAULT_CONFIG.sieveConfig, blockChars: 55, maxBlocks: 20 });
        assert.ok(split && split.filter((b) => b.hardKeep).length >= 2);
        const ordinary = splitSieveBlocks("routine output\n".repeat(20));
        assert.ok(ordinary?.every((b) => !b.hardKeep));
    });
});

describe("v0.5 active sieve", () => {
    it("keeps explicit independent settings above compatibility mode and restores them", async () => {
        const { pi, ext } = setup({ config: { mode: "on", dedupe: "on", sieve: "off" }, judge });
        assert.equal(ext.config.sieve, "off");
        await pi.command("/context mode on");
        assert.equal(ext.config.sieve, "off");
        await pi.command("/context sieve on");
        await pi.command("/context dedupe on");
        await pi.command("/context mode off");
        assert.equal(ext.config.sieve, "on");
        const resumed = new FakePi();
        resumed.entries = structuredClone(pi.entries);
        const resumedExt = createJevContext(resumed.api(), { env: {}, settingsPath: "/nonexistent", judge });
        await resumed.emit("session_start");
        assert.equal(resumedExt.config.sieve, "on");
        assert.equal(resumedExt.config.dedupe, "on");
    });

    it("normalizes invalid numeric settings to conservative defaults", () => {
        const { ext } = setup({ config: { jevThreshold: 2, minHiddenShare: -1, minSavedTokens: -5 } });
        assert.equal(ext.config.jevThreshold, DEFAULT_CONFIG.jevThreshold);
        assert.equal(ext.config.minHiddenShare, DEFAULT_CONFIG.minHiddenShare);
        assert.equal(ext.config.minSavedTokens, DEFAULT_CONFIG.minSavedTokens);
    });

    it("rewrites eligible fresh output, preserves failures, and recalls the original", async () => {
        const { pi } = setup({ judge });
        pi.user("Run the tests and fix any failure.");
        const result = await pi.tool("bash", { command: "npm test" }, output);
        assert.ok(result.patch, "Jev must actively participate");
        assert.ok(result.text.includes("Output shortened"));
        assert.ok(result.text.includes("Tests: 500 passed"));
        const alias = pi.logs("sieve")[0].alias;
        assert.equal((await pi.recall({ id: alias })).split("\n").slice(1).join("\n"), output);
    });

    it("fails open for errors and source viewers without calling Jev", async () => {
        let calls = 0;
        const counting: Judge = { async decide() { calls++; return judge.decide({}, {}); } };
        const { pi } = setup({ judge: counting });
        assert.equal((await pi.tool("bash", { command: "npm test" }, output, { isError: true })).patch, undefined);
        assert.equal((await pi.tool("bash", { command: "git diff" }, output)).patch, undefined);
        assert.equal((await pi.tool("bash", { command: "grep error log" }, output)).patch, undefined);
        assert.equal(calls, 0);
    });
});

// Test actual strings and every source line, rather than merely a nonzero guard count.
describe("v0.5 hardening acceptance", () => {
 it("hard-keeps complete traces across blocks while PASS regions remain hideable", () => {
  const traces = [
   ['Error: broken', ...Array.from({length:18},(_,i)=>`    at worker${i} (app.ts:${i+1}:2)`)],
   ['Traceback (most recent call last):', ...Array.from({length:10},(_,i)=>[`  File "app.py", line ${i+1}, in run`, '    return nested(value)']).flat(), 'ValueError: broken'],
   ['java.lang.RuntimeException: broken', ...Array.from({length:12},(_,i)=>'    at app.Main.work(Main.java:42)'), 'Caused by: java.io.IOException: closed', '    at app.Socket.send(Socket.java:23)', '    ... 12 more'],
   ['panic: broken', '', 'goroutine 1 [running]:', 'main.worker()', '    /repo/main.go:44 +0x12', 'main.main()', '    /repo/main.go:55 +0x34'],
  ];
  for(const trace of traces){
   const text=[...trace,'',...Array.from({length:60},(_,i)=>`PASS ordinary case ${i}`)].join('\n');
   const blocks=splitSieveBlocks(text,{...DEFAULT_CONFIG.sieveConfig,blockChars:100,maxBlocks:100})!;
   trace.forEach((line,i)=>{if(line.trim())assert.ok(blocks.find(b=>b.fromLine<=i+1&&b.toLine>=i+1)?.hardKeep,`${line} was unprotected`);});
   assert.ok(blocks.some(b=>!b.hardKeep&&b.text.includes('PASS ordinary')));
  }
 });
 it("explicit dedupe on overrides shadow in behavior, not only config",async()=>{
  const {pi}=setup({config:{mode:'shadow',dedupe:'on',sieve:'off'}});
  const text=Array.from({length:200},(_,i)=>`const value${i} = ${i};`).join('\n');
  await pi.tool('read',{path:'a.ts'},text);assert.ok((await pi.tool('read',{path:'a.ts'},text)).patch);
 });
 it("checks all invalid numeric forms and valid endpoints",()=>{
  for(const value of [NaN,Infinity,-Infinity,-1,'0','1','invalid',null,{},true]){
   const {ext}=setup({config:{jevThreshold:value,minHiddenShare:value,minSavedTokens:value} as any});
   assert.equal(ext.config.jevThreshold,0.10);assert.equal(ext.config.minHiddenShare,0.30);assert.equal(ext.config.minSavedTokens,1000);
  }
  assert.equal(setup({config:{minSavedTokens:Number.MAX_VALUE}}).ext.config.minSavedTokens,1000);
  assert.equal(setup({config:{minSavedTokens:0.9}}).ext.config.minSavedTokens,0.9);
  for(const value of [2,Number.MAX_VALUE]){const {ext}=setup({config:{jevThreshold:value,minHiddenShare:value}});assert.equal(ext.config.jevThreshold,0.10);assert.equal(ext.config.minHiddenShare,0.30);}
  for(const value of [0,1]){const {ext}=setup({config:{jevThreshold:value,minHiddenShare:value,minSavedTokens:value}});assert.equal(ext.config.jevThreshold,value);assert.equal(ext.config.minHiddenShare,value);assert.equal(ext.config.minSavedTokens,value);}
  const {ext}=setup({env:{PI_JEV_CONTEXT_MIN_HIDDEN_SHARE:'',PI_JEV_CONTEXT_MIN_SAVED_TOKENS:' ',PI_JEV_CONTEXT_JEV_THRESHOLD:'Infinity'}});
  assert.equal(ext.config.minHiddenShare,0.30);assert.equal(ext.config.minSavedTokens,1000);assert.equal(ext.config.jevThreshold,0.10);
 });
});
