import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { homedir } from "node:os";
import { join } from "node:path";
// SDK callers must perform the same HTTP initialization as Pi CLI (Node 26 + undici).
const http = await import(new URL("./core/http-dispatcher.js", "file:///opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js").href);
http.configureHttpDispatcher();
export async function isolatedSession(cwd: string, sm = SessionManager.inMemory(cwd), extensions: string[] = [], tools: string[] = [], keepRecentTokens = 1024) {
 const agentDir = join(homedir(), ".pi/agent");
 const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens }, retry: { enabled: false } });
 const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, additionalExtensionPaths: [join(agentDir, "npm/node_modules/pi-antigravity/src/index.ts"), ...extensions], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
 await resourceLoader.reload();
 const modelRuntime = await ModelRuntime.create();
 const { session, extensionsResult } = await createAgentSession({ cwd, modelRuntime, resourceLoader, settingsManager, sessionManager: sm, tools, thinkingLevel: "off" });
 if (extensionsResult.errors.length) throw new Error(JSON.stringify(extensionsResult.errors));
 const model = modelRuntime.getModel("antigravity", "gemini-3.8-flash");
 if (!model) throw new Error("antigravity/gemini-3.8-flash not registered");
 await session.setModel(model);
 return session;
}

export { SessionManager };
