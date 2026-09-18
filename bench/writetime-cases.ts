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

// ---------------------------------------------------------------------------------------------
// WRITE-TIME HELD-OUT. Written after writetime-q1 and after designing w2, committed before any Jev call
// on them. Other tools and ecosystems than the dev set, some Chinese requests.

const rows = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("\n");

function lintWarnings(): string {
	const out = ["> acme-app@1.4.0 lint", "> eslint .", ""];
	for (let i = 0; i < 95; i++) out.push(`/home/dev/acme-app/src/${DIRS[i % 12]!.slice(4)}/Comp${i}.tsx`, `  ${20 + i}:6  warning  React Hook useEffect has a missing dependency: 'props.id'  react-hooks/exhaustive-deps`);
	out.splice(101, 0, "/home/dev/acme-app/src/cart/CartRow.tsx", "  14:7  error  'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars");
	out.push("", "✖ 96 problems (1 error, 95 warnings)");
	return out.join("\n");
}

function pytestLog(): string {
	const out = ["============================= test session starts ==============================", "platform linux -- Python 3.12.4, pytest-8.3.2", "collected 412 items", ""];
	for (let i = 0; i < 40; i++) out.push(`tests/test_${["orders", "billing", "users", "search"][i % 4]}_${i}.py ${".".repeat(10)}${i === 17 ? "F" : "."} [${Math.round((i / 40) * 100)}%]`);
	out.push("", "=================================== FAILURES ===================================", "____________________________ test_refund_rounding ______________________________", "");
	for (let i = 0; i < 12; i++) out.push(`    ${["def test_refund_rounding():", "    order = make_order(total=1999)", "    refund = refund_amount(order, 0.5)", ">   assert refund == 1000"][i % 4]}`);
	out.push("E   assert 999 == 1000", "tests/test_billing_17.py:23: AssertionError");
	for (let i = 0; i < 180; i++) out.push(`  /usr/lib/python3.12/site-packages/sqlalchemy/orm/session.py:${1200 + i}: SAWarning: relationship 'Order.items' will copy column orders.id`);
	out.push("=========================== short test summary info ============================", "FAILED tests/test_billing_17.py::test_refund_rounding - assert 999 == 1000", "================== 1 failed, 411 passed, 180 warnings in 9.81s ==================");
	return out.join("\n");
}

function kubectlPods(): string {
	const out = ["NAMESPACE     NAME                                   READY   STATUS             RESTARTS        AGE"];
	for (let i = 0; i < 180; i++) out.push(`${["default", "web", "search", "kube-system", "monitoring"][i % 5]!.padEnd(13)} ${`${["web", "search", "worker", "metrics", "cron"][i % 5]}-${(i * 7919).toString(16).slice(0, 5)}-x${i}`.padEnd(38)} 1/1     Running            0               ${1 + (i % 9)}d`);
	out.splice(97, 0, "payments      payments-api-7d9f8c6b5-qx2lp           0/1     CrashLoopBackOff   42 (2m ago)     3h");
	return out.join("\n");
}

function npmCi(): string {
	const out: string[] = [];
	for (let i = 0; i < 190; i++) out.push(`npm http fetch GET 200 https://registry.npmjs.org/pkg-${i} ${10 + (i % 90)}ms (cache ${i % 3 ? "hit" : "miss"})`);
	out.push("", "added 612 packages, and audited 613 packages in 14s", "", "118 packages are looking for funding", "  run `npm fund` for details", "", "found 0 vulnerabilities");
	return out.join("\n");
}

function fetchedPage(): string {
	const out = ["# REST API endpoints for search - GitHub Docs", ""];
	const sections = ["About search", "Ranking search results", "Considerations for code search", "Search commits", "Search issues and pull requests", "Search labels", "Search repositories", "Search topics", "Search users"];
	for (const s of sections) {
		out.push(`## ${s}`, "");
		for (let i = 0; i < 18; i++) out.push(`${s}: parameter and behaviour notes, line ${i + 1}. See the query syntax reference for qualifiers.`);
		out.push("");
		if (s === "About search") out.push("## Rate limit", "", "The REST API has a custom rate limit for searching. For authenticated requests, you can make up to 30 requests per minute for all search endpoints except for the \"Search code\" endpoint. The \"Search code\" endpoint requires you to authenticate and limits you to 10 requests per minute.", "");
	}
	return out.join("\n");
}

function grepUseEffect(): string {
	const out: string[] = [];
	for (let i = 0; i < 200; i++) out.push(`${DIRS[i % 11]}/Comp${i % 13}.tsx:${12 + i}:  useEffect(() => { setOpen(false); }, [${["id", "open", "props.value"][i % 3]}]);`);
	out.push("src/realtime/socket.ts:31:  useEffect(() => { const ws = new WebSocket(url); ws.onmessage = onMessage; return () => ws.close(); }, [url]);");
	return out.sort().join("\n");
}

