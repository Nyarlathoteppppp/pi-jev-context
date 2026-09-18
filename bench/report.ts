// Turns a results/run-*.json file into metrics and a markdown report. No network.
//   node bench/report.ts results/run-XXXX.json

import { readFileSync, writeFileSync } from "node:fs";
import { estimateTokens } from "../src/extract.ts";
import type { ChoiceAnswer, JevCall, NoulAnswer } from "../src/jev.ts";
import { majority, PREDICTIONS, percentile, type Row, type Summary, summarize } from "../src/metrics.ts";
import { compositePolicy, DEFAULT_THRESHOLDS, guardedPolicy, type JevReading, rawPolicy, rulePolicy, safePolicy, type Thresholds } from "../src/policy.ts";
import { SIGNALS } from "../src/questions.ts";
import { LABELS, type Label, type Prediction } from "../src/types.ts";
import type { ItemResult } from "./run.ts";
import { CASES, items } from "./cases.ts";
import { HOLDOUT } from "./holdout.ts";

const file = process.argv[2];
if (!file) {
	console.error("usage: node bench/report.ts results/run-XXXX.json");
	process.exit(1);
}
const { meta, results } = JSON.parse(readFileSync(file, "utf8")) as { meta: Record<string, unknown>; results: ItemResult[] };
const byKey = new Map(items([...CASES, ...HOLDOUT]).map((i) => [i.key, i]));

const TRUNCATED_BUDGET = 150; // tokens a truncated result keeps (~15 key lines)

function reading(r: ItemResult, c: JevCall): JevReading | undefined {
	if (!c.answers) return undefined;
	const signals: Record<string, number> = {};
	const lines: Record<number, number> = {};
	for (const [k, a] of Object.entries(c.answers)) {
		if (k in SIGNALS) signals[k] = (a as NoulAnswer).noul;
		else if (k.startsWith("line_")) lines[Number(k.slice(5))] = (a as NoulAnswer).noul;
	}
	return { decision: c.answers.decision as ChoiceAnswer, signals, lines, excerpted: r.excerpted };
}

function rowOf(r: ItemResult, pred: Prediction): Row {
	const it = byKey.get(r.key)!;
	const out = it.c.session.messages.slice(0, it.at).find((m) => m.role === "toolResult" && m.toolCallId === r.targetId) as { content: Array<{ text: string }> };
	const tokens = estimateTokens(out.content.map((c) => c.text).join("\n"));
	return { key: r.key, category: r.category, truth: r.target.truth, acceptable: r.target.acceptable, critical: r.target.critical, pred, tokens, truncatedTokens: Math.min(tokens, TRUNCATED_BUDGET) };
}

type Policy = (x: JevReading) => Prediction;
const perCall = (p: Policy): Row[] => results.flatMap((r) => r.calls.flatMap((c) => { const x = reading(r, c); return x ? [rowOf(r, p(x))] : []; }));
const perItemMajority = (p: Policy): Row[] =>
	results.map((r) => rowOf(r, majority(r.calls.flatMap((c) => { const x = reading(r, c); return x ? [p(x)] : []; }))));

const POLICIES: Record<string, Policy> = {
	"jev raw": rawPolicy,
	"jev safe": (x) => safePolicy(x),
	"jev composite": (x) => compositePolicy(x),
	"jev guarded (frozen)": (x) => guardedPolicy(x),
};

const baselines: Record<string, Row[]> = {
	"rules only (no Jev)": results.map((r) => { const it = byKey.get(r.key)!; return rowOf(r, rulePolicy(it.c.session.messages.slice(0, it.at), r.targetId)); }),
	"always KEEP": results.map((r) => rowOf(r, "KEEP")),
};

// ---------------------------------------------------------------------------------------------

const pct = (x: number) => (Number.isNaN(x) ? "n/a" : `${(x * 100).toFixed(1)}%`);
const f2 = (x: number) => (Number.isNaN(x) ? "-" : x.toFixed(2));
const lines: string[] = [];
const out = (s = "") => lines.push(s);

