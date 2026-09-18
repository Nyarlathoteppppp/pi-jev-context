import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createJevContext, type JevContextOptions } from "../src/index.ts";
import type { Answer, JevCall, Judge, Question } from "../src/jev.ts";

type Handler = (event: any, ctx: any) => any;

/** Minimal stand-in for pi's ExtensionAPI and session, with sequential awaited handlers like agent-core. */
export class FakePi {
	handlers = new Map<string, Handler[]>();
	commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	tools = new Map<string, any>();
	entries: Array<Record<string, any>> = [];
	sent: string[] = [];
	notes: string[] = [];
	status: string | undefined;
	now = 1_700_000_000_000;
	private seq = 0;

	api(): ExtensionAPI {
		const self = this;
		return {
			on(name: string, h: Handler) {
				self.handlers.set(name, [...(self.handlers.get(name) ?? []), h]);
			},
			registerCommand(name: string, opts: any) {
				self.commands.set(name, opts);
			},
			registerTool(def: any) {
				self.tools.set(def.name, def);
			},
			appendEntry(customType: string, data?: unknown) {
				self.entries.push({ type: "custom", id: `e${++self.seq}`, customType, data });
			},
			sendMessage(m: unknown) {
				self.sent.push(JSON.stringify(m));
			},
			sendUserMessage(m: unknown) {
				self.sent.push(JSON.stringify(m));
			},
		} as unknown as ExtensionAPI;
	}

	ctx() {
		return {
			hasUI: true,
			signal: undefined,
			ui: { setStatus: (_k: string, v: string | undefined) => (this.status = v), notify: (m: string) => this.notes.push(m) },
			sessionManager: { getBranch: () => this.entries, getEntries: () => this.entries, buildContextEntries: () => this.entries },
			getContextUsage: () => undefined,
		};
	}

	async emit(name: string, event: Record<string, unknown> = {}) {
		let result: any;
		for (const h of this.handlers.get(name) ?? []) {
			const r = await h({ type: name, ...event }, this.ctx());
			if (r !== undefined) result = r;
		}
		return result;
	}

	private push(message: Record<string, unknown>) {
		this.entries.push({ type: "message", id: `e${++this.seq}`, message: { timestamp: this.now, ...message } });
	}

	user(text: string) {
		this.push({ role: "user", content: text });
	}

	/** Assistant message with one tool call, then pi's tool_result middleware, then the persisted result. */
	async tool(name: string, input: Record<string, unknown>, text: string, opts: { isError?: boolean; id?: string } = {}) {
		const id = opts.id ?? `call_${++this.seq}`;
		this.push({ role: "assistant", content: [{ type: "toolCall", id, name, arguments: input }] });
		const content = [{ type: "text", text }];
		const patch = await this.emit("tool_result", { toolCallId: id, toolName: name, input, content, isError: !!opts.isError, details: undefined });
		const final = patch?.content ?? content;
		this.push({ role: "toolResult", toolCallId: id, toolName: name, content: final, isError: !!opts.isError });
		return { id, patch, text: final.map((c: { text: string }) => c.text).join("\n") };
	}

	async assistantReply(text: string, usage = { input: 1000, cacheRead: 0, cacheWrite: 1000 }) {
		const message = { role: "assistant", content: [{ type: "text", text }], timestamp: this.now, usage, model: "fake" };
		this.push(message);
		await this.emit("message_end", { message });
	}

	async command(line: string) {
		const [name, ...rest] = line.replace(/^\//, "").split(" ");
		await this.commands.get(name!)!.handler(rest.join(" "), this.ctx());
	}

	async recall(params: Record<string, unknown>) {
		const r = await this.tools.get("context_recall").execute("recall_1", params, undefined, undefined, this.ctx());
		return r.content[0].text as string;
	}

	logs(kind?: string) {
		return this.entries.filter((e) => e.customType === "jev-context" && (!kind || e.data.kind === kind)).map((e) => e.data);
	}

	flush() {
		return new Promise((r) => setTimeout(r, 5));
	}
}

/** Fake judge: answers every question via `fn`; records the questions it saw. */
export function fakeJudge(fn: (key: string, q: Question) => Answer | undefined, opts: { error?: string } = {}): Judge & { calls: Array<Record<string, Question>> } {
	const calls: Array<Record<string, Question>> = [];
	return {
		calls,
		async decide(_state, questions): Promise<JevCall> {
			calls.push(questions);
			if (opts.error) return { error: opts.error, ms: 1 };
			const answers: Record<string, Answer> = {};
			for (const [k, q] of Object.entries(questions)) {
				const a = fn(k, q);
				if (a) answers[k] = a;
			}
			return { answers, ms: 1, cost: 0.00006 };
		},
	};
}

export const choice = (c: string, p = 0.95, confidence = 0.9): Answer => ({ type: "choice", choice: c, probabilities: { [c]: p }, confidence });
export const noul = (v: number): Answer => ({ type: "noul", noul: v });

export function setup(options: JevContextOptions = {}) {
	const pi = new FakePi();
	const ext = createJevContext(pi.api(), { env: {}, ...options });
	return { pi, ext };
}
