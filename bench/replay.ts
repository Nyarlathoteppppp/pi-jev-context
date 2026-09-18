// Replays real pi sessions through the production decision code with live Jev, never touching them.
//
//   node bench/replay.ts write [--max 400]    write-time trimming on every eligible real tool result
//   node bench/replay.ts prune [--max 600]    old-context pruning (raw Jev / hybrid / rules) at user-message checkpoints
//
// Real session content goes to Jev (OpenRouter / TypeSafe). Per-item records stay in results-private/
// (gitignored, may contain code); only aggregate metrics are printed for the public report.
//
// Weak labels ("the agent needed it later"), since real sessions have no ground truth:
//   a fact = a distinctive token (path, dotted/underscored identifier, error code, 4+ digit number, long camelCase word)
//   an old result is NEEDED LATER if one of its facts that appears nowhere else in the context up to the
//   checkpoint shows up after the checkpoint in the agent's text, a tool call argument, or a user message.
//   An omitted part of a trimmed output is NEEDED if one of its facts (absent from the kept text) shows up later.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { estimateTokens, textOf, toolEvents } from "../src/extract.ts";
import { Jev, type NoulAnswer, resolveTransport } from "../src/jev.ts";
import { percentile } from "../src/metrics.ts";
import { guardedPolicy, type JevReading, rulePolicy } from "../src/policy.ts";
import { hybridPolicy, sourceFacts } from "../src/protect.ts";
import { questionsFor, SIGNALS } from "../src/questions.ts";
import { buildState } from "../src/state.ts";
import { shouldConsider } from "../src/trim.ts";
import type { Message } from "../src/types.ts";
import { planTrim } from "../src/writetime.ts";
import { planSieve, sieveDecide, DEFAULT_SIEVE } from "../src/sieve.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { max: { type: "string" }, root: { type: "string" }, concurrency: { type: "string", default: "6" }, "needed-only": { type: "boolean", default: false }, engine: { type: "string", default: "select" } } });
const what = positionals[0] ?? "write";
const root = values.root ?? join(homedir(), ".pi/agent/sessions");
const conc = Number(values.concurrency);

// ---- sessions ------------------------------------------------------------------------------------

function sessions(): Array<{ file: string; messages: Message[] }> {
	const files: string[] = [];
	const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".jsonl")) files.push(p); } };
	walk(root);
	return files.map((file) => {
		const messages: Message[] = [];
		for (const line of readFileSync(file, "utf8").split("\n")) {
			if (!line) continue;
			let e: any;
			try { e = JSON.parse(line); } catch { continue; }
			const m = e.type === "message" ? e.message : undefined;
			if (m && ["user", "assistant", "toolResult"].includes(m.role)) messages.push(m);
		}
		return { file, messages };
	}).filter((s) => s.messages.length > 0);
}

// ---- weak labels ------------------------------------------------------------------------------------

const FACT = /(?:[\w@~.-]*\/[\w@.\/-]+|[A-Za-z_][\w-]*\.[\w.-]*[A-Za-z]\w*|\b[A-Z][A-Z0-9_]{3,}\b|\b(?:TS|E|ERR_)\d{3,}\b|\b\d{4,}\b|\b[a-z]+[A-Z]\w{5,}\b|\b\w+_\w+\b)/g;
const factsOf = (s: string) => new Set((s.match(FACT) ?? []).filter((f) => f.length >= 5 && f.length <= 120 && !/^(?:https?|node_modules)/.test(f)));

/**
 * Facts from `candidates` the agent/user used after message `i` BEFORE any later tool result supplied them
 * again (if a later result re-supplied a fact first, the agent did not need it from this output).
 */
