import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { longVitestLog, packageJson } from "../builder.ts";
import type { Answer, Question } from "../experimental/jev.ts";
import { choice, type FakePi, fakeJudge, noul, setup } from "./harness.ts";

const LOG = longVitestLog();

/** Write-time answers: "specific_parts", every failure line is key. Old-item answers: DROP. */
const trimJudge = (need = "specific_parts") =>
	fakeJudge((k: string, q: Question, state: any): Answer | undefined => {
		if (k === "need") return choice(need, 0.97, 0.95);
		// sieve block questions: judge the block's own text
		if (/^b\d+$/.test(k)) return noul(/FAIL|failed|Expected|×|\.ts:\d+/.test(String(state?.blocks?.[k] ?? "")) ? 0.9 : 0.02);
		if (k === "user_asked") return noul(0.05);
		if (k === "decision") return choice("DROP", 0.95, 0.9);
		if (q.type === "noul") return noul(/FAIL|failed|Expected|×|\.ts:\d+/.test(q.instructions) ? 0.9 : 0.1);
		return undefined;
	});

const seen: FakePi[] = [];
afterEach(() => {
	// pi-jev-context must never inject messages or start a turn.
	for (const pi of seen.splice(0)) assert.deepEqual(pi.sent, []);
});
const track = <T extends { pi: FakePi }>(x: T) => (seen.push(x.pi), x);

describe("write-time trimming", () => {
	it("mode on: shortens a long log to verbatim key lines and stores the original losslessly", async () => {
		const { pi } = track(setup({ judge: trimJudge(), config: { mode: "on" } }));
		pi.user("CI is red. Fix whatever fails.");
		const r = await pi.tool("bash", { command: "npx vitest run" }, LOG, { isError: true });
		assert.ok(r.patch, "result replaced");
		assert.match(r.text, /^\[pi-jev-context\] Output shortened: \d+ of 507 lines kept.*context_recall with id "t1"/);
		for (const k of ["2 failed", "auth.test.ts:42", "expected 401 to be 200", "auth.test.ts:58"]) assert.ok(r.text.includes(k), k);
		// every kept line is an original line
		for (const l of r.text.split("\n").slice(1)) if (!l.startsWith("… [")) assert.ok(LOG.split("\n").includes(l), l);
		// sieve contract: a rewrite hides at least minHiddenShare (30%) of the tokens
		assert.ok(r.text.length < LOG.length * 0.7);
		const recalled = await pi.recall({ id: "t1" });
		assert.equal(recalled.split("\n").slice(1).join("\n"), LOG);
		assert.equal(pi.logs("trim")[0].acted, true);
	});

	it("recall supports line ranges and says where to continue", async () => {
		const { pi } = track(setup({ judge: trimJudge(), config: { mode: "on" } }));
		pi.user("fix CI");
		const { id } = await pi.tool("bash", { command: "npx vitest run" }, LOG);
		const part = await pi.recall({ id, offset: 10, limit: 5 });
		assert.match(part, /lines 10-14 of 507\. More: offset 15\./);
		assert.deepEqual(part.split("\n").slice(1), LOG.split("\n").slice(9, 14));
	});

	it("is deterministic: the same output gives byte-identical replacement text", async () => {
		const a = setup({ judge: trimJudge(), config: { mode: "on" } });
		const b = setup({ judge: trimJudge(), config: { mode: "on" } });
		for (const x of [a, b]) x.pi.user("fix CI");
		const ra = await a.pi.tool("bash", { command: "npx vitest run" }, LOG);
		const rb = await b.pi.tool("bash", { command: "npx vitest run" }, LOG);
		assert.equal(ra.text, rb.text);
	});

	it("keeps the output whole when Jev says every line is needed", async () => {
		const { pi } = track(setup({ judge: trimJudge("every_line"), config: { mode: "on" } }));
		pi.user("list every test");
		const r = await pi.tool("bash", { command: "npx vitest run" }, LOG);
		assert.equal(r.patch, undefined);
		assert.equal(r.text, LOG);
		assert.match(pi.logs("trim")[0].skip, /every_line/);
	});

	it("fails open when Jev errors or is not configured", async () => {
		const failing = track(setup({ judge: fakeJudge(() => undefined, { error: "timeout" }), config: { mode: "on" } }));
		failing.pi.user("fix CI");
		assert.equal((await failing.pi.tool("bash", { command: "npx vitest run" }, LOG)).patch, undefined);
		assert.match(failing.pi.logs("trim")[0].skip, /jev unavailable: timeout/);
		const none = track(setup({ judge: null, config: { mode: "on" } }));
		none.pi.user("fix CI");
		assert.equal((await none.pi.tool("bash", { command: "npx vitest run" }, LOG)).patch, undefined);
	});

	it("never judges reads, file viewers, short outputs or image results", async () => {
		const judge = trimJudge();
		const { pi } = track(setup({ judge, config: { mode: "on" } }));
		pi.user("look around");
		await pi.tool("read", { path: "src/big.ts" }, LOG);
		await pi.tool("bash", { command: "cat src/big.ts" }, LOG);
		await pi.tool("bash", { command: "git diff" }, LOG);
		await pi.tool("bash", { command: "npm test" }, "ok\n".repeat(20));
		const img = await pi.emit("tool_result", { toolCallId: "x", toolName: "bash", input: { command: "screenshot" }, content: [{ type: "image", data: "", mimeType: "image/png" }, { type: "text", text: LOG }], isError: false });
		assert.equal(img, undefined);
		assert.equal(judge.calls.length, 0);
	});

	it("shadow mode never changes the result and logs what it would have done", async () => {
		const { pi } = track(setup({ judge: trimJudge(), config: { mode: "shadow" } }));
		pi.user("fix CI");
		const r = await pi.tool("bash", { command: "npx vitest run" }, LOG);
		assert.equal(r.patch, undefined);
		await pi.flush();
		const [log] = pi.logs("trim");
		assert.equal(log.acted, false);
		assert.ok(log.to < log.from);
	});

	it("off mode does nothing, but context_recall stays registered (tool list is part of the cached prefix)", async () => {
		const judge = trimJudge();
		const { pi } = track(setup({ judge, config: { mode: "off" } }));
		pi.user("fix CI");
		assert.equal((await pi.tool("bash", { command: "npx vitest run" }, LOG)).patch, undefined);
		assert.equal(judge.calls.length, 0);
		assert.ok(pi.tools.has("context_recall"));
		assert.match(await pi.recall({ id: "t9" }), /No shortened output with id "t9"/);
	});

	it("parallel results get distinct aliases, and aliases survive a rebuild", async () => {
		const { pi } = track(setup({ judge: trimJudge(), config: { mode: "on" } }));
		pi.user("fix CI");
		const [a, b] = await Promise.all([pi.tool("bash", { command: "npx vitest run a" }, LOG), pi.tool("bash", { command: "npx vitest run b" }, `${LOG}\n`)]);
		const ids = [a.text, b.text].map((t) => /id "(t\d+)"/.exec(t)![1]);
		assert.notEqual(ids[0], ids[1]);
		await pi.emit("session_start", { reason: "resume" });
		assert.equal((await pi.recall({ id: ids[1]! })).split("\n").slice(1).join("\n"), `${LOG}\n`);
		const c = await pi.tool("bash", { command: "npx vitest run c" }, LOG);
		assert.match(c.text, /id "t3"/);
	});
});

