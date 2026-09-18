import type { Message } from "../src/types.ts";

/** Small DSL for synthetic pi sessions in pi-ai message shapes. */
export class Session {
	readonly messages: Message[] = [];
	private readonly tags = new Map<string, string>();
	private seq = 0;
	private rng: () => number;

	constructor(seed = 1) {
		let s = seed >>> 0 || 1;
		this.rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
	}

	user(text: string): this {
		this.messages.push({ role: "user", content: text });
		return this;
	}

	say(text: string): this {
		this.messages.push({ role: "assistant", content: [{ type: "text", text }] });
		return this;
	}

	/** One assistant tool call plus its result. `tag` names it for ground truth. */
	tool(name: string, args: Record<string, unknown>, output: string, opts: { tag?: string; error?: boolean; say?: string } = {}): this {
		const id = `call_${++this.seq}`;
		const content: any[] = opts.say ? [{ type: "text", text: opts.say }] : [];
		content.push({ type: "toolCall", id, name, arguments: args });
		this.messages.push({ role: "assistant", content });
		this.messages.push({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: output }], isError: !!opts.error });
		if (opts.tag) this.tags.set(opts.tag, id);
		return this;
	}

	bash(command: string, output: string, opts: { tag?: string; error?: boolean; say?: string } = {}): this {
		return this.tool("bash", { command }, output, opts);
	}

	read(path: string, output: string, opts: { tag?: string; say?: string } = {}): this {
		return this.tool("read", { path }, output, opts);
	}

	edit(path: string, oldText: string, newText: string, opts: { tag?: string; say?: string } = {}): this {
		return this.tool("edit", { path, oldText, newText }, `Successfully replaced text in ${path}.`, opts);
	}

	id(tag: string): string {
		const id = this.tags.get(tag);
		if (!id) throw new Error(`unknown tag ${tag}`);
		return id;
	}

	/** Message count now: a checkpoint cut. */
	get at(): number {
		return this.messages.length;
	}

	pick<T>(xs: T[]): T {
		return xs[Math.floor(this.rng() * xs.length)]!;
	}

	/** `n` plausible tool calls unrelated to anything tagged: reads, greps, small edits, passing checks. */
	filler(n: number, area: FillerArea = "ui"): this {
		const pool = FILLER[area];
		for (let i = 0; i < n; i++) {
			const f = pool[i % pool.length]!;
			this.tool(f.name, f.args, f.output);
		}
		return this;
	}
}

export type FillerArea = "ui" | "api" | "docs" | "auth";

type F = { name: string; args: Record<string, unknown>; output: string };

const tsFile = (name: string, body: string) => body.replace(/^\n/, "").replace(/__NAME__/g, name);

