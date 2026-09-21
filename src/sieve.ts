import { estimateTokens, lineCount, summarizeCall, textOf, truncate } from "./extract.ts";
import type { Message } from "./types.ts";
import type { ChoiceAnswer, Judge, NoulAnswer, Question } from "./jev.ts";

export interface SieveConfig { minLines: number; minTokens: number; blockChars: number; maxBlocks: number; maxRequestTokens: number; }
export const DEFAULT_SIEVE: SieveConfig = { minLines: 150, minTokens: 3000, blockChars: 1500, maxBlocks: 64, maxRequestTokens: 20000 };
export interface FreshResult { toolCallId: string; toolName: string; input: Record<string, unknown>; text: string; isError: boolean; }
export interface SieveBlock { id: string; fromLine: number; toLine: number; text: string; completeForJev: boolean; hardKeep: boolean; keepReason?: string; }
export interface SievePlan { blocks: SieveBlock[]; hidden: SieveBlock[]; visible: SieveBlock[]; call?: { ms: number; error?: string; inputTokens?: number; cost?: number; model?: string }; skip?: string; }

const VIEWER = /(?:^|[\s;&|()'"`])(?:cat|bat|less|more|nl|sed|awk|jq|yq|xxd|od|head|tail|grep|rg|ripgrep|find|ls|fd|search|diff|git\s+(?:diff|show|blame|log\b))/i;
const PIPE = /\||`[^`]*`|\$\([^)]*\)/;
export type BashOutputKind = "test" | "build" | "lint" | "diagnostic" | "log";
export function classifyBashCommand(command: string): BashOutputKind | undefined {
    const c = command.trim().replace(/^cd\s+[\w./~-]+\s*&&\s*/, "");
    // Mixed commands can append source or unrelated evidence after a test log.
    // Accept a single known executable, optionally preceded by a simple cd.
    if (!c || VIEWER.test(c) || PIPE.test(c) || /[;&\n\r]/.test(c)) return undefined;
    if (!/^(?:npm|pnpm|yarn|bun|npx|jest|vitest|mocha|ava|pytest|tsc|eslint|biome|stylelint|cargo|go|mvn|gradle|webpack|vite|docker|kubectl|podman|journalctl)(?:\s|$)/i.test(c) && !/^\.\/[\w./-]*(?:test|tests)[\w./-]*(?:\s|$)/i.test(c)) return undefined;
    if (/(?:^|[\s;&])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i.test(c) || /(?:^|[\s;&])(?:npx\s+)?(?:jest|vitest|mocha|ava|pytest)\b/i.test(c) || /(?:^|[\s;&])(?:cargo\s+test|go\s+test|mvn\s+test|gradle\s+test)\b/i.test(c)) return "test";
    if (/(?:^|[\s;&])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|eslint|clippy|stylelint|biome)\b/i.test(c) || /(?:^|[\s;&])(?:npx\s+)?(?:eslint|biome|stylelint)\b/i.test(c)) return "lint";
    if (/(?:^|[\s;&])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:typecheck|check)\b/i.test(c) || /(?:^|[\s;&])(?:npx\s+)?tsc\b/i.test(c)) return "diagnostic";
    if (/(?:^|[\s;&])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile)\b/i.test(c) || /(?:^|[\s;&])(?:npx\s+)?(?:webpack|vite\s+build)\b/i.test(c) || /(?:^|[\s;&])cargo\s+build\b/i.test(c)) return "build";
    if (/(?:^|[\s;&])(?:\.\/|[\w.-]+\/)[\w./-]*(?:test|tests)[\w./-]*(?:\s|$)/i.test(c)) return "test";
    if (/(?:^|[\s;&])(?:docker|kubectl|podman)\s+(?:compose\s+)?logs\b|(?:^|[\s;&])journalctl\b/i.test(c)) return "log";
    return undefined;
}
export function eligibleFreshOutput(toolName: string, input: Record<string, unknown>, text: string, isError: boolean, cfg = DEFAULT_SIEVE): BashOutputKind | undefined {
    if (toolName !== "bash" || isError || typeof input.command !== "string") return undefined;
    if (lineCount(text) < cfg.minLines && estimateTokens(text) < cfg.minTokens) return undefined;
    return classifyBashCommand(input.command);
}

const failure = /\b(?:ERROR|FAIL|FAILED|Traceback|panic|fatal)\b|(?:Error|Exception)\b|[✗×✕✖✘❌]/i;
const warning = /\b(?:WARN(?:ING)?)\b/i;
const location = /(?:^|\s)[^\s:]+:\d+(?::\d+)?\b/;
const summary = /\b(?:tests?|test files?|checks?|files?|errors?|failures?|passed|failed)\s*[:=]?\s*\d+|\bexit\s+code\s*[:=]?\s*\d+/i;
const stackStart = /\b(?:Traceback \(most recent call last\)|Caused by:|panic:|goroutine \d+\b|panicked at)\b/i;
const stackFrame = /^\s*(?:at\s+\S+|File\s+["'][^"']+["'],\s+line\s+\d+|Caused by:|goroutine\s+\d+\b|[\w$./<>-]+(?:\([^)]*\))?\s*\(?[^\s()]+:\d+(?::\d+)?(?:\s+\+0x[\da-f]+)?\)?)/i;

/** Returns source-line numbers belonging to a failure's stack-trace region. */
export function stackTraceLines(linesOrText: string[] | string): Set<number> {
    const lines = Array.isArray(linesOrText) ? linesOrText : linesOrText.split("\n");
    const protectedLines = new Set<number>();
    const markRun = (start: number, end: number) => { for (let i = Math.max(0, start); i <= Math.min(lines.length - 1, end); i++) protectedLines.add(i); };
    for (let seed = 0; seed < lines.length; seed++) {
        const line = lines[seed] ?? "";
        const traceback = /Traceback \(most recent call last\):/i.test(line);
        const panic = /\b(?:panic:|panicked at|goroutine \d+\b)/i.test(line);
        const failed = failure.test(line) || stackStart.test(line);
        if (!failed && !stackFrame.test(line)) continue;
        if (traceback || panic) {
            let end = seed;
            while (end + 1 < lines.length && lines[end + 1]!.trim()) end++;
            markRun(seed, end);
            continue;
        }
        let end = seed;
        let sawFrame = false;
        while (end + 1 < lines.length && lines[end + 1]!.trim()) {
            const next = lines[end + 1]!;
            if (stackFrame.test(next) || (sawFrame && /^\s+/.test(next))) { sawFrame = true; end++; continue; }
            if (/^\s*Caused by:/i.test(next)) { sawFrame = true; end++; continue; }
            break;
        }
        if (sawFrame) markRun(seed, end); else protectedLines.add(seed);
    }
    // A frame can be split into a later candidate block. Preserve all frame-shaped lines
    // adjacent to an already protected stack region, even when the line has no keyword.
    for (let i = 0; i < lines.length; i++) {
        if (!stackFrame.test(lines[i] ?? "")) continue;
        if (protectedLines.has(Math.max(0, i - 1)) || protectedLines.has(Math.min(lines.length - 1, i + 1))) protectedLines.add(i);
    }
    return protectedLines;
}
function hardReason(lines: string[], index: number, stackLines: Set<number>): string | undefined {
    if (stackLines.has(index)) return "stack trace";
    if (failure.test(lines[index] ?? "")) return "failure";
    if (warning.test(lines[index] ?? "")) return "warning";
    if (location.test(lines[index] ?? "")) return "diagnostic location";
    if (summary.test(lines[index] ?? "")) return "summary";
    const near = lines.slice(Math.max(0, index - 6), Math.min(lines.length, index + 7)).some((line) => failure.test(line));
    return near ? "failure context" : undefined;
}
export function splitSieveBlocks(text: string, cfg = DEFAULT_SIEVE): SieveBlock[] | undefined {
    const lines = text.split("\n");
    const ranges: Array<[number, number, boolean]> = [];
    let start = 0;
    while (start < lines.length) {
        let end = start;
        let chars = 0;
        let complete = true;
        while (end < lines.length && chars + lines[end]!.length + (end > start ? 1 : 0) <= cfg.blockChars) { chars += lines[end]!.length + (end > start ? 1 : 0); end++; }
        if (end === start) { end++; complete = false; }
        if (end < lines.length) {
            let boundary = -1;
            for (let i = end - 1; i > start; i--) if (!lines[i]!.trim() || /^(?:\s*(?:Test Files?|Tests?|Build|Lint|Summary|Results?)\b|\s*(?:FAIL|PASS|ERROR)\b)/i.test(lines[i]!)) { boundary = i; break; }
            if (boundary > start) end = boundary;
        }
        ranges.push([start, end, complete && end > start]);
        start = end;
    }
    if (ranges.length > cfg.maxBlocks) return undefined;
    const stackLines = stackTraceLines(lines);
    const blocks = ranges.map(([from, to, complete], i) => {
        const blockLines = lines.slice(from, to);
        const reasons = blockLines.map((_line, n) => hardReason(lines, from + n, stackLines)).filter(Boolean) as string[];
        return { id: `b${i + 1}`, fromLine: from + 1, toLine: to, text: blockLines.join("\n"), completeForJev: complete && blockLines.join("\n").length <= cfg.blockChars, hardKeep: reasons.length > 0, keepReason: reasons[0] };
    });
    const covered = blocks.reduce((n, b) => n + b.toLine - b.fromLine + 1, 0);
    return covered === lines.length && blocks.every((b, i) => i === 0 || b.fromLine === blocks[i - 1]!.toLine + 1) ? blocks : undefined;
}

export const NEED: Question = { type: "choice", instructions: "What does the agent need from this fresh command output for the latest request?", criteria: { every_line: "The complete output", specific_parts: "Only specific parts", outcome_only: "Only the outcome", unclear: "Unclear" } };
export const USER_ASKED: Question = { type: "noul", instructions: "Did the user explicitly request the complete output?" };
export function blockQuestion(block: SieveBlock): Question { return { type: "noul", instructions: `Will the agent likely need information from output lines ${block.fromLine}-${block.toLine} to complete the task?`, criteria: { true: "Needed", false: "Not needed" } }; }

function terms(request: string): string[] { return [...new Set((request.match(/`[^`]+`|[A-Za-z_][\w./:-]{3,}/g) ?? []).map((x) => x.replaceAll("`", "").toLowerCase()))]; }
function state(context: Message[], result: FreshResult, blocks: SieveBlock[]): Record<string, unknown> {
    const users = context.filter((m) => m.role === "user");
    const assistants = context.filter((m) => m.role === "assistant");
    const latest = users.at(-1);
    const intent = assistants.at(-1)?.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";
    return { original_task: truncate(users[0] ? textOf(users[0].content) : "", 500), latest_user_request: truncate(latest ? textOf(latest.content) : "", 800), assistant_intent_before_tool: truncate(intent, 800), recent_conversation: context.slice(-8).map((m) => ({ role: m.role, text: truncate(m.role === "user" ? textOf(m.content) : m.role === "assistant" ? m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") : "", 500) })), tool_call: summarizeCall(result.toolName, result.input), tool_args: result.input, output_status: result.isError ? "error" : "ok", output_size: `${lineCount(result.text)} lines`, blocks: Object.fromEntries(blocks.map((b) => [b.id, { lines: `${b.fromLine}-${b.toLine}`, text: b.text }])) };
}
export function renderSieve(text: string, blocks: SieveBlock[], hidden: SieveBlock[], alias: string): { text: string; originalTokens: number; visibleTokens: number; hiddenTokens: number } {
    const hiddenIds = new Set(hidden.map((b) => b.id));
    const lines = text.split("\n");
    const visible: string[] = [];
    let omitted = 0;
    for (const block of blocks) {
        if (!hiddenIds.has(block.id)) { visible.push(block.text); continue; }
        omitted += block.toLine - block.fromLine + 1;
        visible.push(`… [${block.toLine - block.fromLine + 1} lines omitted: ${block.fromLine}-${block.toLine}] …`);
    }
    const header = `[pi-jev-context] Output shortened: ${lines.length - omitted} of ${lines.length} lines retained verbatim; ${hidden.length} block(s) hidden (${hidden.map((b) => `${b.fromLine}-${b.toLine}`).join(", ")}). Omitted content is not visible. Before relying on it, call context_recall with id "${alias}".`;
    const rendered = `${header}\n${visible.join("\n")}`;
    return { text: rendered, originalTokens: estimateTokens(text), visibleTokens: estimateTokens(rendered), hiddenTokens: Math.max(0, estimateTokens(text) - estimateTokens(rendered)) };
}
export function chooseHidden(need: ChoiceAnswer, userAsked: NoulAnswer, blocks: SieveBlock[], probabilities: Record<string, number>, threshold: number, request: string): { hidden: SieveBlock[]; skip?: string } {
    if (need.choice === "every_line" || need.choice === "unclear") return { hidden: [], skip: `jev ${need.choice}` };
    if (userAsked.noul >= 0.5) return { hidden: [], skip: "user requested complete output" };
    const requestTerms = terms(request);
    const hidden = blocks.filter((b) => b.completeForJev && !b.hardKeep && !requestTerms.some((t) => b.text.toLowerCase().includes(t)) && (probabilities[b.id] ?? 1) < threshold);
    return hidden.length ? { hidden } : { hidden, skip: "no block passed hard guards and threshold" };
}
export async function planSieve(judge: Judge, context: Message[], result: FreshResult, alias: string, opts: { config?: SieveConfig; threshold?: number; minHiddenShare?: number; minSavedTokens?: number; timeoutMs?: number } = {}): Promise<SievePlan> {
    const cfg = opts.config ?? DEFAULT_SIEVE;
    const blocks = splitSieveBlocks(result.text, cfg);
    if (!blocks) return { blocks: [], hidden: [], visible: [], skip: "uncertain block coverage" };
    const questions: Record<string, Question> = { need: NEED, user_asked: USER_ASKED };
    for (const block of blocks) questions[block.id] = blockQuestion(block);
    const built = state(context, result, blocks);
    if (estimateTokens(JSON.stringify(built)) + estimateTokens(JSON.stringify(questions)) > cfg.maxRequestTokens) return { blocks, hidden: [], visible: blocks, skip: "request budget exceeded" };
    const call = await judge.decide(built, questions, opts.timeoutMs ?? 2500);
    if (!call.answers) return { blocks, hidden: [], visible: blocks, call, skip: `jev unavailable: ${call.error ?? "unknown"}` };
    const need = call.answers.need as ChoiceAnswer | undefined;
    const userAsked = call.answers.user_asked as NoulAnswer | undefined;
    if (!need || !userAsked || need.type !== "choice" || !["every_line", "specific_parts", "outcome_only", "unclear"].includes(need.choice) || !Number.isFinite(need.confidence) || need.confidence < 0 || need.confidence > 1 || !need.probabilities || !Object.hasOwn(need.probabilities, need.choice) || Object.values(need.probabilities).some(p => typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) || userAsked.type !== "noul" || !Number.isFinite(userAsked.noul) || userAsked.noul < 0 || userAsked.noul > 1) return { blocks, hidden: [], visible: blocks, call, skip: "invalid complete answer" };
    const probabilities: Record<string, number> = {};
    for (const block of blocks) { const answer = call.answers[block.id] as NoulAnswer | undefined; if (!answer || answer.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) return { blocks, hidden: [], visible: blocks, call, skip: "invalid block answer" }; probabilities[block.id] = answer.noul; }
    const taskText = context.filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n");
    const intentText = context.filter((m) => m.role === "assistant").map((m) => m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n")).join("\n");
    const decision = chooseHidden(need, userAsked, blocks, probabilities, opts.threshold ?? 0.10, `${taskText}\n${intentText}`);
    if (decision.skip) return { blocks, hidden: [], visible: blocks, call, skip: decision.skip };
    const rendered = renderSieve(result.text, blocks, decision.hidden, alias);
    if (rendered.hiddenTokens < (opts.minSavedTokens ?? 1000) || rendered.hiddenTokens / Math.max(1, rendered.originalTokens) < (opts.minHiddenShare ?? 0.30)) return { blocks, hidden: [], visible: blocks, call, skip: "benefit gate failed" };
    return { blocks, hidden: decision.hidden, visible: blocks.filter((b) => !decision.hidden.includes(b)), call };
}
