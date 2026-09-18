// Shadow evaluation runner. Builds a bounded state for every labelled old tool result, asks Jev,
// and stores the raw answers. Never touches a real pi session or context.
//
//   node bench/run.ts [--repeats 5] [--only C04,C05] [--dry-run]
//
// Key: OPENROUTER_API_KEY / TYPESAFE_API_KEY, or a dotenv file named by PI_JEV_ENV_FILE / PI_HEED_ENV_FILE.

import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Jev, type JevCall, resolveTransport } from "../src/jev.ts";
import { QUESTIONS_VERSION, questionsFor } from "../src/questions.ts";
import { buildState } from "../src/state.ts";
import { items } from "./cases.ts";

const { values } = parseArgs({
	options: {
		repeats: { type: "string", default: "5" },
		only: { type: "string" },
		"dry-run": { type: "boolean", default: false },
		out: { type: "string" },
	},
});

const repeats = Math.max(1, Number(values.repeats));
const only = values.only?.split(",");
const selected = items().filter((i) => !only || only.includes(i.caseId));

export interface ItemResult {
	key: string;
	caseId: string;
	category: string;
	checkpoint: string;
	target: ReturnType<typeof items>[number]["target"];
	targetId: string;
	at: number;
	stateTokens: number;
	excerpted: boolean;
	keyLineCandidates: Array<{ n: number; text: string }>;
	calls: JevCall[];
}

if (values["dry-run"]) {
	for (const it of selected) {
		const b = buildState(it.c.session.messages.slice(0, it.at), it.targetId);
		console.log(`\n===== ${it.key}  [${it.category}]  truth=${it.target.truth}  ~${b.approxTokens} tok  candidates=${b.keyLineCandidates.length}`);
		console.log(JSON.stringify(b.state, null, 2));
	}
	console.log(`\n${selected.length} items, ${new Set(selected.map((i) => i.caseId)).size} cases`);
	process.exit(0);
}

const transport = resolveTransport();
if (!transport) {
	console.error("no Jev key: set OPENROUTER_API_KEY / TYPESAFE_API_KEY or PI_JEV_ENV_FILE / PI_HEED_ENV_FILE");
	process.exit(1);
}
const jev = new Jev(transport);

// Warm-up (DNS + TLS), excluded from latency stats.
await jev.decide("warm-up", { q: { type: "noul", instructions: "This is a warm-up request." } });

const results: ItemResult[] = [];
let model = "";
for (const it of selected) {
	const b = buildState(it.c.session.messages.slice(0, it.at), it.targetId);
	const questions = questionsFor(b.keyLineCandidates);
	const calls: JevCall[] = [];
	for (let r = 0; r < repeats; r++) {
		const call = await jev.decide(b.state, questions);
		model ||= call.model ?? "";
		calls.push(call);
	}
	const picks = calls.map((c) => (c.answers?.decision as { choice?: string } | undefined)?.choice ?? `ERR(${c.error})`);
	console.log(`${it.key.padEnd(14)} truth=${it.target.truth.padEnd(8)} jev=${picks.join(",")}  ${calls.map((c) => c.ms).join("/")}ms`);
	results.push({
		key: it.key,
		caseId: it.caseId,
		category: it.category,
		checkpoint: it.checkpoint,
		target: it.target,
		targetId: it.targetId,
		at: it.at,
		stateTokens: b.approxTokens,
		excerpted: b.excerpted,
		keyLineCandidates: b.keyLineCandidates,
		calls,
	});
}

mkdirSync("results", { recursive: true });
const file = values.out ?? `results/run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ meta: { model, requested: transport.model, endpoint: transport.url, questions: QUESTIONS_VERSION, repeats, date: new Date().toISOString() }, results }, null, 1));
console.log(`\nwrote ${file}\nnext: node bench/report.ts ${file}`);
