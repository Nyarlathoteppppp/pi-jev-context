import {
	estimateTokens,
	lineCount,
	linePriority,
	notableLines,
	outcomeLine,
	relatedKey,
	sizeClass,
	summarizeCall,
	textOf,
	type ToolEvent,
	toolEvents,
	truncate,
} from "../../src/extract.ts";
import type { Message } from "../../src/types.ts";

// Builds the bounded Jev `state` for one old tool result. Jev's docs: filter first, keep numbers and
// arithmetic in code, reduce indirection. So relations ("same command re-run later") are computed here
// and handed over as facts; Jev only judges.

export const LIMITS = {
	fullResultLines: 200,
	fullResultChars: 12000,
	headLines: 12,
	tailLines: 12,
	notable: 30,
	recentConversation: 6,
	messageChars: 400,
	userMessagesSince: 8,
	activitySince: 20,
	keyLineCandidates: 16,
};

export interface BuiltState {
	state: Record<string, unknown>;
	target: ToolEvent;
	/** Lines offered to Jev as possible "keep these when truncating" (only for excerpted results). */
	keyLineCandidates: Array<{ n: number; text: string }>;
	excerpted: boolean;
	approxTokens: number;
}

function relation(target: ToolEvent, later: ToolEvent): string | undefined {
	const k = relatedKey(target);
	if (!k || relatedKey(later) !== k) return undefined;
	if (later.name === "edit" || later.name === "write") return "the same file was modified later";
	if (target.name === "read" && later.name === "read") return "the same file was read again later";
	if (target.name === "bash") return "the same command was run again later";
	return "the same lookup was repeated later";
}

function resultView(e: ToolEvent): { view: unknown; excerpted: boolean; notable: Array<{ n: number; text: string }> } {
	const lines = e.output.split("\n");
	if (lines.length <= LIMITS.fullResultLines && e.output.length <= LIMITS.fullResultChars) {
		return { view: e.output || "(no output)", excerpted: false, notable: [] };
	}
	const notable = notableLines(e.output, LIMITS.notable);
	return {
		excerpted: true,
		notable,
		view: {
			note: `Excerpt of a ${lines.length}-line output: first lines, notable lines (errors, failures, file:line references, summaries) and last lines.`,
			first_lines: lines.slice(0, LIMITS.headLines).map((l) => truncate(l, 200)),
			notable_lines: notable.map((l) => `L${l.n}: ${l.text}`),
			last_lines: lines.slice(-LIMITS.tailLines).map((l) => truncate(l, 200)),
		},
	};
}

export function conversationText(m: Message): string | undefined {
	if (m.role === "user") return textOf(m.content);
	if (m.role === "assistant") {
		const t = m.content
			.filter((c) => c.type === "text")
			.map((c) => (c as { text: string }).text)
			.join("\n");
		return t || undefined;
	}
	return undefined;
}

/** State for judging tool result `targetId`, as seen at the end of `messages`. */
export function buildState(messages: Message[], targetId: string): BuiltState {
	const events = toolEvents(messages);
	const target = events.find((e) => e.id === targetId);
	if (!target) throw new Error(`no tool result ${targetId}`);
	const after = events.filter((e) => e.seq > target.seq);

	const users = messages.map((m, i) => ({ m, i })).filter(({ m }) => m.role === "user");
	const latest = users.at(-1);
	const first = users[0];
	const userSince = users.filter(({ i }) => i > target.index).map(({ m }) => truncate(textOf(m.content), 300));

	const convo = messages
		.map((m) => ({ role: m.role, text: conversationText(m) }))
		.filter((x): x is { role: "user" | "assistant"; text: string } => !!x.text)
		.slice(-LIMITS.recentConversation)
		.map((x) => `${x.role}: ${truncate(x.text, LIMITS.messageChars)}`);

	let activity = after.map((e) => `${summarizeCall(e.name, e.args)} → ${e.isError ? "ERROR " : ""}${outcomeLine(e.output, e.isError)}`);
	if (activity.length > LIMITS.activitySince) {
		const omitted = activity.length - LIMITS.activitySince;
		activity = [...activity.slice(0, 5), `… ${omitted} more tool calls …`, ...activity.slice(-(LIMITS.activitySince - 5))];
	}

	const newer = after.flatMap((e) => {
		const rel = relation(target, e);
		return rel ? [{ relation: rel, call: summarizeCall(e.name, e.args), outcome: `${e.isError ? "ERROR " : ""}${outcomeLine(e.output, e.isError)}` }] : [];
	});

	const lines = lineCount(target.output);
	const { view, excerpted, notable } = resultView(target);
	const laterCalls = after.length;
	const age = laterCalls <= 3 ? "recent" : laterCalls <= 12 ? "a while ago" : "long ago";

	const state: Record<string, unknown> = {
		current_goal: {
			latest_user_request: truncate(latest ? textOf(latest.m.content) : "", 800),
			...(first && first !== latest ? { original_task: truncate(textOf(first.m.content), 500) } : {}),
		},
		recent_conversation: convo,
		item: {
			tool_call: summarizeCall(target.name, target.args),
			status: target.isError ? "error" : "ok",
			age: `${age} (${laterCalls} tool calls and ${userSince.length} user messages since)`,
			size: `${sizeClass(lines)} (${lines} lines)`,
			result: view,
		},
		after_item: {
			user_messages_since: userSince.slice(-LIMITS.userMessagesSince),
			tool_activity_since: activity,
		},
		newer_related_results: newer.length ? newer.slice(-6) : "none",
	};
	const keyLineCandidates = excerpted
		? [...notable]
				.sort((a, b) => linePriority(b.text) - linePriority(a.text) || a.n - b.n)
				.slice(0, LIMITS.keyLineCandidates)
				.sort((a, b) => a.n - b.n)
		: [];
	return { state, target, keyLineCandidates, excerpted, approxTokens: estimateTokens(JSON.stringify(state)) };
}
