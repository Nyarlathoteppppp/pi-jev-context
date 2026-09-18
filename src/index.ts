import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { estimateTokens, summarizeCall, textOf, toolEvents, truncate } from "./extract.ts";
import { Jev, type Judge, type NoulAnswer, resolveTransport } from "./jev.ts";
import type { JevReading } from "./policy.ts";
import { hybridPolicy, sourceFacts } from "./protect.ts";
import { questionsFor, SIGNALS } from "./questions.ts";
import { buildState } from "./state.ts";
import { DEFAULT_TRIM, shouldConsider, type TrimConfig } from "./trim.ts";
import type { Label, Message } from "./types.ts";
import { planTrim } from "./writetime.ts";
import { DEFAULT_SIEVE, planSieve, type SieveConfig } from "./sieve.ts";

// pi-jev-context v0.1
//  1. Write-time trimming (mode "on"): long tool output is shortened to its key lines BEFORE it enters the
//     context, so no cached prompt prefix is ever invalidated. The original is stored losslessly in a session
//     entry (custom entries never reach the model) and context_recall returns it.
//  2. Old-context pruning: shadow only. Decisions are logged, the context is never modified.
//  3. Cache observation: logs idle gaps and cache reads, to measure when the prompt cache is really cold.

export type Mode = "off" | "shadow" | "on";
const MODES: Mode[] = ["off", "shadow", "on"];

export interface JevContextConfig {
	mode: Mode;
	/** Write-time engine: "sieve" hides only blocks Jev is confident are unneeded (v0.2 default); "select" keeps only what Jev selects (v0.1). */
	engine: "sieve" | "select";
	sieve: SieveConfig;
	trim: TrimConfig;
	/** Hard deadline for a write-time decision; on timeout the output passes through unchanged. */
	trimTimeoutMs: number;
	/** Shadow pruning: skip results smaller than this (a stub would save nothing). */
	pruneMinTokens: number;
	/** Shadow pruning: at most this many Jev calls per settled run. */
	pruneMaxPerRun: number;
	pruneConcurrency: number;
	pruneTimeoutMs: number;
	/** Idle gap after which the provider cache is assumed cold (Anthropic "short" retention ≈ 5 min). */
	coldAfterMs: number;
	/** Log cache usage for LLM calls that follow an idle gap at least this long. */
	observeGapMs: number;
}

export const DEFAULT_CONFIG: JevContextConfig = {
	mode: "shadow",
	engine: "sieve",
	sieve: DEFAULT_SIEVE,
	trim: DEFAULT_TRIM,
	trimTimeoutMs: 2500,
	pruneMinTokens: 150,
	pruneMaxPerRun: 24,
	pruneConcurrency: 4,
	pruneTimeoutMs: 5000,
	coldAfterMs: 5 * 60_000,
	observeGapMs: 60_000,
};

export interface JevContextOptions {
	/** Override the judge (tests). `null` disables Jev: nothing is trimmed or judged. */
	judge?: Judge | null;
	config?: Partial<JevContextConfig>;
	env?: NodeJS.ProcessEnv;
	/** Settings file path (tests); defaults to ~/.pi/agent/pi-jev-context.json. */
	settingsPath?: string;
}

export const ORIGINAL = "jev-context-original";
export const LOG = "jev-context";
export const CONFIG = "jev-context-config";

export interface Original {
	alias: string;
	toolCallId: string;
	tool: string;
	summary: string;
	text: string;
	fullOutputPath?: string;
}

export type LogRecord =
	| { kind: "trim"; mode: Mode; acted: boolean; alias?: string; toolCallId: string; summary: string; engine?: string; blocks?: number; hidden?: number; from: number; to?: number; keptLines?: number; totalLines: number; ms: number; cost?: number; skip?: string; need?: string; p?: number }
	| { kind: "recall"; alias: string; found: boolean }
	| { kind: "prune"; toolCallId: string; summary: string; decision: Label; raw?: string; p?: number; confidence?: number; tokens: number; goal: number; facts: string; ms: number; cost?: number; error?: string }
	| { kind: "cold"; gapMs: number; reason: string; wouldSave: number; decisions: number }
	| { kind: "cache"; gapMs: number; input: number; cacheRead: number; cacheWrite: number; model?: string }
	| { kind: "label"; target: string; label: "good" | "bad"; note?: string };

