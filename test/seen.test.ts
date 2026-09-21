import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJevContext, contextMessages, dedupeContextMessages } from "../src/index.ts";
import { DEFAULT_SEEN, earlierReads, matchingRuns, planCollapse } from "../src/seen.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "../src/types.ts";
import { setup, FakePi } from "./harness.ts";
const lines = Array.from({ length: 300 }, (_, i) => `line${i + 1}: const result${i + 1} = calculate(${i + 1});`);
const text = lines.slice(0, 200).join("\n");
const read = (body = text, offset = 1, id = "c1"): Message[] => [
 { role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: { path: "a.ts", offset } }] },
 { role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: body }], isError: false },
];
const fresh = (body = text, offset = 1) => ({ toolCallId: "c2", toolName: "read", input: { path: "a.ts", offset }, text: body, isError: false });
const filler = (tokens: number) => "x".repeat(tokens * 4);
const rangeText = (from: number, to: number) => lines.slice(from - 1, to).join("\n");

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
 it("uses only same-task reads inside the freshness token window", async () => {
  const { pi } = setup();
  await pi.tool("read", { path: "a.ts" }, text);
  await pi.tool("bash", { command: "echo filler" }, filler(5_000));
  assert.ok((await pi.tool("read", { path: "a.ts" }, text)).patch, "5k tokens in the same task should remain fresh");

  const stale = setup();
  await stale.pi.tool("read", { path: "a.ts" }, text);
  await stale.pi.tool("bash", { command: "echo filler" }, filler(DEFAULT_SEEN.dedupeMaxAgeTokens + 1));
  assert.equal((await stale.pi.tool("read", { path: "a.ts" }, text)).patch, undefined, "past the age window must refresh fully");

  const newTask = setup();
  await newTask.pi.tool("read", { path: "a.ts" }, text);
  newTask.pi.user("Start a different task.");
  assert.equal((await newTask.pi.tool("read", { path: "a.ts" }, text)).patch, undefined, "a new user turn makes prior reads stale");
 });
 it("selects the most recent exact copy and refreshes it into a fresh source", async () => {
  const { pi } = setup();
  await pi.tool("read", { path: "a.ts" }, text);
  await pi.tool("bash", { command: "echo old-distance" }, filler(30_000));
  const recent = await pi.tool("read", { path: "a.ts" }, text);
  assert.equal(recent.patch, undefined);
  await pi.tool("bash", { command: "echo recent-distance" }, filler(3_000));
  const final = await pi.tool("read", { path: "a.ts" }, text);
  assert.ok(final.patch);
  assert.match(final.text, new RegExp(`matching read ${recent.id} still in context`));

  const refreshed = await pi.tool("read", { path: "a.ts" }, text);
  assert.ok(refreshed.patch, "the recent source remains fresh for an immediate follow-up");
 });
 it("uses only the fresh partial overlap, never stale ranges to fill it", async () => {
  const { pi } = setup();
  await pi.tool("read", { path: "a.ts", offset: 50 }, rangeText(50, 150));
  await pi.tool("bash", { command: "echo stale" }, filler(DEFAULT_SEEN.dedupeMaxAgeTokens + 1));
  await pi.tool("read", { path: "a.ts", offset: 80 }, rangeText(80, 130));
  await pi.tool("bash", { command: "echo recent" }, filler(3_000));
  const result = await pi.tool("read", { path: "a.ts", offset: 50 }, rangeText(50, 150));
  assert.ok(result.patch);
  assert.match(result.text, /file lines 80-130 unchanged/);
  assert.ok(result.text.includes("line50:"));
  assert.ok(result.text.includes("line150:"));
  assert.ok(!result.text.includes("file lines 50-79 unchanged"));
 });
 it("rebuilds freshness from the active branch and compaction context only", () => {
  const sm = SessionManager.inMemory();
  for (const message of read()) sm.appendMessage(message as any);
  const sourceResult = sm.getBranch().at(-1)!;
  assert.ok(sourceResult.parentId);
  sm.branch(sourceResult.parentId);
  const branchMessages = contextMessages({ sessionManager: sm } as any);
  assert.equal(planCollapse(branchMessages, fresh(), "t1"), undefined);

  const compacted = SessionManager.inMemory();
  for (const message of read()) compacted.appendMessage(message as any);
  const kept = compacted.appendMessage({ role: "assistant", content: [{ type: "text", text: "The source was reviewed." }] } as any);
  compacted.appendCompaction("Earlier file reviewed", kept, 10_000);
  assert.equal(planCollapse(contextMessages({ sessionManager: compacted } as any), fresh(), "t1"), undefined);
 });
 it("includes the exact age limit, excludes one token beyond it, and supports zero", () => {
  for (const age of [0, 11999, 12000, 12001]) {
   const messages: Message[] = [...read(), { role: "assistant", content: [{ type: "text", text: filler(age) }] }];
   assert.equal(!!planCollapse(messages, fresh(), "t"), age <= 12000);
   if (age <= 12000) assert.equal(earlierReads(messages, "a.ts", "c2")[0]!.ageTokens, age);
  }
  assert.ok(planCollapse(read(), fresh(), "t", { ...DEFAULT_SEEN, dedupeMaxAgeTokens: 0 }));
  const withArgs: Message[] = [...read(), { role: "assistant", content: [{ type: "toolCall", id: "c2", name: "read", arguments: { path: "a.ts" } }] }];
  assert.equal(planCollapse(withArgs, fresh(), "t", { ...DEFAULT_SEEN, dedupeMaxAgeTokens: 0 }), undefined);
 });
 it("chooses the latest of two fresh sources without widening a partial match", () => {
  const messages = [...read(text, 1, "older"), ...read(rangeText(80, 130), 80, "newer")];
  const c = planCollapse(messages, fresh(rangeText(50, 150), 50), "t")!;
  assert.match(c.text, /matching read newer still in context/);
  assert.equal(c.collapsedLines, 51);
  assert.ok(c.text.includes("line50:"));
  assert.ok(c.text.includes("line150:"));
 });
 it("does not let folded results renew source age", () => {
  const original = read();
  const folded = planCollapse(original, fresh(), "t")!;
  const messages: Message[] = [...original, { role: "assistant", content: [{ type: "text", text: filler(12001) }] }, ...read(folded.text, 1, "folded")];
  assert.equal(planCollapse(messages, { ...fresh(), toolCallId: "c3" }, "t2"), undefined);
 });
 it("restores fresh and stale evidence from a resumed active branch", () => {
  const sm = SessionManager.inMemory();
  for (const message of read()) sm.appendMessage(message as any);
  const freshLeaf = sm.getLeafId()!;
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: filler(12001) }] } as any);
  const staleLeaf = sm.getLeafId()!;
  const resumed = SessionManager.inMemory(sm.getCwd(), undefined, structuredClone(sm.getEntries()));
  for (const [leaf, expected] of [[freshLeaf, true], [staleLeaf, false]] as const) {
   resumed.branch(leaf);
   assert.equal(!!planCollapse(dedupeContextMessages({ sessionManager: resumed } as any), fresh(), "t"), expected);
  }
  resumed.branch(freshLeaf);
  resumed.appendCompaction("summary", freshLeaf, 10000);
  // A retained result whose tool call was compacted away is not usable evidence.
  assert.equal(planCollapse(dedupeContextMessages({ sessionManager: resumed } as any), fresh(), "t"), undefined);
 });
 it("fails safe at unmodeled visible context while ignoring plain custom storage", () => {
  for (const entry of [
   { type: "custom_message", content: filler(13000), display: false },
   { type: "message", message: { role: "bashExecution", output: filler(13000) } },
   { type: "branch_summary", summary: filler(13000) },
  ]) {
   const entries = [...read().map(message => ({ type: "message", message })), entry];
   const ctx = { sessionManager: { buildContextEntries: () => entries } } as any;
   assert.equal(planCollapse(dedupeContextMessages(ctx), fresh(), "t"), undefined);
   // v0.5 sieve projection remains unchanged.
   assert.equal(contextMessages(ctx).length, 2);
  }
  const entries = [...read().map(message => ({ type: "message", message })), { type: "custom", customType: "jev-context-original", data: { text: filler(13000) } }];
  assert.ok(planCollapse(dedupeContextMessages({ sessionManager: { buildContextEntries: () => entries } } as any), fresh(), "t"));
 });
 it("resolves age options over environment over file and rejects explicit null", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-v06-config-"));
  const settingsPath = join(dir, "settings.json");
  try {
   writeFileSync(settingsPath, JSON.stringify({ dedupeMaxAgeTokens: 50000 }));
   assert.equal(setup({ settingsPath }).ext.config.dedupeMaxAgeTokens, 50000);
   assert.equal(setup({ settingsPath, env: { PI_JEV_CONTEXT_DEDUPE_MAX_AGE_TOKENS: "6000" } }).ext.config.dedupeMaxAgeTokens, 6000);
   assert.equal(setup({ settingsPath, env: { PI_JEV_CONTEXT_DEDUPE_MAX_AGE_TOKENS: "6000" }, config: { dedupeMaxAgeTokens: 1000 } }).ext.config.dedupeMaxAgeTokens, 1000);
   for (const invalid of [null, undefined, NaN, -1, "1000"]) {
    assert.equal(setup({ settingsPath, config: { dedupeMaxAgeTokens: invalid as any } }).ext.config.dedupeMaxAgeTokens, 12000);
   }
   for (const invalid of ["", " ", "NaN", "Infinity", "1.5", "-1"]) {
    assert.equal(setup({ settingsPath, env: { PI_JEV_CONTEXT_DEDUPE_MAX_AGE_TOKENS: invalid } }).ext.config.dedupeMaxAgeTokens, 12000);
   }
   writeFileSync(settingsPath, JSON.stringify({ dedupeMaxAgeTokens: "50000" }));
   assert.equal(setup({ settingsPath }).ext.config.dedupeMaxAgeTokens, 12000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
 });
 it("rejects invalid freshness ages without making dedupe more aggressive", () => {
  for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "1000", null, true]) {
   const { ext } = setup({ config: { dedupeMaxAgeTokens: value as any } });
   assert.equal(ext.config.dedupeMaxAgeTokens, DEFAULT_SEEN.dedupeMaxAgeTokens);
   assert.equal(ext.config.seen.dedupeMaxAgeTokens, DEFAULT_SEEN.dedupeMaxAgeTokens);
  }
  assert.equal(setup({ config: { dedupeMaxAgeTokens: 0 } }).ext.config.dedupeMaxAgeTokens, 0);
  assert.equal(setup({ env: { PI_JEV_CONTEXT_DEDUPE_MAX_AGE_TOKENS: "5000" } }).ext.config.dedupeMaxAgeTokens, 5000);
  assert.equal(setup({ env: { PI_JEV_CONTEXT_DEDUPE_MAX_AGE_TOKENS: "-1" } }).ext.config.dedupeMaxAgeTokens, DEFAULT_SEEN.dedupeMaxAgeTokens);
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
