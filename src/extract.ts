import type { Message, ToolCall } from "./types.ts";

/** One tool call paired with its result, positioned in the message list. */
export interface ToolEvent {
	id: string;
	name: string;
	args: Record<string, any>;
	output: string;
	isError: boolean;
	/** Index of the toolResult message. */
	index: number;
	/** Number of user messages before this event (which user request it served). */
	userTurn: number;
	/** Ordinal among tool events. */
	seq: number;
}

export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((p: any) => p?.type === "text" && typeof p.text === "string")
		.map((p: any) => p.text)
		.join("\n");
}

export function toolEvents(messages: Message[]): ToolEvent[] {
	const calls = new Map<string, ToolCall>();
	const out: ToolEvent[] = [];
	let userTurn = 0;
	messages.forEach((m, index) => {
		if (m.role === "user") {
			userTurn++;
		} else if (m.role === "assistant") {
			for (const c of m.content) if (c.type === "toolCall") calls.set(c.id, c);
		} else if (m.role === "toolResult") {
			const call = calls.get(m.toolCallId);
			out.push({
				id: m.toolCallId,
				name: m.toolName,
				args: call?.arguments ?? {},
				output: textOf(m.content),
				isError: m.isError,
				index,
				userTurn,
				seq: out.length,
			});
		}
	});
	return out;
}

export const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
export const normalizeCommand = (c: string) => c.trim().replace(/\s+/g, " ");

/** Human-readable one-liner for a tool call. */
export function summarizeCall(name: string, args: Record<string, any>): string {
	switch (name) {
		case "bash":
			return `bash: ${truncate(normalizeCommand(String(args.command ?? "")), 160)}`;
		case "read": {
			const range = args.offset || args.limit ? ` (lines ${args.offset ?? 1}-${(args.offset ?? 1) + (args.limit ?? 0)})` : "";
			return `read ${args.path}${range}`;
		}
		case "grep":
			return `grep "${args.pattern}" in ${args.path ?? "."}`;
		case "find":
			return `find "${args.pattern}" in ${args.path ?? "."}`;
		case "ls":
			return `ls ${args.path ?? "."}`;
		case "edit":
			return `edit ${args.path}`;
		case "write":
			return `write ${args.path}`;
		default:
			return `${name}: ${truncate(JSON.stringify(args), 160)}`;
	}
}

const NOTABLE =
	/\b(?:errors?|Errors?|ERRORS?|ERR!|FAIL|FAILED|failed|Exception|Traceback|panic|fatal|warning|Warning|WARN|Expected|Received|expected|Tests?:|passed|Caused by)\b|✗|×|\.(?:ts|tsx|js|py|go|rs):\d+/;

/** First line that says what happened: an error-looking line, else the first non-empty line. */
export function outcomeLine(output: string, isError: boolean): string {
	const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
	if (lines.length === 0) return "(no output)";
	const pick = (isError ? lines.find((l) => NOTABLE.test(l)) : undefined) ?? lines.find((l) => /\b(?:passed|failed|Tests?:)\b/i.test(l)) ?? lines[0]!;
	return truncate(pick, 160) + (lines.length > 1 ? ` (+${lines.length - 1} lines)` : "");
}

/** Lines worth showing from a long output: errors, failures, file:line refs, summaries. With 1-based line numbers. */
export function notableLines(output: string, max: number): Array<{ n: number; text: string }> {
	const all: Array<{ n: number; text: string }> = [];
	const seen = new Map<string, number>();
	output.split("\n").forEach((line, i) => {
		const t = line.trim();
		// Lines that differ only in numbers (positions, timings, ids) count at most twice.
		const shape = t.replace(/\d+/g, "#");
		if (!t || !NOTABLE.test(t) || (seen.get(shape) ?? 0) >= 2) return;
		seen.set(shape, (seen.get(shape) ?? 0) + 1);
		all.push({ n: i + 1, text: truncate(t, 200) });
	});
	// Over budget: keep the highest-priority lines (failures before warnings), then restore file order.
	return all
		.sort((a, b) => linePriority(b.text) - linePriority(a.text) || a.n - b.n)
		.slice(0, max)
		.sort((a, b) => a.n - b.n);
}

/** Key for "the same thing observed again": same command, same file, same search. */
export function relatedKey(e: Pick<ToolEvent, "name" | "args">): string | undefined {
	const a = e.args;
	switch (e.name) {
		case "bash": {
			const cmd = normalizeCommand(String(a.command ?? ""));
			// Test/lint/build runners: family = first two tokens ("npm test", "npx vitest", "pnpm lint").
			if (/^(?:npm|pnpm|yarn|npx|bun)\s/.test(cmd)) return `bash:${cmd.split(" ").slice(0, 2).join(" ")}`;
			return `bash:${cmd}`;
		}
		case "read":
		case "edit":
		case "write":
			return `file:${String(a.path).replace(/^\.\//, "")}`;
		case "grep":
			return `grep:${a.pattern}:${a.path ?? "."}`;
		case "ls":
		case "find":
			return `${e.name}:${a.path ?? "."}:${a.pattern ?? ""}`;
		default:
			return undefined;
	}
}

/** Ranks notable lines for "keep when truncating" candidates: failures and locations before warnings and chatter. */
export function linePriority(text: string): number {
	if (/^(?:Found \d+ errors?|Test Files|Tests?:)|\b\d+ (?:failed|errors?)\b/.test(text)) return 4;
	if (/\b(?:FAIL|FAILED|failed|Error|ERROR|error|ERR!|Exception|Traceback|panic|fatal|FATAL|Expected|Received|Caused by)\b|✗|×/.test(text)) return 3;
	if (/\.(?:ts|tsx|js|py|go|rs):\d+/.test(text) || /\bTests?:/.test(text)) return 2;
	return 1;
}

export const lineCount = (s: string) => (s ? s.split("\n").length : 0);

/** Size bucket in words: Jev reads words more reliably than numbers. */
export function sizeClass(lines: number): string {
	if (lines <= 3) return "tiny";
	if (lines <= 30) return "short";
	if (lines <= 150) return "medium";
	if (lines <= 400) return "long";
	return "very long";
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);