const FILLER: Record<FillerArea, F[]> = {
	ui: [
		{ name: "read", args: { path: "src/ui/Button.tsx" }, output: tsFile("Button", `\nimport { cn } from "../lib/cn";\n\nexport interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {\n  variant?: "primary" | "ghost";\n}\n\nexport function Button({ variant = "primary", className, ...rest }: ButtonProps) {\n  return <button className={cn("btn", \`btn-\${variant}\`, className)} {...rest} />;\n}\n`) },
		{ name: "grep", args: { pattern: "variant=", path: "src/ui" }, output: "src/ui/Dialog.tsx:31:      <Button variant=\"ghost\" onClick={onClose}>Cancel</Button>\nsrc/ui/Toolbar.tsx:12:  <Button variant=\"primary\">Save</Button>" },
		{ name: "edit", args: { path: "src/ui/Toolbar.tsx", oldText: "gap-2", newText: "gap-3" }, output: "Successfully replaced text in src/ui/Toolbar.tsx." },
		{ name: "read", args: { path: "src/ui/Toolbar.tsx" }, output: "import { Button } from \"./Button\";\n\nexport function Toolbar() {\n  return (\n    <div className=\"flex gap-3\">\n      <Button variant=\"primary\">Save</Button>\n    </div>\n  );\n}\n" },
		{ name: "bash", args: { command: "npx tsc --noEmit -p ." }, output: "" },
		{ name: "grep", args: { pattern: "className=\"flex", path: "src/ui" }, output: "src/ui/Toolbar.tsx:5:    <div className=\"flex gap-3\">\nsrc/ui/Card.tsx:8:    <div className=\"flex flex-col\">" },
		{ name: "read", args: { path: "src/ui/Card.tsx" }, output: "export function Card({ children }: { children: React.ReactNode }) {\n  return (\n    <div className=\"card\">\n      <div className=\"flex flex-col\">{children}</div>\n    </div>\n  );\n}\n" },
		{ name: "edit", args: { path: "src/ui/Card.tsx", oldText: "card\"", newText: "card rounded-lg\"" }, output: "Successfully replaced text in src/ui/Card.tsx." },
	],
	api: [
		{ name: "read", args: { path: "src/api/routes.ts" }, output: "import { Router } from \"express\";\nimport { listOrders, getOrder } from \"./orders\";\n\nexport const router = Router();\nrouter.get(\"/orders\", listOrders);\nrouter.get(\"/orders/:id\", getOrder);\n" },
		{ name: "grep", args: { pattern: "getOrder", path: "src" }, output: "src/api/routes.ts:2:import { listOrders, getOrder } from \"./orders\";\nsrc/api/routes.ts:6:router.get(\"/orders/:id\", getOrder);\nsrc/api/orders.ts:14:export async function getOrder(req: Request, res: Response) {" },
		{ name: "read", args: { path: "src/api/orders.ts" }, output: "import type { Request, Response } from \"express\";\nimport { orderRepo } from \"../db/orderRepo\";\n\nexport async function listOrders(req: Request, res: Response) {\n  res.json(await orderRepo.list({ limit: 50 }));\n}\n\n// GET /orders/:id\n\n\n\nexport async function getOrder(req: Request, res: Response) {\n  const order = await orderRepo.byId(req.params.id);\n  if (!order) return res.status(404).end();\n  res.json(order);\n}\n" },
		{ name: "edit", args: { path: "src/api/orders.ts", oldText: "limit: 50", newText: "limit: Number(req.query.limit ?? 50)" }, output: "Successfully replaced text in src/api/orders.ts." },
		{ name: "bash", args: { command: "npx tsc --noEmit -p ." }, output: "" },
		{ name: "grep", args: { pattern: "orderRepo.list", path: "src" }, output: "src/api/orders.ts:5:  res.json(await orderRepo.list({ limit: Number(req.query.limit ?? 50) }));" },
		{ name: "read", args: { path: "src/db/orderRepo.ts" }, output: "export const orderRepo = {\n  list: (opts: { limit: number }) => db.order.findMany({ take: opts.limit }),\n  byId: (id: string) => db.order.findUnique({ where: { id } }),\n};\n" },
		{ name: "bash", args: { command: "curl -s localhost:3000/orders?limit=2 | head -c 200" }, output: "[{\"id\":\"o_1\",\"total\":4200},{\"id\":\"o_2\",\"total\":1250}]" },
	],
	docs: [
		{ name: "read", args: { path: "docs/CONTRIBUTING.md" }, output: "# Contributing\n\n1. Fork and branch from main.\n2. Run `npm run lint` before pushing.\n3. Keep PRs small.\n" },
		{ name: "edit", args: { path: "README.md", oldText: "## Usage", newText: "## Usage\n\nSee docs/usage.md." }, output: "Successfully replaced text in README.md." },
		{ name: "read", args: { path: "docs/usage.md" }, output: "# Usage\n\nStart the dev server with `npm run dev` and open http://localhost:3000.\n" },
		{ name: "edit", args: { path: "docs/usage.md", oldText: "open http://localhost:3000.", newText: "open http://localhost:3000.\n\n## Environment\n\nCopy .env.example to .env." }, output: "Successfully replaced text in docs/usage.md." },
		{ name: "grep", args: { pattern: "TODO", path: "docs" }, output: "docs/usage.md:3:<!-- TODO screenshots -->" },
		{ name: "bash", args: { command: "npx markdownlint docs README.md" }, output: "" },
	],
	auth: [
		{ name: "grep", args: { pattern: "useSession", path: "src" }, output: "src/ui/Header.tsx:4:import { useSession } from \"../auth/useSession\";\nsrc/ui/Header.tsx:9:  const { user } = useSession();\nsrc/auth/useSession.ts:6:export function useSession() {" },
		{ name: "read", args: { path: "src/ui/Header.tsx" }, output: "import { useSession } from \"../auth/useSession\";\n\nexport function Header() {\n  const { user } = useSession();\n  return <header>{user ? user.name : \"Sign in\"}</header>;\n}\n" },
		{ name: "bash", args: { command: "ls src/auth" }, output: "api.ts\ninterceptor.ts\nsession.ts\nstorage.ts\nuseSession.ts" },
		{ name: "read", args: { path: "src/auth/storage.ts" }, output: "const KEY = \"acme.tokens\";\nexport const storage = {\n  get: () => JSON.parse(localStorage.getItem(KEY) ?? \"null\"),\n  set: (t: unknown) => localStorage.setItem(KEY, JSON.stringify(t)),\n  clear: () => localStorage.removeItem(KEY),\n};\n" },
		{ name: "grep", args: { pattern: "storage.clear", path: "src" }, output: "src/auth/session.ts:41:    storage.clear();\nsrc/auth/interceptor.ts:88:      storage.clear();" },
		{ name: "bash", args: { command: "npx vitest run src/auth/storage.test.ts" }, output: " ✓ src/auth/storage.test.ts (3 tests) 4ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)" },
		{ name: "read", args: { path: "src/auth/api.ts" }, output: "export async function refreshTokens(refreshToken: string) {\n  const r = await fetch(\"/api/auth/refresh\", { method: \"POST\", body: JSON.stringify({ refreshToken }) });\n  if (!r.ok) throw new Error(`refresh failed: ${r.status}`);\n  return r.json();\n}\n" },
		{ name: "bash", args: { command: "git log --oneline -5 -- src/auth" }, output: "a1c9e02 auth: move token storage behind storage.ts\n7f0b3d1 auth: add interceptor retry\n5e2a8c4 auth: initial session hook" },
	],
};

