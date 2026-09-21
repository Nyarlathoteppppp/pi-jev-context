// Live benchmark scenarios. Each one is a real repo with a task that forces the agent through the paths
// this extension touches: re-reading overlapping parts of a file, and long tool output.
//
// Design principle being tested: the model's ability comes first, saving tokens second. Every scenario is
// scored from the file system, never from what the model says.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Scenario {
	id: string;
	/** What the user asks. */
	prompt: string;
	/** Builds the repo. */
	setup: (dir: string) => void;
	/** Reads the result from disk. Returns [passed, detail]. */
	score: (dir: string) => [boolean, string];
	/** What the extension should do here, for reading the logs afterwards. */
	exercises: "reads" | "long output";
}

const write = (dir: string, rel: string, text: string) => {
	mkdirSync(join(dir, rel, ".."), { recursive: true });
	writeFileSync(join(dir, rel), text);
};
const read = (dir: string, rel: string) => {
	try {
		return readFileSync(join(dir, rel), "utf8");
	} catch {
		return "";
	}
};
const git = (dir: string, args: string[]) => {
	try {
		return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
	} catch {
		return "";
	}
};

/** A long module whose functions are spread over the file, so any real edit needs several reads. */
function pipeline(n: number): string {
	const out = ["// generated pipeline module", "import { compute } from './compute';", ""];
	for (let i = 1; i <= n; i++) {
		out.push(`export function step${i}(input: number): number {`);
		out.push(`  // step ${i} of the pipeline`);
		out.push(`  return compute(input) + ${i};`);
		out.push("}");
		out.push("");
	}
	return out.join("\n");
}