function dockerBuild(): string {
	const out = ["#0 building with \"desktop-linux\" instance using docker driver", "#1 [internal] load build definition from Dockerfile"];
	for (let i = 0; i < 220; i++) out.push(`#5 ${(i * 0.13).toFixed(2)} Progress: resolved ${i * 3}, reused ${i * 3}, downloaded 0, added 0`);
	out.push("#6 [6/9] RUN pnpm install --frozen-lockfile", "#6 1.204  ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with \"frozen-lockfile\" because pnpm-lock.yaml is not up to date with package.json", "#6 1.205 Note that in CI environments this setting is true by default.", "#6 ERROR: process \"/bin/sh -c pnpm install --frozen-lockfile\" did not complete successfully: exit code: 1", "------", " > [6/9] RUN pnpm install --frozen-lockfile:", "------", "ERROR: failed to solve: process \"/bin/sh -c pnpm install --frozen-lockfile\" did not complete successfully: exit code: 1");
	return out.join("\n");
}

export const WRITE_HOLDOUT: WriteCase[] = [
	wc("W14", "95 lint warnings + 1 error, fix errors only", "TRIM", "Make npm run lint pass. Warnings are fine, only fix errors.", "bash", { command: "npm run lint" }, lintWarnings(), { isError: true, keyLines: ["'unused' is assigned a value but never used", "src/cart/CartRow.tsx"] }),
	wc("W15", "pytest: 1 failure among warnings (Chinese)", "TRIM", "修复失败的测试。", "bash", { command: "pytest -q" }, pytestLog(), { isError: true, keyLines: ["test_refund_rounding", "assert 999 == 1000", "tests/test_billing_17.py:23"] }),
	wc("W16", "kubectl pods, one crashlooping", "TRIM", "Why is the payments service down?", "bash", { command: "kubectl get pods -A" }, kubectlPods(), { keyLines: ["payments-api-7d9f8c6b5-qx2lp", "CrashLoopBackOff"] }),
	wc("W17", "npm ci success chatter", "TRIM", "Install the dependencies, then start the dev server.", "bash", { command: "npm ci --loglevel=http" }, npmCi(), { keyLines: ["added 612 packages", "found 0 vulnerabilities"] }),
	wc("W18", "fetched docs page, one relevant section", "TRIM", "What's the rate limit for the GitHub search API? I need it for the crawler config.", "fetch_url", { url: "https://docs.github.com/en/rest/search/search" }, fetchedPage(), { keyLines: ["30 requests per minute"] }),
	wc("W19", "grep useEffect while hunting the websocket", "TRIM", "Find where we subscribe to the websocket; messages are being handled twice.", "grep", { pattern: "useEffect", path: "src" }, grepUseEffect(), { keyLines: ["src/realtime/socket.ts:31"] }),
	wc("W20", "all TODOs into a checklist", "KEEP", "Compile every TODO in src into a markdown checklist grouped by file.", "grep", { pattern: "TODO", path: "src" }, grepTodo()),
	wc("W21", "git log for full release notes", "KEEP", "Write release notes that cover every commit since v1.3.", "bash", { command: "git log --oneline v1.3..HEAD" }, rows(190, (i) => `${(i * 2654435761 >>> 0).toString(16).slice(0, 7)} ${["feat", "fix", "chore", "docs"][i % 4]}(${["cart", "auth", "ui", "api"][i % 4]}): change number ${190 - i}`)),
	wc("W22", "every feature flag row, check each (Chinese)", "KEEP", "把 feature_flags 表的每一行都列出来，我要逐行核对所有值。", "bash", { command: "psql -c 'select * from feature_flags'" }, rows(165, (i) => ` flag_${i} | ${i % 3 === 0 ? "t" : "f"} | team-${i % 7} | 2026-0${(i % 9) + 1}-1${i % 9}`)),
	wc("W23", "rename every test file", "KEEP", "Rename all test files from .test.ts to .spec.ts.", "bash", { command: "find . -name '*.test.ts' -not -path './node_modules/*'" }, rows(180, (i) => `./${DIRS[i % 12]}/${["index", "types", "utils", "api", "view"][i % 5]}${Math.floor(i / 12)}.test.ts`)),
	wc("W24", "SQL rows to export", "KEEP", "Export these customer rows to customers.csv exactly as returned.", "sql_query", { sql: "select id, email, country from customers where created_at > '2026-01-01'" }, rows(170, (i) => `{"id":"c_${i}","email":"user${i}@example.com","country":"${["NZ", "AU", "US", "DE"][i % 4]}"}`)),
	wc("W25", "docker build fails at one step", "TRIM", "The docker build fails. Fix it.", "bash", { command: "docker build -t acme-api ." }, dockerBuild(), { isError: true, keyLines: ["ERR_PNPM_OUTDATED_LOCKFILE", "[6/9] RUN pnpm install --frozen-lockfile"] }),
];