function usedBeforeResupplied(messages: Message[], i: number, candidates: string[], horizon = 80): string[] {
	const open = new Set(candidates);
	const used: string[] = [];
	for (const m of messages.slice(i + 1, i + 1 + horizon)) {
		if (!open.size) break;
		const text = m.role === "toolResult" ? textOf(m.content) : m.role === "user" ? textOf(m.content) : m.content.map((c) => (c.type === "text" ? c.text : c.type === "toolCall" ? JSON.stringify(c.arguments) : "")).join("\n");
		for (const f of [...open]) {
			if (!text.includes(f)) continue;
			open.delete(f);
			if (m.role !== "toolResult") used.push(f);
		}
	}
	return used;
}

/** Everything the agent / user said or did after message index `i` (the "future"). */
function futureText(messages: Message[], i: number, horizon = 80): string {
	return messages.slice(i + 1, i + 1 + horizon).map((m) => {
		if (m.role === "user") return textOf(m.content);
		if (m.role === "assistant") return m.content.map((c) => (c.type === "text" ? c.text : c.type === "toolCall" ? JSON.stringify(c.arguments) : "")).join("\n");
		return ""; // tool results are the world talking, not the agent needing something
	}).join("\n");
}

// ---- helpers ----------------------------------------------------------------------------------------

