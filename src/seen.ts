import { estimateTokens, toolEvents } from "./extract.ts";
import type { Message } from "./types.ts";

export interface SeenConfig {
	minRun: number;
	minSavedShare: number;
	minLines: number;
	maxEarlierReads: number;
}
export const DEFAULT_SEEN: SeenConfig = { minRun: 30, minSavedShare: 0.3, minLines: 60, maxEarlierReads: 4 };
export interface Run { from: number; to: number; }
export interface ReadEvidence { text: string; offset: number; toolCallId: string; }
export interface Collapsed {
	text: string; collapsedLines: number; totalLines: number;
	originalTokens: number; keptTokens: number; runs: Run[];
}

// Pi appends a continuation notice to truncated/limited reads. It is not a file line.
function fileBody(text: string): { lines: string[]; footer: string } {
	const match = text.match(/\n\n\[(?:Showing lines \d+-\d+ of \d+[^\n]*|\d+ more lines in file\. Use offset=\d+ to continue\.)\]$/);
	return { lines: (match ? text.slice(0, match.index) : text).split("\n"), footer: match?.[0] ?? "" };
}
function offsetOf(args: Record<string, unknown>): number | undefined {
	const n = args.offset ?? 1;
	return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** Match exact text at the same absolute file position, never another identical block. */
export function matchingRuns(next: string[], earlier: string[], minRun: number, offset = 1, earlierOffset = 1): Run[] {
	const runs: Run[] = [];
	let start = -1;
	for (let i = 0; i <= next.length; i++) {
		const j = offset + i - earlierOffset;
		const equal = i < next.length && j >= 0 && j < earlier.length && next[i] === earlier[j];
		if (equal && start < 0) start = i;
		if (!equal && start >= 0) {
			if (i - start >= minRun) runs.push({ from: start + 1, to: i });
			start = -1;
		}
	}
	return runs;
}

/** Only visible, unshortened, text-only reads with known positions are evidence. */
export function earlierReads(messages: Message[], path: string, toolCallId: string, cfg = DEFAULT_SEEN): ReadEvidence[] {
	const out: ReadEvidence[] = [];
	for (const e of toolEvents(messages)) {
		if (e.id === toolCallId || e.isError || e.name !== "read" || e.args.path !== path) continue;
		const m = messages[e.index];
		if (!m || m.role !== "toolResult" || !Array.isArray(m.content) || !m.content.every(c => c.type === "text")) continue;
		// Folded results have lost the original positional mapping. Do not use stored originals as evidence.
		if (e.output.includes("context_recall with id") || e.output.startsWith("[pi-jev-context]")) continue;
		const offset = offsetOf(e.args);
		if (offset !== undefined) out.push({ text: e.output, offset, toolCallId: e.id });
	}
	return out.slice(-cfg.maxEarlierReads).reverse();
}

export function collapse(text: string, earlier: ReadEvidence[], alias: string, path: string, cfg = DEFAULT_SEEN, offset = 1): Collapsed | undefined {
	const { lines, footer } = fileBody(text);
	if (lines.length < cfg.minLines) return;
	let runs: Run[] = [];
	let source: ReadEvidence | undefined;
	let covered = 0;
	for (const e of earlier) {
		const candidate = matchingRuns(lines, fileBody(e.text).lines, cfg.minRun, offset, e.offset);
		const n = candidate.reduce((sum, r) => sum + r.to - r.from + 1, 0);
		if (n > covered) { runs = candidate; source = e; covered = n; }
	}
	if (!source) return;
	const body = [`[pi-jev-context] ${path}: file lines ${offset}-${offset + lines.length - 1}. Folded ${covered}/${lines.length} file lines matching read ${source.toolCallId} still in context. Full output: context_recall with id "${alias}".`];
	let cursor = 0;
	for (const r of runs) {
		body.push(...lines.slice(cursor, r.from - 1));
		body.push(`… [file lines ${offset + r.from - 1}-${offset + r.to - 1} unchanged; context_recall with id "${alias}"] …`);
		cursor = r.to;
	}
	body.push(...lines.slice(cursor));
	const out = body.join("\n") + footer;
	return { text: out, collapsedLines: covered, totalLines: lines.length, originalTokens: estimateTokens(text), keptTokens: estimateTokens(out), runs };
}
export const worthCollapsing = (c: Collapsed, cfg = DEFAULT_SEEN) => c.keptTokens <= c.originalTokens * (1 - cfg.minSavedShare);
export function planCollapse(messages: Message[], r: { toolCallId: string; toolName: string; input: Record<string, unknown>; text: string; isError: boolean }, alias: string, cfg = DEFAULT_SEEN): Collapsed | undefined {
	if (r.toolName !== "read" || r.isError || typeof r.input.path !== "string") return;
	const offset = offsetOf(r.input);
	if (offset === undefined) return;
	const c = collapse(r.text, earlierReads(messages, r.input.path, r.toolCallId, cfg), alias, r.input.path, cfg, offset);
	return c && worthCollapsing(c, cfg) ? c : undefined;
}
