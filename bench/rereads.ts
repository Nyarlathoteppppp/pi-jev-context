// Offline census: how much of the tool traffic in real sessions repeats something already in context?
// Nothing leaves the machine.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { estimateTokens, textOf } from "../src/extract.ts";

const files: string[] = [];
const walk = (d: string) => {
	for (const f of readdirSync(d)) {
		const p = join(d, f);
		if (statSync(p).isDirectory()) walk(p);
		else if (p.endsWith(".jsonl")) files.push(p);
	}
};
walk(process.argv[2] ?? join(homedir(), ".pi/agent/sessions"));

let allN = 0;
let allTok = 0;
let readN = 0;
let readTok = 0;
let dupN = 0;
let dupTok = 0;
let changedN = 0;
let changedTok = 0;
let anyDupN = 0;
let anyDupTok = 0;
const perTool = new Map<string, { dup: number; tok: number }>();
const SEP = String.fromCharCode(0);

for (const f of files) {
	const calls = new Map<string, { name?: string; args?: Record<string, unknown> }>();
	const lastRead = new Map<string, string>();
	const seen = new Set<string>();
	for (const line of readFileSync(f, "utf8").split("\n")) {
		if (!line) continue;
		let e: any;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		const m = e.message;
		if (!m) continue;
		if (m.role === "assistant") for (const c of m.content ?? []) if (c.type === "toolCall") calls.set(c.id, { name: c.name, args: c.arguments });
		if (m.role !== "toolResult") continue;
		const call = calls.get(m.toolCallId) ?? {};
		const text = textOf(m.content);
		const tok = estimateTokens(text);
		allN++;
		allTok += tok;
		const key = `${m.toolName}${SEP}${JSON.stringify(call.args ?? {})}${SEP}${text}`;
		if (seen.has(key)) {
			anyDupN++;
			anyDupTok += tok;
			const t = perTool.get(m.toolName) ?? { dup: 0, tok: 0 };
			t.dup++;
			t.tok += tok;
			perTool.set(m.toolName, t);
		}
		seen.add(key);
		if (m.toolName === "read") {
			readN++;
			readTok += tok;
			const path = String(call.args?.path ?? "");
			const before = lastRead.get(path);
			if (before !== undefined) {
				if (before === text) {
					dupN++;
					dupTok += tok;
				} else {
					changedN++;
					changedTok += tok;
				}
			}
			lastRead.set(path, text);
		}
	}
}

const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
const k = (n: number) => `${(n / 1000).toFixed(0)}k`;
console.log(`sessions ${files.length}; all tool results ${allN} (${k(allTok)} tok)`);
console.log(`read results: ${readN} (${k(readTok)} tok, ${pct(readTok, allTok)} of tool tokens)`);
console.log(`  re-read identical to the previous read of that path: ${dupN} (${pct(dupN, readN)} of reads), ${k(dupTok)} tok = ${pct(dupTok, allTok)} of all tool tokens`);
console.log(`  re-read with changed content: ${changedN} (${pct(changedN, readN)}), ${k(changedTok)} tok`);
console.log(`exact duplicate result, any tool (same tool + args + output seen earlier): ${anyDupN} (${pct(anyDupN, allN)}), ${k(anyDupTok)} tok = ${pct(anyDupTok, allTok)}`);
console.log(`by tool: ${[...perTool].sort((a, b) => b[1].tok - a[1].tok).slice(0, 8).map(([n, t]) => `${n} ${t.dup} results / ${k(t.tok)} tok`).join(" · ")}`);
