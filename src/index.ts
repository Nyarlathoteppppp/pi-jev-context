import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { summarizeCall, textOf } from "./extract.ts";
import type { Message } from "./types.ts";
import { DEFAULT_SEEN, planCollapse, type SeenConfig } from "./seen.ts";

export type Mode = "off" | "shadow" | "on";
const MODES: Mode[] = ["off", "shadow", "on"];

export interface JevContextConfig { mode: Mode; seen: SeenConfig; }
export const DEFAULT_CONFIG: JevContextConfig = { mode: "on", seen: DEFAULT_SEEN };
export interface JevContextOptions {
    config?: Partial<JevContextConfig>;
    env?: NodeJS.ProcessEnv;
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
    | { kind: "seen"; mode: Mode; acted: boolean; alias?: string; toolCallId: string; summary: string; from: number; to: number; collapsedLines: number; totalLines: number; runs: number }
    | { kind: "recall"; alias: string; found: boolean }
    | { kind: "label"; target: string; label: "good" | "bad"; note?: string };

/** Only the roles the analysis understands; pi's other message kinds (custom, bashExecution…) are skipped. */
export function contextMessages(ctx: ExtensionContext): Message[] {
	const entries = ctx.sessionManager.buildContextEntries();
	return entries
		.filter((e) => e.type === "message" && ["user", "assistant", "toolResult"].includes(e.message?.role))
		.flatMap((e) => e.type === "message" ? [e.message as Message] : []);
}

function branch(ctx: ExtensionContext): Array<Record<string, any>> {
	return ctx.sessionManager.getBranch() as Array<Record<string, any>>;
}

const recallParams = () =>
	Type.Object({
		id: Type.String({ description: "The id from the [pi-jev-context] header, e.g. t3" }),
		offset: Type.Optional(Type.Number({ description: "First output line to return (1-based, not file line)" })),
		limit: Type.Optional(Type.Number({ description: "Maximum number of lines (default 2000)" })),
	});

type RecallDetails = { alias?: string; from?: number; to?: number; total?: number };

/** Precedence: session mode > environment > settings file > default on. */
export function readSettingsFile(path: string): { mode?: Mode } {
    try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        return { mode: MODES.includes(raw.mode) ? raw.mode : undefined };
    } catch { return {}; }
}