async function pool<T>(items: T[], n: number, f: (x: T, i: number) => Promise<void>) {
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; await f(items[i]!, i); } }));
}
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}% (${a}/${b})`;
const transport = resolveTransport();
if (!transport) throw new Error("no Jev key");
const jev = new Jev(transport);
mkdirSync("results-private", { recursive: true });
const all = sessions();
console.log(`${all.length} sessions from ${root}`);

// ---- write-time ---------------------------------------------------------------------------------------

if (what === "write") {
	type Job = { s: number; idx: number; messages: Message[]; toolCallId: string; toolName: string; input: Record<string, unknown>; text: string; isError: boolean };
	const jobs: Job[] = [];
	all.forEach(({ messages }, s) => {
		const calls = new Map<string, Record<string, unknown>>();
		messages.forEach((m, idx) => {
			if (m.role === "assistant") for (const c of m.content) if (c.type === "toolCall") calls.set(c.id, c.arguments);
			if (m.role !== "toolResult" || !m.content.every((c) => c.type === "text")) return;
			const input = calls.get(m.toolCallId) ?? {};
			const text = textOf(m.content);
			if (shouldConsider(m.toolName, input, text)) jobs.push({ s, idx, messages, toolCallId: m.toolCallId, toolName: m.toolName, input, text, isError: m.isError });
		});
	});
	const max = Number(values.max ?? jobs.length);
	const picked = jobs.slice(0, max);
	console.log(`eligible real tool results: ${jobs.length}, replaying ${picked.length}`);
	const out: any[] = [];
	if (values.engine === "sieve") {
		const recs: any[] = [];
		await pool(picked, conc, async (j) => {
			const fresh = { toolCallId: j.toolCallId, toolName: j.toolName, input: j.input, text: j.text, isError: j.isError };
			const p = await planSieve(jev, j.messages.slice(0, j.idx - 1), fresh, "r", { timeoutMs: 15000 });
			const before = j.messages.slice(0, j.idx).map((m) => (m.role === "user" ? textOf(m.content) : m.role === "toolResult" ? textOf(m.content) : JSON.stringify(m.content))).join("\n");
			// Per block: facts only this block has (vs the rest of the output and everything before), used later before resupplied.
			const blockFacts = p.blocks.map((b) => [...factsOf(b.text)].filter((f) => !before.includes(f)));
			const blocks = p.blocks.map((b, k) => {
				const others = new Set(p.blocks.filter((_, x) => x !== k).flatMap((_, x) => blockFacts[x]!));
				const mine = blockFacts[k]!.filter((f) => !others.has(f));
				return { id: b.id, text: b.text, lines: b.to - b.from + 1, chars: b.text.length, tokens: estimateTokens(b.text), p: p.probs[b.id], needed: usedBeforeResupplied(j.messages, j.idx, mine).length > 0 };
			});
			recs.push({ request: textOf(j.messages.slice(0, j.idx).filter((m) => m.role === "user").at(-1)?.content ?? ""), session: j.s, tool: j.toolName, isError: j.isError, lines: j.text.split("\n").length, tokens: estimateTokens(j.text), need: p.need, userAsked: p.userAsked, trimmed: !!p.trimmed, kept: p.trimmed?.keptTokens, skip: p.skip, blocks, ms: p.call.ms, cost: p.call.cost, error: p.call.error });
		});
		writeFileSync("results-private/replay-sieve.json", JSON.stringify(recs, null, 1));
		const ok = recs.filter((r) => !r.error);
		console.log(`\n== sieve replay ==  judged ${ok.length}, errors ${recs.length - ok.length}; cost $${recs.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(4)}; p50 ${percentile(ok.map((r) => r.ms), 50)} ms, p95 ${percentile(ok.map((r) => r.ms), 95)} ms`);
		console.log("| drop < | outputs rewritten | blocks hidden | tokens hidden | needed blocks hidden (block regret) | outputs with a needed block hidden |");
		console.log("|---|---|---|---|---|---|");
		for (const drop of [0.05, 0.1, 0.15, 0.2, 0.3, 0.5]) {
			let rewritten = 0, hiddenB = 0, allB = 0, hiddenTok = 0, allTok = 0, neededAll = 0, neededHidden = 0, badOutputs = 0;
			for (const r of ok) {
				const units = r.blocks.map((b: any) => ({ id: b.id, from: 0, to: 0, text: b.text ?? "x".repeat(b.chars) }));
				const probs = Object.fromEntries(r.blocks.map((b: any) => [b.id, b.p]));
				const { hidden } = sieveDecide(r.need, r.userAsked, units, probs, { ...DEFAULT_SIEVE, drop }, r.request);
				const hid = new Set(hidden.map((h) => h.id));
				const tokH = r.blocks.filter((b: any) => hid.has(b.id)).reduce((s: number, b: any) => s + b.tokens, 0);
				allTok += r.tokens; allB += r.blocks.length; neededAll += r.blocks.filter((b: any) => b.needed).length;
				if (!hid.size || tokH < r.tokens * DEFAULT_SIEVE.minHiddenShare) continue;
				rewritten++; hiddenB += hid.size; hiddenTok += tokH;
				const nh = r.blocks.filter((b: any) => b.needed && hid.has(b.id)).length;
				neededHidden += nh; if (nh) badOutputs++;
			}
			console.log(`| ${drop} | ${pct(rewritten, ok.length)} | ${pct(hiddenB, allB)} | ${((hiddenTok / allTok) * 100).toFixed(1)}% | ${pct(neededHidden, neededAll)} | ${pct(badOutputs, rewritten)} |`);
		}
		process.exit(0);
	}
	await pool(picked, conc, async (j) => {
		// Context as the agent saw it: everything before this result (minus the result's own call, re-added by planTrim).
		const plan = await planTrim(jev, j.messages.slice(0, j.idx - 1), { toolCallId: j.toolCallId, toolName: j.toolName, input: j.input, text: j.text, isError: j.isError }, "r", { timeoutMs: 15000 });
		let neededOmitted: string[] = [];
		if (plan.trimmed) {
			const kept = factsOf(plan.trimmed.text);
			const omitted = [...factsOf(j.text)].filter((f) => !kept.has(f));
			const before = j.messages.slice(0, j.idx).map((m) => (m.role === "user" ? textOf(m.content) : m.role === "toolResult" ? textOf(m.content) : JSON.stringify(m.content))).join("\n");
			neededOmitted = usedBeforeResupplied(j.messages, j.idx, omitted.filter((f) => !before.includes(f)));
		}
		out.push({ session: j.s, tool: j.toolName, mode: plan.mode, isError: j.isError, lines: j.text.split("\n").length, tokens: estimateTokens(j.text), trimmed: !!plan.trimmed, kept: plan.trimmed?.keptTokens, need: plan.reading?.need.choice, p: plan.reading?.need.probabilities[plan.reading.need.choice], skip: plan.skip, ms: plan.call.ms, cost: plan.call.cost, error: plan.call.error, neededOmitted: neededOmitted.slice(0, 5) });
	});
	writeFileSync("results-private/replay-write.json", JSON.stringify(out, null, 1));
	const trimmed = out.filter((o) => o.trimmed);
	const tokIn = out.reduce((s, o) => s + o.tokens, 0);
	const tokSaved = trimmed.reduce((s, o) => s + o.tokens - o.kept, 0);
	const ms = out.filter((o) => !o.error).map((o) => o.ms);
	const byNeed = new Map<string, number>();
	for (const o of out) byNeed.set(o.need ?? `error`, (byNeed.get(o.need ?? "error") ?? 0) + 1);
	console.log(`\n== write-time replay ==`);
	console.log(`judged ${out.length}, errors ${out.filter((o) => o.error).length}`);
	console.log(`need: ${[...byNeed].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
	console.log(`trimmed: ${pct(trimmed.length, out.length)}; tokens saved ${tokSaved} of ${tokIn} eligible (${((tokSaved / tokIn) * 100).toFixed(1)}%)`);
	console.log(`weak "omitted fact used later": ${pct(trimmed.filter((o) => o.neededOmitted.length).length, trimmed.length)} of trims`);
	for (const m of ["lines", "blocks"]) console.log(`  ${m} mode: ${pct(trimmed.filter((o) => o.mode === m && o.neededOmitted.length).length, trimmed.filter((o) => o.mode === m).length)}`);
	for (const n of ["specific_parts", "outcome_only"]) console.log(`  need=${n}: ${pct(trimmed.filter((o) => o.need === n && o.neededOmitted.length).length, trimmed.filter((o) => o.need === n).length)}`);
	console.log(`  among failing commands: ${pct(trimmed.filter((o) => o.isError && o.neededOmitted.length).length, trimmed.filter((o) => o.isError).length)}`);
	console.log(`by tool: ${[...new Set(out.map((o) => o.tool))].map((t) => `${t} ${out.filter((o) => o.tool === t && o.trimmed).length}/${out.filter((o) => o.tool === t).length}`).join(" · ")}`);
	console.log(`latency p50 ${percentile(ms, 50)} ms, p95 ${percentile(ms, 95)} ms; cost $${out.reduce((s, o) => s + (o.cost ?? 0), 0).toFixed(5)}`);
}

