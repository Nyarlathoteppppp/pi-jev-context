import type { Message } from "../src/types.ts";
import type { FreshResult } from "../src/writetime.ts";
import { longBuildLog, longVitestLog, Session } from "./builder.ts";

// WRITE-TIME GROUND TRUTH, committed before any Jev call on these cases.
// At write time the question is: may the agent see only the key parts of this fresh output?
//   TRIM  the output is mostly noise for the current goal; keyLines must survive the trim
//   KEEP  the agent needs (nearly) all of it now; trimming would force a recall

export interface WriteCase {
	id: string;
	title: string;
	truth: "TRIM" | "KEEP";
	keyLines?: string[];
	context: Message[];
	result: FreshResult;
}

let seq = 0;
function wc(id: string, title: string, truth: WriteCase["truth"], goal: string, tool: string, input: Record<string, unknown>, text: string, opts: { keyLines?: string[]; isError?: boolean; before?: (s: Session) => void } = {}): WriteCase {
	const s = new Session(1000 + ++seq).user(goal);
	opts.before?.(s);
	return { id, title, truth, keyLines: opts.keyLines, context: s.messages, result: { toolCallId: `fresh_${id}`, toolName: tool, input, text, isError: !!opts.isError } };
}

function tscLog(): string {
	const files = ["src/api/orders.ts", "src/api/customers.ts", "src/cart/CartRow.tsx", "src/profile/ProfilePage.tsx", "src/billing/invoiceMapper.ts", "src/lib/money.ts"];
	const lines: string[] = [];
	for (let i = 0; i < 90; i++) {
		lines.push(`${files[i % 6]}(${10 + i},${5 + (i % 30)}): error TS2322: Type 'string | undefined' is not assignable to type 'string'.`);
		lines.push("  Type 'undefined' is not assignable to type 'string'.");
	}
	lines.push("", "Found 90 errors in 6 files.");
	return lines.join("\n");
}

function composeLog(): string {
	const log: string[] = [];
	for (let i = 0; i < 280; i++) {
		if (i % 70 === 40) log.push(`db-1   | 2026-09-18 10:0${i % 10}:12.4 UTC [${60 + i}] FATAL:  password authentication failed for user "acme"`);
		else if (i % 70 === 41) log.push(`api-1  | Error: connect: password authentication failed for user "acme" (SQLSTATE 28P01) at Pool.connect (node_modules/pg-pool/index.js:45:11)`);
		else log.push(`${i % 2 ? "api-1 " : "db-1  "} | 2026-09-18 10:00:${String(i % 60).padStart(2, "0")} ${i % 2 ? "info: waiting for db…" : "LOG:  checkpoint starting: time"}`);
	}
	return log.join("\n");
}

function pnpmLog(): string {
	const out: string[] = ["Lockfile is up to date, resolution step is skipped"];
	for (let i = 0; i < 230; i++) out.push(`Progress: resolved ${i * 3}, reused ${i * 3}, downloaded 0, added ${i}`);
	out.push(" WARN  Issues with peer dependencies found", ".", "└─┬ @acme/legacy-modal 2.1.0", "  └── ✕ unmet peer react@\"^17.0.0\": found 18.3.1", "", "dependencies:", "+ react 18.3.1", "", "Done in 12.4s");
	return out.join("\n");
}

const DIRS = ["src/ui", "src/api", "src/cart", "src/billing", "src/profile", "src/db", "src/lib", "src/i18n", "src/search", "src/catalog", "src/payments/webhooks", "src/auth"];

function grepTodo(): string {
	const out: string[] = [];
	for (let i = 0; i < 220; i++) {
		const d = DIRS[i % 11]!; // src/auth appears only in the explicit lines below
		out.push(`${d}/file${i % 7}.ts:${10 + i}:  // TODO: ${["tidy up", "i18n", "remove after migration", "perf", "types"][i % 5]}`);
	}
	out.splice(120, 0, "src/auth/interceptor.ts:88:      // TODO: storage.clear() runs before the retry; guard with a refresh lock", "src/auth/session.ts:41:    // TODO: refresh token may be null here after logout()");
	return out.sort().join("\n");
}

function findTs(): string {
	const out: string[] = [];
	for (let i = 0; i < 300; i++) out.push(`./${DIRS[i % 10]}/${["index", "types", "utils", "hooks", "view", "model"][i % 6]}${Math.floor(i / 10)}.ts`);
	out.push("./src/payments/webhooks/stripeHandler.ts", "./src/payments/webhooks/verify.ts");
	return out.sort().join("\n");
}

function docsSearch(): string {
	const out: string[] = [];
	const topics = ["Relation queries", "Transactions", "Raw SQL", "Middleware", "Logging", "Connection pool", "Migrations", "Seeding", "Aggregations", "Full-text search"];
	for (let t = 0; t < 10; t++) {
		out.push(`## Result ${t + 1}: Prisma docs › ${topics[t]}`);
		for (let i = 0; i < 17; i++) out.push(`${topics[t]} paragraph ${i + 1}: configuration details and examples for ${topics[t]!.toLowerCase()} in Prisma Client.`);
		out.push("");
		if (t === 4) {
			out.push("## Result 11: Prisma docs › Excluding fields (omit)");
			out.push("Use the `omit` option to exclude fields from query results, e.g. prisma.user.findMany({ omit: { password: true } }).");
			out.push("`omit` is generally available since Prisma ORM 6.2.0 (preview `omitApi` from 5.13.0). It is not available in Prisma 4.x.");
			out.push("Global omit: new PrismaClient({ omit: { user: { password: true } } }).");
			out.push("");
		}
	}
	return out.join("\n");
}

