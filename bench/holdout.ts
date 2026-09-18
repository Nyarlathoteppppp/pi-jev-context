import { Session } from "./builder.ts";
import { type Case, end, T } from "./cases.ts";

// HELD-OUT GROUND TRUTH. Written after run-q1 and after freezing GUARD in src/policy.ts, committed before
// any Jev call on these items. Targets the weak spots found in run-q1: durable facts that are temporarily
// irrelevant (must not be dropped) and durable-looking outputs that really are obsolete (should be dropped).

function h01(): Case {
	const s = new Session(101)
		.user("The date picker test fails on my machine. Fix it.")
		.bash("node -v", "v20.11.1", { tag: "old" })
		.bash("nvm use 22", "Now using node v22.9.0 (npm v10.8.3)")
		.bash("node -v", "v22.9.0")
		.bash("npx vitest run src/ui/DatePicker.test.tsx", " FAIL  src/ui/DatePicker.test.tsx > opens on focus\nTypeError: Cannot read properties of null (reading 'focus')\n ❯ src/ui/DatePicker.tsx:31:18", { error: true })
		.read("src/ui/DatePicker.tsx", "export function DatePicker() {\n  const ref = useRef<HTMLInputElement>(null);\n  useEffect(() => ref.current!.focus(), []);\n  return <input ref={ref} />;\n}\n")
		.filler(4, "ui");
	return { id: "H01", category: "durable-looking but superseded", title: "Old node -v, superseded by nvm switch and a newer node -v", session: s, checkpoints: end(s, [T("old", "DROP", ["TRUNCATE"], false, "The Node version changed; the later node -v is the current fact.")]) };
}

function h02(): Case {
	const schema = "model Order {\n  id        String   @id @default(cuid())\n  total     Int\n  /// one of: pending | paid | refunded | cancelled\n  status    String   @default(\"pending\")\n  refundedAt DateTime?\n  createdAt DateTime @default(now())\n}\n\nmodel Customer {\n  id    String @id @default(cuid())\n  email String @unique\n}\n";
	const s = new Session(102)
		.user("Make the orders table in the admin UI sortable by date.")
		.read("prisma/schema.prisma", schema, { tag: "schema" })
		.filler(8, "ui")
		.bash("npx playwright test e2e/admin-orders.spec.ts", "  3 passed (4.2s)")
		.user("Thanks. Now make the rows zebra-striped.")
		.filler(4, "ui");
	const a = s.at;
	s.user("Next: add a Refund button on each order row that marks the order as refunded in the database.");
	return {
		id: "H02",
		category: "temporarily irrelevant",
		title: "Prisma schema read during a UI task; later the task needs the status values",
		session: s,
		checkpoints: [
			{ name: "A: before goal change", at: a, targets: [T("schema", "TRUNCATE", ["KEEP"], true, "Data model facts (status values, refundedAt) are durable and needed later.")] },
			{ name: "B: after goal change", at: s.at, targets: [T("schema", "KEEP", ["TRUNCATE"], true, "The refund button must set status=\"refunded\" and refundedAt.")] },
		],
	};
}

function h03(): Case {
	const s = new Session(103)
		.user("Add request logging middleware to the API server.")
		.read("src/server/config.ts", "export const config = {\n  port: Number(process.env.PORT ?? 3000),\n  cors: {\n    allowedOrigins: [\"https://app.acme.dev\", \"http://localhost:5173\"],\n    credentials: true,\n  },\n  logLevel: process.env.LOG_LEVEL ?? \"info\",\n};\n", { tag: "cfg" })
		.edit("src/server/index.ts", "app.use(cors(config.cors));", "app.use(cors(config.cors));\napp.use(requestLogger(config.logLevel));")
		.filler(8, "api")
		.user("The staging frontend at https://staging.acme.dev now gets CORS errors on every request. Why?");
	return { id: "H03", category: "temporarily irrelevant", title: "Server config read for logging; later a CORS question it answers", session: s, checkpoints: end(s, [T("cfg", "KEEP", ["TRUNCATE"], true, "allowedOrigins lacks the staging origin: the answer.")]) };
}

