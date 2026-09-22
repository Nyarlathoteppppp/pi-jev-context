import { readFileSync } from "node:fs";

export interface ChoiceQuestion {
    type: "choice";
    instructions: string;
    criteria: Record<string, string>;
}
export interface NoulQuestion {
    type: "noul";
    instructions: string;
    criteria?: { true: string; false: string };
}
export type Question = ChoiceQuestion | NoulQuestion;
export interface ChoiceAnswer { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number; }
export interface NoulAnswer { type: "noul"; noul: number; }
export type Answer = ChoiceAnswer | NoulAnswer;
export interface JevCall { answers?: Record<string, Answer>; error?: string; ms: number; model?: string; inputTokens?: number; cost?: number; }
export interface Judge { decide(state: unknown, questions: Record<string, Question>, timeoutMs?: number, signal?: AbortSignal): Promise<JevCall>; warm?(): void; }
interface Transport { url: string; model: string; key: string; }
export const JEV_PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";

function fromEnvFile(path: string | undefined, name: string): string | undefined {
    if (!path) return undefined;
    try {
        const line = readFileSync(path, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
        return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "") || undefined;
    } catch { return undefined; }
}
export function resolveTransport(env: NodeJS.ProcessEnv = process.env, envFile?: string): Transport | undefined {
    const file = env.PI_JEV_ENV_FILE ?? env.PI_HEED_ENV_FILE ?? envFile;
    const model = env.PI_JEV_MODEL;
    const typesafe = env.TYPESAFE_API_KEY ?? fromEnvFile(file, "TYPESAFE_API_KEY");
    if (typesafe) return { url: TYPESAFE_URL, model: model ?? "jev-latest", key: typesafe };
    const openrouter = env.OPENROUTER_API_KEY ?? fromEnvFile(file, "OPENROUTER_API_KEY");
    return openrouter ? { url: OPENROUTER_URL, model: model ?? "~typesafe/jev-latest", key: openrouter } : undefined;
}
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const probability = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
export function normalizeAnswer(q: Question, value: unknown): Answer | undefined {
    if (!value || typeof value !== "object") return undefined;
    const a = value as any;
    if (q.type === "noul") return probability(a.noul) ? { type: "noul", noul: a.noul } : undefined;
    if (typeof a.choice !== "string" || !(a.choice in q.criteria) || !probability(a.confidence) || !a.probabilities || typeof a.probabilities !== "object") return undefined;
    const probabilities: Record<string, number> = {};
    for (const [key, probability] of Object.entries(a.probabilities)) {
        if (!finite(probability) || probability < 0 || probability > 1) return undefined;
        probabilities[key] = probability;
    }
    if (!probability(probabilities[a.choice])) return undefined;
    return { type: "choice", choice: a.choice, probabilities, confidence: a.confidence };
}
const retryable = new Set([429, 500, 502, 503, 504]);
function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
}
export class Jev implements Judge {
    readonly transport: Transport;
    constructor(transport: Transport) { this.transport = transport; }
    warm(): void { fetch(new URL(this.transport.url).origin, { method: "HEAD", signal: AbortSignal.timeout(3000) }).then((r) => r.body?.cancel(), () => {}); }
    async decide(state: unknown, questions: Record<string, Question>, timeoutMs = 2500, signal?: AbortSignal): Promise<JevCall> {
        const started = performance.now();
        const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
        try {
            const body = JSON.stringify({ model: this.transport.model, state, questions });
            let response: Response;
            for (let attempt = 0; ; attempt++) {
                response = await fetch(this.transport.url, { method: "POST", headers: { Authorization: `Bearer ${this.transport.key}`, "Content-Type": "application/json", "X-Title": "pi-jev-context" }, body, signal: deadline });
                if (response.ok || !retryable.has(response.status) || attempt >= 2) break;
                await response.body?.cancel().catch(() => {});
                const header = response.headers.get("retry-after");
                const retryAfter = header?.trim() ? Number(header) : NaN;
                await wait(Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 150 * 2 ** attempt, deadline);
            }
            if (!response.ok) {
                const detail = (await response.text()).slice(0, 200);
                return { error: `http ${response.status}: ${detail}`, ms: Math.round(performance.now() - started) };
            }
            const payload = await response.json() as { model?: string; answers?: Record<string, unknown>; usage?: { input_tokens?: number; cost?: number } };
            const ms = Math.round(performance.now() - started);
            const answers: Record<string, Answer> = {};
            for (const [key, question] of Object.entries(questions)) {
                const answer = normalizeAnswer(question, payload.answers?.[key]);
                if (!answer) return { error: `malformed answer for ${key}`, ms };
                answers[key] = answer;
            }
            const inputTokens = payload.usage?.input_tokens;
            return { answers, ms, model: payload.model, inputTokens, cost: payload.usage?.cost ?? (inputTokens === undefined ? undefined : inputTokens * JEV_PRICE_PER_INPUT_TOKEN) };
        } catch (error) {
            return { error: String((error as Error)?.message ?? error), ms: Math.round(performance.now() - started) };
        }
    }
}
