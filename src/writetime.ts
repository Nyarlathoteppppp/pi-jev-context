import type { ChoiceAnswer, JevCall, Judge, NoulAnswer, Question } from "./jev.ts";
import type { JevReading } from "./policy.ts";
import { DECISION, SIGNALS } from "./questions.ts";
import { buildState } from "./state.ts";
import { DEFAULT_TRIM, decideTrim, renderTrimmed, type TrimConfig, type TrimDecision, type Trimmed, type Unit, type UnitMode, unitQuestion, units, worthTrimming } from "./trim.ts";
import type { Message } from "./types.ts";

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
	reading?: JevReading;
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

/** One Jev call: the q1 decision + signals, plus one noul per offered line/block. Fails open. */
export async function planTrim(
	judge: Judge,
	context: Message[],
	r: FreshResult,
	alias: string,
	opts: { cfg?: TrimConfig; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TrimPlan> {
	const cfg = opts.cfg ?? DEFAULT_TRIM;
	const { mode, units: offered } = units(r.text, r.toolName, cfg);
	const { state } = buildState(withFresh(context, r), r.toolCallId);
	const questions: Record<string, Question> = { decision: DECISION, ...SIGNALS };
	for (const u of offered) questions[u.id] = unitQuestion(mode, u);
	const call = await judge.decide(state, questions, opts.timeoutMs ?? 2500, opts.signal);
	if (!call.answers) return { mode, units: offered, call, skip: `jev unavailable: ${call.error}` };

	const signals: Record<string, number> = {};
	for (const k of Object.keys(SIGNALS)) signals[k] = (call.answers[k] as NoulAnswer).noul;
	const unitAnswers: Record<string, number> = {};
	for (const u of offered) unitAnswers[u.id] = (call.answers[u.id] as NoulAnswer).noul;
	const reading: JevReading = { decision: call.answers.decision as ChoiceAnswer, signals, lines: {}, excerpted: true };
	const decision = decideTrim(reading, offered, unitAnswers, cfg);
	if (!decision.trim) return { mode, units: offered, call, reading, decision, skip: decision.reason };
	const trimmed = renderTrimmed(r.text, mode, decision.selected, alias, cfg);
	if (!worthTrimming(trimmed, cfg)) return { mode, units: offered, call, reading, decision, skip: `would keep ${trimmed.keptTokens}/${trimmed.originalTokens} tokens` };
	return { mode, units: offered, call, reading, decision, trimmed };
}