const calls = results.flatMap((r) => r.calls);
const ok = calls.filter((c) => c.answers);
const ms = ok.map((c) => c.ms);
const cost = calls.reduce((s, c) => s + (c.cost ?? 0), 0);
const inTok = ok.reduce((s, c) => s + (c.inputTokens ?? 0), 0);

out(`# pi-jev-context shadow evaluation`);
out();
out(`- file: \`${file}\``);
out(`- model: \`${meta.model}\` (requested \`${meta.requested}\`), questions \`${meta.questions}\`, repeats per item: ${meta.repeats}`);
out(`- items: ${results.length} (from ${new Set(results.map((r) => r.caseId)).size} cases), critical: ${results.filter((r) => r.target.critical).length}, Jev calls: ${calls.length} (${calls.length - ok.length} failed)`);
out(`- latency: p50 **${percentile(ms, 50)} ms**, p95 **${percentile(ms, 95)} ms**, max ${Math.max(...ms)} ms`);
out(`- cost: **$${cost.toFixed(6)}** total, $${(cost / Math.max(1, ok.length)).toFixed(7)} per call, ${Math.round(inTok / Math.max(1, ok.length))} input tokens per call`);
out();

const header = "| policy | acc | lenient acc | KEEP recall | retention | **critical false drop** | false drop | TRUNCATE acc | DROP precision | DROP recall | UNCERTAIN | token savings |";
const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|";
const line = (name: string, s: Summary) =>
	`| ${name} | ${pct(s.accuracy)} | ${pct(s.lenientAccuracy)} | ${pct(s.keepRecall)} | ${pct(s.retention)} | **${pct(s.criticalFalseDropRate)}** | ${pct(s.falseDropRate)} | ${pct(s.truncateAccuracy)} | ${pct(s.dropPrecision)} | ${pct(s.dropRecall)} | ${pct(s.uncertainRate)} | ${pct(s.tokenSavings)} |`;

out(`## Metrics`);
out();
out(`Per call (every repeat counted):`);
out();
out(header);
out(sep);
const summaries: Record<string, Summary> = {};
for (const [name, p] of Object.entries(POLICIES)) out(line(name, (summaries[name] = summarize(perCall(p)))));
out();
out(`Per item, majority of ${meta.repeats} repeats (ties → safer):`);
out();
out(header);
out(sep);
for (const [name, p] of Object.entries(POLICIES)) out(line(name, summarize(perItemMajority(p))));
for (const [name, rows] of Object.entries(baselines)) out(line(name, summarize(rows)));
out();

out(`Critical false drops (per call): ${Object.entries(summaries).map(([n, s]) => `${n}: ${s.criticalFalseDrops.join(", ") || "none"}`).join(" · ")}`);
out();

function matrix(title: string, rows: Row[]) {
	const m = summarize(rows).confusion;
	out(`**${title}** (rows = truth, columns = prediction)`);
	out();
	out(`| truth \\ pred | ${PREDICTIONS.join(" | ")} |`);
	out(`|---|${PREDICTIONS.map(() => "---").join("|")}|`);
	for (const t of LABELS) out(`| ${t} | ${PREDICTIONS.map((p) => m[t][p]).join(" | ")} |`);
	out();
}
out(`## Confusion matrices`);
out();
matrix("Jev raw, per call", perCall(rawPolicy));
matrix("Jev composite, per call", perCall((x) => compositePolicy(x)));
matrix("Jev guarded (frozen), per call", perCall((x) => guardedPolicy(x)));
matrix("rules only", baselines["rules only (no Jev)"]!);

// Stability
const unanimous = results.filter((r) => new Set(r.calls.map((c) => (c.answers?.decision as ChoiceAnswer | undefined)?.choice)).size === 1).length;
out(`## Stability`);
out();
out(`Raw choice identical across all ${meta.repeats} repeats for ${unanimous}/${results.length} items.`);
out();

