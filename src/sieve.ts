import { conversationText, LIMITS } from "./state.ts";
import { estimateTokens, lineCount, sizeClass, summarizeCall, textOf, truncate } from "./extract.ts";
import type { ChoiceAnswer, ChoiceQuestion, JevCall, Judge, NoulAnswer, NoulQuestion, Question } from "./jev.ts";
import { DEFAULT_TRIM, renderTrimmed, type TrimConfig, type Trimmed, type Unit } from "./trim.ts";
import type { Message } from "./types.ts";
import type { FreshResult } from "./writetime.ts";

// v0.2 write-time "sieve" (after run-q1 real-session replays and Winnow's design): every block of a long
// output gets its own P(needed) and a block is hidden only when Jev is confident it is NOT needed.
// Uncertain blocks stay. v0.1 did the opposite (kept only what Jev selected), which on real sessions hid
// facts the agent used later in 17% of trims.

export interface SieveConfig {
	/** Target lines per block, and the cap on blocks (questions) per call. */
	blockLines: number;
	maxBlocks: number;
	/** Characters of each block shown to Jev. */
	blockChars: number;
	/** Hide a block only when P(needed) is below this. */
	drop: number;
	/** Skip the rewrite unless at least this share of the tokens would be hidden. */
	minHiddenShare: number;
	/** A confident "every_line" or a user request for the full output vetoes any hiding. */
	vetoProbability: number;
}

export const DEFAULT_SIEVE: SieveConfig = { blockLines: 20, maxBlocks: 80, blockChars: 1500, drop: 0.15, minHiddenShare: 0.3, vetoProbability: 0.5 };

export const SIEVE_VERSION = "s1";

export const SIEVE_NEED: ChoiceQuestion = {
	type: "choice",
	instructions: "`blocks` is the output of `tool_call`, split into numbered blocks. What does the agent need from `blocks` to handle `latest_user_request`?",
	criteria: {
		every_line:
			"Nearly every line: the request needs the complete output, for example every match to edit or rename, every row or field to convert or review, or a complete list or inventory the user asked for.",
		specific_parts:
			"Only specific parts: some lines matter (failures, errors, warnings, the matches or sections related to the request) and the rest is repetitive, routine or unrelated.",
		outcome_only: "Only the overall outcome: whether it succeeded or finished; the details do not matter for the request.",
		unclear: "It is not clear from the request what the agent needs from this output.",
	},
};

export const SIEVE_USER_ASKED: NoulQuestion = {
	type: "noul",
	instructions: "`latest_user_request` explicitly asks to see the complete output of `tool_call`.",
};

export function blockQuestion(id: string): NoulQuestion {
	return {
		type: "noul",
		instructions: `Would the agent have to read \`blocks.${id}\` to handle \`latest_user_request\` correctly?`,
		criteria: {
			true: "The agent must read this block: it holds the failure, error or warning being investigated, the match or record the request is about, a value or name the agent will use next, or an item the agent may choose from.",
			false: "The agent can handle the request without ever reading this block: repeated success lines, progress or timing noise, boilerplate, or items unrelated to the request.",
		},
	};
}

/** Splits the output into blocks along its own structure where it has one (files, directories, paragraphs). */
export function sieveBlocks(text: string, toolName: string, cfg: SieveConfig = DEFAULT_SIEVE): Unit[] {
	const lines = text.split("\n");
	const n = lines.length;
	const size = Math.max(cfg.blockLines, Math.ceil(n / cfg.maxBlocks));
	// Structural cut points: file / directory changes (grep, find, ls) or blank lines (prose, search results).
	const pathKey = (l: string) => (/^([^\s:]+):\d+[:-]/.exec(l)?.[1] ?? (/^\.?\/?[\w.@-]+(?:\/[\w.@-]+)+$/.test(l.trim()) ? l.trim().split("/").slice(0, -1).join("/") : undefined));
	const keys = lines.map(pathKey);
	const pathShaped = toolName === "grep" || toolName === "find" || toolName === "ls" || keys.filter(Boolean).length >= n * 0.6;
	const blanky = lines.filter((l) => !l.trim()).length >= 3;
	const ranges: Array<[number, number]> = [];
	let start = 1;
	let chars = lines[0]!.length + 1;
	for (let i = 2; i <= n + 1; i++) {
		const len = i - start;
		// Never let a block outgrow what Jev is shown: a hidden block must have been read in full.
		if (i <= n && chars + lines[i - 1]!.length + 1 > cfg.blockChars) {
			ranges.push([start, i - 1]);
			start = i;
			chars = lines[i - 1]!.length + 1;
			continue;
		}
		if (i <= n) chars += lines[i - 1]!.length + 1;
		const structural = i <= n && (pathShaped ? keys[i - 1] !== keys[i - 2] : blanky ? !lines[i - 2]!.trim() : false);
		// Cut at a structural boundary once the block is reasonably sized, or hard-cut at twice the target.
		if (i > n || (structural && len >= size / 2) || len >= size * 2 || (!pathShaped && !blanky && len >= size)) {
			if (i > n) {
				ranges.push([start, n]);
				break;
			}
			ranges.push([start, i - 1]);
			start = i;
			chars = lines[i - 1]!.length + 1;
		}
	}
	// Still too many: merge neighbours.
	let merged = ranges;
	while (merged.length > cfg.maxBlocks) {
		const next: Array<[number, number]> = [];
		for (let i = 0; i < merged.length; i += 2) next.push([merged[i]![0], (merged[i + 1] ?? merged[i]!)[1]]);
		merged = next;
	}
	return merged.map(([from, to], k) => ({ id: `b${k + 1}`, from, to, text: lines.slice(from - 1, to).join("\n") }));
}

