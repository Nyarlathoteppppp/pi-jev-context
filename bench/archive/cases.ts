import type { Label } from "../../src/types.ts";
import { longBuildLog, longVitestLog, packageJson, Session } from "../builder.ts";

// GROUND TRUTH. Written and committed before the first live Jev run. Do not edit labels to fit results;
// if a label is wrong, fix it in a separate commit that says why, and re-run.
//
// truth       the single best decision
// acceptable  decisions that lose nothing the agent will need (truth is always included)
// critical    the information is needed later in the session; DROP here is a critical false drop
// keyLines    for TRUNCATE-worthy long outputs: substrings that any truncation must keep

export interface Target {
	tag: string;
	truth: Label;
	acceptable: Label[];
	critical: boolean;
	keyLines?: string[];
	why: string;
}

export interface Checkpoint {
	name: string;
	/** Message count at which the session is judged. */
	at: number;
	targets: Target[];
}

export interface Case {
	id: string;
	category: string;
	title: string;
	session: Session;
	checkpoints: Checkpoint[];
}

export const T = (tag: string, truth: Label, acceptable: Label[], critical: boolean, why: string, keyLines?: string[]): Target => ({
	tag,
	truth,
	acceptable: [...new Set<Label>([truth, ...acceptable])],
	critical,
	why,
	keyLines,
});

export const end = (s: Session, targets: Target[], name = "end"): Checkpoint[] => [{ name, at: s.at, targets }];

// ---------------------------------------------------------------------------------------------

function c01(): Case {
	const s = new Session(1)
		.user("Fix the session refresh bug: users get logged out after 15 minutes even though they are active.")
		.bash("pwd", "/home/dev/acme-app", { tag: "pwd" })
		.bash("ls", "README.md\ndocs\nnode_modules\npackage.json\npnpm-lock.yaml\npublic\nsrc\ntests\ntsconfig.json\nvite.config.ts", { tag: "ls" })
		.bash("find src -maxdepth 2 -type d", "src\nsrc/api\nsrc/auth\nsrc/cart\nsrc/db\nsrc/lib\nsrc/profile\nsrc/ui\nsrc/billing", { tag: "find" })
		.read("src/auth/session.ts", "import { storage } from \"./storage\";\nimport { refreshTokens } from \"./api\";\n\nconst IDLE_LIMIT_MS = 15 * 60 * 1000;\nlet lastActivity = Date.now();\n\nexport function touch() {\n  lastActivity = Date.now();\n}\n\nexport async function ensureFresh() {\n  const t = storage.get();\n  if (!t) return;\n  if (Date.now() - t.issuedAt > IDLE_LIMIT_MS) {\n    storage.clear();\n    return;\n  }\n  if (t.expiresAt - Date.now() < 60_000) storage.set(await refreshTokens(t.refreshToken));\n}\n")
		.say("ensureFresh compares against issuedAt instead of lastActivity, so active users are logged out 15 minutes after login.")
		.edit("src/auth/session.ts", "Date.now() - t.issuedAt > IDLE_LIMIT_MS", "Date.now() - lastActivity > IDLE_LIMIT_MS")
		.filler(6, "auth")
		.bash("npx vitest run src/auth", " ✓ src/auth/session.test.ts (5 tests) 9ms\n ✓ src/auth/storage.test.ts (3 tests) 4ms\n\n Test Files  2 passed (2)\n      Tests  8 passed (8)")
		.filler(4, "ui")
		.user("Also make sure touch() is called on every API request, not only on clicks.");
	return {
		id: "C01",
		category: "stale directory info",
		title: "pwd / ls / find at session start, then 14 tool calls of real work",
		session: s,
		checkpoints: end(s, [
			T("pwd", "DROP", [], false, "Working dir is trivially regenerable and never used again."),
			T("ls", "DROP", [], false, "Top-level listing no longer drives any decision."),
			T("find", "DROP", ["TRUNCATE"], false, "Directory map is stale orientation; the relevant files were read since."),
		]),
	};
}

