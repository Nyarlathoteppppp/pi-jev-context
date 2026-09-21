import { estimateTokens, textOf, toolEvents } from "../../src/extract.ts";
import type { Message } from "../../src/types.ts";

// Deterministic de-duplication of file reads. No model call: a run of lines is collapsed only when the
// agent was already shown exactly those lines, contiguously, by an earlier read of the same file that is
// still in the context. It runs at write time, so no cached prefix is touched.
//
// The idea comes from cachebro (MIT: glommer/cachebro, and the pi port in rawwerks/ypi), with the one
// change that matters: cachebro compares the file on disk against its own cache, so it answers
// "[unchanged in lines 300-350]" for a range the agent has never been shown. Replaying 22 real pi
// sessions, that fires 2,301 times, and in 598 of them more than half of the requested lines had never
// been shown — about 458k tokens of content the agent would never see. Here the reference is the context.

export interface SeenConfig {
	/** Only collapse runs of at least this many consecutive already-shown lines. */
	minRun: number;
	/** Only rewrite when at least this share of the result's tokens is collapsed. */
	minSavedShare: number;
	/** Ignore reads shorter than this (nothing to gain). */
	minLines: number;
	/** Scan at most this many earlier reads of the same file. */
	maxEarlierReads: number;
}

export const DEFAULT_SEEN: SeenConfig = { minRun: 30, minSavedShare: 0.3, minLines: 60, maxEarlierReads: 4 };

export interface Run {
	/** 1-based, inclusive, in the new text. */
	from: number;
	to: number;
}

/**
 * Runs of `next` that appear contiguously in `earlier`. Contiguity is the point: a set of lines seen
 * scattered around the file is not the same as a block the agent actually read.
 */
export function matchingRuns(next: string[], earlier: string[], minRun: number): Run[] {
	const positions = new Map<string, number[]>();
	earlier.forEach((line, p) => {
		const at = positions.get(line);
		if (at) at.push(p);
		else positions.set(line, [p]);
	});
	// suffix[p] = length of the match that starts at next[i] and earlier[p], filled from the end.
	let after = new Map<number, number>();
	const best = new Array<number>(next.length).fill(0);
	for (let i = next.length - 1; i >= 0; i--) {
		const here = new Map<number, number>();
		let longest = 0;
		for (const p of positions.get(next[i]!) ?? []) {
			const len = 1 + (after.get(p + 1) ?? 0);
			here.set(p, len);
			if (len > longest) longest = len;
		}
		best[i] = longest;
		after = here;
	}
	const runs: Run[] = [];
	for (let i = 0; i < next.length; ) {
		if (best[i]! >= minRun) {
			runs.push({ from: i + 1, to: i + best[i]! });
			i += best[i]!;
		} else i++;
	}
	return runs;
}

/**
 * Earlier reads of `path` the agent has been shown: the ones still in the context, plus any sibling read
 * from the batch currently being executed. pi does not guarantee that `buildContextEntries()` already
 * contains sibling results of the same assistant message, but the model will see them in the same turn.
 */
export function earlierReads(messages: Message[], path: string, toolCallId: string, cfg: SeenConfig = DEFAULT_SEEN, siblings: ReadonlyArray<{ toolCallId: string; path: string; text: string }> = []): string[] {
	const out: string[] = [];
	const seenIds = new Set<string>();
	for (const e of toolEvents(messages)) {
		if (e.id === toolCallId || e.isError) continue;
		if (e.name !== "read" || String(e.args.path ?? "") !== path) continue;
		seenIds.add(e.id);
		out.push(e.output);
	}
	for (const s of siblings) if (s.path === path && s.toolCallId !== toolCallId && !seenIds.has(s.toolCallId)) out.push(s.text);
	return out.slice(-cfg.maxEarlierReads).reverse();
}

export interface Collapsed {
	text: string;
	collapsedLines: number;
	totalLines: number;
	originalTokens: number;
	keptTokens: number;
	runs: Run[];
}

/** Replaces already-shown runs with one marker line each. Kept lines are verbatim. Deterministic. */
export function collapse(text: string, earlier: string[], alias: string, path: string, cfg: SeenConfig = DEFAULT_SEEN): Collapsed | undefined {
	const lines = text.split("\n");
	if (lines.length < cfg.minLines || earlier.length === 0) return undefined;
	// Take the runs from whichever earlier read covers the most: they are all equally "already shown".
	let runs: Run[] = [];
	let covered = -1;
	for (const e of earlier) {
		const candidate = matchingRuns(lines, e.split("\n"), cfg.minRun);
		const total = candidate.reduce((s, r) => s + (r.to - r.from + 1), 0);
		if (total > covered) {
			covered = total;
			runs = candidate;
		}
	}
	if (!runs.length) return undefined;

	const hidden = new Set<number>();
	for (const r of runs) for (let n = r.from; n <= r.to; n++) hidden.add(n);
	const body: string[] = [];
	for (let n = 1; n <= lines.length; n++) {
		const run = runs.find((r) => r.from === n);
		if (run) {
			body.push(`… [lines ${run.from}-${run.to} unchanged from what you already read of ${path}; full text: context_recall with id "${alias}"] …`);
			n = run.to;
			continue;
		}
		body.push(lines[n - 1]!);
	}
	const out = body.join("\n");
	return {
		text: out,
		collapsedLines: hidden.size,
		totalLines: lines.length,
		originalTokens: estimateTokens(text),
		keptTokens: estimateTokens(out),
		runs,
	};
}

export const worthCollapsing = (c: Collapsed, cfg: SeenConfig = DEFAULT_SEEN) => c.keptTokens <= c.originalTokens * (1 - cfg.minSavedShare);

/** The whole decision for one fresh read result. Returns nothing when the result should pass through. */
export function planCollapse(
	messages: Message[],
	r: { toolCallId: string; toolName: string; input: Record<string, unknown>; text: string; isError: boolean },
	alias: string,
	cfg: SeenConfig = DEFAULT_SEEN,
	siblings: ReadonlyArray<{ toolCallId: string; path: string; text: string }> = [],
): Collapsed | undefined {
	if (r.toolName !== "read" || r.isError) return undefined;
	const path = String(r.input.path ?? "");
	if (!path) return undefined;
	const earlier = earlierReads(messages, path, r.toolCallId, cfg, siblings);
	const c = collapse(r.text, earlier, alias, path, cfg);
	return c && worthCollapsing(c, cfg) ? c : undefined;
}

export { textOf };
