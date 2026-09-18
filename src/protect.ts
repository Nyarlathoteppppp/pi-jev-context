import { relatedKey, toolEvents } from "./extract.ts";
import { guardedPolicy, type JevReading } from "./policy.ts";
import type { Label, Message } from "./types.ts";

// Deterministic facts about where an old tool result came from. They guard against Jev's one measured
// weakness: durable facts that are irrelevant to the current goal (package.json engines, prisma --version,
// schema.prisma) were dropped by raw Jev in 3 of 3 cases.

const DURABLE_PATH =
	/(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|[^/]*\.prisma|\.env[^/]*|docker-compose[^/]*\.ya?ml|[^/]*\.config\.[cm]?[jt]s|[^/]*\.(?:ya?ml|toml|ini)|Dockerfile|README[^/]*|[^/]*\.proto|\.nvmrc|\.tool-versions)$|(?:^|\/)(?:config|docs|adr)\//;
const VERSION_CMD = /(?:--version\b|\s-v\s*$|^node -v\b|\bversion\b)/;

export interface SourceFacts {
	/** Manifest / config / schema / env / docs / version output. */
	durableSource: boolean;
	/** The same file or command was observed again later with the same tool. */
	superseded: boolean;
	/** A later result of the same thing is byte-identical: dropping this one loses nothing. */
	exactRepeat: boolean;
}

export function sourceFacts(messages: Message[], toolCallId: string): SourceFacts {
	const events = toolEvents(messages);
	const e = events.find((x) => x.id === toolCallId);
	if (!e) return { durableSource: false, superseded: false, exactRepeat: false };
	const key = relatedKey(e);
	const later = events.filter((x) => x.seq > e.seq && key !== undefined && relatedKey(x) === key && x.name === e.name);
	const path = String(e.args.path ?? "");
	const cmd = String(e.args.command ?? "").trim();
	const catPath = /^(?:cat|head|tail|bat)\s+(\S+)/.exec(cmd)?.[1] ?? "";
	return {
		durableSource: DURABLE_PATH.test(path) || DURABLE_PATH.test(catPath) || VERSION_CMD.test(cmd),
		superseded: later.length > 0,
		exactRepeat: later.some((x) => x.output === e.output && x.isError === e.isError),
	};
}

/**
 * Old-item decision used by the shadow pruner: exact repeats drop without asking Jev's opinion,
 * guardedPolicy decides the rest, and durable sources are never dropped unless superseded.
 */
export function hybridPolicy(r: JevReading | undefined, f: SourceFacts): Label {
	if (f.exactRepeat) return "DROP";
	if (!r) return "KEEP";
	const p = guardedPolicy(r);
	if (p === "DROP" && f.durableSource && !f.superseded) return "TRUNCATE";
	return p;
}
