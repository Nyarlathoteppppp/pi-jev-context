import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Jev, normalizeAnswer } from "../src/jev.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const ok = (answers: unknown) => new Response(JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 1000 } }), { status: 200 });
const jev = () => new Jev({ url: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", key: "k" });
const Q = { q: { type: "noul" as const, instructions: "x?" } };

describe("Jev client", () => {
	it("retries 429 and transient 5xx, honouring Retry-After", async () => {
		const statuses = [429, 503];
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			const s = statuses.shift();
			return s ? new Response("busy", { status: s, headers: { "retry-after": "0" } }) : ok({ q: { noul: 0.4 } });
		}) as typeof fetch;
		const r = await jev().decide("s", Q, 5000);
		assert.equal(calls, 3);
		assert.equal((r.answers!.q as { noul: number }).noul, 0.4);
		assert.ok(Math.abs(r.cost! - 0.000042) < 1e-12);
	});

	it("gives up after two retries and fails open; never retries a 400", async () => {
		let calls = 0;
		globalThis.fetch = (async () => (calls++, new Response("x", { status: 500, headers: { "retry-after": "0" } }))) as typeof fetch;
		assert.match((await jev().decide("s", Q, 5000)).error!, /http 500/);
		assert.equal(calls, 3);
		calls = 0;
		globalThis.fetch = (async () => (calls++, new Response("bad", { status: 400 }))) as typeof fetch;
		assert.match((await jev().decide("s", Q, 5000)).error!, /http 400/);
		assert.equal(calls, 1);
	});

	it("a retry wait never outlives the deadline", async () => {
		globalThis.fetch = (async () => new Response("x", { status: 429, headers: { "retry-after": "30" } })) as typeof fetch;
		const t = Date.now();
		const r = await jev().decide("s", Q, 200);
		assert.ok(r.error);
		assert.ok(Date.now() - t < 1500);
	});

	it("clamps overshoot into [0, 1] and rejects non-finite or off-schema answers", () => {
		assert.deepEqual(normalizeAnswer(Q.q, { noul: 1.0000002 }), { type: "noul", noul: 1 });
		assert.equal(normalizeAnswer(Q.q, { noul: Number.NaN }), undefined);
		const c = { type: "choice" as const, instructions: "?", criteria: { a: "A", b: "B" } };
		assert.deepEqual(normalizeAnswer(c, { choice: "a", probabilities: { a: 1.01, b: -0.01 }, confidence: 0.9 }), { type: "choice", choice: "a", probabilities: { a: 1, b: 0 }, confidence: 0.9 });
		assert.equal(normalizeAnswer(c, { choice: "z", probabilities: {}, confidence: 1 }), undefined);
	});
});