function c02(): Case {
	const s = new Session(2)
		.user("Add input validation to the signup form using zod.")
		.read("src/ui/SignupForm.tsx", "export function SignupForm() {\n  const [email, setEmail] = useState(\"\");\n  const [password, setPassword] = useState(\"\");\n  return <form onSubmit={submit}>...</form>;\n}\n")
		.edit("src/ui/SignupForm.tsx", "export function SignupForm", "import { z } from \"zod\";\n\nconst schema = z.object({ email: z.string().email(), password: z.string().min(8) });\n\nexport function SignupForm")
		.bash(
			"npm test",
			"> acme-app@1.4.0 test\n> vitest run\n\n FAIL  src/ui/SignupForm.test.tsx [ src/ui/SignupForm.test.tsx ]\nError: Cannot find module 'zod' imported from /home/dev/acme-app/src/ui/SignupForm.tsx\n ❯ src/ui/SignupForm.tsx:1:19\n\n Test Files  1 failed | 37 passed (38)\n      Tests  401 passed (401)",
			{ tag: "fail", error: true },
		)
		.bash("pnpm add zod", "Packages: +1\n+\ndependencies:\n+ zod 3.23.8\n\nDone in 1.4s")
		.bash("npm test", "> acme-app@1.4.0 test\n> vitest run\n\n Test Files  38 passed (38)\n      Tests  404 passed (404)\n   Duration  6.12s", { tag: "pass" })
		.user("Also show the validation errors under each field.")
		.read("src/ui/Field.tsx", "export function Field({ label, children }: { label: string; children: React.ReactNode }) {\n  return <label>{label}{children}</label>;\n}\n")
		.edit("src/ui/Field.tsx", "{children}</label>", "{children}{error && <p className=\"field-error\">{error}</p>}</label>")
		.filler(2, "ui");
	return {
		id: "C02",
		category: "superseded failure",
		title: "npm test fails (missing zod) → install → npm test passes",
		session: s,
		checkpoints: end(s, [
			T("fail", "DROP", ["TRUNCATE"], false, "The missing-module failure was fixed and a later run of the same command passed."),
			T("pass", "KEEP", ["TRUNCATE"], false, "Latest verification state of the suite."),
		]),
	};
}

function c03(): Case {
	const s = new Session(3)
		.user("Users sometimes get a 401 right after their access token expires. Find the root cause and fix it.")
		.read("src/auth/interceptor.ts", "export async function onResponse(res: Response, req: Request) {\n  if (res.status !== 401) return res;\n  if (req.headers.get(\"x-retried\")) {\n    logout();\n    return res;\n  }\n  await refreshSession();\n  return retry(req);\n}\n")
		.bash(
			"DEBUG=auth npx playwright test e2e/auth-retry.spec.ts",
			"[auth] GET /me → 401 (access token expired)\n[auth] onResponse: 401 → calling refreshSession()\n[auth] refreshSession: concurrent 401 from GET /notifications already triggered logout()\n[auth] logout(): storage.clear() → refresh_token=null\n[auth] refreshSession: no refresh token, skipping refresh\n[auth] retry GET /me → 401\nROOT CAUSE CANDIDATE: 401 happens because the refresh token is cleared (by the concurrent logout) before the retry\n\n  1 failed\n    e2e/auth-retry.spec.ts:18:5 › retries after refresh",
			{ tag: "root", error: true },
		)
		.bash("ls tests", "e2e\nfixtures\nunit", { tag: "lsTests" })
		.filler(8, "auth")
		.filler(8, "ui")
		.user("Any progress? Remember it only happens intermittently.");
	return {
		id: "C03",
		category: "old but critical",
		title: "Early debug log reveals the 401 root cause, then 16 unrelated calls",
		session: s,
		checkpoints: end(s, [
			T("root", "KEEP", ["TRUNCATE"], true, "The only evidence of the root cause; the fix has not been made."),
			T("lsTests", "DROP", [], false, "Directory listing that played no role."),
		]),
	};
}

function c04(): Case {
	const s = new Session(4)
		.user("CI is red. Run the test suite and fix whatever fails.")
		.bash("npx vitest run --reporter=verbose", longVitestLog(), { tag: "log", error: true })
		.read("src/auth/auth.test.ts", "  it(\"refreshes an expired session\", async () => {\n    server.expireSession();\n    const res = await client.get(\"/me\");\n    expect(res.status).toBe(200);\n  });\n")
		.read("src/auth/interceptor.ts", "export async function onResponse(res: Response, req: Request) {\n  if (res.status !== 401) return res;\n  await refreshSession();\n  return retry(req);\n}\n")
		.filler(3, "auth");
	return {
		id: "C04",
		category: "very long log",
		title: "500-line vitest output with exactly 2 failures, still being fixed",
		session: s,
		checkpoints: end(s, [
			T("log", "TRUNCATE", [], true, "Only the two failures matter; the other ~490 lines are noise.", [
				"2 failed",
				"auth.test.ts:42",
				"expected 401 to be 200",
				"auth.test.ts:58",
				"retries the original request after refresh",
			]),
		]),
	};
}

function c05(): Case {
	const s = new Session(5)
		.user("Set up the project locally and add a dark mode toggle to the header.")
		.bash("cat package.json", packageJson(), { tag: "pkg" })
		.bash("pnpm install", "Lockfile is up to date, resolution step is skipped\nPackages: +612\nDone in 8.2s")
		.filler(8, "ui")
		.user("Looks good. Now make the toggle remember the choice in localStorage.")
		.filler(6, "ui");
	const a = s.at;
	s.user(
		"New problem: in CI, `pnpm add @acme/ui-kit` fails with\n\nERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment (bad pnpm and/or Node.js version)\nYour Node version is incompatible with \"acme-app\".\nExpected version: see the engines field\nGot: v20.18.0\n\nWhy does installing this dependency fail? It works on my machine.",
	);
	return {
		id: "C05",
		category: "temporarily irrelevant",
		title: "package.json (engines node>=22) unused for many turns, then the task becomes an install failure",
		session: s,
		checkpoints: [
			{ name: "A: before goal change", at: a, targets: [T("pkg", "TRUNCATE", ["KEEP"], true, "Durable project facts (engines, package manager, versions) that the session needs later.", ["\"node\": \">=22\""])] },
			{ name: "B: after goal change", at: s.at, targets: [T("pkg", "KEEP", ["TRUNCATE"], true, "The engines field is the direct evidence for the install failure.", ["\"node\": \">=22\""])] },
		],
	};
}

