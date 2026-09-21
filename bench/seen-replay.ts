// Replays the deterministic read de-duplication over real pi sessions, using the production planCollapse.
// Offline: no model, no network, nothing leaves the machine.
//
//   node bench/seen-replay.ts [sessions-dir] [--min-run 30]

import { buildContextEntries } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { estimateTokens, textOf } from "../src/extract.ts";
import { DEFAULT_SEEN, planCollapse } from "../src/seen.ts";
import type { Message } from "../src/types.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { "min-run": { type: "string" }, "min-share": { type: "string" } } });
const cfg = { ...DEFAULT_SEEN, minRun: Number(values["min-run"] ?? DEFAULT_SEEN.minRun), minSavedShare: Number(values["min-share"] ?? DEFAULT_SEEN.minSavedShare) };

const files: string[] = [];
const walk = (d: string) => {
	for (const f of readdirSync(d)) {
		const p = join(d, f);
		if (statSync(p).isDirectory()) walk(p);
		else if (p.endsWith(".jsonl")) files.push(p);
	}
};
walk(positionals[0] ?? join(homedir(), ".pi/agent/sessions"));

let reads = 0;
let readTok = 0;
let collapsed = 0;
let saved = 0;
let allTok = 0;
const perSession: Array<{ reads: number; collapsed: number; saved: number; readTok: number }> = [];

for (const f of files) {
	const calls = new Map<string, Record<string, unknown>>();
	const entries: any[] = [];
	const s = { reads: 0, collapsed: 0, saved: 0, readTok: 0 };
	for (const line of readFileSync(f, "utf8").split("\n")) {
		if (!line) continue;
		let e: any;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		const context = buildContextEntries(entries, e.parentId).flatMap((entry: any) => entry.type === "message" && ["user", "assistant", "toolResult"].includes(entry.message.role) ? [entry.message as Message] : []);
		entries.push(e);
		const m = e.type === "message" ? e.message : undefined;
		if (!m || !["user", "assistant", "toolResult"].includes(m.role)) continue;
		if (m.role === "assistant") for (const c of m.content ?? []) if (c.type === "toolCall") calls.set(c.id, c.arguments ?? {});
		if (m.role === "toolResult" && Array.isArray(m.content) && m.content.every((c: any) => c.type === "text")) {
			const text = textOf(m.content);
			allTok += estimateTokens(text);
			if (m.toolName === "read") {
				const input = calls.get(m.toolCallId) ?? {};
				s.reads++;
				s.readTok += estimateTokens(text);
				const c = planCollapse(context, { toolCallId: m.toolCallId, toolName: "read", input, text, isError: !!m.isError }, "t", cfg);
				if (c) {
					s.collapsed++;
					s.saved += c.originalTokens - c.keptTokens;
					// What the agent would have seen from here on is the collapsed text.
					e.message = { ...m, content: [{ type: "text", text: c.text }] };
					continue;
				}
			}
		}
	}
	if (s.reads) perSession.push(s);
	reads += s.reads;
	readTok += s.readTok;
	collapsed += s.collapsed;
	saved += s.saved;
}

const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
const k = (n: number) => `${(n / 1000).toFixed(0)}k`;
console.log(`sessions ${files.length}, reads ${reads} (${k(readTok)} tok of ${k(allTok)} tool tokens)`);
console.log(`minRun=${cfg.minRun} lines, minSavedShare=${cfg.minSavedShare}`);
console.log(`  reads rewritten: ${collapsed} (${pct(collapsed, reads)})`);
console.log(`  tokens saved: ${k(saved)} = ${pct(saved, readTok)} of read tokens, ${pct(saved, allTok)} of all tool tokens`);
const top = perSession.sort((a, b) => b.saved - a.saved).slice(0, 5);
console.log(`  best sessions: ${top.map((x) => `${k(x.saved)} saved of ${k(x.readTok)} (${pct(x.saved, x.readTok)}, ${x.collapsed}/${x.reads} reads)`).join(" · ")}`);
