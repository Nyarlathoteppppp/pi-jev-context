import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createJevContext } from "../src/index.ts";
import { FakePi } from "./harness.ts";

const make = (opts: Parameters<typeof createJevContext>[1] = {}) => createJevContext(new FakePi().api(), { env: {}, settingsPath: "/nonexistent", ...opts });

describe("defaults for a fresh install", () => {
	it("dedupe is on and the Jev sieve is opt-in when nothing is configured", () => {
		const { config } = make();
		assert.equal(config.dedupe, "on");
		assert.equal(config.sieve, "off");
	});

	it("an API key in the environment alone does not switch the sieve on", () => {
		const { config } = make({ env: { OPENROUTER_API_KEY: "sk-test", TYPESAFE_API_KEY: "ts-test" } });
		assert.equal(config.sieve, "off");
	});

	it("an explicit mode keeps its meaning: on enables both, shadow logs dedupe only, off disables both", () => {
		assert.deepEqual([make({ env: { PI_JEV_CONTEXT_MODE: "on" } }).config.dedupe, make({ env: { PI_JEV_CONTEXT_MODE: "on" } }).config.sieve], ["on", "on"]);
		assert.equal(make({ env: { PI_JEV_CONTEXT_MODE: "shadow" } }).config.sieve, "off");
		const off = make({ env: { PI_JEV_CONTEXT_MODE: "off" } }).config;
		assert.deepEqual([off.dedupe, off.sieve], ["off", "off"]);
	});

	it("the sieve can be opted into by switch, env or settings file", () => {
		assert.equal(make({ config: { sieve: "on" } }).config.sieve, "on");
		assert.equal(make({ env: { PI_JEV_CONTEXT_SIEVE: "on" } }).config.sieve, "on");
		const dir = mkdtempSync(join(tmpdir(), "jctx-defaults-"));
		writeFileSync(join(dir, "s.json"), JSON.stringify({ sieve: "on" }));
		assert.equal(make({ settingsPath: join(dir, "s.json") }).config.sieve, "on");
	});
});

describe("dedupeSameTurn", () => {
	it("defaults to true and can be relaxed by option, env or settings file; invalid values keep the default", () => {
		assert.equal(make().config.seen.sameUserTurn, true);
		assert.equal(make({ config: { dedupeSameTurn: false } }).config.seen.sameUserTurn, false);
		assert.equal(make({ env: { PI_JEV_CONTEXT_DEDUPE_SAME_TURN: "false" } }).config.seen.sameUserTurn, false);
		assert.equal(make({ env: { PI_JEV_CONTEXT_DEDUPE_SAME_TURN: "nope" } }).config.seen.sameUserTurn, true);
		const dir = mkdtempSync(join(tmpdir(), "jctx-sameturn-"));
		writeFileSync(join(dir, "s.json"), JSON.stringify({ dedupeSameTurn: false }));
		assert.equal(make({ settingsPath: join(dir, "s.json") }).config.seen.sameUserTurn, false);
		writeFileSync(join(dir, "bad.json"), JSON.stringify({ dedupeSameTurn: "false" }));
		assert.equal(make({ settingsPath: join(dir, "bad.json") }).config.seen.sameUserTurn, true);
	});
});

describe("dedupeSameTurn behaviour", () => {
	it("a re-read after a new user message folds only when the boundary is relaxed", async () => {
		const { planCollapse, DEFAULT_SEEN } = await import("../src/seen.ts");
		const text = Array.from({ length: 120 }, (_, i) => `const v${i + 1} = compute(${i + 1});`).join("\n");
		const messages: any[] = [
			{ role: "user", content: "read a.ts" },
			{ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } }] },
			{ role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text }], isError: false },
			{ role: "user", content: "now refactor it" },
			{ role: "assistant", content: [{ type: "toolCall", id: "c2", name: "read", arguments: { path: "a.ts" } }] },
		];
		const fresh = { toolCallId: "c2", toolName: "read", input: { path: "a.ts" }, text, isError: false };
		assert.equal(planCollapse(messages, fresh, "t1", DEFAULT_SEEN), undefined);
		assert.ok(planCollapse(messages, fresh, "t1", { ...DEFAULT_SEEN, sameUserTurn: false }));
	});
});