function h04(): Case {
	const s = new Session(104)
		.user("We get 'Invalid hook call' warnings. Check whether React is installed twice.")
		.bash("npm ls react", "acme-app@1.4.0 /home/dev/acme-app\n├─┬ @acme/legacy-modal@2.1.0\n│ └── react@17.0.2\n├─┬ @tanstack/react-query@5.59.0\n│ └── react@18.3.1 deduped\n└── react@18.3.1", { tag: "ls" })
		.edit("package.json", "\"@acme/legacy-modal\": \"^2.1.0\"", "\"@acme/legacy-modal\": \"^3.0.0\"")
		.bash("pnpm install", "Packages: -1 +1\nDone in 3.1s")
		.bash("npm ls react", "acme-app@1.4.0 /home/dev/acme-app\n├─┬ @acme/legacy-modal@3.0.0\n│ └── react@18.3.1 deduped\n└── react@18.3.1")
		.user("Great, fixed. Now update the CONTRIBUTING guide to mention the new lint rules.")
		.filler(5, "docs");
	return { id: "H04", category: "durable-looking but superseded", title: "Duplicate-React dependency tree, fixed and re-checked, task moved to docs", session: s, checkpoints: end(s, [T("ls", "DROP", ["TRUNCATE"], false, "Problem fixed; a newer npm ls shows the current tree.")]) };
}

function h05(): Case {
	const s = new Session(105)
		.user("Fix the flaky cart total rounding bug.")
		.bash("git log --oneline -8", "a91f3c2 cart: show shipping line\n7c2e0b1 i18n: add de-DE\n3d4f5a6 ui: dark mode toggle\n9e8d7c6 api: paginate orders\n5b4a3c2 db: orderRepo pagination\n1a2b3c4 chore: bump vite\n0f9e8d7 auth: idle timeout fix\n6c5b4a3 docs: usage", { tag: "log" })
		.read("src/cart/totals.ts", "export function totals(cart: Cart) {\n  const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);\n  const tax = subtotal * cart.taxRate;\n  return { subtotal, tax, total: subtotal + tax };\n}\n")
		.edit("src/cart/totals.ts", "const tax = subtotal * cart.taxRate;", "const tax = Math.round(subtotal * cart.taxRate);")
		.bash("npx vitest run src/cart", " ✓ src/cart/totals.test.ts (6 tests) 5ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)")
		.filler(6, "api")
		.user("Also add a regression test for 0.1 + 0.2 style rounding.");
	return { id: "H05", category: "stale orientation", title: "Orientation git log at start, never used", session: s, checkpoints: end(s, [T("log", "DROP", ["TRUNCATE"], false, "Orientation only; nothing in it bears on the rounding work.")]) };
}

function h06(): Case {
	const s = new Session(106)
		.user("Emails with non-ASCII subjects arrive garbled. Find out why.")
		.bash("node scripts/send-test-mail.js --subject 'Grüße'", "SMTP > Subject: Grüße\nSMTP < 250 OK\nraw header written: Subject: GrÃ¼Ãe\nnote: header not RFC 2047 encoded (mailer.encodeHeaders=false in config/mail.json)", { tag: "root" })
		.say("The subject header is sent raw because encodeHeaders is disabled in config/mail.json; that is the likely root cause.")
		.filler(7, "api")
		.filler(5, "docs")
		.user("Before changing anything, list the evidence for your root cause.");
	return { id: "H06", category: "old but critical", title: "Root-cause output, already summarized by the assistant, user asks for the evidence", session: s, checkpoints: end(s, [T("root", "KEEP", ["TRUNCATE"], true, "The user asks for the evidence; the raw output is it.")]) };
}