describe("never touches the model's context", () => {
	it("the context handler returns nothing, even when the cache is cold or the model changed", async () => {
		const { pi } = track(setup({ judge: trimJudge(), config: { mode: "on" } }));
		pi.user("hi");
		await pi.assistantReply("hello");
		pi.now += 10 * 60_000;
		assert.equal(await pi.emit("context", { messages: [] }), undefined);
		await pi.emit("model_select", {});
		assert.equal(await pi.emit("context", { messages: [] }), undefined);
		assert.deepEqual(pi.logs("cold").map((c) => c.reason), ["idle gap", "model changed"]);
	});

	it("logs cache usage for calls after an idle gap", async () => {
		const { pi } = track(setup({ judge: trimJudge() }));
		pi.user("hi");
		await pi.assistantReply("a");
		pi.now += 90_000;
		await pi.assistantReply("b", { input: 20, cacheRead: 0, cacheWrite: 9000 });
		assert.deepEqual(pi.logs("cache").map((c) => [c.gapMs, c.cacheRead]), [[90_000, 0]]);
	});
});

describe("old-context pruning (shadow)", () => {
	it("judges old results, protects the current request, drops exact repeats without Jev, never drops durable sources", async () => {
		const judge = trimJudge();
		const { pi, ext } = track(setup({ judge, config: { mode: "on", trim: { ...(await import("../experimental/trim.ts")).DEFAULT_TRIM, minLines: 100000 } } }));
		const big = (s: string) => `${s}\n${"line of output\n".repeat(80)}`;
		pi.user("first task");
		const pkg = await pi.tool("bash", { command: "cat package.json" }, `${packageJson()}\n${" ".repeat(800)}`);
		const t1 = await pi.tool("bash", { command: "npm test" }, big("FAIL a"));
		const t2 = await pi.tool("bash", { command: "npm test" }, big("FAIL a"));
		pi.user("second task");
		const current = await pi.tool("bash", { command: "npm run build" }, big("built"));
		await pi.emit("agent_settled");
		await ext.settled();
		const byId = Object.fromEntries(pi.logs("prune").map((p) => [p.toolCallId, p]));
		assert.equal(byId[current.id], undefined, "current request protected");
		assert.equal(byId[t1.id].decision, "DROP");
		assert.equal(byId[t1.id].raw, undefined, "exact repeat decided without Jev");
		assert.notEqual(byId[pkg.id].decision, "DROP", "durable source never dropped");
		assert.equal(byId[pkg.id].decision, "TRUNCATE");
		assert.ok(byId[t2.id]);
		// Same goal: no re-judging. New user message: judged again.
		const n = judge.calls.length;
		await pi.emit("agent_settled");
		await ext.settled();
		assert.equal(judge.calls.length, n);
		pi.user("third task");
		await pi.emit("agent_settled");
		await ext.settled();
		assert.ok(judge.calls.length > n);
	});

	it("/context report summarises trims, shadow decisions and cache observations", async () => {
		const { pi } = track(setup({ judge: trimJudge(), config: { mode: "on" } }));
		pi.user("fix CI");
		await pi.tool("bash", { command: "npx vitest run" }, LOG);
		await pi.command("/context report");
		assert.match(pi.notes.at(-1)!, /trimmed: 1 outputs/);
		await pi.command("/context mode shadow");
		assert.match(pi.notes.at(-1)!, /mode: shadow/);
	});
});

