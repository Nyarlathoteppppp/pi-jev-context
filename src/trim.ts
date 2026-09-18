import { estimateTokens, linePriority, notableLines, truncate } from "./extract.ts";
import type { ChoiceAnswer, NoulQuestion } from "./jev.ts";

// Write-time trimming of long tool output. Runs in tool_result, before the result ever enters the
// model's context, so it never invalidates a cached prompt prefix. The original is stored losslessly
// and can be fetched with context_recall.

export interface TrimConfig {
	/** Only outputs with at least this many lines are considered. */
	minLines: number;
	headLines: number;
	tailLines: number;
	/** Lines of context kept around each selected line (line mode). */
	around: number;
	/** Max units (lines or blocks) offered to Jev. */
	units: number;
	/** Trim only if the result keeps at most this share of the original tokens. */
	maxKeptShare: number;
	/** Jev must pick specific_parts/outcome_only with at least this probability and confidence. */
	minProbability: number;
	minConfidence: number;
	/** A user_requested signal at or above this keeps the output whole. */
	userRequestedVeto: number;
	/** A unit is kept when its noul reaches this. */
	unitThreshold: number;
	/** If no unit reaches the threshold, units within this of the best one are kept. */
	nearTie: number;
}

export const DEFAULT_TRIM: TrimConfig = {
	minLines: 150,
	headLines: 5,
	tailLines: 8,
	around: 2,
	units: 16,
	maxKeptShare: 0.5,
	minProbability: 0.7,
	minConfidence: 0.6,
	userRequestedVeto: 0.5,
	unitThreshold: 0.5,
	nearTie: 0.1,
};

/** Tools whose output the agent needs verbatim on first use (file content, edits): never trimmed. */
const NEVER = new Set(["read", "edit", "write", "context_recall"]);
/** Shell commands that print file or diff content. */
const VIEWER = /^(?:\S+=\S+\s+)*(?:cat|bat|less|more|nl|sed|awk|jq|yq|xxd|od|git\s+(?:diff|show|blame|log\s+-p)|diff|head|tail)\b/;
/** head/tail of a log file is a log excerpt, which is fine to trim. */
const LOG_TAIL = /^(?:head|tail)\b.*\.(?:log|out|txt)\b/;

export function isCandidateCommand(command: string): boolean {
	const c = command.trim();
	if (LOG_TAIL.test(c)) return true;
	return !VIEWER.test(c);
}

export function shouldConsider(toolName: string, input: Record<string, unknown>, text: string, cfg: TrimConfig = DEFAULT_TRIM): boolean {
	if (NEVER.has(toolName)) return false;
	if (toolName === "bash" && !isCandidateCommand(String(input.command ?? ""))) return false;
	return text.split("\n").length >= cfg.minLines;
}

/** A piece of the output Jev can keep: one line (logs) or a block of lines (listings, search hits, prose). */
export interface Unit {
	id: string;
	from: number;
	to: number;
	text: string;
}

export type UnitMode = "lines" | "blocks";

/**
 * Logs have error/failure/summary lines a regex can find: offer those lines. Anything else (grep hits,
 * file listings, JSON, prose from MCP tools) is split into blocks and Jev judges each block's relevance.
 */
export function units(text: string, toolName: string, cfg: TrimConfig = DEFAULT_TRIM): { mode: UnitMode; units: Unit[] } {
	const notable = notableLines(text, cfg.units);
	if (notable.filter((l) => linePriority(l.text) >= 3).length >= 2) {
		return { mode: "lines", units: notable.map((l) => ({ id: `line_${l.n}`, from: l.n, to: l.n, text: l.text })) };
	}
	return { mode: "blocks", units: blocks(text, toolName, cfg.units) };
}

function groupKey(line: string, toolName: string): string | undefined {
	if (toolName === "grep" || /^[\w./-]+:\d+:/.test(line)) return /^([^:]+):\d+:/.exec(line)?.[1];
	if (toolName === "find" || toolName === "ls" || /^\.?\/?[\w.-]+(?:\/[\w.-]+)+$/.test(line.trim())) return line.trim();
	return undefined;
}

/** Drops `level` trailing path segments: file → dir → parent dir. */
const coarsen = (key: string, level: number) => key.split("/").slice(0, Math.max(1, key.split("/").length - level)).join("/");

function runs(keys: Array<string | undefined>): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	let start = 1;
	for (let n = 2; n <= keys.length + 1; n++) {
		if (n > keys.length || keys[n - 1] !== keys[start - 1]) {
			out.push([start, n - 1]);
			start = n;
		}
	}
	return out;
}