function h07(): Case {
	const lint = "> acme-app@1.4.0 lint\n> eslint .\n\n/home/dev/acme-app/src/api/orders.ts\n  41:5  error  Unexpected console statement  no-console\n\n✖ 1 problem (1 error, 0 warnings)";
	const s = new Session(107)
		.user("Make lint pass without disabling rules.")
		.bash("npm run lint", lint, { tag: "l1", error: true })
		.edit("src/api/orders.ts", "console.log(order)", "logger.debug(order)")
		.bash("npm run lint", lint, { tag: "l2", error: true })
		.read("src/api/orders.ts", "import { logger } from \"../lib/logger\";\n// …\n  41 |     console.log(\"order\", order.id); // second call\n")
		.user("Still failing, keep going.");
	return {
		id: "H07",
		category: "repeated failure",
		title: "Identical lint failure twice, unresolved",
		session: s,
		checkpoints: end(s, [
			T("l1", "DROP", ["TRUNCATE"], false, "Identical to the newer failure."),
			T("l2", "KEEP", ["TRUNCATE"], true, "Current unresolved error."),
		]),
	};
}

function h08(): Case {
	const out: string[] = ["Lockfile is up to date, resolution step is skipped", "Progress: resolved 1, reused 0, downloaded 0, added 0"];
	for (let i = 0; i < 230; i++) out.push(`Progress: resolved ${i * 3}, reused ${i * 3}, downloaded 0, added ${i}`);
	out.push(" WARN  Issues with peer dependencies found", ".", "└─┬ @acme/legacy-modal 2.1.0", "  └── ✕ unmet peer react@\"^17.0.0\": found 18.3.1");
	out.push("", "dependencies:", "+ react 18.3.1", "+ @acme/legacy-modal 2.1.0", "", "Done in 12.4s");
	const s = new Session(108)
		.user("pnpm install prints a peer dependency warning. What is it about?")
		.bash("pnpm install --reporter=append-only", out.join("\n"), { tag: "log" })
		.filler(3, "docs");
	return { id: "H08", category: "very long log (one key line)", title: "~240-line install log, one peer-dependency warning is the answer", session: s, checkpoints: end(s, [T("log", "TRUNCATE", [], true, "Only the peer warning lines matter.", ["unmet peer", "legacy-modal"])]) };
}

function h09(): Case {
	const s = new Session(109)
		.user("Speed up the orders list query.")
		.bash("npx vitest run src/db", " ✓ src/db/orderRepo.test.ts (9 tests) 41ms\n\n Test Files  1 passed (1)\n      Tests  9 passed (9)", { tag: "pass" })
		.edit("src/db/orderRepo.ts", "findMany({ take: opts.limit })", "findMany({ take: opts.limit, select: listFields })")
		.bash("npx vitest run src/db", " ✓ src/db/orderRepo.test.ts (9 tests) 38ms\n\n Test Files  1 passed (1)\n      Tests  9 passed (9)")
		.user("Good. Now completely different: translate the settings page to German.")
		.filler(6, "ui");
	return { id: "H09", category: "old passing result", title: "Old passing test run, re-run later, task changed", session: s, checkpoints: end(s, [T("pass", "DROP", [], false, "Superseded by a later identical run; unrelated to the new task.")]) };
}

function h10(): Case {
	const s = new Session(110)
		.user("Start the local stack with docker compose and note which host ports each service uses; we'll need them for the README later.")
		.bash("docker compose ps", "NAME       SERVICE   STATUS    PORTS\nacme-db    db        running   0.0.0.0:55432->5432/tcp\nacme-redis redis     running   0.0.0.0:6380->6379/tcp\nacme-api   api       running   0.0.0.0:3001->3000/tcp\nacme-web   web       running   0.0.0.0:5173->5173/tcp", { tag: "ps" })
		.filler(6, "api")
		.filler(4, "ui")
		.user("OK, now write the 'Running locally' section of the README.");
	return { id: "H10", category: "user-requested evidence", title: "User asked to note the ports for later; now the README needs them", session: s, checkpoints: end(s, [T("ps", "KEEP", ["TRUNCATE"], true, "Non-default host ports (55432, 6380, 3001) go into the README.")]) };
}

