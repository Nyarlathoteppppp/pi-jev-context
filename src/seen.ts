import { hiddenReferences } from "./hints.ts";
import { estimateTokens, textOf, toolEvents } from "./extract.ts";
import type { Message } from "./types.ts";

export interface SeenConfig {
	minRun: number;
	minSavedShare: number;
	minLines: number;
	maxEarlierReads: number;
	dedupeMaxAgeTokens: number;
}
export const DEFAULT_SEEN: SeenConfig = { minRun: 30, minSavedShare: 0.3, minLines: 60, maxEarlierReads: 4, dedupeMaxAgeTokens: 12_000 };
export interface Run { from: number; to: number; }
export interface ReadEvidence { text: string; offset: number; toolCallId: string; userTurn: number; ageTokens: number; }
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

function messageTokens(message: Message): number {
	if (message.role === "user") return estimateTokens(typeof message.content === "string" ? message.content : textOf(message.content));
	if (message.role === "toolResult") return estimateTokens(textOf(message.content));
	return estimateTokens(message.content.map((part) => part.type === "text" ? part.text : part.type === "toolCall" ? JSON.stringify(part.arguments) : part.thinking).join("\n"));
}

/** Only visible, unshortened, same-epoch reads within the deterministic token-age window are evidence. */
export function earlierReads(messages: Message[], path: string, toolCallId: string, cfg = DEFAULT_SEEN): ReadEvidence[] {
	const currentUserTurn = messages.reduce((turn, message) => turn + (message.role === "user" ? 1 : 0), 0);
	const out: ReadEvidence[] = [];
	const suffixTokens = new Array<number>(messages.length + 1).fill(0);
	for (let i = messages.length - 1; i >= 0; i--) suffixTokens[i] = suffixTokens[i + 1]! + messageTokens(messages[i]!);
	for (const e of toolEvents(messages)) {
		if (e.id === toolCallId || e.isError || e.name !== "read" || e.args.path !== path || e.userTurn !== currentUserTurn) continue;
		const m = messages[e.index];
		if (!m || m.role !== "toolResult" || !Array.isArray(m.content) || !m.content.every(c => c.type === "text")) continue;
		// Folded results have lost the original positional mapping. Do not use stored originals as evidence.
		if (e.output.includes("context_recall with id") || e.output.startsWith("[pi-jev-context]")) continue;
		const offset = offsetOf(e.args);
		if (offset === undefined) continue;
		const ageTokens = suffixTokens[e.index + 1]!;
		if (ageTokens <= cfg.dedupeMaxAgeTokens) out.push({ text: e.output, offset, toolCallId: e.id, userTurn: e.userTurn, ageTokens });
	}
	return out.slice(-cfg.maxEarlierReads).reverse();
}

export function collapse(text: string, earlier: ReadEvidence[], alias: string, path: string, cfg = DEFAULT_SEEN, offset = 1): Collapsed | undefined {
	const { lines, footer } = fileBody(text);
	if (lines.length < cfg.minLines) return;
	let runs: Run[] = [];
	let source: ReadEvidence | undefined;
	for (const e of earlier) {
		const candidate = matchingRuns(lines, fileBody(e.text).lines, cfg.minRun, offset, e.offset);
		if (candidate.length) {
			runs = candidate;
			source = e;
			break;
		}
	}
	if (!source) return;
	const covered = runs.reduce((sum, r) => sum + r.to - r.from + 1, 0);
	const body = [`[pi-jev-context] ${path}: file lines ${offset}-${offset + lines.length - 1}. Folded ${covered}/${lines.length} file lines matching read ${source.toolCallId} still in context. Full output: context_recall with id "${alias}".${hiddenReferences(runs.map(r => lines.slice(r.from - 1, r.to).join("\n")).join("\n"))} Search original chunks with context_recall query.`];
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