// ---------------------------------------------------------------------------------------------
// Long outputs.

/** ~500-line vitest run: many passing files, a pile of deprecation warnings, and exactly two failures. */
export function longVitestLog(): string {
	const out: string[] = [" RUN  v2.1.8 /home/dev/acme-app", ""];
	const suites = ["cart", "orders", "catalog", "search", "profile", "billing", "i18n", "router", "forms", "hooks", "utils", "date"];
	let n = 0;
	for (let i = 0; i < 26; i++) {
		const s = suites[i % suites.length]!;
		out.push(` ✓ src/${s}/${s}${i}.test.ts (${8 + (i % 5)} tests) ${10 + i}ms`);
		for (let j = 0; j < 8 + (i % 5); j++) out.push(`   ✓ ${s} › case ${j + 1} handles input variant ${String.fromCharCode(97 + (j % 26))}`);
		if (i % 3 === 0) out.push(`(node:${4100 + i}) [DEP0040] DeprecationWarning: The \`punycode\` module is deprecated. Please use a userland alternative instead.`);
		if (i % 4 === 1) out.push(" stderr | src/" + s + "/" + s + i + ".test.ts > renders\n Warning: ReactDOM.render is no longer supported in React 18. Use createRoot instead.");
		n++;
	}
	out.push(" ❯ src/auth/auth.test.ts (6 tests | 2 failed) 88ms");
	out.push("   ✓ auth › logs in with valid credentials");
	out.push("   × auth › refreshes an expired session");
	out.push("   × auth › retries the original request after refresh");
	out.push("   ✓ auth › logs out", "   ✓ auth › rejects bad password", "   ✓ auth › remembers me");
	for (let i = 0; i < 12; i++) out.push(` ✓ src/misc/misc${i}.test.ts (5 tests) ${5 + i}ms`);
	out.push("", "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯", "");
	out.push(" FAIL  src/auth/auth.test.ts > auth > refreshes an expired session");
	out.push("AssertionError: expected 401 to be 200 // Object.is equality");
	out.push("", "- Expected", "+ Received", "", "- 200", "+ 401", "");
	out.push(" ❯ src/auth/auth.test.ts:42:31");
	out.push("     40|     server.expireSession();", "     41|     const res = await client.get(\"/me\");", "     42|     expect(res.status).toBe(200);", "       |                               ^", "     43|   });");
	out.push("", "⎯⎯⎯⎯⎯⎯⎯[1/2]⎯", "");
	out.push(" FAIL  src/auth/auth.test.ts > auth > retries the original request after refresh");
	out.push("AssertionError: expected 1 to be 2 // Object.is equality");
	out.push(" ❯ src/auth/auth.test.ts:58:34");
	out.push("", "⎯⎯⎯⎯⎯⎯⎯[2/2]⎯", "");
	out.push(" Test Files  1 failed | 38 passed (39)");
	out.push("      Tests  2 failed | 402 passed (404)");
	out.push("   Start at  10:42:17", "   Duration  7.81s (transform 1.2s, setup 0ms, collect 3.4s, tests 2.1s)");
	// Pad with the verbose reporter's per-test timing table to reach ~500 lines.
	while (out.length < 500) out.push(`   ${suites[out.length % suites.length]} › timing ${out.length}: ${(out.length % 17) + 1}ms`);
	return out.join("\n");
}

/** ~400-line successful production build with chunk listings and warnings. */
export function longBuildLog(): string {
	const out: string[] = ["> acme-app@1.4.0 build", "> vite build", "", "vite v5.4.11 building for production...", "transforming..."];
	for (let i = 0; i < 360; i++) {
		if (i % 45 === 0) out.push(`(!) src/ui/icons/Icon${i}.tsx: Module level directives cause errors when bundled, "use client" was ignored.`);
		out.push(`dist/assets/chunk-${(i * 2654435761 >>> 0).toString(16).slice(0, 8)}.js   ${(3 + (i % 40) * 1.7).toFixed(2)} kB │ gzip: ${(1 + (i % 40) * 0.6).toFixed(2)} kB`);
	}
	out.push("(!) Some chunks are larger than 500 kB after minification. Consider:");
	out.push("- Using dynamic import() to code-split the application");
	out.push("✓ 1843 modules transformed.");
	out.push("✓ built in 14.62s");
	return out.join("\n");
}

export function packageJson(): string {
	return JSON.stringify(
		{
			name: "acme-app",
			version: "1.4.0",
			private: true,
			type: "module",
			engines: { node: ">=22" },
			packageManager: "pnpm@9.12.0",
			scripts: { dev: "vite", build: "vite build", test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit" },
			dependencies: { react: "^18.3.1", "react-dom": "^18.3.1", zod: "^3.23.8", "@tanstack/react-query": "^5.59.0", express: "^4.21.1" },
			devDependencies: { vite: "^5.4.11", vitest: "^2.1.8", typescript: "^5.6.3", eslint: "^9.14.0", "@types/node": "^22.9.0" },
		},
		null,
		2,
	);
}
