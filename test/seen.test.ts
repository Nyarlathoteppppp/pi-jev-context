import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collapse, DEFAULT_SEEN, matchingRuns, planCollapse } from "../src/seen.ts";
import type { Message } from "../src/types.ts";
import { fakeJudge, setup } from "./harness.ts";

const file = (n: number, tag = "l") => Array.from({ length: n }, (_, i) => `${tag}${i + 1}: const value${i + 1} = compute(${i + 1});`);
const body = (n: number, tag?: string) => file(n, tag).join("\n");

const readResult = (path: string, text: string, id: string): Message[] => [
	{ role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: { path } }] },
	{ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text }], isError: false },
];

describe("matching runs", () => {
	it("finds contiguous already-shown runs and ignores scattered coincidences", () => {
		const earlier = file(100);
		const next = [...file(100), "brand new line A", "brand new line B"];
		assert.deepEqual(matchingRuns(next, earlier, 30), [{ from: 1, to: 100 }]);
		// Only contiguity counts. Here the earlier text is ["}", l1…l35], so the run starts at the "}"
		// that directly precedes l1 in the new text (line 3), not at l1 itself.
		const scattered = ["}", "}", "}", ...file(40), "}", "}"];
		assert.deepEqual(matchingRuns(scattered, ["}", ...file(40).slice(0, 35)], 30), [{ from: 3, to: 38 }]);
		// Lines that were only ever seen scattered are never a run.
		assert.deepEqual(matchingRuns(file(40), file(40).filter((_, i) => i % 2 === 0), 30), []);
	});

	it("matches a middle section when the file grew around it", () => {
		const earlier = file(80);
		const next = ["new header", ...file(80), "new footer"];
		assert.deepEqual(matchingRuns(next, earlier, 30), [{ from: 2, to: 81 }]);
	});
});

describe("collapse", () => {
	it("keeps unseen lines verbatim, collapses seen runs, and names the recall id", () => {
		const earlier = body(100);
		const next = `${body(100)}\n${file(20, "NEW").join("\n")}`;
		const c = collapse(next, [earlier], "t4", "src/a.ts")!;
		assert.equal(c.collapsedLines, 100);
		assert.equal(c.totalLines, 120);
		assert.match(c.text, /… \[lines 1-100 unchanged from what you already read of src\/a\.ts; full text: context_recall with id "t4"\] …/);
		for (const l of file(20, "NEW")) assert.ok(c.text.includes(l));
		assert.ok(c.keptTokens < c.originalTokens / 3);
	});

	it("does nothing without an earlier read, for short files, or when nothing matches", () => {
		assert.equal(collapse(body(100), [], "t1", "a.ts"), undefined);
		assert.equal(collapse(body(10), [body(10)], "t1", "a.ts"), undefined);
		assert.equal(collapse(body(100), [body(100, "OTHER")], "t1", "a.ts"), undefined);
	});
});

describe("planCollapse", () => {
	it("collapses a re-read of a file whose text is still in the context", () => {
		const text = body(200);
		const ctx = readResult("src/a.ts", text, "c1");
		const c = planCollapse(ctx, { toolCallId: "c2", toolName: "read", input: { path: "src/a.ts" }, text, isError: false }, "t1", DEFAULT_SEEN)!;
		assert.equal(c.collapsedLines, 200);
	});

	it("never collapses lines the agent has not been shown (the cachebro bug)", () => {
		// The agent read lines 1-100. It now reads 101-300 of the same unchanged file.
		const whole = file(300);
		const ctx = readResult("src/a.ts", whole.slice(0, 100).join("\n"), "c1");
		const later = whole.slice(100).join("\n");
		assert.equal(planCollapse(ctx, { toolCallId: "c2", toolName: "read", input: { path: "src/a.ts" }, text: later, isError: false }, "t1"), undefined);
	});

	it("stops collapsing once the earlier read is no longer in the context", () => {
		const text = body(200);
		const withRead = readResult("src/a.ts", text, "c1");
		const fresh = { toolCallId: "c2", toolName: "read", input: { path: "src/a.ts" }, text, isError: false };
		assert.ok(planCollapse(withRead, fresh, "t1"));
		// Compaction dropped the earlier read: nothing to point at any more.
		assert.equal(planCollapse([], fresh, "t1"), undefined);
	});

	it("ignores other tools, errors and other paths", () => {
		const text = body(200);
		const ctx = readResult("src/a.ts", text, "c1");
		assert.equal(planCollapse(ctx, { toolCallId: "c2", toolName: "bash", input: { command: "cat src/a.ts" }, text, isError: false }, "t1"), undefined);
		assert.equal(planCollapse(ctx, { toolCallId: "c2", toolName: "read", input: { path: "src/a.ts" }, text, isError: true }, "t1"), undefined);
		assert.equal(planCollapse(ctx, { toolCallId: "c2", toolName: "read", input: { path: "src/b.ts" }, text, isError: true }, "t1"), undefined);
	});
});

