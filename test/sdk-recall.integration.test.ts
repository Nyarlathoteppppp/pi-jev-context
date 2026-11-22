import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJevContext } from "../src/index.ts";

it("Pi SDK session startup restores originals before a recall tool executes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "jev-sdk-recall-"));
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
        const agentDir = join(cwd, "agent");
        const sm = SessionManager.inMemory(cwd);
        sm.appendCustomEntry("jev-context-original", { alias: "t1", toolCallId: "c1", tool: "bash", summary: "npm test", text: "AuthMiddleware region: au-southeast-2" });
        const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
        const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
            extensionFactories: [pi => { createJevContext(pi, { env: {}, settingsPath: join(cwd, "no-settings.json") }); }] });
        await resourceLoader.reload();
        const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(cwd, "models-cache"), refreshOnCreate: false, allowModelNetwork: false });
        const created = await createAgentSession({ cwd, agentDir, modelRuntime, resourceLoader, settingsManager, sessionManager: sm, tools: ["context_recall"], thinkingLevel: "off" });
        session = created.session;
        assert.deepEqual(created.extensionsResult.errors, []);
        await session.bindExtensions({});
        const before = JSON.stringify(session.messages);
        const tool = session.agent.state.tools.find(t => t.name === "context_recall");
        assert.ok(tool);
        const result = await tool.execute("recall", { query: "AuthMiddleware" }, undefined);
        assert.match(result.content.filter(c => c.type === "text").map(c => c.text).join("\n"), /AuthMiddleware region: au-southeast-2/);
        assert.equal(JSON.stringify(session.messages), before);
    } finally { session?.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});
