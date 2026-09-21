import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJevContext, contextMessages } from "../src/index.ts";
import { DEFAULT_SEEN, matchingRuns, planCollapse } from "../src/seen.ts";
import type { Message } from "../src/types.ts";
import { setup, FakePi } from "./harness.ts";
const lines = Array.from({ length: 300 }, (_, i) => `line${i + 1}: const result${i + 1} = calculate(${i + 1});`);
const text = lines.slice(0, 200).join("\n");
const read = (body = text, offset = 1, id = "c1"): Message[] => [
 { role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: { path: "a.ts", offset } }] },
 { role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: body }], isError: false },
];
const fresh = (body = text, offset = 1) => ({ toolCallId: "c2", toolName: "read", input: { path: "a.ts", offset }, text: body, isError: false });

describe("position-aware read dedupe", () => {
 it("matches overlapping ranges and labels absolute file positions", () => {
  const c = planCollapse(read(), fresh(lines.slice(100).join("\n"), 101), "t1")!;
  assert.equal(c.collapsedLines, 100);
  assert.match(c.text, /file lines 101-200 unchanged/);
  assert.match(c.text, /Folded 100\/200 file lines matching read c1 still in context/);
  assert.ok(c.text.includes(lines[250]!));
 });
 it("does not confuse identical blocks at different positions or shifted content", () => {
  assert.equal(planCollapse(read(), fresh(text, 301), "t1"), undefined);
  assert.deepEqual(matchingRuns(["new", ...lines], lines, 30), []);
 });
 it("keeps edited lines and nonmatching ranges verbatim", () => {
  const changed = [...lines.slice(0, 200)]; changed[100] = "CHANGED VALUE";
  const c = planCollapse(read(), fresh(changed.join("\n")), "t1")!;
  assert.ok(c.text.includes("CHANGED VALUE"));
  assert.equal(c.collapsedLines, 199);
  assert.equal(planCollapse(read(text), fresh(lines.slice(200).join("\n"), 201), "t1"), undefined);
 });
 it("preserves Pi continuation notices and excludes them from file lines", () => {
  const footer = "\n\n[100 more lines in file. Use offset=201 to continue.]";
  const c = planCollapse(read(text + footer), fresh(text + footer), "t1")!;
  assert.equal(c.totalLines, 200); assert.ok(c.text.endsWith(footer));
 });
 it("does not use folded output, errors, other paths or short runs", () => {
  const c = planCollapse(read(), fresh(), "t1")!;
  assert.equal(planCollapse(read(c.text), fresh(), "t2"), undefined);
  assert.equal(planCollapse(read(), { ...fresh(), isError: true }, "t1"), undefined);
  assert.equal(planCollapse(read(), { ...fresh(), input: { path: "b.ts" } }, "t1"), undefined);
  assert.equal(planCollapse(read(), fresh(lines.slice(0, 20).join("\n")), "t1"), undefined);
  assert.equal(planCollapse([], fresh(), "t1"), undefined);
 });
});

describe("MVP lifecycle", () => {
 it("rewrites only incoming reads, persists originals, supports recall and reports dedupe", async () => {
  const { pi } = setup();
  await pi.tool("read", { path: "a.ts" }, text);
  const before = JSON.stringify(pi.entries);
  const n = pi.entries.length;
  const result = await pi.tool("read", { path: "a.ts" }, text);
  assert.ok(result.patch);
  assert.equal(JSON.stringify(pi.entries.slice(0, n)), before);
  const alias = pi.logs("seen")[0].alias;
  assert.equal((await pi.recall({ id: alias })).split("\n").slice(1).join("\n"), text);
  assert.deepEqual((await pi.recall({ id: alias, offset: 101, limit: 2 })).split("\n").slice(1), lines.slice(100, 102));
  await pi.command("/context report"); assert.match(pi.notes.at(-1)!, /Collapsed: 1 reads/);
  assert.equal(await pi.emit("context", { messages: [] }), undefined);
  assert.deepEqual(pi.sent, []);
 });
 it("shadow and off do not alter output", async () => {
  for (const mode of ["shadow", "off"] as const) {
   const { pi } = setup({ config: { mode } });
   await pi.tool("read", { path: "a.ts" }, text);
   assert.equal((await pi.tool("read", { path: "a.ts" }, text)).patch, undefined);
   assert.equal(pi.logs("seen").length, mode === "shadow" ? 1 : 0);
  }
 });
 it("does not start external judgments or handle old pruning events", async () => {
  const { pi } = setup();
  assert.deepEqual([...pi.handlers.keys()].sort(), ["session_start", "session_tree", "tool_result"]);
  assert.equal((await pi.tool("bash", { command: "test" }, text)).patch, undefined);
 });
 it("rebuilds recall and statistics on resume and clears them on session switch", async () => {
  const { pi } = setup();
  await pi.tool("read", { path: "a.ts" }, text);
  await pi.tool("read", { path: "a.ts" }, text);
  const alias = pi.logs("seen")[0].alias;
  const resumed = new FakePi(); resumed.entries = structuredClone(pi.entries);
  createJevContext(resumed.api(), { env: {}, settingsPath: "/nonexistent" });
  await resumed.emit("session_start");
  assert.equal((await resumed.recall({ id: alias })).split("\n").slice(1).join("\n"), text);
  assert.match(resumed.status!, /1 trimmed/);
  resumed.entries = []; await resumed.emit("session_start");
  assert.match(await resumed.recall({ id: alias }), /No shortened output/);
 });
 it("uses Pi's actual compaction boundary, ignoring originals outside it", () => {
  const sm = SessionManager.inMemory();
  for (const m of read()) sm.appendMessage(m as any);
  const tail = sm.appendMessage({ role: "user", content: "continue", timestamp: Date.now() });
  sm.appendCompaction("Earlier file reviewed", tail, 10000);
  const messages = contextMessages({ sessionManager: sm } as any);
  assert.equal(planCollapse(messages, fresh(), "t1"), undefined);
 });
 it("does not remember results absent from the current context during the same run", async () => {
  const { pi } = setup();
  await pi.emit("agent_start");
  await pi.tool("read", { path: "a.ts" }, text);
  pi.entries = [];
  assert.equal((await pi.tool("read", { path: "a.ts" }, text)).patch, undefined);
 });
});
