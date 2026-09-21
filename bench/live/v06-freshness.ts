// Focused v0.6 deterministic freshness benchmark. No Jev, network, or model calls.
// Usage: node bench/live/v06-freshness.ts --out results/live-v06-freshness.json
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_SEEN } from "../../src/seen.ts";
import { setup } from "../../test/harness.ts";

const { values } = parseArgs({ options: { out: { type: "string", default: "results/live-v06-freshness.json" } } });
const out = resolve(values.out!);
if (existsSync(out)) throw new Error(`Refusing to overwrite existing result file: ${out}`);
const lines = Array.from({ length: 240 }, (_, i) => `source line ${i + 1}: stable value ${i + 1}`);
const full = lines.join("\n");
const range = (from: number, to: number) => lines.slice(from - 1, to).join("\n");
const filler = (tokens: number) => "x".repeat(tokens * 4);

let reads = 0;
let freshDedupe = 0;
let staleRefresh = 0;
let crossUserTurnPrevented = 0;
let partialOverlapDedupe = 0;
let savedTokens = 0;

async function readCase(pi: any, input: Record<string, unknown>, text: string) {
	reads++;
	const result = await pi.tool("read", input, text);
	if (result.patch) {
		freshDedupe++;
		savedTokens += (pi.logs("seen").at(-1)?.from ?? 0) - (pi.logs("seen").at(-1)?.to ?? 0);
	}
	return result;
}

{
	const { pi } = setup();
	await readCase(pi, { path: "src/app.ts" }, full);
	await readCase(pi, { path: "src/app.ts" }, full);
}
{
	const { pi } = setup();
	await readCase(pi, { path: "src/app.ts" }, full);
	await pi.tool("bash", { command: "echo five-thousand" }, filler(5_000));
	await readCase(pi, { path: "src/app.ts" }, full);
}
{
	const { pi } = setup();
	await readCase(pi, { path: "src/app.ts" }, full);
	await pi.tool("bash", { command: "echo stale" }, filler(DEFAULT_SEEN.dedupeMaxAgeTokens + 1));
	const result = await readCase(pi, { path: "src/app.ts" }, full);
	if (!result.patch) staleRefresh++;
}
{
	const { pi } = setup();
	await readCase(pi, { path: "src/app.ts" }, full);
	pi.user("Start a different task.");
	const result = await readCase(pi, { path: "src/app.ts" }, full);
	if (!result.patch) crossUserTurnPrevented++;
}
{
	const { pi } = setup();
	await readCase(pi, { path: "src/app.ts" }, full);
	await pi.tool("bash", { command: "echo old-copy-age" }, filler(30_000));
	await readCase(pi, { path: "src/app.ts" }, full);
	await pi.tool("bash", { command: "echo recent-copy-age" }, filler(3_000));
	await readCase(pi, { path: "src/app.ts" }, full);
}
{
	const { pi } = setup();
	await readCase(pi, { path: "src/app.ts", offset: 50 }, range(50, 150));
	await pi.tool("bash", { command: "echo stale-range" }, filler(DEFAULT_SEEN.dedupeMaxAgeTokens + 1));
	await readCase(pi, { path: "src/app.ts", offset: 80 }, range(80, 130));
	await pi.tool("bash", { command: "echo recent-range" }, filler(3_000));
	const result = await readCase(pi, { path: "src/app.ts", offset: 50 }, range(50, 150));
	if (result.patch && result.text.includes("file lines 80-130 unchanged")) partialOverlapDedupe++;
}

const result = {
	version: "0.6.0",
	model: "deterministic-no-jev",
	dedupeMaxAgeTokens: DEFAULT_SEEN.dedupeMaxAgeTokens,
	reads,
	freshDedupe,
	staleRefresh,
	crossUserTurnPrevented,
	partialOverlapDedupe,
	savedTokens,
};
assert.equal(reads, 14);
assert.equal(freshDedupe, 4);
assert.equal(staleRefresh, 1);
assert.equal(crossUserTurnPrevented, 1);
assert.equal(partialOverlapDedupe, 1);
assert.ok(savedTokens > 0);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