function h11(): Case {
	const s = new Session(111)
		.user("帮我把首页的轮播图换成静态 banner。")
		.read(".env.example", "DATABASE_URL=postgres://acme:acme@localhost:55432/acme\nREDIS_URL=redis://localhost:6380\nSESSION_SECRET=change-me\n", { tag: "env" })
		.filler(8, "ui")
		.user("好了。另外本地 Redis 连不上，报 ECONNREFUSED 127.0.0.1:6379，为什么？");
	return { id: "H11", category: "temporarily irrelevant (Chinese)", title: ".env.example with non-default Redis port; later a Redis connection error", session: s, checkpoints: end(s, [T("env", "KEEP", ["TRUNCATE"], true, "REDIS_URL uses 6380, the error shows 6379: the answer.")]) };
}

function h12(): Case {
	const s = new Session(112)
		.user("Remove the old v1 checkout code; everything uses v2 now.")
		.read("src/checkout/v1/legacyCheckout.ts", "export function legacyCheckout(cart: Cart) {\n  // v1 flow, replaced by src/checkout/v2\n  return fetch(\"/api/v1/checkout\", { method: \"POST\", body: JSON.stringify(cart) });\n}\n", { tag: "read" })
		.bash("git grep -n legacyCheckout -- ':!src/checkout/v1'", "")
		.bash("git rm -r src/checkout/v1", "rm 'src/checkout/v1/legacyCheckout.ts'")
		.bash("npx tsc --noEmit -p .", "")
		.user("Done? Then add an analytics event when v2 checkout completes.")
		.filler(5, "api");
	return { id: "H12", category: "deleted file", title: "Read of a file that was then deleted", session: s, checkpoints: end(s, [T("read", "DROP", [], false, "The file no longer exists and the task moved on.")]) };
}

function h13(): Case {
	const s = new Session(113)
		.user("Rename fetchUser to loadUser everywhere.")
		.tool("grep", { pattern: "fetchUser", path: "src" }, "src/auth/useSession.ts:12:  const u = await fetchUser(id);\nsrc/profile/ProfilePage.tsx:8:import { fetchUser } from \"../api/users\";\nsrc/api/users.ts:4:export async function fetchUser(id: string) {", { tag: "grep" })
		.edit("src/api/users.ts", "export async function fetchUser", "export async function loadUser")
		.edit("src/auth/useSession.ts", "fetchUser(id)", "loadUser(id)")
		.edit("src/profile/ProfilePage.tsx", "import { fetchUser }", "import { loadUser }")
		.bash("npx tsc --noEmit -p .", "")
		.user("Now add a 60-second in-memory cache to loadUser.");
	return { id: "H13", category: "superseded search", title: "grep for a symbol that was renamed everywhere afterwards", session: s, checkpoints: end(s, [T("grep", "DROP", ["TRUNCATE"], false, "Rename done and type-checked; loadUser lives in src/api/users.ts which the edits show.")]) };
}

function h14(): Case {
	const s = new Session(114)
		.user("Run all the tests.")
		.bash("npx playwright test", "  ✘ e2e/checkout.spec.ts:44:3 › pays with saved card (timeout 30000ms exceeded)\n  38 passed, 1 failed (1.2m)", { tag: "flaky", error: true })
		.bash("npx vitest run", " Test Files  2 failed | 36 passed (38)\n      Tests  3 failed | 398 passed (401)", { error: true })
		.user("Ignore the checkout e2e, it's a known flaky test tracked elsewhere. Focus on the unit test failures.")
		.filler(6, "api");
	return { id: "H14", category: "user-dismissed evidence", title: "Flaky e2e failure the user explicitly said to ignore", session: s, checkpoints: end(s, [T("flaky", "DROP", ["TRUNCATE"], false, "User ruled it out of scope.")]) };
}

export const HOLDOUT: Case[] = [h01, h02, h03, h04, h05, h06, h07, h08, h09, h10, h11, h12, h13, h14].map((f) => f());
