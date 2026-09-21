import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { summarizeCall, textOf } from "./extract.ts";
import type { Message } from "./types.ts";
import { searchOriginals } from "./recall.ts";
import { DEFAULT_SEEN, planCollapse, type SeenConfig } from "./seen.ts";
import { Jev, resolveTransport, type Judge } from "./jev.ts";
import { DEFAULT_SIEVE, eligibleFreshOutput, planSieve, renderSieve, type SieveConfig } from "./sieve.ts";

export type Mode = "off" | "shadow" | "on";
const MODES: Mode[] = ["off", "shadow", "on"];
export type DedupeMode = "off" | "on";
export type SieveMode = "off" | "on";
export interface JevContextConfig {
    mode: Mode;
    dedupe: DedupeMode;
    sieve: SieveMode;
    jevThreshold: number;
    minHiddenShare: number;
    minSavedTokens: number;
    dedupeMaxAgeTokens: number;
    seen: SeenConfig;
    sieveConfig: SieveConfig;
}
export const DEFAULT_CONFIG: JevContextConfig = { mode: "on", dedupe: "on", sieve: "on", jevThreshold: 0.10, minHiddenShare: 0.30, minSavedTokens: 1000, dedupeMaxAgeTokens: DEFAULT_SEEN.dedupeMaxAgeTokens, seen: DEFAULT_SEEN, sieveConfig: DEFAULT_SIEVE };
export interface JevContextOptions { config?: Partial<JevContextConfig>; env?: NodeJS.ProcessEnv; settingsPath?: string; judge?: Judge; }
export const ORIGINAL = "jev-context-original";
export const LOG = "jev-context";
export const CONFIG = "jev-context-config";
export interface Original { alias: string; toolCallId: string; tool: string; summary: string; text: string; fullOutputPath?: string; }
export type LogRecord =
    | { kind: "seen"; mode: Mode; acted: boolean; alias?: string; toolCallId: string; summary: string; from: number; to: number; collapsedLines: number; totalLines: number; runs: number }
    | { kind: "sieve"; mode: SieveMode; acted: boolean; alias?: string; toolCallId: string; summary: string; from: number; to: number; hiddenBlocks: number; latencyMs: number; inputTokens?: number; cost?: number; skip?: string; category?: string; threshold: number }
    | { kind: "recall"; alias: string; found: boolean; query?: string }
    | { kind: "label"; target: string; label: "good" | "bad"; note?: string };

