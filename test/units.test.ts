import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { items } from "../bench/archive/cases.ts";
import { notableLines, relatedKey, toolEvents } from "../src/extract.ts";
import { majority, percentile, summarize, type Row } from "../bench/experimental/metrics.ts";
import { compositePolicy, type JevReading, rulePolicy, safePolicy } from "../bench/experimental/policy.ts";
import { buildState } from "../bench/experimental/state.ts";
import { Session } from "../bench/builder.ts";

const reading = (choice: string, probs: Record<string, number>, confidence: number, signals: Record<string, number> = {}, excerpted = false): JevReading => ({
	decision: { type: "choice", choice, probabilities: probs, confidence },
	signals,
	lines: {},
	excerpted,
});

describe("extraction", () => {
	it("pairs tool calls with results", () => {
		const s = new Session().user("go").bash("pwd", "/x", { tag: "a" }).read("a.ts", "x", { tag: "b" });
		const ev = toolEvents(s.messages);
		assert.deepEqual(ev.map((e) => [e.name, e.output, e.userTurn]), [["bash", "/x", 1], ["read", "x", 1]]);
	});

	it("groups test runner invocations into one family", () => {
		assert.equal(relatedKey({ name: "bash", args: { command: "npm  test -- auth" } }), relatedKey({ name: "bash", args: { command: "npm test" } }));
		assert.equal(relatedKey({ name: "read", args: { path: "./a.ts" } }), relatedKey({ name: "edit", args: { path: "a.ts" } }));
	});

	it("prefers failures over warnings when over budget", () => {
		const out = [...Array(50).fill("Warning: noisy"), "FAIL x"].map((l, i) => `${l} ${i}`).join("\n");
		assert.ok(notableLines(out, 5).some((l) => l.text.startsWith("FAIL")));
	});
});

describe("state", () => {
	it("reports newer results about the same thing and never exceeds Jev's state budget", () => {
		for (const it of items()) {
			const b = buildState(it.c.session.messages.slice(0, it.at), it.targetId);
			assert.ok(b.approxTokens < 8000, `${it.key} ${b.approxTokens}`);
		}
		const c02 = items().find((i) => i.key === "C02:fail")!;
		const b = buildState(c02.c.session.messages.slice(0, c02.at), c02.targetId);
		assert.equal((b.state.newer_related_results as any[])[0].relation, "the same command was run again later");
	});

	it("every labelled key line is visible to Jev", () => {
		for (const it of items().filter((i) => i.target.keyLines)) {
			const text = JSON.stringify(buildState(it.c.session.messages.slice(0, it.at), it.targetId).state);
			for (const k of it.target.keyLines!) assert.ok(text.includes(k.replace(/"/g, '\\"')), `${it.key}: ${k}`);
		}
	});
});

describe("policies", () => {
	it("safe policy never drops on UNCERTAIN or a weak DROP", () => {
		assert.equal(safePolicy(reading("UNCERTAIN", { UNCERTAIN: 0.6 }, 0.4)), "KEEP");
		assert.equal(safePolicy(reading("DROP", { DROP: 0.55, TRUNCATE: 0.3, KEEP: 0.15 }, 0.6)), "TRUNCATE");
		assert.equal(safePolicy(reading("DROP", { DROP: 0.95 }, 0.9)), "DROP");
	});

	it("composite policy vetoes drops on protective signals", () => {
		assert.equal(compositePolicy(reading("DROP", { DROP: 0.95 }, 0.9, { needed_now: 0.8 })), "KEEP");
		assert.equal(compositePolicy(reading("DROP", { DROP: 0.95 }, 0.9, { durable: 0.7 })), "TRUNCATE");
		assert.equal(compositePolicy(reading("DROP", { DROP: 0.95 }, 0.9, { unique_fact: 0.9, superseded: 0.9 })), "DROP");
		assert.equal(compositePolicy(reading("KEEP", { KEEP: 0.9 }, 0.9, { mostly_noise: 0.9 }, true)), "TRUNCATE");
	});

	it("rule baseline drops superseded failures", () => {
		const it = items().find((i) => i.key === "C02:fail")!;
		assert.equal(rulePolicy(it.c.session.messages.slice(0, it.at), it.targetId), "DROP");
	});
});

describe("metrics", () => {
	const row = (truth: any, pred: any, critical = false, acceptable = [truth]): Row => ({ key: `${truth}-${pred}`, category: "x", truth, acceptable, critical, pred, tokens: 100, truncatedTokens: 20 });
	it("counts critical false drops and drop precision", () => {
		const s = summarize([row("KEEP", "DROP", true), row("KEEP", "KEEP", true), row("DROP", "DROP"), row("TRUNCATE", "TRUNCATE")]);
		assert.equal(s.criticalFalseDropRate, 0.5);
		assert.equal(s.dropPrecision, 0.5);
		assert.equal(s.tokenSavings, (100 + 100 + 80) / 400);
	});
	it("majority ties break toward the safer decision", () => {
		assert.equal(majority(["DROP", "KEEP"]), "KEEP");
		assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
	});
});
