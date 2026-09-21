import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WRITE_CASES, WRITE_HOLDOUT } from "../bench/writetime-cases.ts";
import type { Answer, Question } from "../bench/experimental/jev.ts";
import { DEFAULT_SIEVE, planSieve, sieveBlocks, sieveDecide } from "../bench/experimental/sieve.ts";
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

	it("hides only confidently unneeded blocks; uncertain, oversize, top-ranked and request-matching blocks stay; vetoes win", () => {
		const mk = (id: string, text = id) => ({ id, from: 1, to: 1, text });
		const blocks = [mk("b1"), mk("b2"), mk("b3", "x".repeat(DEFAULT_SIEVE.blockChars + 1)), mk("b4"), mk("b5"), mk("b6"), mk("b7", "the omit option")];
		const probs = { b1: 0.05, b2: 0.3, b3: 0.01, b4: 0.9, b5: 0.8, b6: 0.04, b7: 0.02 };
		// b2 uncertain, b3 oversize, b4/b5/b2 top-3; b7 matches the request term "omit".
		assert.deepEqual(sieveDecide(need("specific_parts"), 0.1, blocks, probs, DEFAULT_SIEVE, "use the omit option").hidden.map((b) => b.id), ["b1", "b6"]);
		// outcome_only: no top-3 protection.
		assert.deepEqual(sieveDecide(need("outcome_only"), 0.1, blocks, probs).hidden.map((b) => b.id), ["b1", "b6", "b7"]);
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