function c06(): Case {
	const s = new Session(6)
		.user("Rename the formatPrice helper to formatMoney everywhere.")
		.tool("grep", { pattern: "formatCurrency", path: "src" }, "No matches found", { tag: "g" })
		.tool("grep", { pattern: "formatPrice", path: "src" }, "src/lib/money.ts:3:export function formatPrice(cents: number) {\nsrc/cart/CartRow.tsx:14:  <td>{formatPrice(item.total)}</td>\nsrc/api/orders.ts:22:  total: formatPrice(order.total),")
		.edit("src/lib/money.ts", "export function formatPrice", "export function formatMoney")
		.edit("src/cart/CartRow.tsx", "formatPrice(", "formatMoney(")
		.edit("src/api/orders.ts", "formatPrice(", "formatMoney(")
		.bash("npx tsc --noEmit -p .", "")
		.filler(5, "api")
		.user("Now also add a currency parameter to formatMoney, defaulting to USD.");
	return {
		id: "C06",
		category: "empty grep (stale)",
		title: "Empty grep for an alternative name, irrelevant after the rename",
		session: s,
		checkpoints: end(s, [T("g", "DROP", [], false, "A no-match search for a name that plays no further role.")]),
	};
}

function c07(): Case {
	const s = new Session(7)
		.user("Can we safely delete src/legacy/legacyAuth.ts? Check whether anything still uses it.")
		.bash("git grep -n legacyAuth -- ':!src/legacy'", "", { tag: "g" })
		.tool("grep", { pattern: "legacy/legacyAuth", path: "tests" }, "No matches found", { tag: "g2" })
		.read("src/legacy/legacyAuth.ts", "// Pre-2024 cookie auth. Replaced by src/auth/*.\nexport function legacyLogin(user: string, pass: string) {\n  document.cookie = `sid=${btoa(user + \":\" + pass)}`;\n}\n")
		.filler(5, "docs")
		.user("OK. Before you delete it, tell me exactly what evidence you have that nothing uses it.");
	return {
		id: "C07",
		category: "empty grep (evidence)",
		title: "Empty search results are the evidence the user asks for",
		session: s,
		checkpoints: end(s, [
			T("g", "KEEP", ["TRUNCATE"], true, "The empty git grep across the repo is the evidence the user is asking for."),
			T("g2", "KEEP", ["TRUNCATE"], true, "The empty search in tests is part of the same evidence."),
		]),
	};
}

function c08(): Case {
	const status = (files: string[]) => `On branch refactor/orders\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n${files.map((f) => `\tmodified:   ${f}`).join("\n")}\n\nno changes added to commit (use "git add" and/or "git commit -a")`;
	const s = new Session(8)
		.user("Split the orders refactor into two commits: one for the repository layer, one for the handlers.")
		.bash("git status", status(["src/api/orders.ts", "src/api/routes.ts", "src/db/orderRepo.ts", "src/db/index.ts"]), { tag: "gs1" })
		.bash("git add src/db && git commit -m 'db: orderRepo pagination'", "[refactor/orders 1a2b3c4] db: orderRepo pagination\n 2 files changed, 18 insertions(+), 6 deletions(-)")
		.bash("git status", status(["src/api/orders.ts", "src/api/routes.ts"]), { tag: "gs2" })
		.bash("git add src/api && git commit -m 'api: paginate orders'", "[refactor/orders 5d6e7f8] api: paginate orders\n 2 files changed, 11 insertions(+), 3 deletions(-)")
		.bash("git status", "On branch refactor/orders\nnothing to commit, working tree clean")
		.user("Now write a short PR description summarizing the two commits.");
	return {
		id: "C08",
		category: "repeated git status",
		title: "Three git status calls while committing; the first two are obsolete",
		session: s,
		checkpoints: end(s, [
			T("gs1", "DROP", [], false, "Superseded by later status calls; the commits record what happened."),
			T("gs2", "DROP", [], false, "Superseded by the final clean status."),
		]),
	};
}

