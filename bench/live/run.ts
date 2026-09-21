// Live benchmark: real pi, a real model, real repos. The extension is switched off and on for the same
// task, and the outcome is read from the file system, never from what the model says.
//
//   PI_JEV_ENV_FILE=~/.env node bench/live/run.ts --reps 3 --model antigravity/gemini-3.8-flash
//   node bench/live/run.ts --only S1 --reps 1
//
// Other Jev extensions are switched off per run so they cannot influence the result.

import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SCENARIOS } from "./scenarios.ts";

/** Absolute path, so a transient PATH lookup failure cannot abort the benchmark. */
const PI_BIN = process.env.PI_BIN ?? "/opt/homebrew/bin/pi";

const { values } = parseArgs({
	options: {
		reps: { type: "string", default: "3" },
		model: { type: "string", default: "antigravity/gemini-3.8-flash" },
		only: { type: "string" },
		timeout: { type: "string", default: "300" },
		out: { type: "string", default: "results/live.json" },
		root: { type: "string" },
	},
});

const reps = Number(values.reps);
const timeoutMs = Number(values.timeout) * 1000;
const root = values.root ?? mkdtempSync(join(tmpdir(), "jctx-live-"));
const scenarios = SCENARIOS.filter((s) => !values.only || values.only.split(",").includes(s.id));
console.log(`root ${root}\nmodel ${values.model}\nscenarios ${scenarios.map((s) => s.id).join(",")} × ${reps} reps × [off, on]`);

interface Run {
	scenario: string;
	condition: "off" | "on";
	rep: number;
	passed: boolean;
	detail: string;
	seconds: number;
	timedOut: boolean;
	llmCalls: number;
	inputTokens: number;
	cacheReadTokens: number;
	toolResultTokens: number;
	acted: number;
	savedTokens: number;
	recalls: number;
	jevCost: number;
	output?: string;
}

function pi(dir: string, prompt: string, condition: "off" | "on"): Promise<{ seconds: number; timedOut: boolean; output: string }> {
	const started = Date.now();
	return new Promise((resolve) => {
		// stdin must be closed: with an open pipe pi waits for input and never runs the prompt.
		const child = spawn(PI_BIN, ["-p", "-a", "--model", values.model!, "--session-dir", join(dir, ".session"), prompt], {
			cwd: dir,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PI_JEV_CONTEXT_MODE: condition, PI_HEED_MODE: "off" },
		});
		let output = "";
		child.on("error", (e) => {
			output += `\n[runner] could not start pi: ${e}`;
			clearTimeout(timer);
			resolve({ seconds: Math.round((Date.now() - started) / 1000), timedOut: false, output });
		});
		child.stdout.on("data", (d) => (output += d));
		child.stderr.on("data", (d) => (output += d));
		let timedOut = false;
		// biome-ignore lint: declared before use by the error handler above
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);
		child.on("close", () => {
			clearTimeout(timer);
			resolve({ seconds: Math.round((Date.now() - started) / 1000), timedOut, output: output.slice(-2000) });
		});
	});
}

/** Everything measurable about one finished session, read back from its transcript. */
function inspect(dir: string) {
	const out = { llmCalls: 0, inputTokens: 0, cacheReadTokens: 0, toolResultTokens: 0, acted: 0, savedTokens: 0, recalls: 0, jevCost: 0 };
	let files: string[] = [];
	try {
		files = readdirSync(join(dir, ".session")).filter((f) => f.endsWith(".jsonl"));
	} catch {
		return out;
	}
	for (const f of files) {
		for (const line of readFileSync(join(dir, ".session", f), "utf8").split("\n")) {
			if (!line) continue;
			let e: any;
			try {
				e = JSON.parse(line);
			} catch {
				continue;
			}
			if (e.type === "custom" && e.customType === "jev-context") {
				const d = e.data ?? {};
				if ((d.kind === "seen" || d.kind === "trim") && d.acted) {
					out.acted++;
					out.savedTokens += Math.max(0, (d.from ?? 0) - (d.to ?? 0));
				}
				if (d.kind === "recall") out.recalls++;
				out.jevCost += d.cost ?? 0;
				continue;
			}
			const m = e.type === "message" ? e.message : undefined;
			if (!m) continue;
			if (m.role === "assistant" && m.usage) {
				out.llmCalls++;
				out.inputTokens += m.usage.input ?? 0;
				out.cacheReadTokens += m.usage.cacheRead ?? 0;
			}
			if (m.role === "toolResult") out.toolResultTokens += Math.ceil((m.content ?? []).map((c: any) => c.text ?? "").join("\n").length / 4);
		}
	}
	return out;
}

const runs: Run[] = [];
for (const s of scenarios) {
	for (let rep = 1; rep <= reps; rep++) {
		for (const condition of ["off", "on"] as const) {
			const dir = join(root, `${s.id}-${condition}-${rep}`);
			rmSync(dir, { recursive: true, force: true });
			mkdirSync(dir, { recursive: true });
			s.setup(dir);
			const { seconds, timedOut, output } = await pi(dir, s.prompt, condition);
			const [passed, detail] = s.score(dir);
			const stats = inspect(dir);
			runs.push({ scenario: s.id, condition, rep, passed, detail, seconds, timedOut, ...stats, output });
			console.log(
				`${s.id} ${condition.padEnd(3)} rep${rep}  ${passed ? "PASS" : timedOut ? "TIMEOUT" : "FAIL"}  ${seconds}s  calls=${stats.llmCalls} toolTok=${stats.toolResultTokens} rewrites=${stats.acted} saved=${stats.savedTokens} recalls=${stats.recalls}  ${detail}`,
			);
			mkdirSync("results", { recursive: true });
			writeFileSync(values.out!, JSON.stringify({ model: values.model, reps, runs }, null, 1));
		}
	}
}

const sum = (rs: Run[], k: keyof Run) => rs.reduce((a, r) => a + (r[k] as number), 0);
console.log("\n| scenario | condition | passed | tool tokens | rewrites | tokens saved | recalls | median s |");
console.log("|---|---|---|---|---|---|---|---|");
for (const s of scenarios) {
	for (const condition of ["off", "on"] as const) {
		const rs = runs.filter((r) => r.scenario === s.id && r.condition === condition);
		if (!rs.length) continue;
		const secs = rs.map((r) => r.seconds).sort((a, b) => a - b);
		console.log(
			`| ${s.id} | ${condition} | ${rs.filter((r) => r.passed).length}/${rs.length} | ${sum(rs, "toolResultTokens")} | ${sum(rs, "acted")} | ${sum(rs, "savedTokens")} | ${sum(rs, "recalls")} | ${secs[Math.floor(secs.length / 2)]} |`,
		);
	}
}
const off = runs.filter((r) => r.condition === "off");
const on = runs.filter((r) => r.condition === "on");
console.log(`\ntotal: off ${off.filter((r) => r.passed).length}/${off.length} passed, ${sum(off, "toolResultTokens")} tool tokens · on ${on.filter((r) => r.passed).length}/${on.length} passed, ${sum(on, "toolResultTokens")} tool tokens, ${sum(on, "recalls")} recalls`);
console.log(`results: ${values.out}`);