describe("in the extension", () => {
	const noJev = () => fakeJudge(() => undefined, { error: "should not be called" });

	it("collapses a re-read without calling Jev, and recall returns the original", async () => {
		const judge = noJev();
		const { pi } = setup({ judge, config: { mode: "on" } });
		pi.user("refactor src/a.ts");
		const text = body(200);
		await pi.tool("read", { path: "src/a.ts" }, text);
		const again = await pi.tool("read", { path: "src/a.ts" }, text);
		assert.ok(again.patch, "second read rewritten");
		assert.match(again.text, /unchanged from what you already read of src\/a\.ts/);
		assert.equal(judge.calls.length, 0, "no model call");
		const [log] = pi.logs("seen");
		assert.equal(log.acted, true);
		assert.equal(log.collapsedLines, 200);
		assert.equal((await pi.recall({ id: log.alias })).split("\n").slice(1).join("\n"), text);
		assert.deepEqual(pi.sent, []);
	});

	it("shadow mode logs the same decision and changes nothing", async () => {
		const { pi } = setup({ judge: noJev(), config: { mode: "shadow" } });
		pi.user("refactor src/a.ts");
		const text = body(200);
		await pi.tool("read", { path: "src/a.ts" }, text);
		const again = await pi.tool("read", { path: "src/a.ts" }, text);
		assert.equal(again.patch, undefined);
		assert.equal(again.text, text);
		assert.equal(pi.logs("seen")[0].acted, false);
	});

	it("leaves the first read of a file alone", async () => {
		const { pi } = setup({ judge: noJev(), config: { mode: "on" } });
		pi.user("read it");
		const first = await pi.tool("read", { path: "src/a.ts" }, body(200));
		assert.equal(first.patch, undefined);
		assert.equal(pi.logs("seen").length, 0);
	});
});

describe("cache neutrality (design invariant)", () => {
	it("a rewrite touches only the arriving result; every earlier message stays byte-identical", async () => {
		const { pi } = setup({ judge: fakeJudge(() => undefined, { error: "no" }), config: { mode: "on" } });
		pi.user("refactor src/a.ts");
		const text = body(200);
		await pi.tool("read", { path: "src/a.ts" }, text);
		const before = JSON.stringify(pi.entries.filter((e) => e.type === "message"));
		const again = await pi.tool("read", { path: "src/a.ts" }, text);
		assert.ok(again.patch, "the arriving result was rewritten");
		const after = JSON.stringify(pi.entries.filter((e) => e.type === "message").slice(0, JSON.parse(before).length));
		assert.equal(after, before, "no earlier message was modified");
		// The context hook must stay observation-only, whatever happened.
		assert.equal(await pi.emit("context", { messages: [] }), undefined);
	});

	it("is deterministic: the same read in the same context always renders the same text", () => {
		const text = body(200);
		const ctx = readResult("src/a.ts", text, "c1");
		const fresh = { toolCallId: "c2", toolName: "read", input: { path: "src/a.ts" }, text, isError: false };
		assert.equal(planCollapse(ctx, fresh, "t1")!.text, planCollapse(ctx, fresh, "t1")!.text);
	});
});