function c09(): Case {
	const fail =
		" FAIL  src/date/format.test.ts > formatDay > uses the user's timezone\nAssertionError: expected '2024-03-10' to be '2024-03-09' // Object.is equality\n ❯ src/date/format.test.ts:12:40\n\n Test Files  1 failed (1)\n      Tests  1 failed | 6 passed (7)";
	const s = new Session(9)
		.user("Fix the failing date formatting test.")
		.bash("npx vitest run src/date", fail, { tag: "f1", error: true })
		.read("src/date/format.ts", "export function formatDay(d: Date) {\n  return d.toISOString().slice(0, 10);\n}\n")
		.edit("src/date/format.ts", "d.toISOString().slice(0, 10)", "new Intl.DateTimeFormat(\"en-CA\").format(d)")
		.bash("npx vitest run src/date", fail, { tag: "f2", error: true })
		.edit("src/date/format.ts", "new Intl.DateTimeFormat(\"en-CA\")", "new Intl.DateTimeFormat(\"en-CA\", { timeZone: \"UTC\" })")
		.bash("npx vitest run src/date", fail, { tag: "f3", error: true })
		.user("Still failing? What's your next idea?");
	return {
		id: "C09",
		category: "repeated test failure",
		title: "Same failure three times, still unresolved",
		session: s,
		checkpoints: end(s, [
			T("f1", "DROP", ["TRUNCATE"], false, "Identical to the latest failure, which is kept."),
			T("f2", "DROP", ["TRUNCATE"], false, "Identical to the latest failure, which is kept."),
			T("f3", "KEEP", ["TRUNCATE"], true, "Current, unresolved failure."),
		]),
	};
}

function c10(): Case {
	const s = new Session(10)
		.user("The app crashes on /profile when the user has no avatar. Fix it.")
		.bash(
			"tail -20 logs/server.log",
			"2026-09-18T09:12:44Z GET /profile 500\nTypeError: Cannot read properties of undefined (reading 'url')\n    at Avatar (src/profile/Avatar.tsx:12:31)\n    at renderWithHooks (node_modules/react-dom/cjs/react-dom-server.node.development.js:5662:16)\n    at renderIndeterminateComponent (node_modules/react-dom/cjs/react-dom-server.node.development.js:5735:15)\n    at renderElement (node_modules/react-dom/cjs/react-dom-server.node.development.js:5950:7)\n    at ProfilePage (src/profile/ProfilePage.tsx:22:9)",
			{ tag: "trace" },
		)
		.read("src/profile/Avatar.tsx", "export function Avatar({ user }: { user: User }) {\n  return <img src={user.avatar.url} alt=\"\" />;\n}\n")
		.edit("src/profile/Avatar.tsx", "<img src={user.avatar.url} alt=\"\" />", "user.avatar ? <img src={user.avatar.url} alt=\"\" /> : <DefaultAvatar />")
		.bash("npx vitest run src/profile", " ✓ src/profile/Avatar.test.tsx (3 tests) 12ms\n   ✓ renders without avatar\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)")
		.user("Thanks! Next: add a `limit` query parameter to the orders list API.")
		.filler(8, "api");
	return {
		id: "C10",
		category: "old stack trace (resolved)",
		title: "Crash stack trace, fixed and verified, then a different task",
		session: s,
		checkpoints: end(s, [T("trace", "DROP", ["TRUNCATE"], false, "The crash was fixed and verified; the task changed.")]),
	};
}

function c11(): Case {
	const s = new Session(11)
		.user("Checkout intermittently throws in production. It started after Tuesday's deploy. Find out why.")
		.bash(
			"grep -A 8 'CheckoutError' logs/prod-2026-09-17.log | head -20",
			"2026-09-17T03:14:09Z ERROR CheckoutError: tax rate missing for region 'NZ'\n    at computeTax (src/checkout/tax.ts:57:11)\n    at buildOrder (src/checkout/order.ts:88:20)\n    at async POST /checkout (src/api/checkout.ts:31:5)\n  requestId=9f2c userRegion=NZ cartItems=3\n2026-09-17T07:40:51Z ERROR CheckoutError: tax rate missing for region 'NZ'\n    at computeTax (src/checkout/tax.ts:57:11)",
			{ tag: "trace" },
		)
		.filler(8, "api")
		.filler(6, "ui")
		.user("Any idea yet what's causing it?");
	return {
		id: "C11",
		category: "old stack trace (unresolved)",
		title: "Production stack trace, 14 unrelated calls later still the open problem",
		session: s,
		checkpoints: end(s, [T("trace", "KEEP", ["TRUNCATE"], true, "The only concrete evidence for the open production bug.")]),
	};
}

function c12(): Case {
	const diff = [
		"diff --git a/src/cart/totals.ts b/src/cart/totals.ts",
		"index 3b1f2e0..9a7c4d1 100644",
		"--- a/src/cart/totals.ts",
		"+++ b/src/cart/totals.ts",
		"@@ -1,18 +1,24 @@",
		" import type { Cart } from \"./types\";",
		"+import { shippingFor } from \"./shipping\";",
		" ",
		" export function totals(cart: Cart) {",
		"   const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);",
		"   const tax = Math.round(subtotal * cart.taxRate);",
		"-  return { subtotal, tax, total: subtotal + tax };",
		"+  const shipping = shippingFor(cart);",
		"+  return { subtotal, tax, shipping, total: subtotal + tax + shipping };",
		" }",
		...Array.from({ length: 20 }, (_, i) => (i % 3 ? ` // line ${i}` : `+// note ${i}`)),
	].join("\n");
	const s = new Session(12)
		.user("Review my changes to the cart totals and commit them.")
		.bash("git diff", diff, { tag: "diff" })
		.say("The change adds shipping to totals and looks correct.")
		.bash("git commit -am 'cart: include shipping in totals'", "[main 3f2a1b9] cart: include shipping in totals\n 1 file changed, 14 insertions(+), 2 deletions(-)")
		.user("Now update the usage docs; nothing to do with the cart.")
		.filler(6, "docs");
	return {
		id: "C12",
		category: "old git diff",
		title: "Reviewed and committed diff, then an unrelated docs task",
		session: s,
		checkpoints: end(s, [T("diff", "DROP", ["TRUNCATE"], false, "Committed and recoverable with git show; the task moved on.")]),
	};
}

