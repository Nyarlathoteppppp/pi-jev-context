import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WRITE_CASES, WRITE_HOLDOUT } from "../bench/writetime-cases.ts";
import type { Answer, Question } from "../src/jev.ts";
import { DEFAULT_SIEVE, planSieve, sieveBlocks, sieveDecide } from "../src/sieve.ts";
import { fakeJudge, noul, choice } from "./harness.ts";

const need = (c: string, p = 0.95) => ({ type: "choice" as const, choice: c, probabilities: { [c]: p }, confidence: 0.9 });

describe("sieve", () => {
	it("blocks cover every line exactly once and each block fits what Jev is shown", () => {
		for (const c of [...WRITE_CASES, ...WRITE_HOLDOUT]) {
			const lines = c.result.text.split("\n").length;
			const blocks = sieveBlocks(c.result.text, c.result.toolName);
			assert.equal(blocks[0]!.from, 1, c.id);
			assert.equal(blocks.at(-1)!.to, lines, c.id);
			for (let i = 1; i < blocks.length; i++) assert.equal(blocks[i]!.from, blocks[i - 1]!.to + 1, c.id);
			for (const b of blocks) assert.ok(b.text.length <= DEFAULT_SIEVE.blockChars, `${c.id} ${b.id}`);
			assert.ok(blocks.length <= DEFAULT_SIEVE.maxBlocks);
		}
	});

	it("hides only confidently unneeded blocks; uncertain and oversize blocks stay; vetoes win", () => {
		const blocks = [
			{ id: "b1", from: 1, to: 1, text: "a" },
			{ id: "b2", from: 2, to: 2, text: "b" },
			{ id: "b3", from: 3, to: 3, text: "x".repeat(DEFAULT_SIEVE.blockChars + 1) },
		];
		const probs = { b1: 0.05, b2: 0.3, b3: 0.01 };
		assert.deepEqual(sieveDecide(need("specific_parts"), 0.1, blocks, probs).hidden.map((b) => b.id), ["b1"]);
		assert.equal(sieveDecide(need("every_line"), 0.1, blocks, probs).hidden.length, 0);
		assert.equal(sieveDecide(need("specific_parts"), 0.9, blocks, probs).hidden.length, 0);
	});

	it("never hides a failure line, even inside a block Jev called unneeded", async () => {
		const c = WRITE_CASES.find((x) => x.id === "W01")!;
		const judge = fakeJudge((k: string, _q: Question): Answer | undefined => (k === "need" ? choice("specific_parts") : k === "user_asked" ? noul(0) : noul(0.01)));
		const p = await planSieve(judge, c.context, c.result, "t1");
		assert.ok(p.trimmed);
		for (const k of ["auth.test.ts:42", "auth.test.ts:58", "expected 401 to be 200", "2 failed"]) assert.ok(p.trimmed!.text.includes(k), k);
	});
});