export function sieveState(context: Message[], r: FreshResult, blocks: Unit[], cfg: SieveConfig = DEFAULT_SIEVE): Record<string, unknown> {
	const latest = context.filter((m) => m.role === "user").at(-1);
	const convo = context
		.map((m) => ({ role: m.role, text: conversationText(m) }))
		.filter((x): x is { role: "user" | "assistant"; text: string } => !!x.text)
		.slice(-LIMITS.recentConversation, -1)
		.map((x) => `${x.role}: ${truncate(x.text, LIMITS.messageChars)}`);
	return {
		tool_call: summarizeCall(r.toolName, r.input),
		latest_user_request: truncate(latest ? textOf(latest.content) : "", 800),
		status: r.isError ? "error" : "ok",
		output_size: `${sizeClass(lineCount(r.text))} (${lineCount(r.text)} lines, ${blocks.length} blocks)`,
		blocks: Object.fromEntries(blocks.map((b) => [b.id, `lines ${b.from}-${b.to}:\n${truncate(b.text, cfg.blockChars)}`])),
		earlier_conversation: convo,
	};
}

export interface SievePlan {
	blocks: Unit[];
	call: JevCall;
	need?: ChoiceAnswer;
	userAsked?: number;
	/** P(needed) per block id. */
	probs: Record<string, number>;
	hidden: Unit[];
	trimmed?: Trimmed;
	skip?: string;
}

/** Pure decision from Jev's answers: which blocks to hide. Exposed for threshold sweeps on recorded answers. */
export function sieveDecide(need: ChoiceAnswer | undefined, userAsked: number, blocks: Unit[], probs: Record<string, number>, cfg: SieveConfig = DEFAULT_SIEVE): { hidden: Unit[]; skip?: string } {
	if (need?.choice === "every_line" && (need.probabilities.every_line ?? 0) >= cfg.vetoProbability) return { hidden: [], skip: "jev every_line" };
	if (userAsked >= cfg.vetoProbability) return { hidden: [], skip: "user asked for this output" };
	// A block Jev saw only in part (longer than blockChars, e.g. after merging) is never hidden.
	const hidden = blocks.filter((b) => (probs[b.id] ?? 1) < cfg.drop && b.text.length <= cfg.blockChars);
	if (!hidden.length) return { hidden, skip: "nothing confidently unneeded" };
	return { hidden };
}

export async function planSieve(
	judge: Judge,
	context: Message[],
	r: FreshResult,
	alias: string,
	opts: { cfg?: SieveConfig; trim?: TrimConfig; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SievePlan> {
	const cfg = opts.cfg ?? DEFAULT_SIEVE;
	const trimCfg = opts.trim ?? DEFAULT_TRIM;
	const blocks = sieveBlocks(r.text, r.toolName, cfg);
	const questions: Record<string, Question> = { need: SIEVE_NEED, user_asked: SIEVE_USER_ASKED };
	for (const b of blocks) questions[b.id] = blockQuestion(b.id);
	const call = await judge.decide(sieveState(context, r, blocks, cfg), questions, opts.timeoutMs ?? 2500, opts.signal);
	if (!call.answers) return { blocks, call, probs: {}, hidden: [], skip: `jev unavailable: ${call.error}` };
	const need = call.answers.need as ChoiceAnswer;
	const userAsked = (call.answers.user_asked as NoulAnswer).noul;
	const probs = Object.fromEntries(blocks.map((b) => [b.id, (call.answers![b.id] as NoulAnswer).noul]));
	const { hidden, skip } = sieveDecide(need, userAsked, blocks, probs, cfg);
	if (skip) return { blocks, call, need, userAsked, probs, hidden, skip };
	const hiddenIds = new Set(hidden.map((b) => b.id));
	const kept = blocks.filter((b) => !hiddenIds.has(b.id));
	const trimmed = renderTrimmed(r.text, "blocks", kept, alias, trimCfg, blocks);
	if (trimmed.keptTokens > trimmed.originalTokens * (1 - cfg.minHiddenShare)) return { blocks, call, need, userAsked, probs, hidden, skip: `would hide only ${Math.round((1 - trimmed.keptTokens / trimmed.originalTokens) * 100)}%` };
	return { blocks, call, need, userAsked, probs, hidden, trimmed };
}

export const tokensOf = (u: Unit) => estimateTokens(u.text);