function c13(): Case {
	const s = new Session(13)
		.user("Get npm run lint passing.")
		.bash(
			"npm run lint",
			"> acme-app@1.4.0 lint\n> eslint .\n\n/home/dev/acme-app/src/cart/CartRow.tsx\n  14:7  error  'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars\n\n/home/dev/acme-app/src/api/orders.ts\n  3:10  error  'Request' is defined but never used  @typescript-eslint/no-unused-vars\n  41:5  error  Unexpected console statement  no-console\n\n✖ 3 problems (3 errors, 0 warnings)",
			{ tag: "lint", error: true },
		)
		.edit("src/cart/CartRow.tsx", "const unused = 1;\n", "")
		.edit("src/api/orders.ts", "import type { Request, Response }", "import type { Response }")
		.edit("src/api/orders.ts", "  console.log(order);\n", "")
		.bash("npm run lint", "> acme-app@1.4.0 lint\n> eslint .\n")
		.user("Nice. Now add a loading spinner to the orders page.")
		.filler(5, "ui");
	return {
		id: "C13",
		category: "fixed lint error",
		title: "Three lint errors, all fixed, lint clean, new task",
		session: s,
		checkpoints: end(s, [T("lint", "DROP", ["TRUNCATE"], false, "All errors fixed; lint re-run is clean.")]),
	};
}

function c14(): Case {
	const s = new Session(14)
		.user("Add an endpoint GET /orders/:id/invoice that returns the invoice PDF URL.")
		.read(
			"docs/adr/0003-data-access.md",
			"# ADR 0003: Data access\n\nStatus: Accepted (2025-11-02)\n\n## Decision\nAll database access goes through repository modules in src/db/*Repo.ts.\nRoute handlers must never import the Prisma client (`db`) directly.\nNew tables get a new repository module.\n\n## Consequences\nHandlers stay testable with in-memory repositories.",
			{ tag: "adr" },
		)
		.filler(8, "api")
		.user("Continue: wire up the handler and query the invoices table.");
	return {
		id: "C14",
		category: "architecture decision",
		title: "ADR read early; the rule constrains the code about to be written",
		session: s,
		checkpoints: end(s, [T("adr", "KEEP", ["TRUNCATE"], true, "The handler about to be written must follow this rule (new invoiceRepo, no direct db import).")]),
	};
}

function c15(): Case {
	const s = new Session(15)
		.user("Our invoice schema needs a new dueDate field. First find where the invoice schema lives.")
		.tool(
			"find",
			{ pattern: "**/*invoice*", path: "." },
			"shared/schemas/billing/v2/invoice.proto\nshared/schemas/billing/v1/invoice.proto\nsrc/billing/invoiceMapper.ts\nsrc/billing/invoice.test.ts\nscripts/gen-proto.sh",
			{ tag: "find" },
		)
		.read("src/billing/invoiceMapper.ts", "import type { Invoice } from \"../gen/billing/v2/invoice\";\n\nexport const toDto = (i: Invoice) => ({ id: i.id, total: i.totalCents });\n")
		.filler(8, "api")
		.user("Now add the dueDate field to the schema and regenerate the types.");
	return {
		id: "C15",
		category: "file path",
		title: "find reveals the non-obvious schema path (v2 vs v1) and the codegen script",
		session: s,
		checkpoints: end(s, [T("find", "KEEP", ["TRUNCATE"], true, "The exact schema path and gen script are needed for the next step.")]),
	};
}

function c16(): Case {
	const s = new Session(16)
		.user("Add soft-delete to orders using Prisma.")
		.bash(
			"npx prisma --version",
			"prisma                  : 4.16.2\n@prisma/client          : 4.16.2\nComputed binaryTarget   : darwin-arm64\nOperating System        : darwin\nArchitecture            : arm64\nNode.js                 : v22.9.0\nQuery Engine (Node-API) : libquery-engine 4bc8b6e1b66cb932731fb1bdbbc550d1e010de81\nSchema Engine           : schema-engine-cli 4bc8b6e1b66cb932731fb1bdbbc550d1e010de81",
			{ tag: "ver" },
		)
		.filler(8, "api")
		.user("Use Prisma's `omit` query option to hide deletedAt from API responses.");
	return {
		id: "C16",
		category: "version number",
		title: "Prisma 4.16 version output; later the user asks for a feature that needs a newer Prisma",
		session: s,
		checkpoints: end(s, [T("ver", "KEEP", ["TRUNCATE"], true, "`omit` does not exist in Prisma 4.16; the version decides what is possible.")]),
	};
}

