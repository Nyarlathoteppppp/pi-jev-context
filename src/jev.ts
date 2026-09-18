import { readFileSync } from "node:fs";

// Adapted from pi-heed's judge.ts, plus latency and billed-cost capture per call.

export interface ChoiceQuestion {
	type: "choice";
	instructions: string;
	criteria: Record<string, string>;
}

export interface NoulQuestion {
	type: "noul";
	instructions: string;
}

export type Question = ChoiceQuestion | NoulQuestion;

export interface ChoiceAnswer {
	type: "choice";
	choice: string;
	probabilities: Record<string, number>;
	confidence: number;
}

export interface NoulAnswer {
	type: "noul";
	noul: number;
}

export type Answer = ChoiceAnswer | NoulAnswer;

export interface JevCall {
	answers?: Record<string, Answer>;
	error?: string;
	ms: number;
	model?: string;
	inputTokens?: number;
	cost?: number;
}

interface Transport {
	url: string;
	model: string;
	key: string;
}

const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";
const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";

function fromEnvFile(path: string | undefined, name: string): string | undefined {
	if (!path) return undefined;
	try {
		const line = readFileSync(path, "utf8")
			.split("\n")
			.find((l) => l.startsWith(`${name}=`));
		return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
	} catch {
		return undefined;
	}
}

/** Same key lookup as pi-heed: env vars first, then the dotenv file named by PI_JEV_ENV_FILE / PI_HEED_ENV_FILE. */
export function resolveTransport(env: NodeJS.ProcessEnv = process.env): Transport | undefined {
	const envFile = env.PI_JEV_ENV_FILE ?? env.PI_HEED_ENV_FILE;
	const model = env.PI_JEV_MODEL;
	const openrouter = env.OPENROUTER_API_KEY ?? fromEnvFile(envFile, "OPENROUTER_API_KEY");
	if (openrouter) return { url: OPENROUTER_URL, model: model ?? "~typesafe/jev-latest", key: openrouter };
	const typesafe = env.TYPESAFE_API_KEY ?? fromEnvFile(envFile, "TYPESAFE_API_KEY");
	if (typesafe) return { url: TYPESAFE_URL, model: model ?? "jev-latest", key: typesafe };
	return undefined;
}

function validAnswer(q: Question, a: any): boolean {
	if (!a || typeof a !== "object") return false;
	if (q.type === "noul") return typeof a.noul === "number";
	return typeof a.choice === "string" && a.choice in q.criteria && typeof a.confidence === "number" && !!a.probabilities;
}

export class Jev {
	readonly transport: Transport;
	constructor(transport: Transport) {
		this.transport = transport;
	}

	async decide(state: unknown, questions: Record<string, Question>, timeoutMs = 15000): Promise<JevCall> {
		const started = performance.now();
		try {
			const res = await fetch(this.transport.url, {
				method: "POST",
				headers: { Authorization: `Bearer ${this.transport.key}`, "Content-Type": "application/json", "X-Title": "pi-jev-context" },
				body: JSON.stringify({ model: this.transport.model, state, questions }),
				signal: AbortSignal.timeout(timeoutMs),
			});
			const ms = Math.round(performance.now() - started);
			if (!res.ok) return { error: `http ${res.status}: ${(await res.text()).slice(0, 200)}`, ms };
			const body = (await res.json()) as { model?: string; answers?: Record<string, unknown>; usage?: { input_tokens?: number; cost?: number } };
			const answers: Record<string, Answer> = {};
			for (const [key, q] of Object.entries(questions)) {
				const a = body.answers?.[key];
				if (!validAnswer(q, a)) return { error: `malformed answer for ${key}`, ms };
				answers[key] = { ...(a as Answer), type: q.type } as Answer;
			}
			return { answers, ms, model: body.model, inputTokens: body.usage?.input_tokens, cost: body.usage?.cost };
		} catch (e) {
			return { error: String((e as Error)?.message ?? e), ms: Math.round(performance.now() - started) };
		}
	}
}