// ---------------------------------------------------------------------------------------------
// WRITE-TIME HELD-OUT 2 (sieve). Written after the sieve's first runs exposed the "needle inside an
// unrelated block" failure (W08) and before the guards that address it were run. Committed before any
// Jev call on them.

function jsonBlob(): string {
	const out = ["{"];
	for (let i = 0; i < 170; i++) out.push(`  "service_${i}": { "replicas": ${1 + (i % 4)}, "cpu": "${100 + i}m", "image": "acme/svc-${i}:1.${i % 9}.0" },`);
	out.splice(121, 0, `  "checkout": { "replicas": 0, "cpu": "250m", "image": "acme/checkout:2.4.1", "note": "scaled to zero by autoscaler at 03:12" },`);
	out.push("}");
	return out.join("\n");
}

function releaseNotesPage(): string {
	const out: string[] = ["# Vite 6 migration guide", ""];
	const sections = ["Environment API", "Resolve conditions", "JSON stringify", "Extended asset references", "PostCSS config", "Sass modern API", "CSS output file name", "Library mode", "Dev server", "Build", "Advanced"];
	for (const s of sections) {
		out.push(`## ${s}`, "");
		for (let i = 0; i < 14; i++) out.push(`${s}: explanation of behaviour change ${i + 1}, with migration notes for plugin authors and frameworks.`);
		if (s === "Library mode") out.push("In library mode, `build.lib.fileName` now defaults to the package name, and CSS output is named `style.css` only if `build.lib.cssFileName` is set.");
		out.push("");
	}
	return out.join("\n");
}

function mixedTestLog(): string {
	const out: string[] = [];
	for (let i = 0; i < 190; i++) out.push(`PASS  packages/${["core", "ui", "cli", "server"][i % 4]}/test/case-${i}.spec.ts (${10 + (i % 50)} ms)`);
	out.splice(140, 0, "FAIL  packages/cli/test/config-loader.spec.ts", "  ● loadConfig › resolves extends chain", "    Expected: \"./base.json\"", "    Received: undefined", "      at Object.<anonymous> (packages/cli/test/config-loader.spec.ts:77:25)");
	out.push("Tests:       1 failed, 189 passed, 190 total");
	return out.join("\n");
}

function dependencyTree(): string {
	const out = ["acme-app@1.4.0 /home/dev/acme-app"];
	for (let i = 0; i < 175; i++) out.push(`${i % 5 ? "│ " : ""}├── ${["lodash", "zod", "react", "express", "vite", "dayjs", "axios"][i % 7]}-plugin-${i}@${1 + (i % 3)}.${i % 10}.0`);
	out.splice(88, 0, "├─┬ jsonwebtoken@8.5.1", "│ └── jws@3.2.2  (deprecated: CVE-2022-23540, upgrade to jsonwebtoken@9)");
	return out.join("\n");
}

export const WRITE_HOLDOUT2: WriteCase[] = [
	wc("W26", "k8s config JSON, one service scaled to zero", "TRIM", "Checkout requests return 503 since this morning. Find out why.", "bash", { command: "kubectl get deploy -o json | node scripts/summarize-deploys.js" }, jsonBlob(), { keyLines: ["\"checkout\": { \"replicas\": 0"] }),
	wc("W27", "migration guide page, one relevant paragraph inside a long section", "TRIM", "After upgrading to Vite 6 our library build no longer emits style.css. Check the migration guide.", "fetch_url", { url: "https://vite.dev/guide/migration" }, releaseNotesPage(), { keyLines: ["build.lib.cssFileName"] }),
	wc("W28", "190 passing tests, one failure in the middle", "TRIM", "Run the test suite and fix what fails.", "bash", { command: "npx jest" }, mixedTestLog(), { isError: true, keyLines: ["config-loader.spec.ts:77", "resolves extends chain", "Received: undefined"] }),
	wc("W29", "dependency tree, one vulnerable package", "TRIM", "Is anything in our dependency tree flagged as vulnerable or deprecated?", "bash", { command: "npm ls --all" }, dependencyTree(), { keyLines: ["CVE-2022-23540", "jsonwebtoken@8.5.1"] }),
	wc("W30", "same JSON, but the user wants every service's replica count", "KEEP", "List the replica count of every service in a table.", "bash", { command: "kubectl get deploy -o json | node scripts/summarize-deploys.js" }, jsonBlob()),
	wc("W31", "migration guide, user asks for a full summary", "KEEP", "Summarise every section of the Vite 6 migration guide for the team wiki.", "fetch_url", { url: "https://vite.dev/guide/migration" }, releaseNotesPage()),
	wc("W32", "dependency tree, user wants the full tree pasted", "KEEP", "Paste the complete dependency tree into docs/deps.md, unchanged.", "bash", { command: "npm ls --all" }, dependencyTree()),
];