function c17(): Case {
	const s = new Session(17)
		.user("Integrate payments into checkout using our internal payments SDK.")
		.read(
			"node_modules/@acme/payments/README.md",
			"# @acme/payments 3.2\n\n## Creating a payment intent\n\n`payments.createIntent()` was removed in 3.0.\nUse `payments.intents.createV2({ amountCents, currency, idempotencyKey })`.\nidempotencyKey is required; reuse it on retries.\n\n## Webhooks\n\nVerify signatures with `payments.webhooks.verify(rawBody, header)`.",
			{ tag: "api" },
		)
		.filler(5, "ui")
		.filler(4, "api")
		.user("Now write the server-side call that creates the payment intent.");
	return {
		id: "C17",
		category: "API name",
		title: "SDK README gives the non-obvious API name; later the agent must call it",
		session: s,
		checkpoints: end(s, [T("api", "KEEP", ["TRUNCATE"], true, "The call to write depends on intents.createV2 and its required idempotencyKey.")]),
	};
}

function c18(): Case {
	const s = new Session(18)
		.user("Investigate why the nightly export failed. Keep the exact error output from the export job log; I need to paste it verbatim into the incident report later.")
		.bash(
			"tail -8 logs/export-2026-09-18.log",
			"02:00:01 export: starting nightly export (tables=orders,customers)\n02:00:03 export: orders 18234 rows\n02:00:04 ERROR export: customers query failed: canceling statement due to statement timeout\n02:00:04 ERROR export: SQLSTATE 57014 (query_canceled) after 30000 ms\n02:00:04 export: aborted, 0 files uploaded",
			{ tag: "log" },
		)
		.read("src/jobs/export.ts", "const TIMEOUT_MS = 30_000;\nexport async function exportTable(name: string) {\n  return db.$queryRawUnsafe(`SET statement_timeout = ${TIMEOUT_MS}; SELECT * FROM ${name}`);\n}\n")
		.edit("src/jobs/export.ts", "SELECT * FROM ${name}", "SELECT * FROM ${name} /* streamed */")
		.bash("npm run job:export -- --dry-run", "export: dry run ok (orders, customers)")
		.filler(6, "api")
		.user("Fixed, thanks. Clean up anything left over and tell me when you're done.");
	return {
		id: "C18",
		category: "user-requested evidence",
		title: "User explicitly asked to keep the verbatim error output; the bug is fixed",
		session: s,
		checkpoints: end(s, [T("log", "KEEP", [], true, "The user asked for the exact output verbatim; truncating or dropping breaks that.")]),
	};
}

function c19(): Case {
	const cfg = (ms: number) => `pricing:\n  url: https://pricing.internal.acme.dev\n  timeoutMs: ${ms}\n  retries: 0\ninventory:\n  url: https://inventory.internal.acme.dev\n  timeoutMs: 10000\n`;
	const s = new Session(19)
		.user("Requests to the pricing service time out. Increase its timeout to 60s.")
		.read("config/services.yaml", cfg(30000), { tag: "old" })
		.edit("config/services.yaml", "timeoutMs: 30000", "timeoutMs: 60000")
		.read("config/services.yaml", cfg(60000), { tag: "new" })
		.bash("npx vitest run src/pricing", " ✓ src/pricing/client.test.ts (4 tests) 7ms\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)")
		.user("Also add retries with exponential backoff to the pricing client, configured in the same file.")
		.filler(4, "api");
	return {
		id: "C19",
		category: "superseded config value",
		title: "Config read, edited, read again",
		session: s,
		checkpoints: end(s, [
			T("old", "DROP", ["TRUNCATE"], false, "Pre-edit content; the file was read again after the change."),
			T("new", "KEEP", ["TRUNCATE"], false, "Current content of the file the next change goes into (retries: 0)."),
		]),
	};
}

