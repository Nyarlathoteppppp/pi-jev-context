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
	/** Optional { true, false } descriptions of what a yes and a no mean. */
	criteria?: { true: string; false: string };
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

/** Jev list price: $0.042 per million input tokens, output free (docs.typesafe.ai/models). */
export const JEV_PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000;

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
export function resolveTransport(env: NodeJS.ProcessEnv = process.env, fileEnvFile?: string): Transport | undefined {
	const envFile = env.PI_JEV_ENV_FILE ?? env.PI_HEED_ENV_FILE ?? fileEnvFile;
	const model = env.PI_JEV_MODEL;
	// TypeSafe's own endpoint first (official key), OpenRouter as the fallback.
	const typesafe = env.TYPESAFE_API_KEY ?? fromEnvFile(envFile, "TYPESAFE_API_KEY");
	if (typesafe) return { url: TYPESAFE_URL, model: model ?? "jev-latest", key: typesafe };
	const openrouter = env.OPENROUTER_API_KEY ?? fromEnvFile(envFile, "OPENROUTER_API_KEY");
	if (openrouter) return { url: OPENROUTER_URL, model: model ?? "~typesafe/jev-latest", key: openrouter };
	return undefined;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Validates an answer and clamps minor numeric overshoot into [0, 1]; anything non-finite or off-schema is
 * rejected, which fails the call open. (Ported from pi-heed v0.7, which borrowed it from thruwire/foreman, MIT.)
 */
export function normalizeAnswer(q: Question, a: any): Answer | undefined {
	if (!a || typeof a !== "object") return undefined;
	if (q.type === "noul") return finite(a.noul) ? { type: "noul", noul: clamp01(a.noul) } : undefined;
	if (typeof a.choice !== "string" || !(a.choice in q.criteria) || !finite(a.confidence) || !a.probabilities || typeof a.probabilities !== "object") return undefined;
	const probabilities: Record<string, number> = {};
	for (const [k, v] of Object.entries(a.probabilities)) {
		if (!finite(v)) return undefined;
		probabilities[k] = clamp01(v);
	}
	return { type: "choice", choice: a.choice, probabilities, confidence: clamp01(a.confidence) };
}

/** Transient statuses worth retrying (TypeSafe's SDK retries the same set). From pi-heed v0.7. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;

function retryDelay(res: Response, attempt: number): number {
	const header = res.headers.get("retry-after");
	const seconds = header !== null && header !== "" ? Number(header) : Number.NaN;
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	return 150 * 2 ** attempt;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(signal.reason);
		const t = setTimeout(resolve, ms);
		signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
	});
}

/** Anything that answers Jev questions: the real client, or a fake in tests. */
export interface Judge {
	decide(state: unknown, questions: Record<string, Question>, timeoutMs?: number, signal?: AbortSignal): Promise<JevCall>;
	warm?(): void;
}

export class Jev implements Judge {
	readonly transport: Transport;
	constructor(transport: Transport) {
		this.transport = transport;
	}

	/**
	 * Opens DNS + TLS ahead of the first decision with an unauthenticated HEAD. pi-heed E13 measured this
	 * against a tiny real decision on TypeSafe's endpoint: same first-decision latency (305–382 vs 288–397 ms,
	 * cold 790–918 ms), because the cold cost is the connection, not the model. Free, never throws.
	 */
	warm(): void {
		fetch(new URL(this.transport.url).origin, { method: "HEAD", signal: AbortSignal.timeout(3000) }).then(
			(r) => r.body?.cancel(),
			() => {},
		);
	}

	/**
	 * Never throws: failures come back as `error` (callers fail open). 429 and transient 5xx are retried (up to
	 * twice, honouring Retry-After) inside the deadline, so retries never exceed the caller's timeout.
	 */
	async decide(state: unknown, questions: Record<string, Question>, timeoutMs = 15000, signal?: AbortSignal): Promise<JevCall> {
		const started = performance.now();
		const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
		const payload = JSON.stringify({ model: this.transport.model, state, questions });
		try {
			let res: Response;
			for (let attempt = 0; ; attempt++) {
				res = await fetch(this.transport.url, {
					method: "POST",
					headers: { Authorization: `Bearer ${this.transport.key}`, "Content-Type": "application/json", "X-Title": "pi-jev-context" },
					body: payload,
					signal: deadline,
				});
				if (res.ok || !RETRYABLE.has(res.status) || attempt >= MAX_RETRIES) break;
				await res.body?.cancel().catch(() => {});
				await sleep(retryDelay(res, attempt), deadline);
			}
			const ms = Math.round(performance.now() - started);
			if (!res.ok) return { error: `http ${res.status}: ${(await res.text()).slice(0, 200)}`, ms };
			const body = (await res.json()) as { model?: string; answers?: Record<string, unknown>; usage?: { input_tokens?: number; cost?: number } };
			const answers: Record<string, Answer> = {};
			for (const [key, q] of Object.entries(questions)) {
				const a = normalizeAnswer(q, body.answers?.[key]);
				if (!a) return { error: `malformed answer for ${key}`, ms };
				answers[key] = a;
			}
			const inputTokens = body.usage?.input_tokens;
			// OpenRouter reports cost; TypeSafe's endpoint reports tokens only (input is billed, output is free).
			const cost = body.usage?.cost ?? (inputTokens !== undefined ? inputTokens * JEV_PRICE_PER_INPUT_TOKEN : undefined);
			return { answers, ms, model: body.model, inputTokens, cost };
		} catch (e) {
			return { error: String((e as Error)?.message ?? e), ms: Math.round(performance.now() - started) };
		}
	}
}
