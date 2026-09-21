// Offline: if a re-read of a file the agent already read were replaced by a unified diff against the
// version it last saw, how many tokens would that save? Nothing leaves the machine.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
const dir = mkdtempSync(join(tmpdir(), "reread-"));
const a = join(dir, "a");
const b = join(dir, "b");

function unifiedDiff(from: string, to: string, context: number): string {
	writeFileSync(a, from);
	writeFileSync(b, to);
	try {
		execFileSync("diff", [`-U${context}`, a, b], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
		return "";
	} catch (e: any) {
		return typeof e.stdout === "string" ? e.stdout : "";
	}
}

let n = 0;
let full = 0;
const saved = new Map<number, number>();
const worse = new Map<number, number>();
const CONTEXTS = [0, 3, 6];
for (const f of files) {
	const calls = new Map<string, Record<string, unknown>>();
	const last = new Map<string, string>();
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
		if (m.role === "assistant") for (const c of m.content ?? []) if (c.type === "toolCall") calls.set(c.id, c.arguments ?? {});
		if (m.role !== "toolResult" || m.toolName !== "read") continue;
		const path = String(calls.get(m.toolCallId)?.path ?? "");
		const text = textOf(m.content);
		const before = last.get(path);
		last.set(path, text);
		if (before === undefined || before === text || !path) continue;
		n++;
		const tok = estimateTokens(text);
		full += tok;
		for (const c of CONTEXTS) {
			const d = estimateTokens(unifiedDiff(before, text, c));
			// A diff only replaces the read when it is clearly smaller; otherwise the full text is kept.
			if (d < tok * 0.5) saved.set(c, (saved.get(c) ?? 0) + (tok - d));
			else worse.set(c, (worse.get(c) ?? 0) + 1);
		}
	}
}
const k = (x: number) => `${(x / 1000).toFixed(0)}k`;
console.log(`changed re-reads: ${n}, full text ${k(full)} tok`);
for (const c of CONTEXTS) {
	const s = saved.get(c) ?? 0;
	console.log(`  diff -U${c}: saves ${k(s)} tok (${((s / full) * 100).toFixed(1)}% of re-read tokens); kept whole because the diff was not small enough: ${worse.get(c) ?? 0}/${n}`);
}
