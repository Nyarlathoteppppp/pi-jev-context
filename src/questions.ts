import type { ChoiceQuestion, NoulQuestion, Question } from "./jev.ts";

// Pre-registered before the first live run. Changing any text here invalidates comparisons with
// earlier result files; bump QUESTIONS_VERSION when you do.
export const QUESTIONS_VERSION = "q1";

export const DECISION: ChoiceQuestion = {
	type: "choice",
	instructions:
		"`item` is an old tool call and its result inside an AI coding agent's context. Decide what should happen to it in the agent's context from now on. " +
		"Judge whether the agent will still need the information in item's result to accomplish current_goal or later work in this project, " +
		"given what happened after it (after_item) and any newer results about the same thing (newer_related_results). " +
		"Output that the agent could trivially regenerate and that is irrelevant to current_goal (such as an old pwd or ls) is not worth keeping.",
	criteria: {
		KEEP: "Keep the whole result: its information is still needed (for example an unresolved error, a root cause, a decision or rule, the current content of a file being worked on, or evidence the user asked for), and the result is short or all of it matters.",
		TRUNCATE: "Keep only a few key lines: part of the result still matters (for example the failing test names and error lines of a long log, or a version or config value inside a long file), but most of the text is noise.",
		DROP: "Remove it entirely: nothing in it is still needed, because it is outdated, superseded by a newer result, already resolved, or trivially regenerable and irrelevant to current_goal.",
		UNCERTAIN: "The state does not contain enough information to decide safely.",
	},
};

export const SIGNALS: Record<string, NoulQuestion> = {
	superseded: {
		type: "noul",
		instructions:
			"A result listed in newer_related_results makes the information in item's result outdated (for example the same command was run again later with a different outcome, or the same file was read again after being modified).",
	},
	needed_now: {
		type: "noul",
		instructions: "Information in item's result is needed to accomplish current_goal.",
	},
	unique_fact: {
		type: "noul",
		instructions:
			"item's result contains a specific fact (such as a root cause, a still-unresolved error message, a file path, a version number, a config value, an API name or a design decision) that is not repeated anywhere else in the state.",
	},
	durable: {
		type: "noul",
		instructions:
			"item's result contains long-lived project facts (such as required runtime or package versions, engine constraints, architecture rules, API names or file locations) that could matter for future tasks in this project even if they are not needed for current_goal.",
	},
	user_requested: {
		type: "noul",
		instructions: "The user explicitly asked the agent to keep, preserve, or later use this specific output.",
	},
	mostly_noise: {
		type: "noul",
		instructions: "Most of the text of item's result is boilerplate or repetitive output, and only a few of its lines carry useful information.",
	},
};

export function keyLineQuestion(n: number, text: string): NoulQuestion {
	return {
		type: "noul",
		instructions: `Line L${n} of item's result ("${text}") is key evidence that must be kept if the result is shortened.`,
	};
}

export function questionsFor(keyLines: Array<{ n: number; text: string }>): Record<string, Question> {
	const q: Record<string, Question> = { decision: DECISION, ...SIGNALS };
	for (const l of keyLines) q[`line_${l.n}`] = keyLineQuestion(l.n, l.text);
	return q;
}