function renameGrep(): string {
	const out: string[] = [];
	for (let i = 0; i < 180; i++) out.push(`${DIRS[i % 12]}/file${i % 9}.ts:${5 + i}:  const v${i} = formatPrice(item${i}.total);`);
	return out.join("\n");
}

function printConfig(): string {
	const out: string[] = ["{"];
	for (let i = 0; i < 200; i++) out.push(`  "feature.flag${i}": ${i % 3 === 0 ? "true" : "false"},  // owner: team-${i % 7}`);
	out.push("}");
	return out.join("\n");
}

function csvReport(): string {
	const out: string[] = ["region,month,orders,revenue_cents,refunds"];
	for (let i = 0; i < 170; i++) out.push(`${["NZ", "AU", "US", "DE", "JP"][i % 5]},2026-${String((i % 9) + 1).padStart(2, "0")},${100 + i * 7},${250000 + i * 1311},${i % 11}`);
	return out.join("\n");
}

function authTests(): string {
	const out: string[] = [" RUN  v2.1.8 /home/dev/acme-app", ""];
	for (let i = 0; i < 155; i++) out.push(`   ✓ auth › ${["login", "logout", "refresh", "retry", "remember-me", "mfa", "lockout"][i % 7]} › case ${i + 1}: ${["valid", "expired", "revoked", "concurrent", "offline"][i % 5]} token`);
	out.push("", " Test Files  1 passed (1)", "      Tests  155 passed (155)");
	return out.join("\n");
}

function lsR(): string {
	const out: string[] = [];
	for (let i = 0; i < 200; i++) out.push(`${DIRS[i % 12]}/${["index", "types", "utils", "api", "view"][i % 5]}${Math.floor(i / 12)}.ts`);
	return out.join("\n");
}

export const WRITE_CASES: WriteCase[] = [
	wc("W01", "500-line vitest run, fix CI", "TRIM", "CI is red. Run the test suite and fix whatever fails.", "bash", { command: "npx vitest run --reporter=verbose" }, longVitestLog(), {
		isError: true,
		keyLines: ["2 failed", "auth.test.ts:42", "expected 401 to be 200", "auth.test.ts:58", "retries the original request after refresh"],
	}),
	wc("W02", "tsc: 90 copies of one error", "TRIM", "I just enabled strictNullChecks in tsconfig. Fix the resulting type errors.", "bash", { command: "npx tsc --noEmit -p ." }, tscLog(), { isError: true, keyLines: ["TS2322", "Found 90 errors in 6 files", "src/api/customers.ts"] }),
	wc("W03", "compose logs, one failure", "TRIM", "docker compose up: the api container keeps restarting. Find out why.", "bash", { command: "docker compose logs --no-color db api | tail -280" }, composeLog(), { keyLines: ["password authentication failed", "28P01"] }),
	wc("W04", "pnpm install, one peer warning", "TRIM", "pnpm install prints a peer dependency warning. What is it about?", "bash", { command: "pnpm install --reporter=append-only" }, pnpmLog(), { keyLines: ["unmet peer", "legacy-modal"] }),
	wc("W05", "successful build log", "TRIM", "Build the app to make sure everything compiles.", "bash", { command: "npm run build" }, longBuildLog(), { keyLines: ["built in"] }),
	wc("W06", "grep TODO while debugging auth", "TRIM", "Users sometimes get a 401 right after their access token expires. Find the root cause.", "grep", { pattern: "TODO", path: "src" }, grepTodo(), { keyLines: ["src/auth/interceptor.ts:88", "src/auth/session.ts:41"] }),
	wc("W07", "find *.ts while looking for the webhook handler", "TRIM", "Where is the Stripe webhook handler? I need to add signature verification.", "find", { pattern: "*.ts", path: "." }, findTs(), { keyLines: ["stripeHandler.ts"] }),
	wc("W08", "MCP docs search, one relevant section", "TRIM", "Use Prisma's omit option to hide deletedAt from API responses. Check the docs first.", "docs_search", { query: "prisma omit field" }, docsSearch(), { keyLines: ["omit` is generally available since Prisma ORM 6.2.0"] }),
	wc("W09", "grep for a rename: every match needed", "KEEP", "Rename formatPrice to formatMoney everywhere in src.", "grep", { pattern: "formatPrice", path: "src" }, renameGrep()),
	wc("W10", "user wants to review every config field", "KEEP", "Print the full resolved feature-flag config. I want to review every single field myself.", "bash", { command: "npm run -s print-config" }, printConfig()),
	wc("W11", "CSV report to convert in full", "KEEP", "Run the monthly report script and convert its entire output into a markdown table for the wiki.", "bash", { command: "python scripts/report.py --format csv" }, csvReport()),
	wc("W12", "list every test name", "KEEP", "List every test name in the auth suite so I can check which scenarios are covered.", "bash", { command: "npx vitest run src/auth --reporter=verbose" }, authTests()),
	wc("W13", "full file inventory for a migration plan", "KEEP", "Give me a complete inventory of every file under src; I'm planning the monorepo migration file by file.", "bash", { command: "find src -type f | sort" }, lsR()),
];
