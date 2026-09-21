// POST-HOC (designed after run-q1 dev + held-out): deterministic protections around Jev.
// Evaluated on dev and held-out together; both sets have now been seen, so this needs a third, fresh set.
import { readFileSync } from "node:fs";
import { relatedKey, toolEvents } from "../../src/extract.ts";
import type { ChoiceAnswer, NoulAnswer } from "../experimental/jev.ts";
import { summarize, type Row } from "../experimental/metrics.ts";
import { guardedPolicy, type JevReading, rawPolicy } from "../experimental/policy.ts";
import { SIGNALS } from "../experimental/questions.ts";
import type { Label, Message, Prediction } from "../../src/types.ts";
import { CASES, items } from "./cases.ts";
import { HOLDOUT } from "./holdout.ts";
import type { ItemResult } from "./run.ts";

const byKey = new Map(items([...CASES, ...HOLDOUT]).map((i) => [i.key, i]));
const DURABLE_SOURCE = /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|[^/]*\.prisma|\.env[^/]*|docker-compose[^/]*\.ya?ml|[^/]*\.config\.[cm]?[jt]s|[^/]*\.(?:ya?ml|toml|ini)|Dockerfile|README[^/]*|[^/]*\.proto)$|(?:^|\/)(?:config|docs|adr)\//;
const VERSION_CMD = /(?:--version\b|\s-v$|^node -v|\bversion\b)/;

/** Where the fact comes from, not what Jev thinks of it. */
function facts(messages: Message[], id: string) {
	const ev = toolEvents(messages);
	const e = ev.find((x) => x.id === id)!;
	const later = ev.filter((x) => x.seq > e.seq && relatedKey(x) === relatedKey(e));
	const path = String(e.args.path ?? "");
	const cmd = String(e.args.command ?? "");
	const catPath = /^(?:cat|head|tail)\s+(\S+)/.exec(cmd)?.[1] ?? "";
	return {
		durableSource: DURABLE_SOURCE.test(path) || DURABLE_SOURCE.test(catPath) || VERSION_CMD.test(cmd),
		superseded: later.some((x) => x.name === e.name),
		exactRepeat: later.some((x) => x.name === e.name && x.output === e.output && x.isError === e.isError),
	};
}

function hybrid(x: JevReading, f: ReturnType<typeof facts>): Prediction {
	if (f.exactRepeat) return "DROP"; // identical newer copy exists: nothing is lost
	const p = guardedPolicy(x);
	if (p === "DROP" && f.durableSource && !f.superseded) return "TRUNCATE";
	return p;
}

const pct = (v: number) => (Number.isNaN(v) ? "n/a" : `${(v * 100).toFixed(1)}%`);
for (const file of process.argv.slice(2)) {
	const { results } = JSON.parse(readFileSync(file, "utf8")) as { results: ItemResult[] };
	const rows = (f: (x: JevReading, r: ItemResult) => Prediction): Row[] =>
		results.flatMap((r) => {
			const it = byKey.get(r.key)!;
			return r.calls.flatMap((c) => {
				if (!c.answers) return [];
				const signals: Record<string, number> = {};
				for (const [k, a] of Object.entries(c.answers)) if (k in SIGNALS) signals[k] = (a as NoulAnswer).noul;
				const x: JevReading = { decision: c.answers.decision as ChoiceAnswer, signals, lines: {}, excerpted: r.excerpted };
				return [{ key: r.key, category: r.category, truth: r.target.truth, acceptable: r.target.acceptable, critical: r.target.critical, pred: f(x, r), tokens: 1, truncatedTokens: 0 }];
			});
		});
	console.log(`\n${file}`);
	console.log("| policy | lenient acc | KEEP recall | critical FD | false drop | DROP prec | DROP recall | TRUNC acc | critical FD items |");
	console.log("|---|---|---|---|---|---|---|---|---|");
	const show = (name: string, rs: Row[]) => { const s = summarize(rs); console.log(`| ${name} | ${pct(s.lenientAccuracy)} | ${pct(s.keepRecall)} | ${pct(s.criticalFalseDropRate)} | ${pct(s.falseDropRate)} | ${pct(s.dropPrecision)} | ${pct(s.dropRecall)} | ${pct(s.truncateAccuracy)} | ${s.criticalFalseDrops.join(",")} |`); };
	show("jev raw", rows((x) => rawPolicy(x)));
	show("jev guarded", rows((x) => guardedPolicy(x)));
	show("hybrid (guarded + source protection + exact dedupe)", rows((x, r) => { const it = byKey.get(r.key)!; return hybrid(x, facts(it.c.session.messages.slice(0, it.at), r.targetId)); }));
}