export function contextMessages(ctx: ExtensionContext): Message[] {
    return ctx.sessionManager.buildContextEntries().filter((e) => e.type === "message" && ["user", "assistant", "toolResult"].includes(e.message?.role)).flatMap((e) => e.type === "message" ? [e.message as Message] : []);
}
// Unknown context-bearing entries conservatively end read evidence. This keeps the
// sieve's existing context projection unchanged while preventing invisible age gaps.
export function dedupeContextMessages(ctx: ExtensionContext): Message[] {
    const entries = ctx.sessionManager.buildContextEntries();
    let start = 0;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        if (entry.type === "custom_message" || entry.type === "branch_summary" || entry.type === "compaction" ||
            (entry.type === "message" && !["user", "assistant", "toolResult"].includes(entry.message?.role))) start = i + 1;
    }
    return entries.slice(start).flatMap((entry) => entry.type === "message" ? [entry.message as Message] : []);
}
function branch(ctx: ExtensionContext): Array<Record<string, any>> { return ctx.sessionManager.getBranch() as Array<Record<string, any>>; }
const recallParams = () => Type.Object({ id: Type.Optional(Type.String({ description: "Original id, e.g. t3. Omit to search all originals on the active branch." })), query: Type.Optional(Type.String({ description: "Keywords or identifiers to search historical original chunks." })), budget: Type.Optional(Type.Integer({ minimum: 1, description: "Estimated tokens for whole search chunks, default 800. Navigation header is additional." })), offset: Type.Optional(Type.Integer({ minimum: 1, description: "1-based output line for id-only recall; 1-based ranked chunk for query pagination" })), limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines (default 2000)" })) });
type RecallDetails = { hits?: number; returned?: number; alias?: string; from?: number; to?: number; total?: number };
interface Settings { mode?: Mode; dedupe?: DedupeMode; sieve?: SieveMode; jevThreshold?: number; minHiddenShare?: number; minSavedTokens?: number; dedupeMaxAgeTokens?: number; envFile?: string; }
const numberInRange = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const parseEnvNumber = (value: string): number => value.trim() ? Number(value) : NaN;
const nonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const safeThreshold = (value: unknown, fallback: number) => numberInRange(value, 0, 1) ? value : fallback;
const safeSavedTokens = (value: unknown, fallback: number) => nonNegative(value) ? value : fallback;
const validAgeTokens = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const safeAgeTokens = (value: unknown, fallback: number) => validAgeTokens(value) ? value : fallback;
export function readSettingsFile(path: string): Settings {
    try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        return {
            mode: MODES.includes(raw.mode) ? raw.mode : undefined,
            dedupe: raw.dedupe === "on" || raw.dedupe === "off" ? raw.dedupe : undefined,
            sieve: raw.sieve === "on" || raw.sieve === "off" ? raw.sieve : undefined,
            jevThreshold: numberInRange(raw.jevThreshold, 0, 1) ? raw.jevThreshold : undefined,
            minHiddenShare: numberInRange(raw.minHiddenShare, 0, 1) ? raw.minHiddenShare : undefined,
            minSavedTokens: nonNegative(raw.minSavedTokens) ? raw.minSavedTokens : undefined,
            dedupeMaxAgeTokens: validAgeTokens(raw.dedupeMaxAgeTokens) ? raw.dedupeMaxAgeTokens : undefined,
            envFile: typeof raw.envFile === "string" ? raw.envFile : undefined,
        };
    } catch { return {}; }
}
function bool(value: unknown): value is DedupeMode { return value === "on" || value === "off"; }
function modeConfig(mode: Mode): Pick<JevContextConfig, "dedupe" | "sieve"> { return mode === "off" ? { dedupe: "off", sieve: "off" } : mode === "shadow" ? { dedupe: "on", sieve: "off" } : { dedupe: "on", sieve: "on" }; }

export function createJevContext(pi: ExtensionAPI, options: JevContextOptions = {}) {
    const env = options.env ?? process.env;
    const file = readSettingsFile(options.settingsPath ?? join(homedir(), ".pi", "agent", "pi-jev-context.json"));
    const envMode = env.PI_JEV_CONTEXT_MODE as Mode | undefined;
    const baseMode = options.config?.mode ?? (envMode && MODES.includes(envMode) ? envMode : (file.mode ?? DEFAULT_CONFIG.mode));
    const startupDedupe = options.config?.dedupe ?? (bool(env.PI_JEV_CONTEXT_DEDUPE) ? env.PI_JEV_CONTEXT_DEDUPE : file.dedupe);
    const startupSieve = options.config?.sieve ?? (bool(env.PI_JEV_CONTEXT_SIEVE) ? env.PI_JEV_CONTEXT_SIEVE : file.sieve);
    const config: JevContextConfig = { ...DEFAULT_CONFIG, ...modeConfig(baseMode), ...options.config, mode: baseMode };
    config.dedupe = startupDedupe ?? modeConfig(baseMode).dedupe;
    config.sieve = startupSieve ?? modeConfig(baseMode).sieve;
    const envThreshold = env.PI_JEV_CONTEXT_JEV_THRESHOLD === undefined ? undefined : parseEnvNumber(env.PI_JEV_CONTEXT_JEV_THRESHOLD);
    const envHiddenShare = env.PI_JEV_CONTEXT_MIN_HIDDEN_SHARE === undefined ? undefined : parseEnvNumber(env.PI_JEV_CONTEXT_MIN_HIDDEN_SHARE);
    const envSavedTokens = env.PI_JEV_CONTEXT_MIN_SAVED_TOKENS === undefined ? undefined : parseEnvNumber(env.PI_JEV_CONTEXT_MIN_SAVED_TOKENS);
    const envMaxAgeTokens = env.PI_JEV_CONTEXT_DEDUPE_MAX_AGE_TOKENS === undefined ? undefined : parseEnvNumber(env.PI_JEV_CONTEXT_DEDUPE_MAX_AGE_TOKENS);
    config.jevThreshold = safeThreshold(options.config?.jevThreshold ?? envThreshold ?? file.jevThreshold, DEFAULT_CONFIG.jevThreshold);
    config.minHiddenShare = safeThreshold(options.config?.minHiddenShare ?? envHiddenShare ?? file.minHiddenShare, DEFAULT_CONFIG.minHiddenShare);
    config.minSavedTokens = safeSavedTokens(options.config?.minSavedTokens ?? envSavedTokens ?? file.minSavedTokens, DEFAULT_CONFIG.minSavedTokens);
    const selectedAgeTokens = options.config && Object.hasOwn(options.config, "dedupeMaxAgeTokens")
        ? options.config.dedupeMaxAgeTokens : envMaxAgeTokens ?? file.dedupeMaxAgeTokens;
    config.dedupeMaxAgeTokens = safeAgeTokens(selectedAgeTokens, DEFAULT_CONFIG.dedupeMaxAgeTokens);
    config.seen = { ...DEFAULT_SEEN, ...config.seen, dedupeMaxAgeTokens: config.dedupeMaxAgeTokens };
    const originals = new Map<string, Original>();
    const byCallId = new Map<string, string>();
    const judgedCallIds = new Set<string>();
    const runtimeOverrides: { dedupe?: DedupeMode; sieve?: SieveMode } = { dedupe: startupDedupe, sieve: startupSieve };
    let stats = { trimmed: 0, savedTokens: 0 };
    const transport = options.judge ? undefined : resolveTransport(env, file.envFile);
    const judge = options.judge ?? (transport ? new Jev(transport) : undefined);
    const log = (record: LogRecord) => { try { pi.appendEntry(LOG, record); } catch { /* telemetry must not change visible output */ } };
    const status = (ctx: ExtensionContext) => { if (!ctx.hasUI) return; if (config.dedupe === "off" && config.sieve === "off") return ctx.ui.setStatus("jev-context", undefined); const saved = stats.savedTokens >= 1000 ? `${(stats.savedTokens / 1000).toFixed(1)}k` : String(stats.savedTokens); ctx.ui.setStatus("jev-context", `ctx:${config.mode}${stats.trimmed ? ` · ${stats.trimmed} trimmed, ${saved} tok saved` : ""}`); };
    function rebuild(ctx: ExtensionContext) {
        originals.clear(); byCallId.clear(); judgedCallIds.clear(); stats = { trimmed: 0, savedTokens: 0 }; aliasSeq = 0;
        config.mode = baseMode;
        runtimeOverrides.dedupe = startupDedupe;
        runtimeOverrides.sieve = startupSieve;
        const base = modeConfig(config.mode);
        config.dedupe = runtimeOverrides.dedupe ?? base.dedupe;
        config.sieve = runtimeOverrides.sieve ?? base.sieve;
        for (const entry of branch(ctx)) {
            if (entry.type === "custom" && entry.customType === ORIGINAL) { const original = entry.data as Original; originals.set(original.alias, original); byCallId.set(original.toolCallId, original.alias); aliasSeq = Math.max(aliasSeq, Number(original.alias.slice(1)) || 0); }
            else if (entry.type === "custom" && entry.customType === CONFIG) {
                if (MODES.includes(entry.data?.mode)) { config.mode = entry.data.mode; const mapped = modeConfig(config.mode); if (runtimeOverrides.dedupe === undefined) config.dedupe = mapped.dedupe; if (runtimeOverrides.sieve === undefined) config.sieve = mapped.sieve; }
                if (bool(entry.data?.dedupe)) { runtimeOverrides.dedupe = entry.data.dedupe; config.dedupe = entry.data.dedupe; }
                if (bool(entry.data?.sieve)) { runtimeOverrides.sieve = entry.data.sieve; config.sieve = entry.data.sieve; }
            }
            else if (entry.type === "custom" && entry.customType === LOG && entry.data?.acted && (entry.data.kind === "seen" || entry.data.kind === "sieve")) { stats.trimmed++; stats.savedTokens += Math.max(0, Number(entry.data.from ?? 0) - Number(entry.data.to ?? 0)); }
        }
        status(ctx);
    }
    let aliasSeq = 0;
    const nextAlias = () => `t${++aliasSeq}`;

    pi.on("tool_result", async (event, ctx) => {
        if (!Array.isArray(event.content) || !event.content.every((c: any) => c.type === "text")) return;
        const text = textOf(event.content);
        const input = event.input as Record<string, unknown>;
        if (event.toolName === "read" && config.dedupe === "on") {
            const alias = nextAlias();
            const collapse = planCollapse(dedupeContextMessages(ctx), { toolCallId: event.toolCallId, toolName: event.toolName, input, text, isError: event.isError }, alias, config.seen);
            if (collapse) {
                const base = { toolCallId: event.toolCallId, summary: summarizeCall(event.toolName, input), from: collapse.originalTokens, to: collapse.keptTokens, collapsedLines: collapse.collapsedLines, totalLines: collapse.totalLines, runs: collapse.runs.length };
                if (config.mode === "shadow" && runtimeOverrides.dedupe === undefined) { log({ kind: "seen", mode: "shadow", acted: false, ...base }); return; }
                const original: Original = { alias, toolCallId: event.toolCallId, tool: event.toolName, summary: base.summary, text };
                try { pi.appendEntry(ORIGINAL, original); originals.set(alias, original); byCallId.set(event.toolCallId, alias); log({ kind: "seen", mode: "on", acted: true, alias, ...base }); } catch { return; }
                stats.trimmed++; stats.savedTokens += Math.max(0, collapse.originalTokens - collapse.keptTokens); status(ctx);
                return { content: [{ type: "text" as const, text: collapse.text }] };
            }
            return;
        }
        if (config.sieve !== "on" || !judge || judgedCallIds.has(event.toolCallId)) return;
        // Pi truncates before tool_result; do not hide more of an already partial log.
        if ((event.details as any)?.truncation?.truncated || /\[Showing [^\n]*Full output:/.test(text)) return;
        const category = eligibleFreshOutput(event.toolName, input, text, !!event.isError, config.sieveConfig);
        if (!category) return;
        const alias = nextAlias();
        judgedCallIds.add(event.toolCallId);
        try {
            const plan = await planSieve(judge, contextMessages(ctx), { toolCallId: event.toolCallId, toolName: event.toolName, input, text, isError: !!event.isError }, alias, { config: { ...config.sieveConfig, minTokens: config.sieveConfig.minTokens }, threshold: config.jevThreshold, minHiddenShare: config.minHiddenShare, minSavedTokens: config.minSavedTokens });
            const call = plan.call;
            if (!plan.hidden.length) { log({ kind: "sieve", mode: "on", acted: false, toolCallId: event.toolCallId, summary: summarizeCall(event.toolName, input), from: 0, to: 0, hiddenBlocks: 0, latencyMs: call?.ms ?? 0, inputTokens: call?.inputTokens, cost: call?.cost, skip: plan.skip, category, threshold: config.jevThreshold }); return; }
            const rendered = renderSieve(text, plan.blocks, plan.hidden, alias);
            if (rendered.hiddenTokens < config.minSavedTokens || rendered.hiddenTokens / Math.max(1, rendered.originalTokens) < config.minHiddenShare) return;
            const original: Original = { alias, toolCallId: event.toolCallId, tool: event.toolName, summary: summarizeCall(event.toolName, input), text };
            pi.appendEntry(ORIGINAL, original);
            originals.set(alias, original); byCallId.set(event.toolCallId, alias);
            log({ kind: "sieve", mode: "on", acted: true, alias, toolCallId: event.toolCallId, summary: original.summary, from: rendered.originalTokens, to: rendered.visibleTokens, hiddenBlocks: plan.hidden.length, latencyMs: call?.ms ?? 0, inputTokens: call?.inputTokens, cost: call?.cost, category, threshold: config.jevThreshold });
            stats.trimmed++; stats.savedTokens += rendered.hiddenTokens; status(ctx);
            return { content: [{ type: "text" as const, text: rendered.text }] };
        } catch (error) {
            log({ kind: "sieve", mode: "on", acted: false, toolCallId: event.toolCallId, summary: summarizeCall(event.toolName, input), from: 0, to: 0, hiddenBlocks: 0, latencyMs: 0, skip: `handler failure: ${String(error).slice(0, 120)}`, category, threshold: config.jevThreshold });
            return;
        }
    });

    pi.registerTool<ReturnType<typeof recallParams>, RecallDetails>({ name: "context_recall", label: "Context recall", description: "Search saved historical output by query (optional id, budget, offset), or retrieve original lines by id/offset/limit. Search returns verbatim chunks, may miss facts, and is branch-local. Use read/search for current files.", promptSnippet: "context_recall: search historical originals by query, or retrieve exact original lines by id", parameters: recallParams(), async execute(_toolCallId, params) {
        if (params.query !== undefined) {
            const source = params.id ? originals.get(params.id) ?? originals.get(byCallId.get(params.id) ?? "") : undefined;
            if (params.id && !source) {
                log({ kind: "recall", alias: params.id, query: params.query, found: false });
                return { content: [{ type: "text", text: `Unknown original id "${params.id}" on this branch. Available ids: ${[...originals.keys()].slice(-5).join(", ") || "none"}. Omit id to search the saved originals on this branch.` }], details: {} };
            }
            const result = searchOriginals(params.id ? (source ? [source] : []) : originals.values(), params.query, params.budget ?? 800, Math.max(1, Math.floor(params.offset ?? 1)));
            log({ kind: "recall", alias: params.id ?? "*", query: params.query, found: result.hits > 0 });
            return { content: [{ type: "text", text: result.text }], details: { hits: result.hits, returned: result.returned } };
        }
        if (!params.id) return { content: [{ type: "text", text: "Provide query to search, or id with optional offset/limit to retrieve original lines." }], details: {} };
        const original = originals.get(params.id) ?? originals.get(byCallId.get(params.id) ?? "");
        log({ kind: "recall", alias: params.id, found: !!original });
        if (!original) return { content: [{ type: "text", text: `No shortened output with id "${params.id}". Known ids: ${[...originals.keys()].slice(-20).join(", ") || "none"}.` }], details: {} };
        const lines = original.text.split("\n"); const from = Math.max(1, Math.floor(params.offset ?? 1)); const to = Math.min(lines.length, from - 1 + Math.max(1, Math.floor(params.limit ?? 2000))); const more = to < lines.length ? ` More: offset ${to + 1}.` : "";
        return { content: [{ type: "text", text: `[context_recall ${original.alias}] ${original.summary}: output lines ${from}-${to} of ${lines.length}.${more}\n${lines.slice(from - 1, to).join("\n")}` }], details: { alias: original.alias, from, to, total: lines.length } };
    }});
    pi.on("session_start", (_event, ctx) => rebuild(ctx));
    pi.on("session_tree", (_event, ctx) => rebuild(ctx));
    function report(ctx: ExtensionContext): string {
        const records = branch(ctx).filter((e) => e.customType === LOG).map((e) => e.data as LogRecord);
        const saved = (record: LogRecord) => (record.kind === "seen" || record.kind === "sieve") && record.acted ? Math.max(0, record.from - record.to) : 0;
        return [`pi-jev-context: mode ${config.mode} · dedupe ${config.dedupe} (max age ${config.dedupeMaxAgeTokens} tok) · sieve ${config.sieve}`, `Collapsed: ${records.filter((r) => r.kind === "seen" && r.acted).length} reads; shortened: ${records.filter((r) => r.kind === "sieve" && r.acted).length} outputs · ~${records.reduce((n, r) => n + saved(r), 0)} tokens saved`, `Jev sieve calls: ${records.filter((r) => r.kind === "sieve").length}`, `Recalls: ${records.filter((r) => r.kind === "recall").length}`].join("\n");
    }
    pi.registerCommand("context", { description: "pi-jev-context: status | report | mode <off|shadow|on> | dedupe <on|off> | sieve <on|off> | recalls | label <good|bad> [note]", getArgumentCompletions: (prefix) => ["status", "report", "mode", "dedupe", "sieve", "recalls", "label"].filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s })), handler: async (args, ctx) => {
        const [sub = "report", ...rest] = args.trim().split(/\s+/).filter(Boolean); const say = (message: string, level: "info" | "warning" = "info") => ctx.ui.notify(message, level);
        if (sub === "status" || sub === "report") return say(report(ctx));
        if (sub === "mode") {
            const mode = rest[0] as Mode;
            if (!MODES.includes(mode)) return say(`usage: /context mode <${MODES.join("|")}>`, "warning");
            pi.appendEntry(CONFIG, { mode });
            config.mode = mode;
            const mapped = modeConfig(mode);
            if (runtimeOverrides.dedupe === undefined) config.dedupe = mapped.dedupe;
            if (runtimeOverrides.sieve === undefined) config.sieve = mapped.sieve;
            status(ctx);
            return say(`pi-jev-context mode: ${mode}`);
        }
        if (sub === "dedupe" || sub === "sieve") {
            const value = rest[0] as DedupeMode | SieveMode;
            if (value !== "on" && value !== "off") return say(`usage: /context ${sub} <on|off>`, "warning");
            pi.appendEntry(CONFIG, { [sub]: value });
            runtimeOverrides[sub] = value;
            config[sub] = value;
            status(ctx);
            return say(`pi-jev-context ${sub}: ${value}`);
        }
        if (sub === "recalls") return say([...originals.values()].slice(-20).map((o) => `${o.alias}  ${o.summary}  (${o.text.split("\n").length} lines)`).join("\n") || "nothing shortened on this branch");
        if (sub === "label") { const label = rest[0]; if (label !== "good" && label !== "bad") return say("usage: /context label <good|bad> [note]", "warning"); const last = branch(ctx).filter((e) => e.type === "custom" && e.customType === LOG).at(-1); if (!last) return say("nothing to label", "warning"); log({ kind: "label", target: last.id, label, note: rest.slice(1).join(" ") || undefined }); return say(`labelled ${last.id} ${label}`); }
        return say(`unknown subcommand ${sub}`, "warning");
    }});
    return { config, originals, judge };
}
export default function (pi: ExtensionAPI) { createJevContext(pi); }