// Per item
out(`## Per item`);
out();
out(`| item | category | truth (acceptable) | crit | Jev raw picks | p(choice) | conf | needed_now | superseded | unique | durable | user_req | noise | guarded | ok? |`);
out(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
for (const r of results) {
	const rs = r.calls.map((c) => reading(r, c)).filter((x): x is JevReading => !!x);
	const picks = rs.map((x) => x.decision.choice);
	const comp = majority(rs.map((x) => guardedPolicy(x)));
	const sig = (k: string) => f2(mean(rs.map((x) => x.signals[k] ?? Number.NaN)));
	const good = r.target.acceptable.includes(comp as Label);
	const fatal = r.target.critical && comp === "DROP";
	out(
		`| ${r.key} | ${r.category} | ${r.target.truth} (${r.target.acceptable.join("/")}) | ${r.target.critical ? "yes" : ""} | ${picks.join(" ")} | ${f2(mean(rs.map((x) => x.decision.probabilities[x.decision.choice] ?? 0)))} | ${f2(mean(rs.map((x) => x.decision.confidence)))} | ${sig("needed_now")} | ${sig("superseded")} | ${sig("unique_fact")} | ${sig("durable")} | ${sig("user_requested")} | ${sig("mostly_noise")} | ${comp} | ${fatal ? "**CRITICAL DROP**" : good ? "✓" : "✗"} |`,
	);
}
out();

// Key lines
out(`## TRUNCATE key-line selection`);
out();
out(`Candidates are chosen by code (errors, failures, file:line, summaries); Jev marks which to keep (noul ≥ 0.5).`);
out();
out(`| item | key lines | covered by candidates | covered by Jev-kept lines | Jev kept / candidates |`);
out(`|---|---|---|---|---|`);
for (const r of results.filter((x) => x.target.keyLines)) {
	const cand = r.keyLineCandidates;
	const covers = (sel: typeof cand) => r.target.keyLines!.filter((k) => sel.some((l) => l.text.includes(k))).length;
	const keptPerCall = r.calls.map((c) => { const x = reading(r, c); return x ? cand.filter((l) => (x.lines[l.n] ?? 0) >= 0.5) : []; });
	const kept = keptPerCall[0] ?? [];
	out(`| ${r.key} | ${r.target.keyLines!.length} | ${cand.length ? `${covers(cand)}/${r.target.keyLines!.length}` : "no candidates (not excerpted)"} | ${cand.length ? keptPerCall.map((k) => `${covers(k)}/${r.target.keyLines!.length}`).join(" ") : "-"} | ${cand.length ? `${kept.length}/${cand.length}` : "-"} |`);
}
out();

// Threshold sweep
out(`## Threshold sweep (composite policy, per call)`);
out();
out(`| drop p ≥ | confidence ≥ | veto ≥ | critical false drop | false drop | DROP precision | DROP recall | lenient acc | token savings |`);
out(`|---|---|---|---|---|---|---|---|---|`);
const sweep: Array<{ t: Thresholds; s: Summary }> = [];
for (const drop of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95])
	for (const confidence of [0.3, 0.5, 0.7])
		for (const veto of [0.3, 0.5, 0.7]) {
			const t = { ...DEFAULT_THRESHOLDS, drop, confidence, veto };
			const s = summarize(perCall((x) => compositePolicy(x, t)));
			sweep.push({ t, s });
			out(`| ${drop} | ${confidence} | ${veto} | ${pct(s.criticalFalseDropRate)} | ${pct(s.falseDropRate)} | ${pct(s.dropPrecision)} | ${pct(s.dropRecall)} | ${pct(s.lenientAccuracy)} | ${pct(s.tokenSavings)} |`);
		}
out();

// Errors by category
out(`## Misjudgements (Jev raw, per call, not in acceptable set)`);
out();
const wrong = perCall(rawPolicy).filter((r) => !r.acceptable.includes(r.pred as Label));
const groups = new Map<string, string[]>();
for (const r of wrong) groups.set(r.category, [...(groups.get(r.category) ?? []), `${r.key}: ${r.truth}→${r.pred}${r.critical && r.pred === "DROP" ? " (CRITICAL)" : ""}`]);
for (const [cat, xs] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) out(`- **${cat}** (${xs.length}): ${[...new Set(xs)].map((x) => `${x} ×${xs.filter((y) => y === x).length}`).join("; ")}`);
out();

const md = lines.join("\n");
const mdFile = file.replace(/\.json$/, ".md");
writeFileSync(mdFile, md);
console.log(md);
console.error(`\nwrote ${mdFile}`);
