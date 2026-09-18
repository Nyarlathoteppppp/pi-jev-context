// Offline census of real pi sessions: how much tool-result text would write-time trimming even look at?
// Reads ~/.pi/agent/sessions/**/*.jsonl locally. No network, nothing leaves the machine.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { estimateTokens, textOf } from "../src/extract.ts";
import { shouldConsider } from "../src/trim.ts";

const root = process.argv[2] ?? join(homedir(), ".pi/agent/sessions");
const files: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".jsonl")) files.push(p); } };
walk(root);

let sessions = 0, results = 0, resultTok = 0, userTok = 0, assistantTok = 0, eligible = 0, eligibleTok = 0;
const byTool = new Map<string, { n: number; tok: number; eligible: number; eligibleTok: number }>();
const sizes: number[] = [];
for (const f of files) {
	const calls = new Map<string, Record<string, unknown>>();
	let any = false;
	for (const line of readFileSync(f, "utf8").split("\n")) {
		if (!line) continue;
		let e: any; try { e = JSON.parse(line); } catch { continue; }
		const m = e.type === "message" ? e.message : undefined;
		if (!m) continue;
		any = true;
		if (m.role === "user") userTok += estimateTokens(textOf(m.content));
		if (m.role === "assistant") for (const c of m.content ?? []) { if (c.type === "toolCall") calls.set(c.id, c.arguments ?? {}); if (c.type === "text") assistantTok += estimateTokens(c.text); }
		if (m.role === "toolResult") {
			const text = textOf(m.content); const tok = estimateTokens(text); const lines = text.split("\n").length;
			results++; resultTok += tok; sizes.push(lines);
			const t = byTool.get(m.toolName) ?? { n: 0, tok: 0, eligible: 0, eligibleTok: 0 };
			t.n++; t.tok += tok;
			if (shouldConsider(m.toolName, calls.get(m.toolCallId) ?? {}, text)) { eligible++; eligibleTok += tok; t.eligible++; t.eligibleTok += tok; }
			byTool.set(m.toolName, t);
		}
	}
	if (any) sessions++;
}
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
const k = (n: number) => `${(n / 1000).toFixed(0)}k`;
console.log(`sessions ${sessions} (files ${files.length}), tool results ${results}`);
console.log(`tokens: tool results ${k(resultTok)} · assistant text ${k(assistantTok)} · user ${k(userTok)}  → tool results are ${pct(resultTok, resultTok + assistantTok + userTok)} of message text`);
console.log(`write-time eligible (≥150 lines, not read/edit/write/cat/diff): ${eligible} results (${pct(eligible, results)}), ${k(eligibleTok)} tokens = ${pct(eligibleTok, resultTok)} of tool-result tokens`);
console.log("by tool (top 10 by tokens): tool  results  tokens  eligible  eligibleTokens");
for (const [name, t] of [...byTool].sort((a, b) => b[1].tok - a[1].tok).slice(0, 10)) console.log(`  ${name.padEnd(22)} ${String(t.n).padStart(6)} ${k(t.tok).padStart(7)} ${String(t.eligible).padStart(6)} ${k(t.eligibleTok).padStart(7)}`);
sizes.sort((a, b) => a - b);
console.log(`result size in lines: p50 ${sizes[Math.floor(sizes.length * 0.5)]}, p90 ${sizes[Math.floor(sizes.length * 0.9)]}, p99 ${sizes[Math.floor(sizes.length * 0.99)]}`);