function c20(): Case {
	const v1 = "import type { Cart } from \"./types\";\n\nexport function totals(cart: Cart) {\n  const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);\n  const tax = Math.round(subtotal * cart.taxRate);\n  const shipping = subtotal > 5000 ? 0 : 499;\n  return { subtotal, tax, shipping, total: subtotal + tax + shipping };\n}\n";
	const v2 = "import type { Cart } from \"./types\";\n\nexport const FREE_SHIPPING_CENTS = 5000;\n\nexport function computeTax(subtotal: number, rate: number): number {\n  return Math.round(subtotal * rate);\n}\n\nexport function computeShipping(subtotal: number): number {\n  return subtotal > FREE_SHIPPING_CENTS ? 0 : 499;\n}\n\nexport function totals(cart: Cart) {\n  const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);\n  const tax = computeTax(subtotal, cart.taxRate);\n  const shipping = computeShipping(subtotal);\n  return { subtotal, tax, shipping, total: subtotal + tax + shipping };\n}\n";
	const s = new Session(20)
		.user("Refactor src/cart/totals.ts so tax and shipping are computed in separate exported functions.")
		.read("src/cart/totals.ts", v1, { tag: "v1" })
		.edit("src/cart/totals.ts", "const tax = Math.round(subtotal * cart.taxRate);", "const tax = computeTax(subtotal, cart.taxRate);")
		.edit("src/cart/totals.ts", "const shipping = subtotal > 5000 ? 0 : 499;", "const shipping = computeShipping(subtotal);")
		.read("src/cart/totals.ts", v2, { tag: "v2" })
		.bash("npx tsc --noEmit -p .", "")
		.user("Now add unit tests for the new functions.");
	return {
		id: "C20",
		category: "same file old/new read",
		title: "Old and new read of a file being refactored",
		session: s,
		checkpoints: end(s, [
			T("v1", "DROP", ["TRUNCATE"], false, "Pre-refactor content, superseded by the later read."),
			T("v2", "KEEP", [], true, "Current content; the tests to write target these exact functions and constants."),
		]),
	};
}

function c21(): Case {
	const s = new Session(21)
		.user("修一下移动端 Header 的布局，按钮在小屏上被挤出屏幕了。")
		.read("src/ui/Header.tsx", "export function Header() {\n  return (\n    <header className=\"header\">\n      <Logo />\n      <nav className=\"header-nav\">...</nav>\n      <Button>Sign in</Button>\n    </header>\n  );\n}\n")
		.read("src/styles/header.css", ".header {\n  display: flex;\n  justify-content: space-between;\n  min-width: 1024px;\n}\n.header-nav {\n  display: flex;\n  gap: 24px;\n}\n", { tag: "css" })
		.edit("src/styles/header.css", "min-width: 1024px;", "flex-wrap: wrap;")
		.bash("npx playwright test e2e/header.spec.ts --project=mobile", "  1 passed (2.1s)")
		.user("好了。现在换个任务：帮我配置 GitHub Actions，在每个 PR 上跑 lint 和测试。")
		.bash("ls .github", "ls: .github: No such file or directory", { error: true })
		.filler(3, "docs");
	return {
		id: "C21",
		category: "goal changed",
		title: "CSS read for a finished layout task; goal switched to CI setup (Chinese)",
		session: s,
		checkpoints: end(s, [T("css", "DROP", ["TRUNCATE"], false, "Belongs to the finished layout task; irrelevant to CI setup.")]),
	};
}

function c22(): Case {
	const s = new Session(22)
		.user("Build the app to make sure everything compiles.")
		.bash("npm run build", longBuildLog(), { tag: "build" })
		.say("The production build succeeds.")
		.user("Great. Now rewrite the README intro to be friendlier.")
		.filler(6, "docs");
	return {
		id: "C22",
		category: "irrelevant big build log",
		title: "~400-line successful build log, task moved to README copy",
		session: s,
		checkpoints: end(s, [T("build", "DROP", ["TRUNCATE"], false, "Successful build; nothing in it bears on README wording.")]),
	};
}

function c23(): Case {
	const s = new Session(23)
		.user("线上有个 bug：用户上传头像偶尔失败，报 413。帮我查一下根因。")
		.bash(
			"kubectl logs deploy/ingress-nginx --since=1h | grep -i avatar | tail -5",
			"2026/09/18 11:02:13 [error] 31#31: *88121 client intended to send too large body: 5412331 bytes, client: 10.2.3.4, request: \"POST /api/profile/avatar HTTP/1.1\"\n2026/09/18 11:05:40 [error] 31#31: *88402 client intended to send too large body: 3187220 bytes, client: 10.2.9.1, request: \"POST /api/profile/avatar HTTP/1.1\"\n# ingress annotation: nginx.ingress.kubernetes.io/proxy-body-size: 1m",
			{ tag: "root" },
		)
		.filler(7, "auth")
		.filler(7, "ui")
		.user("还有别的线索吗？先别改配置。");
	return {
		id: "C23",
		category: "old but critical (Chinese)",
		title: "Ingress log shows the 413 root cause (1m body limit); 14 calls later still investigating",
		session: s,
		checkpoints: end(s, [T("root", "KEEP", ["TRUNCATE"], true, "Direct evidence of the root cause; investigation continues.")]),
	};
}

