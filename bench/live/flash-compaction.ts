// Isolated native compaction transport probe; never changes global settings.
import { SessionManager } from "./runtime.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { isolatedSession } from "./runtime.ts";
const sm = SessionManager.inMemory();
sm.appendMessage({ role: "user", content: "Implement a queue. Preserve retry limit 7, use region au-southeast-2, never change public API enqueue(job).", timestamp: Date.now() });
for (let i = 0; i < 12; i++) {
 sm.appendMessage({ role: "user", content: `Inspection ${i}: ` + "The queue processes jobs in FIFO order. ".repeat(120), timestamp: Date.now() });
}
sm.appendMessage({ role: "user", content: "Continue the queue implementation and preserve the earlier constraints.", timestamp: Date.now() });
const session = await isolatedSession(process.cwd(), sm);
const modelId = "antigravity/gemini-3.8-flash";
const start = Date.now();
try {
 const result = await session.compact();
 mkdirSync("results-private", { recursive: true });
 writeFileSync("results-private/flash-native-probe-antigravity.json", JSON.stringify({ model: modelId, ms: Date.now() - start, result }, null, 2));
 console.log(JSON.stringify({ model: modelId, ms: Date.now() - start, summaryChars: result.summary.length, retained: ["7", "au-southeast-2", "enqueue"].map(s => result.summary.includes(s)) }));
} finally { session.dispose(); }