export function createJevContext(pi: ExtensionAPI, options: JevContextOptions = {}) {
	const env = options.env ?? process.env;
	const file = readSettingsFile(options.settingsPath ?? join(homedir(), ".pi", "agent", "pi-jev-context.json"));
	const envMode = env.PI_JEV_CONTEXT_MODE as Mode | undefined;
	const baseMode = envMode && MODES.includes(envMode) ? envMode : (file.mode ?? DEFAULT_CONFIG.mode);
	const config: JevContextConfig = { ...DEFAULT_CONFIG, mode: baseMode, ...options.config };
	const originals = new Map<string, Original>();
	const byCallId = new Map<string, string>();
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
		stats = { trimmed: 0, savedTokens: 0 };
		aliasSeq = 0;
		config.mode = options.config?.mode ?? baseMode;
		for (const e of branch(ctx)) {
			if (e.type === "custom" && e.customType === ORIGINAL) {
				const o = e.data as Original;
				originals.set(o.alias, o);
				byCallId.set(o.toolCallId, o.alias);
				aliasSeq = Math.max(aliasSeq, Number(o.alias.slice(1)) || 0);
			} else if (e.type === "custom" && e.customType === CONFIG && MODES.includes(e.data?.mode)) {
				config.mode = e.data.mode;
			} else if (e.type === "custom" && e.customType === LOG && e.data?.kind === "seen" && e.data.acted) {
				stats.trimmed++;
				stats.savedTokens += Math.max(0, e.data.from - (e.data.to ?? e.data.from));

			}
		}
		status(ctx);
	}

	// Reserved synchronously (before any await) so parallel tool results never share an alias.
	let aliasSeq = 0;
	const nextAlias = () => `t${++aliasSeq}`;

	// ---- Incoming read dedupe -----------------------------------------------------------------

	pi.on("tool_result", async (event, ctx) => {
		if (config.mode === "off") return;
		// Images or other non-text parts: leave untouched.
		if (!event.content.every((c) => c.type === "text")) return;
		const text = textOf(event.content);
		const input = event.input as Record<string, unknown>;

		// Deterministic: collapse only runs of lines the agent
		// was already shown, contiguously, by an earlier read of this file that is still in the context.
		if (event.toolName === "read") {
			const alias = nextAlias();
			const fresh = { toolCallId: event.toolCallId, toolName: event.toolName, input, text, isError: event.isError };
			const c = planCollapse(contextMessages(ctx), fresh, alias, config.seen);
			if (c) {
				const base = { toolCallId: event.toolCallId, summary: summarizeCall(event.toolName, input), from: c.originalTokens, to: c.keptTokens, collapsedLines: c.collapsedLines, totalLines: c.totalLines, runs: c.runs.length };
				if (config.mode === "shadow") {
					log({ kind: "seen", mode: "shadow", acted: false, ...base });
					return;
				}
				const original: Original = { alias, toolCallId: event.toolCallId, tool: event.toolName, summary: base.summary, text };
				pi.appendEntry(ORIGINAL, original);
				originals.set(alias, original);
				byCallId.set(event.toolCallId, alias);
				log({ kind: "seen", mode: "on", acted: true, alias, ...base });
				stats.trimmed++;
				stats.savedTokens += Math.max(0, c.originalTokens - c.keptTokens);
				status(ctx);
				return { content: [{ type: "text" as const, text: c.text }] };
			}
			return;
		}

	});

	// Always registered, whatever the mode: the tool list is part of the cached prompt prefix, so it must not
	// appear or disappear when the mode changes.
	pi.registerTool<ReturnType<typeof recallParams>, RecallDetails>({
		name: "context_recall",
		label: "Context recall",
		description:
			"Return the full original text of a tool output that pi-jev-context shortened. Use the id from the collapse marker (for example t3). Optional offset/limit select 1-based output lines, not file lines.",
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
			const head = `[context_recall ${o.alias}] ${o.summary}: output lines ${from}-${to} of ${lines.length}.${more}${saved}`;
			return { content: [{ type: "text", text: `${head}\n${lines.slice(from - 1, to).join("\n")}` }], details: { alias: o.alias, from, to, total: lines.length } };
		},
	});

    // Rebuild originals from the active branch, including those preceding compaction.
    pi.on("session_start", (_e, ctx) => rebuild(ctx));
    pi.on("session_tree", (_e, ctx) => rebuild(ctx));

	// ---- /context ----------------------------------------------------------------------------------

    function report(ctx: ExtensionContext): string {
        const records = branch(ctx).filter(e => e.customType === LOG).map(e => e.data as LogRecord);
        const seen = records.filter((r): r is Extract<LogRecord, {kind: "seen"}> => r.kind === "seen");
        const acted = seen.filter(r => r.acted);
        const shadow = seen.filter(r => !r.acted);
        return [
            `pi-jev-context: mode ${config.mode} · deterministic read dedupe`,
            `Collapsed: ${acted.length} reads, ~${acted.reduce((n, r) => n + r.from - r.to, 0)} tokens saved`,
            `Shadow: ${shadow.length} candidate reads`,
            `Recalls: ${records.filter(r => r.kind === "recall").length}`,
        ].join("\n");
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
					return say(`pi-jev-context mode: ${m}${m === "on" ? " (read dedupe active)" : ""}`);
				}
				case "recalls":
					return say([...originals.values()].slice(-20).map((o) => `${o.alias}  ${o.summary}  (${o.text.split("\n").length} lines)`).join("\n") || "nothing trimmed on this branch");
				case "label": {
					const [label, ...note] = rest;
					if (label !== "good" && label !== "bad") return say("usage: /context label <good|bad> [note]  (labels the latest dedupe)", "warning");
					const last = branch(ctx).filter((e) => e.type === "custom" && e.customType === LOG && e.data?.kind === "seen").at(-1);
					if (!last) return say("nothing to label", "warning");
					log({ kind: "label", target: last.id, label, note: note.join(" ") || undefined });
					return say(`labelled ${last.id} ${label}`);
				}
				default:
					return say(`unknown subcommand ${sub}`, "warning");
			}
		},
	});

	return { config, originals };
}

export default function (pi: ExtensionAPI) {
	createJevContext(pi);
}