// ---- old-context pruning ------------------------------------------------------------------------------

if (what === "prune") {
	type Job = { s: number; cp: number; messages: Message[]; toolCallId: string; tokens: number; needed: boolean; facts: number };
	const jobs: Job[] = [];
	all.forEach(({ messages }, s) => {
		const userIdx = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
		// Facts per message, computed once. For "only source" we count, per fact, how many messages up to the
		// checkpoint contain it (tool results and conversation alike).
		const factSets = messages.map((m) => factsOf(m.role === "toolResult" ? textOf(m.content) : m.role === "user" ? textOf(m.content) : JSON.stringify(m.content)));
		const count = new Map<string, number>();
		let upto = 0;
		// At most 8 checkpoints per session, spread evenly, skipping the first two user messages.
		const cps = userIdx.slice(2);
		const step = Math.max(1, Math.ceil(cps.length / 8));
		for (const u of cps.filter((_, k) => k % step === 0)) {
			for (; upto <= u; upto++) for (const f of factSets[upto]!) count.set(f, (count.get(f) ?? 0) + 1);
			const ctx = messages.slice(0, u + 1);
			const prevUser = userIdx[userIdx.indexOf(u) - 1]!;
			for (let i = 0; i < prevUser; i++) {
				const m = ctx[i]!;
				if (m.role !== "toolResult") continue;
				const tokens = estimateTokens(textOf(m.content));
				if (tokens < 150) continue;
				// Facts this result is the only source of in the context so far.
				const mine = [...factSets[i]!].filter((f) => count.get(f) === 1);
				const needed = mine.length > 0 && usedBeforeResupplied(messages, u, mine, 120).length > 0;
				jobs.push({ s, cp: u, messages: ctx, toolCallId: m.toolCallId, tokens, needed, facts: mine.length });
			}
		}
	});
	// Spread the budget over sessions and checkpoints: deterministic stride sample.
	const max = Number(values.max ?? 600);
	// --needed-only: every weakly-needed pair (to measure the false-drop rate with a usable sample).
	const pool0 = values["needed-only"] ? jobs.filter((j) => j.needed) : jobs;
	const stride = Math.max(1, Math.floor(pool0.length / max));
	const picked = pool0.filter((_, i) => i % stride === 0).slice(0, max);
	console.log(`candidate (checkpoint, old result) pairs: ${jobs.length}, judging ${picked.length}; weakly needed later: ${pct(picked.filter((j) => j.needed).length, picked.length)}`);
	const out: any[] = [];
	await pool(picked, conc, async (j) => {
		const facts = sourceFacts(j.messages, j.toolCallId);
		const b = buildState(j.messages, j.toolCallId);
		const call = await jev.decide(b.state, questionsFor(b.keyLineCandidates), 15000);
		let reading: JevReading | undefined;
		if (call.answers) {
			const signals: Record<string, number> = {};
			for (const k of Object.keys(SIGNALS)) signals[k] = (call.answers[k] as NoulAnswer).noul;
			reading = { decision: call.answers.decision as JevReading["decision"], signals, lines: {}, excerpted: b.excerpted };
		}
		const tool = toolEvents(j.messages).find((e) => e.id === j.toolCallId)!;
		out.push({ session: j.s, tool: tool.name, tokens: j.tokens, needed: j.needed, uniqueFacts: j.facts, raw: reading?.decision.choice ?? "ERROR", guarded: reading ? guardedPolicy(reading) : "KEEP", hybrid: hybridPolicy(reading, facts), rules: rulePolicy(j.messages, j.toolCallId), durable: facts.durableSource, superseded: facts.superseded, exactRepeat: facts.exactRepeat, ms: call.ms, cost: call.cost, error: call.error });
	});
	writeFileSync(values["needed-only"] ? "results-private/replay-prune-needed.json" : "results-private/replay-prune.json", JSON.stringify(out, null, 1));
	const ok = out.filter((o) => !o.error);
	console.log(`\n== pruning replay (weak labels) ==  judged ${ok.length}, errors ${out.length - ok.length}`);
	console.log("| policy | DROP | TRUNCATE | KEEP | weak critical false drop (needed & DROP / needed) | drop precision (not needed / DROP) | tokens droppable |");
	console.log("|---|---|---|---|---|---|---|");
	for (const p of ["raw", "guarded", "hybrid", "rules"]) {
		const d = ok.filter((o) => o[p] === "DROP");
		const needed = ok.filter((o) => o.needed);
		console.log(`| ${p} | ${d.length} | ${ok.filter((o) => o[p] === "TRUNCATE").length} | ${ok.filter((o) => o[p] === "KEEP").length} | ${pct(needed.filter((o) => o[p] === "DROP").length, needed.length)} | ${pct(d.filter((o) => !o.needed).length, d.length)} | ${d.reduce((s, o) => s + o.tokens, 0)} of ${ok.reduce((s, o) => s + o.tokens, 0)} |`);
	}
	const ms = ok.map((o) => o.ms);
	console.log(`latency p50 ${percentile(ms, 50)} ms, p95 ${percentile(ms, 95)} ms; cost $${out.reduce((s, o) => s + (o.cost ?? 0), 0).toFixed(5)}`);
	const fd = ok.filter((o) => o.needed && o.hybrid === "DROP");
	console.log(`hybrid weak false drops by tool: ${[...new Set(fd.map((o) => o.tool))].map((t) => `${t} ${fd.filter((o) => o.tool === t).length}`).join(" · ") || "none"}`);
}