function c24(): Case {
	const files = ["src/api/orders.ts", "src/api/customers.ts", "src/cart/CartRow.tsx", "src/profile/ProfilePage.tsx", "src/billing/invoiceMapper.ts", "src/lib/money.ts"];
	const lines: string[] = [];
	for (let i = 0; i < 90; i++) {
		const f = files[i % files.length]!;
		lines.push(`${f}(${10 + i},${5 + (i % 30)}): error TS2322: Type 'string | undefined' is not assignable to type 'string'.`);
		lines.push(`  Type 'undefined' is not assignable to type 'string'.`);
	}
	lines.push("", `Found 90 errors in ${files.length} files.`, "", ...files.map((f, i) => `Errors  Files\n    15  ${f}:${10 + i}`));
	const s = new Session(24)
		.user("I just enabled strictNullChecks in tsconfig. Fix the resulting type errors.")
		.bash("npx tsc --noEmit -p .", lines.join("\n"), { tag: "tsc", error: true })
		.read("src/lib/money.ts", "export function formatMoney(cents: number, currency: string = process.env.CURRENCY) {\n  return new Intl.NumberFormat(\"en\", { style: \"currency\", currency }).format(cents / 100);\n}\n")
		.edit("src/lib/money.ts", "currency: string = process.env.CURRENCY", "currency: string = process.env.CURRENCY ?? \"USD\"")
		.filler(3, "api");
	return {
		id: "C24",
		category: "very long log (repetitive)",
		title: "~190-line tsc output: 90 copies of one error across 6 files, being fixed",
		session: s,
		checkpoints: end(s, [
			T("tsc", "TRUNCATE", [], true, "The error kind and the six files matter; 90 near-identical lines do not.", ["TS2322", "Found 90 errors in 6 files", "src/api/customers.ts"]),
		]),
	};
}

function c25(): Case {
	const body: string[] = ["import { defineConfig } from \"vite\";", "import react from \"@vitejs/plugin-react\";", "", "export default defineConfig({", "  plugins: [react()],"];
	for (let i = 0; i < 60; i++) body.push(`  // build option ${i}: see https://vitejs.dev/config/build-options`);
	body.push("  server: {", "    port: 5173,", "    proxy: {", "      \"/api\": { target: \"http://localhost:8080\", changeOrigin: true },", "    },", "  },");
	for (let i = 0; i < 60; i++) body.push(`  // preview option ${i}`);
	body.push("});");
	const s = new Session(25)
		.user("In dev, API calls fail with ECONNREFUSED. The backend runs on port 3000. Figure out why.")
		.read("vite.config.ts", body.join("\n"), { tag: "vite" })
		.filler(5, "api")
		.user("Keep going. Don't change the backend port.");
	return {
		id: "C25",
		category: "config value in long file",
		title: "~130-line vite config where one proxy line (port 8080) is the answer",
		session: s,
		checkpoints: end(s, [
			T("vite", "TRUNCATE", ["KEEP"], true, "The proxy target localhost:8080 vs backend 3000 is the bug; the rest is comments.", ["localhost:8080"]),
		]),
	};
}

function c26(): Case {
	const log: string[] = [];
	for (let i = 0; i < 280; i++) {
		if (i % 70 === 40) log.push(`db-1   | 2026-09-18 10:0${i % 10}:12.4 UTC [${60 + i}] FATAL:  password authentication failed for user "acme"`);
		else if (i % 70 === 41) log.push(`api-1  | Error: connect: password authentication failed for user "acme" (SQLSTATE 28P01) at Pool.connect (node_modules/pg-pool/index.js:45:11)`);
		else log.push(`${i % 2 ? "api-1 " : "db-1  "} | 2026-09-18 10:00:${String(i % 60).padStart(2, "0")} ${i % 2 ? "info: waiting for db…" : "LOG:  checkpoint starting: time"}`);
	}
	const s = new Session(26)
		.user("docker compose up: the api container keeps restarting. Find out why.")
		.bash("docker compose logs --no-color db api | tail -280", log.join("\n"), { tag: "logs" })
		.read(".env", "DATABASE_URL=postgres://acme:acme@db:5432/acme\n")
		.read("docker-compose.yml", "services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_USER: acme\n      POSTGRES_PASSWORD: ${DB_PASSWORD}\n")
		.filler(2, "docs");
	return {
		id: "C26",
		category: "very long log (one key line)",
		title: "280 lines of compose logs; the only signal is the password auth failure",
		session: s,
		checkpoints: end(s, [
			T("logs", "TRUNCATE", [], true, "Only the auth-failure lines matter; the rest is idle chatter.", ["password authentication failed", "28P01"]),
		]),
	};
}

export const CASES: Case[] = [c01, c02, c03, c04, c05, c06, c07, c08, c09, c10, c11, c12, c13, c14, c15, c16, c17, c18, c19, c20, c21, c22, c23, c24, c25, c26].map((f) => f());

export interface Item {
	key: string;
	caseId: string;
	category: string;
	checkpoint: string;
	at: number;
	targetId: string;
	target: Target;
	c: Case;
}

export function items(cases: Case[] = CASES): Item[] {
	return cases.flatMap((c) =>
		c.checkpoints.flatMap((cp) =>
			cp.targets.map((t) => ({
				key: `${c.id}${c.checkpoints.length > 1 ? `.${cp.name[0]}` : ""}:${t.tag}`,
				caseId: c.id,
				category: c.category,
				checkpoint: cp.name,
				at: cp.at,
				targetId: c.session.id(t.tag),
				target: t,
				c,
			})),
		),
	);
}