function blocks(text: string, toolName: string, max: number): Unit[] {
	const lines = text.split("\n");
	let ranges: Array<[number, number]> = [];
	// Group by file (grep) or directory (find/ls) when the output has that shape.
	const keys = lines.map((l) => groupKey(l, toolName));
	if (keys.filter(Boolean).length >= lines.length * 0.6) {
		// Path-shaped output: group by file, and coarsen to directories until the groups fit.
		for (let level = 0; level < 6; level++) {
			ranges = runs(keys.map((k) => (k === undefined ? k : level ? coarsen(k, level) : k)));
			if (ranges.length <= max) break;
		}
	} else if (lines.filter((l) => !l.trim()).length >= 3) {
		// Prose, markdown, search results: paragraphs / sections separated by blank lines.
		let start = 1;
		for (let n = 1; n <= lines.length; n++) {
			if (!lines[n - 1]!.trim() || n === lines.length) {
				if (n > start) ranges.push([start, n]);
				start = n + 1;
			}
		}
	} else {
		const size = Math.max(10, Math.ceil(lines.length / max));
		for (let s = 1; s <= lines.length; s += size) ranges.push([s, Math.min(lines.length, s + size - 1)]);
	}
	// Too many groups: merge neighbours until they fit.
	while (ranges.length > max) {
		const merged: Array<[number, number]> = [];
		for (let i = 0; i < ranges.length; i += 2) merged.push([ranges[i]![0], (ranges[i + 1] ?? ranges[i]!)[1]]);
		ranges = merged;
	}
	return ranges.map(([from, to]) => {
		const slice = lines.slice(from - 1, to);
		const preview = slice.length <= 4 ? slice.join(" ⏎ ") : `${slice.slice(0, 3).join(" ⏎ ")} ⏎ … (${slice.length - 4} more) ⏎ ${slice.at(-1)}`;
		return { id: `block_${from}_${to}`, from, to, text: truncate(preview, 400) };
	});
}

export function unitQuestion(mode: UnitMode, u: Unit): NoulQuestion {
	if (mode === "lines") return { type: "noul", instructions: `Line L${u.from} of \`output\` ("${u.text}") is needed to handle \`latest_user_request\`.` };
	return { type: "noul", instructions: `Lines L${u.from}-L${u.to} of \`output\` ("${u.text}") are needed to handle \`latest_user_request\`.` };
}

export interface TrimDecision {
	trim: boolean;
	reason: string;
	/** Units Jev marked as needed. */
	selected: Unit[];
}

/** Turns one Jev reading into a trim decision. Anything short of a confident "only parts / only outcome" keeps the output whole. */
export function decideTrim(r: { need: ChoiceAnswer; userAsked: number }, offered: Unit[], unitAnswers: Record<string, number>, cfg: TrimConfig = DEFAULT_TRIM): TrimDecision {
	const d = r.need;
	const p = d.probabilities[d.choice] ?? 0;
	const selected = offered.filter((u) => (unitAnswers[u.id] ?? 0) >= cfg.unitThreshold);
	if (d.choice !== "specific_parts" && d.choice !== "outcome_only") return { trim: false, reason: `jev ${d.choice}`, selected };
	if (p < cfg.minProbability || d.confidence < cfg.minConfidence) return { trim: false, reason: `jev ${d.choice} not confident (p=${p.toFixed(2)}, c=${d.confidence.toFixed(2)})`, selected };
	if (r.userAsked >= cfg.userRequestedVeto) return { trim: false, reason: "user asked for this output", selected };
	// Nothing clears the absolute bar: fall back to Jev's ranking (the top unit and near-ties, at most 3).
	const reason = `jev ${d.choice} (p=${p.toFixed(2)}, c=${d.confidence.toFixed(2)})`;
	if (selected.length) return { trim: true, reason, selected };
	const top = Math.max(0, ...offered.map((u) => unitAnswers[u.id] ?? 0));
	const ranked = offered.filter((u) => (unitAnswers[u.id] ?? 0) >= top - cfg.nearTie).sort((a, b) => (unitAnswers[b.id] ?? 0) - (unitAnswers[a.id] ?? 0)).slice(0, 3);
	return { trim: true, reason: `${reason}, by rank`, selected: ranked };
}

export interface Trimmed {
	text: string;
	keptLines: number;
	totalLines: number;
	originalTokens: number;
	keptTokens: number;
}

/**
 * Deterministic rendering: the same output and selection always give the same text, so a replayed or
 * rebuilt session produces byte-identical context. Kept lines are the original lines, never rewritten.
 */
export function renderTrimmed(text: string, mode: UnitMode, selected: Unit[], alias: string, cfg: TrimConfig = DEFAULT_TRIM): Trimmed {
	const lines = text.split("\n");
	const total = lines.length;
	const keep = new Set<number>();
	const add = (n: number) => n >= 1 && n <= total && keep.add(n);
	for (let n = 1; n <= Math.min(cfg.headLines, total); n++) add(n);
	for (let n = Math.max(1, total - cfg.tailLines + 1); n <= total; n++) add(n);
	const pad = mode === "lines" ? cfg.around : 0;
	for (const u of selected) for (let n = u.from - pad; n <= u.to + pad; n++) add(n);
	// Summary lines ("Tests: 2 failed", "Found 90 errors") are always kept.
	lines.forEach((l, i) => linePriority(l.trim()) === 4 && add(i + 1));

	const sorted = [...keep].sort((a, b) => a - b);
	const body: string[] = [];
	let prev = 0;
	for (const n of sorted) {
		if (n > prev + 1) body.push(`… [${n - prev - 1} lines omitted] …`);
		body.push(lines[n - 1]!);
		prev = n;
	}
	if (prev < total) body.push(`… [${total - prev} lines omitted] …`);
	const header = `[pi-jev-context] Output shortened: ${sorted.length} of ${total} lines kept (chosen by Jev for the current task; kept lines are verbatim). Full output: context_recall with id "${alias}".`;
	const out = `${header}\n${body.join("\n")}`;
	return { text: out, keptLines: sorted.length, totalLines: total, originalTokens: estimateTokens(text), keptTokens: estimateTokens(out) };
}

export const worthTrimming = (t: Trimmed, cfg: TrimConfig = DEFAULT_TRIM) => t.keptTokens <= t.originalTokens * cfg.maxKeptShare;