describe("v0.2 write-time guards", () => {
	it("keeps every failure line even when Jev says only the outcome matters and selects nothing", async () => {
		const outcome = fakeJudge((k) => (k === "need" ? choice("outcome_only", 0.94, 0.9) : k === "user_asked" ? noul(0.02) : noul(0.05)));
		const { pi } = track(setup({ judge: outcome, config: { mode: "on" } }));
		pi.user("run the tests then say DONE");
		const r = await pi.tool("bash", { command: "./run-tests.sh" }, LOG, { isError: true });
		assert.ok(r.patch);
		for (const k of ["refreshes an expired session", "retries the original request after refresh", "auth.test.ts:42", "auth.test.ts:58", "expected 1 to be 2"]) assert.ok(r.text.includes(k), k);
		assert.match(r.text.split("\n")[0]!, /You cannot see the omitted lines; before relying on anything not shown here, call context_recall with id "t1"/);
	});

	it("reads mode and key file from the settings file; env overrides the file", async () => {
		const { writeFileSync, mkdtempSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { createJevContext } = await import("./index-v03.ts");
		const { FakePi } = await import("./harness.ts");
		const dir = mkdtempSync(`${tmpdir()}/jctx-`);
		writeFileSync(`${dir}/s.json`, JSON.stringify({ mode: "on", envFile: `${dir}/.env` }));
		writeFileSync(`${dir}/.env`, "OPENROUTER_API_KEY=sk-test\n");
		const a = createJevContext(new FakePi().api(), { env: {}, settingsPath: `${dir}/s.json` });
		assert.equal(a.config.mode, "on");
		assert.equal(a.hasJudge, true);
		const b = createJevContext(new FakePi().api(), { env: { PI_JEV_CONTEXT_MODE: "off" }, settingsPath: `${dir}/s.json` });
		assert.equal(b.config.mode, "off");
		const c = createJevContext(new FakePi().api(), { env: {}, settingsPath: `${dir}/missing.json` });
		assert.equal(c.config.mode, "shadow");
		assert.equal(c.hasJudge, false);
	});
});

describe("warm-up", () => {
	it("warms Jev at session start and again on input after a long idle, never when off", async () => {
		let warms = 0;
		const judge = { ...fakeJudge(() => undefined), warm: () => (warms++, Promise.resolve({ ms: 1 })) };
		const { pi, ext } = track(setup({ judge, config: { mode: "on", rewarmAfterMs: 0 } }));
		await pi.emit("session_start", { reason: "startup" });
		assert.equal(warms, 1);
		await new Promise((r) => setTimeout(r, 2));
		await pi.emit("input", { text: "hi", source: "interactive" });
		assert.equal(warms, 2);
		ext.config.mode = "off";
		await pi.emit("session_start", { reason: "startup" });
		assert.equal(warms, 2);
	});
});
