import { lineCount, relatedKey, type ToolEvent, toolEvents } from "./extract.ts";
import type { ChoiceAnswer } from "./jev.ts";
import type { Label, Message, Prediction } from "./types.ts";

/** What one Jev call said about one item. */
export interface JevReading {
	decision: ChoiceAnswer;
	signals: Record<string, number>;
	/** Line number → probability the line is key evidence. */
	lines: Record<number, number>;
	excerpted: boolean;
}

export interface Thresholds {
	/** Minimum p(DROP) to act on a DROP. */
	drop: number;
	/** Minimum confidence to act on a DROP. */
	confidence: number;
	/** Noul level at which a protective signal vetoes a DROP. */
	veto: number;
	/** mostly_noise level at which a long KEEP becomes TRUNCATE. */
	noise: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { drop: 0.7, confidence: 0.5, veto: 0.5, noise: 0.7 };

/** Jev's choice as-is, UNCERTAIN included. */
export function rawPolicy(r: JevReading): Prediction {
	return r.decision.choice as Prediction;
}

function keepOrTruncate(r: JevReading): Label {
	const p = r.decision.probabilities;
	return (p.TRUNCATE ?? 0) > (p.KEEP ?? 0) ? "TRUNCATE" : "KEEP";
}

/** UNCERTAIN → KEEP; a DROP must clear both thresholds, else the better of KEEP / TRUNCATE. */
export function safePolicy(r: JevReading, t: Thresholds = DEFAULT_THRESHOLDS): Label {
	const c = r.decision.choice;
	if (c === "UNCERTAIN") return "KEEP";
	if (c === "DROP") return (r.decision.probabilities.DROP ?? 0) >= t.drop && r.decision.confidence >= t.confidence ? "DROP" : keepOrTruncate(r);
	return c as Label;
}

/** safePolicy, then protective signals veto DROPs, and noisy long KEEPs become TRUNCATE. */
export function compositePolicy(r: JevReading, t: Thresholds = DEFAULT_THRESHOLDS): Label {
	const s = r.signals;
	const base = safePolicy(r, t);
	if (base === "DROP") {
		if ((s.needed_now ?? 0) >= t.veto || (s.user_requested ?? 0) >= t.veto) return r.excerpted ? "TRUNCATE" : "KEEP";
		if ((s.durable ?? 0) >= t.veto || ((s.unique_fact ?? 0) >= t.veto && (s.superseded ?? 0) < 0.5)) return "TRUNCATE";
		return "DROP";
	}
	if (base === "KEEP" && r.excerpted && (s.mostly_noise ?? 0) >= t.noise) return "TRUNCATE";
	return base;
}

// ---------------------------------------------------------------------------------------------
// Baselines without Jev.

const NAVIGATION = /^(?:pwd|ls|ll|tree|find|git status|git branch|whoami|date|echo \$\w+)\b/;

function isNavigation(e: ToolEvent): boolean {
	if (e.name === "ls" || e.name === "find") return true;
	return e.name === "bash" && NAVIGATION.test(String(e.args.command ?? "").trim());
}

/**
 * Deterministic baseline: what plain rules can do without any semantics.
 * - navigation output (pwd/ls/find/git status) with ≥ 5 tool calls after it → DROP
 * - an error whose command family later ran without error → DROP
 * - a read or run superseded by a later read / re-run of the same thing → DROP
 * - more than 150 lines → TRUNCATE
 * - otherwise KEEP
 */
export function rulePolicy(messages: Message[], targetId: string): Label {
	const events = toolEvents(messages);
	const e = events.find((x) => x.id === targetId)!;
	const later = events.filter((x) => x.seq > e.seq);
	const key = relatedKey(e);
	const same = later.filter((x) => key && relatedKey(x) === key);
	if (isNavigation(e) && later.length >= 5) return "DROP";
	if (e.isError && same.some((x) => !x.isError)) return "DROP";
	if (e.name === "read" && same.some((x) => x.name === "read")) return "DROP";
	if (e.name === "bash" && same.length > 0 && !e.isError) return "DROP";
	if (lineCount(e.output) > 150) return "TRUNCATE";
	return "KEEP";
}

export const alwaysKeep = (): Label => "KEEP";
