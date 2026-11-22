import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JevCall, Judge, Question } from "../src/jev.ts";
import { ORIGINAL } from "../src/index.ts";
import { setup } from "./harness.ts";

const output = (name: string) => Array.from({ length: 500 }, (_, i) => `${name} routine test output ${i} with stable padding`).join("\n");
function pendingJudge() {
    const requests: Array<{ resolve: (call: JevCall) => void; reject: (error: Error) => void; questions: Record<string, Question>; signal?: AbortSignal }> = [];
    const judge: Judge = {
        decide(_state, questions, _timeoutMs, signal) {
            return new Promise<JevCall>((resolve, reject) => { requests.push({ resolve, reject, questions, signal }); });
        },
    };
    return { judge, requests,
        complete(index: number) {
            const request = requests[index]!;
            request.resolve({ answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, key === "need"
                ? { type: "choice", choice: "specific_parts", probabilities: { specific_parts: 1 }, confidence: 1 }
                : { type: "noul", noul: 0 }])), ms: 1 });
        },
    };
}
describe("pending sieve lifecycle", () => {
    for (const event of ["session_start", "session_tree"]) it(`discards the pending decision on ${event} even if aliases are reused`, async () => {
        const pending = pendingJudge();
        const { pi, ext } = setup({ judge: pending.judge, config: { sieve: "on" } });
        const oldResult = pi.tool("bash", { command: "npm test" }, output("old-branch"));
        assert.equal(pending.requests.length, 1);
        pi.entries = [];
        await pi.emit(event);
        assert.equal(pending.requests[0]!.signal?.aborted, true);
        const newResult = pi.tool("bash", { command: "npm test" }, output("new-branch"));
        assert.equal(pending.requests.length, 2);
        pending.complete(1);
        assert.ok((await newResult).patch);
        pending.complete(0);
        assert.equal((await oldResult).patch, undefined);
        assert.equal(pi.entries.filter(entry => entry.customType === ORIGINAL).length, 1);
        assert.equal(pi.logs("sieve").length, 1);
        assert.equal(ext.originals.size, 1);
        assert.equal(ext.originals.get("t1")?.text, output("new-branch"));
    });
    for (const layer of ["sieve", "mode"]) it(`keeps full output after ${layer} is toggled while judging`, async () => {
        const pending = pendingJudge();
        const { pi, ext } = setup({ judge: pending.judge, config: { mode: "on" } });
        const result = pi.tool("bash", { command: "npm test" }, output("pending"));
        await pi.command(`/context ${layer} off`);
        assert.equal(pending.requests[0]!.signal?.aborted, true);
        await pi.command(`/context ${layer} on`);
        pending.complete(0);
        assert.equal((await result).patch, undefined);
        assert.equal(ext.originals.size, 0);
        assert.equal(pi.logs("sieve").length, 0);
    });
    it("never logs a stale judge error to another branch", async () => {
        const pending = pendingJudge();
        const { pi } = setup({ judge: pending.judge, config: { sieve: "on" } });
        const result = pi.tool("bash", { command: "npm test" }, output("old-branch"));
        pi.entries = [];
        await pi.emit("session_tree");
        pending.requests[0]!.reject(new Error("old request failed"));
        assert.equal((await result).patch, undefined);
        assert.equal(pi.logs("sieve").length, 0);
    });
    for (const cancel of ["agent abort", "session shutdown"]) it(`ignores a late result after ${cancel}`, async () => {
        const pending = pendingJudge();
        const { pi, ext } = setup({ judge: pending.judge, config: { sieve: "on" } });
        const controller = new AbortController();
        pi.signal = controller.signal;
        const result = pi.tool("bash", { command: "npm test" }, output("cancelled"));
        assert.equal(pending.requests[0]!.signal?.aborted, false);
        if (cancel === "agent abort") controller.abort();
        else await pi.emit("session_shutdown");
        assert.equal(pending.requests[0]!.signal?.aborted, true);
        pending.complete(0);
        assert.equal((await result).patch, undefined);
        assert.equal(ext.originals.size, 0);
        assert.equal(pi.logs("sieve").length, 0);
    });
});