/** Only the roles the analysis understands; pi's other message kinds (custom, bashExecution…) are skipped. */
export function contextMessages(ctx: ExtensionContext): Message[] {
	const sm = ctx.sessionManager as unknown as { buildContextEntries?: () => any[]; getBranch: () => any[] };
	const entries = sm.buildContextEntries?.() ?? sm.getBranch();
	return entries
		.filter((e) => e.type === "message" && ["user", "assistant", "toolResult"].includes(e.message?.role))
		.map((e) => e.message as Message);
}

function branch(ctx: ExtensionContext): Array<Record<string, any>> {
	return ctx.sessionManager.getBranch() as Array<Record<string, any>>;
}

async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
	const queue = [...items];
	await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
		while (queue.length) await f(queue.shift()!);
	}));
}

const recallParams = () =>
	Type.Object({
		id: Type.String({ description: "The id from the [pi-jev-context] header, e.g. t3" }),
		offset: Type.Optional(Type.Number({ description: "First line to return (1-based)" })),
		limit: Type.Optional(Type.Number({ description: "Maximum number of lines (default 2000)" })),
	});

type RecallDetails = { alias?: string; from?: number; to?: number; total?: number };

/**
 * Optional global settings file, for pi started without the shell environment (GUI, pi-web):
 *   ~/.pi/agent/pi-jev-context.json  { "mode": "on", "envFile": "/path/to/.env" }
 * Precedence: session /context mode > PI_JEV_CONTEXT_MODE > file > default (shadow).
 */
export function readSettingsFile(path: string): { mode?: Mode; envFile?: string } {
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as { mode?: string; envFile?: string };
		return { mode: MODES.includes(raw.mode as Mode) ? (raw.mode as Mode) : undefined, envFile: typeof raw.envFile === "string" ? raw.envFile.replace(/^~(?=\/)/, homedir()) : undefined };
	} catch {
		return {};
	}
}

