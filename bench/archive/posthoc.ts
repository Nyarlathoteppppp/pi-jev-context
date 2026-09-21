// POST-HOC analysis: policies designed after seeing run-q1 results. Numbers here are fitted to the
// same items and therefore optimistic; they must be confirmed on held-out cases.
import { readFileSync } from "node:fs";
import type { ChoiceAnswer, NoulAnswer } from "../experimental/jev.ts";
import { summarize, type Row } from "../experimental/metrics.ts";
import type { Label, Prediction } from "../../src/types.ts";
import type { ItemResult } from "./run.ts";

const { results } = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { results: ItemResult[] };
type R = { choice: string; p: Record<string, number>; conf: number; s: Record<string, number> };
const read = (c: ItemResult["calls"][number]): R | undefined => {
	if (!c.answers) return undefined;
	const d = c.answers.decision as ChoiceAnswer;
	const s: Record<string, number> = {};
	for (const [k, a] of Object.entries(c.answers)) if (k !== "decision" && !k.startsWith("line_")) s[k] = (a as NoulAnswer).noul;
	return { choice: d.choice, p: d.probabilities, conf: d.confidence, s };
};
export function guarded(x: R, t = { drop: 0.7, conf: 0.5, durable: 0.8, needed: 0.5, user: 0.5 }): Prediction {
	const fallback: Label = (x.p.TRUNCATE ?? 0) > (x.p.KEEP ?? 0) ? "TRUNCATE" : "KEEP";
	if (x.choice === "UNCERTAIN") return "KEEP";
	if (x.choice !== "DROP") return x.choice as Label;
	if ((x.p.DROP ?? 0) < t.drop || x.conf < t.conf) return fallback;
	if ((x.s.needed_now ?? 0) >= t.needed || (x.s.user_requested ?? 0) >= t.user) return fallback;
	if ((x.s.durable ?? 0) >= t.durable) return "TRUNCATE";
	return "DROP";
}
const rows = (f: (x: R) => Prediction): Row[] =>
	results.flatMap((r) => r.calls.flatMap((c) => { const x = read(c); return x ? [{ key: r.key, category: r.category, truth: r.target.truth, acceptable: r.target.acceptable, critical: r.target.critical, pred: f(x), tokens: 1, truncatedTokens: 0 }] : []; }));
const pct = (v: number) => (Number.isNaN(v) ? "n/a" : `${(v * 100).toFixed(1)}%`);
console.log("| drop p ≥ | conf ≥ | durable veto ≥ | lenient acc | critical FD | false drop | DROP prec | DROP recall | KEEP recall | TRUNC acc | crit FD items |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const drop of [0.6, 0.7, 0.8, 0.9]) for (const conf of [0.5, 0.7]) for (const durable of [0.7, 0.75, 0.8, 0.85, 0.9, 1.01]) {
	const s = summarize(rows((x) => guarded(x, { drop, conf, durable, needed: 0.5, user: 0.5 })));
	console.log(`| ${drop} | ${conf} | ${durable > 1 ? "off" : durable} | ${pct(s.lenientAccuracy)} | ${pct(s.criticalFalseDropRate)} | ${pct(s.falseDropRate)} | ${pct(s.dropPrecision)} | ${pct(s.dropRecall)} | ${pct(s.keepRecall)} | ${pct(s.truncateAccuracy)} | ${s.criticalFalseDrops.join(",")} |`);
}
