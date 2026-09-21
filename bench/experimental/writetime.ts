import type { ChoiceAnswer, JevCall, Judge, NoulAnswer, Question } from "./jev.ts";
import { WRITE_NEED, WRITE_USER_ASKED } from "./questions.ts";
import { conversationText, LIMITS } from "./state.ts";
import { lineCount, notableLines, sizeClass, summarizeCall, textOf, truncate } from "../../src/extract.ts";
import { DEFAULT_TRIM, decideTrim, renderTrimmed, type TrimConfig, type TrimDecision, type Trimmed, type Unit, type UnitMode, unitQuestion, units, worthTrimming } from "./trim.ts";
import type { Message } from "../../src/types.ts";

export interface FreshResult {
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	text: string;
	isError: boolean;
}

export interface TrimPlan {
	mode: UnitMode;
	units: Unit[];
	call: JevCall;
	reading?: WriteReading;
	decision?: TrimDecision;
	/** Present only when the output should be replaced. */
	trimmed?: Trimmed;
	/** Why nothing is replaced, when trimmed is absent. */
	skip?: string;
}

/** The session as it will look once this result lands (the result itself is the judged item). */
export function withFresh(context: Message[], r: FreshResult): Message[] {
	const hasCall = context.some((m) => m.role === "assistant" && m.content.some((c) => c.type === "toolCall" && c.id === r.toolCallId));
	const msgs = [...context];
	if (!hasCall) msgs.push({ role: "assistant", content: [{ type: "toolCall", id: r.toolCallId, name: r.toolName, arguments: r.input }] });
	msgs.push({ role: "toolResult", toolCallId: r.toolCallId, toolName: r.toolName, content: [{ type: "text", text: r.text }], isError: r.isError });
	return msgs;
}

/**
 * Write-time state. Field order matters for Jev (it weighs what it reads first): the fresh call and the
 * user's latest request come first, the output next, older conversation last.
 */
export function writeState(context: Message[], r: FreshResult): Record<string, unknown> {
	const users = context.filter((m) => m.role === "user");
	const latest = users.at(-1);
	const lines = r.text.split("\n");
	const full = lines.length <= LIMITS.fullResultLines && r.text.length <= LIMITS.fullResultChars;
	const convo = context
		.map((m) => ({ role: m.role, text: conversationText(m) }))
		.filter((x): x is { role: "user" | "assistant"; text: string } => !!x.text)
		.slice(-LIMITS.recentConversation, -1)
		.map((x) => `${x.role}: ${truncate(x.text, LIMITS.messageChars)}`);
	return {
		tool_call: summarizeCall(r.toolName, r.input),
		latest_user_request: truncate(latest ? textOf(latest.content) : "", 800),
		output: full
			? r.text
			: {
					note: `Excerpt of a ${lines.length}-line output: first lines, notable lines and last lines.`,
					first_lines: lines.slice(0, LIMITS.headLines).map((l) => truncate(l, 200)),
					notable_lines: notableLines(r.text, LIMITS.notable).map((l) => `L${l.n}: ${l.text}`),
					last_lines: lines.slice(-LIMITS.tailLines).map((l) => truncate(l, 200)),
				},
		output_size: `${sizeClass(lineCount(r.text))} (${lineCount(r.text)} lines)`,
		status: r.isError ? "error" : "ok",
		earlier_conversation: convo,
	};
}

export interface WriteReading {
	need: ChoiceAnswer;
	userAsked: number;
}

/** One Jev call: what the output is needed for, whether the user asked for it, and one noul per line/block. Fails open. */
export async function planTrim(
	judge: Judge,
	context: Message[],
	r: FreshResult,
	alias: string,
	opts: { cfg?: TrimConfig; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TrimPlan> {
	const cfg = opts.cfg ?? DEFAULT_TRIM;
	const { mode, units: offered } = units(r.text, r.toolName, cfg);
	const questions: Record<string, Question> = { need: WRITE_NEED, user_asked: WRITE_USER_ASKED };
	for (const u of offered) questions[u.id] = unitQuestion(mode, u);
	const call = await judge.decide(writeState(context, r), questions, opts.timeoutMs ?? 2500, opts.signal);
	if (!call.answers) return { mode, units: offered, call, skip: `jev unavailable: ${call.error}` };

	const reading: WriteReading = { need: call.answers.need as ChoiceAnswer, userAsked: (call.answers.user_asked as NoulAnswer).noul };
	const unitAnswers: Record<string, number> = {};
	for (const u of offered) unitAnswers[u.id] = (call.answers[u.id] as NoulAnswer).noul;
	const decision = decideTrim(reading, offered, unitAnswers, cfg);
	if (!decision.trim) return { mode, units: offered, call, reading, decision, skip: decision.reason };
	const trimmed = renderTrimmed(r.text, mode, decision.selected, alias, cfg, offered);
	if (!worthTrimming(trimmed, cfg)) return { mode, units: offered, call, reading, decision, skip: `would keep ${trimmed.keptTokens}/${trimmed.originalTokens} tokens` };
	return { mode, units: offered, call, reading, decision, trimmed };
}