export function createJevContext(pi: ExtensionAPI, options: JevContextOptions = {}) {
	const env = options.env ?? process.env;
	const file = readSettingsFile(options.settingsPath ?? join(homedir(), ".pi", "agent", "pi-jev-context.json"));
	const envMode = env.PI_JEV_CONTEXT_MODE as Mode | undefined;
	const baseMode = envMode && MODES.includes(envMode) ? envMode : (file.mode ?? DEFAULT_CONFIG.mode);
	const config: JevContextConfig = { ...DEFAULT_CONFIG, mode: baseMode, ...options.config };
	const transport = options.judge === undefined ? resolveTransport(env, file.envFile) : undefined;
	const judge: Judge | undefined = options.judge === undefined ? (transport ? new Jev(transport) : undefined) : (options.judge ?? undefined);

	const originals = new Map<string, Original>();
	const byCallId = new Map<string, string>();
	/** Latest shadow decision per tool call, and the goal version (user message count) it was made for. */
	const decisions = new Map<string, { decision: Label; tokens: number; goal: number }>();
	let lastAssistantAt: number | undefined;
	let modelChanged = false;
	let pruning: Promise<void> | undefined;
	let stats = { trimmed: 0, savedTokens: 0 };

	const log = (r: LogRecord) => pi.appendEntry(LOG, r);

	const status = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (config.mode === "off") return ctx.ui.setStatus("jev-context", undefined);
		const saved = stats.savedTokens >= 1000 ? `${(stats.savedTokens / 1000).toFixed(1)}k` : String(stats.savedTokens);
		ctx.ui.setStatus("jev-context", `ctx:${config.mode}${stats.trimmed ? ` · ${stats.trimmed} trimmed, ${saved} tok saved` : ""}`);
	};

	function rebuild(ctx: ExtensionContext) {
		originals.clear();
		byCallId.clear();
		decisions.clear();
		stats = { trimmed: 0, savedTokens: 0 };
		lastAssistantAt = undefined;
		aliasSeq = 0;
		for (const e of branch(ctx)) {
			if (e.type === "custom" && e.customType === ORIGINAL) {
				const o = e.data as Original;
				originals.set(o.alias, o);
				byCallId.set(o.toolCallId, o.alias);
				aliasSeq = Math.max(aliasSeq, Number(o.alias.slice(1)) || 0);
			} else if (e.type === "custom" && e.customType === CONFIG && MODES.includes(e.data?.mode)) {
				config.mode = e.data.mode;
			} else if (e.type === "custom" && e.customType === LOG && e.data?.kind === "trim" && e.data.acted) {
				stats.trimmed++;
				stats.savedTokens += Math.max(0, e.data.from - (e.data.to ?? e.data.from));
			} else if (e.type === "custom" && e.customType === LOG && e.data?.kind === "prune") {
				decisions.set(e.data.toolCallId, { decision: e.data.decision, tokens: e.data.tokens, goal: e.data.goal });
			} else if (e.type === "message" && e.message?.role === "assistant" && typeof e.message.timestamp === "number") {
				lastAssistantAt = e.message.timestamp;
			}
		}
		status(ctx);
	}

	// Reserved synchronously (before any await) so parallel tool results never share an alias.
	let aliasSeq = 0;
	const nextAlias = () => `t${++aliasSeq}`;

	// ---- 1. write-time trimming -----------------------------------------------------------------

	pi.on("tool_result", async (event, ctx) => {
		if (config.mode === "off" || !judge) return;
		// Images or other non-text parts: leave untouched.
		if (!event.content.every((c) => c.type === "text")) return;
		const text = textOf(event.content);
		const input = event.input as Record<string, unknown>;
		if (!shouldConsider(event.toolName, input, text, config.trim)) return;
		const fresh = { toolCallId: event.toolCallId, toolName: event.toolName, input, text, isError: event.isError };
		const summary = summarizeCall(event.toolName, input);
		const run = async (alias: string, signal?: AbortSignal) => {
			const opts = { cfg: config.trim, timeoutMs: config.trimTimeoutMs, signal };
			const plan =
				config.engine === "sieve"
					? await planSieve(judge, contextMessages(ctx), fresh, alias, { ...opts, cfg: config.sieve, trim: config.trim }).then((p) => ({ ...p, need: p.need, extra: { blocks: p.blocks.length, hidden: p.hidden.length } }))
					: await planTrim(judge, contextMessages(ctx), fresh, alias, opts).then((p) => ({ ...p, need: p.reading?.need, extra: {} }));
			const need = plan.need;
			return { plan, base: { toolCallId: event.toolCallId, summary, engine: config.engine, ...plan.extra, from: estimateTokens(text), totalLines: text.split("\n").length, ms: plan.call.ms, cost: plan.call.cost, need: need?.choice, p: need ? need.probabilities[need.choice] : undefined } };
		};

		if (config.mode === "shadow") {
			// Shadow never delays the tool: decide in the background and only log.
			run("shadow").then(({ plan, base }) => log({ kind: "trim", mode: "shadow", acted: false, ...base, to: plan.trimmed?.keptTokens, keptLines: plan.trimmed?.keptLines, skip: plan.skip }), () => {});
			return;
		}

		const alias = nextAlias();
		const { plan, base } = await run(alias, ctx.signal);
		if (!plan.trimmed) {
			log({ kind: "trim", mode: "on", acted: false, ...base, skip: plan.skip });
			return;
		}
		const details = event.details as { fullOutputPath?: string } | undefined;
		const original: Original = { alias, toolCallId: event.toolCallId, tool: event.toolName, summary, text, fullOutputPath: details?.fullOutputPath };
		// Store the original before the shortened text can reach the model.
		pi.appendEntry(ORIGINAL, original);
		originals.set(alias, original);
		byCallId.set(event.toolCallId, alias);
		log({ kind: "trim", mode: "on", acted: true, alias, ...base, to: plan.trimmed.keptTokens, keptLines: plan.trimmed.keptLines });
		stats.trimmed++;
		stats.savedTokens += Math.max(0, plan.trimmed.originalTokens - plan.trimmed.keptTokens);
		status(ctx);
		return { content: [{ type: "text" as const, text: plan.trimmed.text }] };
	});

	// Always registered, whatever the mode: the tool list is part of the cached prompt prefix, so it must not
	// appear or disappear when the mode changes.
	pi.registerTool<ReturnType<typeof recallParams>, RecallDetails>({
		name: "context_recall",
		label: "Context recall",
		description:
			"Return the full original text of a tool output that pi-jev-context shortened. Use the id from the \"[pi-jev-context] Output shortened\" header (for example t3). Optional offset/limit select a 1-based line range.",
		promptSnippet: "context_recall: get the full original of a tool output shortened by pi-jev-context",
		parameters: recallParams(),
		async execute(_toolCallId, params) {
			const o = originals.get(params.id) ?? originals.get(byCallId.get(params.id) ?? "");
			log({ kind: "recall", alias: params.id, found: !!o });
			if (!o) {
				const known = [...originals.keys()].slice(-20).join(", ") || "none";
				return { content: [{ type: "text", text: `No shortened output with id "${params.id}". Known ids: ${known}.` }], details: {} };
			}
			const lines = o.text.split("\n");
			const from = Math.max(1, Math.floor(params.offset ?? 1));
			const to = Math.min(lines.length, from - 1 + Math.max(1, Math.floor(params.limit ?? 2000)));
			const more = to < lines.length ? ` More: offset ${to + 1}.` : "";
			const saved = o.fullOutputPath ? ` pi also saved the untruncated output at ${o.fullOutputPath}.` : "";
			const head = `[context_recall ${o.alias}] ${o.summary}: lines ${from}-${to} of ${lines.length}.${more}${saved}`;
			return { content: [{ type: "text", text: `${head}\n${lines.slice(from - 1, to).join("\n")}` }], details: { alias: o.alias, from, to, total: lines.length } };
		},
	});

	// ---- 2. old-context pruning, shadow only ---------------------------------------------------

	async function shadowPrune(ctx: ExtensionContext): Promise<void> {
		if (config.mode === "off" || !judge) return;
		const messages = contextMessages(ctx);
		const events = toolEvents(messages);
		const lastUser = messages.map((m) => m.role).lastIndexOf("user");
		const goal = messages.filter((m) => m.role === "user").length;
		const candidates = messages
			.map((m, i) => ({ m, i }))
			// Results produced for the current request are protected.
			.filter(({ m, i }) => m.role === "toolResult" && i < lastUser)
			.map(({ m }) => m as Extract<Message, { role: "toolResult" }>)
			.filter((m) => estimateTokens(textOf(m.content)) >= config.pruneMinTokens)
			.filter((m) => decisions.get(m.toolCallId)?.goal !== goal)
			.slice(-config.pruneMaxPerRun);
		await pool(candidates, config.pruneConcurrency, async (m) => {
			const facts = sourceFacts(messages, m.toolCallId);
			const tokens = estimateTokens(textOf(m.content));
			const factText = Object.entries(facts).filter(([, v]) => v).map(([k]) => k).join(",") || "-";
			let reading: JevReading | undefined;
			let raw: { choice?: string; p?: number; confidence?: number; ms: number; cost?: number; error?: string } = { ms: 0 };
			if (!facts.exactRepeat) {
				const b = buildState(messages, m.toolCallId);
				const call = await judge.decide(b.state, questionsFor(b.keyLineCandidates), config.pruneTimeoutMs);
				raw = { ms: call.ms, cost: call.cost, error: call.error };
				if (call.answers) {
					const signals: Record<string, number> = {};
					for (const k of Object.keys(SIGNALS)) signals[k] = (call.answers[k] as NoulAnswer).noul;
					reading = { decision: call.answers.decision as JevReading["decision"], signals, lines: {}, excerpted: b.excerpted };
					raw = { ...raw, choice: reading.decision.choice, p: reading.decision.probabilities[reading.decision.choice], confidence: reading.decision.confidence };
				}
			}
			// No Jev answer and no deterministic fact: KEEP (hybridPolicy's default).
			const decision = hybridPolicy(reading, facts);
			decisions.set(m.toolCallId, { decision, tokens, goal });
			log({ kind: "prune", toolCallId: m.toolCallId, summary: truncate(summarizeCall(m.toolName, events.find((x) => x.id === m.toolCallId)?.args ?? {}), 80), decision, raw: raw.choice, p: raw.p, confidence: raw.confidence, tokens, goal, facts: factText, ms: raw.ms, cost: raw.cost, error: raw.error });
		});
	}

	pi.on("agent_settled", (_e, ctx) => {
		// Background only; never awaited by pi.
		pruning = shadowPrune(ctx).catch(() => {});
	});

	// ---- 3. cache observation (the context is never modified) -----------------------------------

	pi.on("model_select", () => {
		modelChanged = true;
	});

	pi.on("context", (event) => {
		if (config.mode === "off") return;
		const now = Date.now();
		const gap = lastAssistantAt === undefined ? 0 : now - lastAssistantAt;
		const reason = modelChanged ? "model changed" : gap >= config.coldAfterMs ? "idle gap" : undefined;
		modelChanged = false;
		if (!reason) return;
		const present = new Set((event.messages as Array<{ role: string; toolCallId?: string }>).filter((m) => m.role === "toolResult").map((m) => m.toolCallId!));
		let wouldSave = 0;
		let n = 0;
		for (const [id, d] of decisions) {
			if (!present.has(id) || d.decision === "KEEP") continue;
			n++;
			wouldSave += d.decision === "DROP" ? Math.max(0, d.tokens - 40) : Math.max(0, d.tokens - 150);
		}
		log({ kind: "cold", gapMs: gap, reason, wouldSave, decisions: n });
		// Deliberately no return value: v0.1 never changes what the model sees.
	});

	pi.on("message_end", (event) => {
		const m = event.message as { role?: string; timestamp?: number; usage?: { input: number; cacheRead: number; cacheWrite: number }; model?: string };
		if (m.role !== "assistant" || typeof m.timestamp !== "number") return;
		const gap = lastAssistantAt === undefined ? 0 : m.timestamp - lastAssistantAt;
		if (config.mode !== "off" && m.usage && gap >= config.observeGapMs) log({ kind: "cache", gapMs: gap, input: m.usage.input, cacheRead: m.usage.cacheRead, cacheWrite: m.usage.cacheWrite, model: m.model });
		lastAssistantAt = m.timestamp;
	});

	pi.on("session_start", (_e, ctx) => {
		rebuild(ctx);
		if (config.mode !== "off") judge?.warm?.();
	});
	pi.on("session_tree", (_e, ctx) => rebuild(ctx));

	// ---- /context ----------------------------------------------------------------------------------

	function report(ctx: ExtensionContext): string {
		const recs = branch(ctx).filter((e) => e.type === "custom" && e.customType === LOG).map((e) => e.data as LogRecord);
		const trims = recs.filter((r): r is Extract<LogRecord, { kind: "trim" }> => r.kind === "trim");
		const acted = trims.filter((t) => t.acted);
		const wouldTrim = trims.filter((t) => !t.acted && t.to !== undefined);
		const recalls = recs.filter((r) => r.kind === "recall");
		const prunes = new Map<string, Extract<LogRecord, { kind: "prune" }>>();
		for (const r of recs) if (r.kind === "prune") prunes.set(r.toolCallId, r);
		const present = new Set(contextMessages(ctx).filter((m) => m.role === "toolResult").map((m) => (m as { toolCallId: string }).toolCallId));
		const live = [...prunes.values()].filter((p) => present.has(p.toolCallId));
		const count = (d: Label) => live.filter((p) => p.decision === d).length;
		const wouldSave = live.reduce((s, p) => s + (p.decision === "DROP" ? Math.max(0, p.tokens - 40) : p.decision === "TRUNCATE" ? Math.max(0, p.tokens - 150) : 0), 0);
		const liveTokens = live.reduce((s, p) => s + p.tokens, 0);
		const colds = recs.filter((r) => r.kind === "cold");
		const caches = recs.filter((r): r is Extract<LogRecord, { kind: "cache" }> => r.kind === "cache");
		const jevCost = recs.reduce((s, r) => s + ((r as { cost?: number }).cost ?? 0), 0);
		const usage = ctx.getContextUsage?.();
		const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
		const lines = [
			`pi-jev-context: mode ${config.mode} · judge ${judge ? "jev" : "none"}${usage ? ` · context ${k((usage as { tokens?: number }).tokens ?? 0)} tokens` : ""}`,
			"",
			`Write-time trimming (cache-neutral)`,
			`  trimmed: ${acted.length} outputs, ${k(acted.reduce((s, t) => s + t.from - (t.to ?? t.from), 0))} tokens kept out of context`,
			`  shadow would-trim: ${wouldTrim.length} (${k(wouldTrim.reduce((s, t) => s + t.from - (t.to ?? t.from), 0))} tokens)`,
			`  left whole: ${trims.filter((t) => t.to === undefined).length} (${[...new Set(trims.filter((t) => t.to === undefined).map((t) => t.skip?.split(" (")[0]))].join("; ") || "-"})`,
			`  recalls: ${recalls.length}${acted.length ? ` (${((recalls.length / acted.length) * 100).toFixed(0)}% of trims)` : ""}`,
			"",
			`Old-context pruning (shadow, never applied)`,
			`  judged tool results in context: ${live.length} (${k(liveTokens)} tokens) → KEEP ${count("KEEP")} · TRUNCATE ${count("TRUNCATE")} · DROP ${count("DROP")}`,
			`  would save if applied: ${k(wouldSave)} tokens`,
			`  cold-cache windows seen: ${colds.length}`,
			caches.length ? `  LLM calls after idle gaps: ${caches.map((c) => `${Math.round(c.gapMs / 1000)}s→read ${k(c.cacheRead)}/write ${k(c.cacheWrite)}`).slice(-6).join(", ")}` : `  LLM calls after idle gaps: none yet`,
			"",
			`Jev: ${trims.length + prunes.size} decisions, $${jevCost.toFixed(5)}`,
		];
		return lines.join("\n");
	}

	pi.registerCommand("context", {
		description: "pi-jev-context: status | report | mode <off|shadow|on> | recalls | label <good|bad> [note]",
		getArgumentCompletions: (prefix) => ["status", "report", "mode", "recalls", "label"].filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s })),
		handler: async (args, ctx) => {
			const [sub = "report", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const say = (msg: string, level: "info" | "warning" = "info") => ctx.ui.notify(msg, level);
			switch (sub) {
				case "status":
				case "report":
					return say(report(ctx));
				case "mode": {
					const m = rest[0] as Mode;
					if (!MODES.includes(m)) return say(`usage: /context mode <${MODES.join("|")}>`, "warning");
					pi.appendEntry(CONFIG, { mode: m });
					config.mode = m;
					status(ctx);
					return say(`pi-jev-context mode: ${m}${m === "on" ? " (write-time trimming active; old-context pruning stays shadow)" : ""}`);
				}
				case "recalls":
					return say([...originals.values()].slice(-20).map((o) => `${o.alias}  ${o.summary}  (${o.text.split("\n").length} lines)`).join("\n") || "nothing trimmed on this branch");
				case "label": {
					const [label, ...note] = rest;
					if (label !== "good" && label !== "bad") return say("usage: /context label <good|bad> [note]  (labels the latest trim)", "warning");
					const last = branch(ctx).filter((e) => e.type === "custom" && e.customType === LOG && e.data?.kind === "trim").at(-1);
					if (!last) return say("nothing to label", "warning");
					log({ kind: "label", target: last.id, label, note: note.join(" ") || undefined });
					return say(`labelled ${last.id} ${label}`);
				}
				default:
					return say(`unknown subcommand ${sub}`, "warning");
			}
		},
	});

	return {
		config,
		hasJudge: !!judge,
		originals,
		decisions,
		/** Resolves when the latest shadow pruning pass is done (tests). */
		settled: () => pruning ?? Promise.resolve(),
	};
}

export default function (pi: ExtensionAPI) {
	createJevContext(pi);
}
