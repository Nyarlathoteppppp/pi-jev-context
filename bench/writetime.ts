// Write-time trimming benchmark: runs the production planTrim() against labelled fresh outputs.
//   node bench/writetime.ts [--repeats 5] [--dry-run]

import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { estimateTokens } from "../src/extract.ts";
import { Jev, resolveTransport } from "../src/jev.ts";
import { percentile } from "../src/metrics.ts";
import { shouldConsider, units } from "../src/trim.ts";
import { planTrim, type TrimPlan } from "../src/writetime.ts";
import { planSieve } from "../src/sieve.ts";
import { WRITE_CASES as DEV, WRITE_HOLDOUT, WRITE_HOLDOUT2 } from "./writetime-cases.ts";

const { values } = parseArgs({ options: { repeats: { type: "string", default: "5" }, "dry-run": { type: "boolean", default: false }, set: { type: "string", default: "dev" }, out: { type: "string" }, engine: { type: "string", default: "select" } } });
const repeats = Math.max(1, Number(values.repeats));
const WRITE_CASES = values.set === "holdout" ? WRITE_HOLDOUT : values.set === "holdout2" ? WRITE_HOLDOUT2 : values.set === "all" ? [...DEV, ...WRITE_HOLDOUT, ...WRITE_HOLDOUT2] : DEV;

if (values["dry-run"]) {
	for (const c of WRITE_CASES) {
		const u = units(c.result.text, c.result.toolName);
		const covered = (c.keyLines ?? []).filter((k) => u.units.some((x) => x.text.includes(k)) || c.result.text.split("\n").slice(0, 5).concat(c.result.text.split("\n").slice(-8)).some((l) => l.includes(k)));
		console.log(`${c.id} ${c.truth} considered=${shouldConsider(c.result.toolName, c.result.input, c.result.text)} lines=${c.result.text.split("\n").length} mode=${u.mode} units=${u.units.length} keyLines reachable=${covered.length}/${c.keyLines?.length ?? 0}`);
	}
	process.exit(0);
}

const transport = resolveTransport();
if (!transport) throw new Error("no Jev key");
const jev = new Jev(transport);
await jev.decide("warm-up", { q: { type: "noul", instructions: "warm-up" } });

type Out = { id: string; truth: string; plans: Array<Omit<TrimPlan, "units"> & { keptText?: string }> };
const results: Out[] = [];
for (const c of WRITE_CASES) {
	const plans: Out["plans"] = [];
	for (let r = 0; r < repeats; r++) {
		if (values.engine === "sieve") {
			const p = await planSieve(jev, c.context, c.result, "t1", { timeoutMs: 15000 });
			plans.push({ mode: "blocks", call: p.call, trimmed: p.trimmed, skip: p.skip, keptText: p.trimmed?.text, decision: { trim: !!p.trimmed, reason: `${p.need?.choice ?? "-"} hidden ${p.hidden.length}/${p.blocks.length}`, selected: [] } } as any);
		} else {
			const p = await planTrim(jev, c.context, c.result, "t1", { timeoutMs: 15000 });
			plans.push({ mode: p.mode, call: p.call, reading: p.reading, decision: p.decision && { ...p.decision, selected: p.decision.selected }, trimmed: p.trimmed, skip: p.skip, keptText: p.trimmed?.text });
		}
	}
	const verdicts = plans.map((p) => (p.trimmed ? "TRIM" : "KEEP"));
	const keyOk = plans.map((p) => (p.trimmed ? (c.keyLines ?? []).filter((k) => p.trimmed!.text.includes(k)).length : Number.NaN));
	console.log(`${c.id} truth=${c.truth} got=${verdicts.join(",")} keyLines=${keyOk.map((k) => (Number.isNaN(k) ? "-" : `${k}/${c.keyLines?.length ?? 0}`)).join(" ")} kept=${plans.map((p) => (p.trimmed ? `${p.trimmed.keptTokens}/${p.trimmed.originalTokens}` : "-")).join(" ")} | ${plans[0]!.skip ?? plans[0]!.decision?.reason} ${plans.map((p) => p.call.ms).join("/")}ms`);
	results.push({ id: c.id, truth: c.truth, plans });
}

// Metrics
const all = results.flatMap((r) => r.plans.map((p) => ({ r, p, trimmed: !!p.trimmed })));
const truthTrim = all.filter((x) => x.r.truth === "TRIM");
const truthKeep = all.filter((x) => x.r.truth === "KEEP");
const keyTotal = truthTrim.filter((x) => x.trimmed).reduce((s, x) => s + (WRITE_CASES.find((c) => c.id === x.r.id)!.keyLines?.length ?? 0), 0);
const keyKept = truthTrim.filter((x) => x.trimmed).reduce((s, x) => s + WRITE_CASES.find((c) => c.id === x.r.id)!.keyLines!.filter((k) => x.p.trimmed!.text.includes(k)).length, 0);
const orig = all.reduce((s, x) => s + estimateTokens(WRITE_CASES.find((c) => c.id === x.r.id)!.result.text), 0);
const after = all.reduce((s, x) => s + (x.p.trimmed ? x.p.trimmed.keptTokens : estimateTokens(WRITE_CASES.find((c) => c.id === x.r.id)!.result.text)), 0);
const ms = all.map((x) => x.p.call.ms);
const cost = all.reduce((s, x) => s + (x.p.call.cost ?? 0), 0);
const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}% (${a}/${b})`;
const summary = [
	`calls: ${all.length}, model ${all[0]?.p.call.model}`,
	`trim recall (TRIM cases trimmed): ${pct(truthTrim.filter((x) => x.trimmed).length, truthTrim.length)}`,
	`false trim (KEEP cases trimmed): ${pct(truthKeep.filter((x) => x.trimmed).length, truthKeep.length)}`,
	`key lines surviving a trim: ${pct(keyKept, keyTotal)}`,
	`tokens: ${orig} → ${after} (${(100 - (after / orig) * 100).toFixed(1)}% saved over all cases)`,
	`latency p50 ${percentile(ms, 50)} ms, p95 ${percentile(ms, 95)} ms; cost $${cost.toFixed(6)}`,
];
console.log(`\n${summary.join("\n")}`);
mkdirSync("results", { recursive: true });
const outFile = values.out ?? `results/writetime-${values.set}.json`;
writeFileSync(outFile, JSON.stringify({ summary, results }, null, 1));
console.log(`wrote ${outFile}`);