export const SCENARIOS: Scenario[] = [
	{
		id: "S4",
		exercises: "reads",
		// 650 steps ≈ 2,600 lines: past pi's 2,000-line read window, so the file can only be read in slices.
		prompt:
			"src/pipeline.ts is long. Three functions are wrong: step50, step330 and step610 must multiply by their step number instead of adding it (`compute(input) * 50` and so on). Fix exactly those three, and after each fix read that part of the file again to confirm the change landed. Change nothing else.",
		setup: (dir) => {
			write(dir, "src/compute.ts", "export const compute = (x: number) => x * 2;\n");
			write(dir, "src/pipeline.ts", pipeline(650));
			git(dir, ["init", "-q"]);
			git(dir, ["add", "-A"]);
			git(dir, ["-c", "user.email=b@b", "-c", "user.name=b", "commit", "-qm", "init"]);
		},
		score: (dir) => {
			const t = read(dir, "src/pipeline.ts");
			const want = [50, 330, 610].every((i) => new RegExp(`return compute\\(input\\) \\* ${i};`).test(t));
			const others = [...Array(650).keys()].map((k) => k + 1).filter((i) => ![50, 330, 610].includes(i));
			const intact = others.every((i) => t.includes(`return compute(input) + ${i};`));
			return [want && intact, `fixed=${want} others-intact=${intact}`];
		},
	},
	{
		id: "S1",
		exercises: "reads",
		prompt:
			"In src/pipeline.ts, three functions are wrong: step17, step58 and step91 must multiply by their step number instead of adding it (so `compute(input) * 17` and so on). Fix exactly those three and change nothing else.",
		setup: (dir) => {
			write(dir, "src/compute.ts", "export const compute = (x: number) => x * 2;\n");
			write(dir, "src/pipeline.ts", pipeline(100));
			git(dir, ["init", "-q"]);
			git(dir, ["add", "-A"]);
			git(dir, ["-c", "user.email=b@b", "-c", "user.name=b", "commit", "-qm", "init"]);
		},
		score: (dir) => {
			const t = read(dir, "src/pipeline.ts");
			const want = [17, 58, 91].every((i) => new RegExp(`return compute\\(input\\) \\* ${i};`).test(t));
			// Nothing else may have changed: every other step keeps its "+ i".
			const others = [...Array(100).keys()].map((k) => k + 1).filter((i) => ![17, 58, 91].includes(i));
			const intact = others.every((i) => t.includes(`return compute(input) + ${i};`));
			return [want && intact, `fixed=${want} others-intact=${intact}`];
		},
	},
	{
		id: "S2",
		exercises: "reads",
		prompt: "Rename the exported function `collectMetrics` to `gatherMetrics` everywhere in src/, including all call sites. Keep the behaviour identical.",
		setup: (dir) => {
			write(dir, "src/metrics.ts", `${pipeline(60)}\nexport function collectMetrics(values: number[]): number {\n  return values.reduce((a, b) => a + b, 0);\n}\n`);
			write(dir, "src/report.ts", `import { collectMetrics } from './metrics';\n\n${pipeline(40)}\nexport const report = (v: number[]) => collectMetrics(v).toFixed(2);\n`);
			write(dir, "src/summary.ts", `import { collectMetrics } from './metrics';\n\nexport const summary = (v: number[]) => 'total: ' + collectMetrics(v);\n`);
			git(dir, ["init", "-q"]);
			git(dir, ["add", "-A"]);
			git(dir, ["-c", "user.email=b@b", "-c", "user.name=b", "commit", "-qm", "init"]);
		},
		score: (dir) => {
			const files = ["src/metrics.ts", "src/report.ts", "src/summary.ts"].map((f) => read(dir, f));
			const noOld = files.every((t) => !t.includes("collectMetrics"));
			const renamed = files.filter((t) => t.includes("gatherMetrics")).length === 3;
			return [noOld && renamed, `old-gone=${noOld} all-three-renamed=${renamed}`];
		},
	},
	{
		id: "S3",
		exercises: "long output",
		prompt: "Run ./run-tests.sh with the bash tool. It fails. Fix the bug it reports in src/auth.ts, then run ./run-tests.sh again to confirm it passes.",
		setup: (dir) => {
			write(dir, "src/auth.ts", "export function statusFor(expired: boolean): number {\n  return expired ? 401 : 200;\n}\n\nexport function refresh(expired: boolean): number {\n  // BUG: a refreshed session must return 200\n  return statusFor(expired);\n}\n");
			const log: string[] = [" RUN  v2.1.8 test suite", ""];
			for (let i = 0; i < 120; i++) log.push(` ✓ src/misc/case${i}.test.ts (${4 + (i % 7)} tests) ${3 + i}ms`);
			log.push(" ❯ src/auth.test.ts (2 tests | 1 failed) 12ms", "   × auth › refresh returns 200 for an expired session");
			for (let i = 0; i < 120; i++) log.push(` ✓ src/other/case${i}.test.ts (${3 + (i % 5)} tests) ${2 + i}ms`);
			log.push("", "AssertionError: expected 401 to be 200", " ❯ src/auth.test.ts:9:31", "", "      Tests  1 failed | 806 passed (807)");
			write(dir, "fail.log", log.join("\n"));
			write(
				dir,
				"run-tests.sh",
				"#!/bin/sh\ncd \"$(dirname \"$0\")\"\nif grep -q 'return 200;' src/auth.ts; then\n  echo ' Test Files  2 passed (2)'\n  echo '      Tests  807 passed (807)'\n  exit 0\nfi\ncat fail.log\nexit 1\n",
			);
			execFileSync("chmod", ["+x", join(dir, "run-tests.sh")]);
			git(dir, ["init", "-q"]);
			git(dir, ["add", "-A"]);
			git(dir, ["-c", "user.email=b@b", "-c", "user.name=b", "commit", "-qm", "init"]);
		},
		score: (dir) => {
			const fixed = /return 200;/.test(read(dir, "src/auth.ts"));
			let passes = false;
			try {
				execFileSync(join(dir, "run-tests.sh"), [], { cwd: dir, encoding: "utf8" });
				passes = true;
			} catch {
				passes = false;
			}
			return [fixed && passes, `edited=${fixed} suite-passes=${passes}`];
		},
	},
];
