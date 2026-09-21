// Frozen v0.7.0 classifier from commit 96371e2.
const VIEWER = /(?:^|[\s;&|()'"`])(?:cat|bat|less|more|nl|sed|awk|jq|yq|xxd|od|head|tail|grep|rg|ripgrep|find|ls|fd|search|diff|git\s+(?:diff|show|blame|log\b))/i;
const PIPE = /\||`[^`]*`|\$\([^)]*\)/;
export type BashOutputKind = "test" | "build" | "lint" | "diagnostic" | "log";
export function classifyBashCommand(command: string): BashOutputKind | undefined {
    const c = command.trim().replace(/^cd\s+[\w./~-]+\s*&&\s*/, "").replace(/^python(?:3)?\s+-m\s+pytest\b/, "pytest");
    // Mixed commands can append source or unrelated evidence after a test log.
    // Accept a single known executable, optionally preceded by a simple cd.
    if (!c || VIEWER.test(c) || PIPE.test(c) || /[;&\n\r]/.test(c)) return undefined;
    if (!/^(?:npm|pnpm|yarn|bun|npx|jest|vitest|mocha|ava|pytest|tsc|eslint|biome|stylelint|cargo|go|mvn|gradle|webpack|vite|docker|kubectl|podman|journalctl)(?:\s|$)/i.test(c) && !/^\.\/[\w./-]*(?:test|tests)[\w./-]*(?:\s|$)/i.test(c)) return undefined;
    if (/^cargo\s+(?:check|clippy)\b/.test(c)) return "diagnostic";
    if (/^go\s+vet\b/.test(c)) return "diagnostic";
    if (/^go\s+build\b/.test(c)) return "build";
    if (/(?:^|[\s;&])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i.test(c) || /(?:^|[\s;&])(?:npx\s+)?(?:jest|vitest|mocha|ava|pytest)\b/i.test(c) || /(?:^|[\s;&])(?:cargo\s+test|go\s+test|mvn\s+test|gradle\s+test)\b/i.test(c)) return "test";
    if (/(?:^|[\s;&])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|eslint|clippy|stylelint|biome)\b/i.test(c) || /(?:^|[\s;&])(?:npx\s+)?(?:eslint|biome|stylelint)\b/i.test(c)) return "lint";
    if (/(?:^|[\s;&])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:typecheck|check)\b/i.test(c) || /(?:^|[\s;&])(?:npx\s+)?tsc\b/i.test(c)) return "diagnostic";
    if (/(?:^|[\s;&])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile)\b/i.test(c) || /(?:^|[\s;&])(?:npx\s+)?(?:webpack|vite\s+build)\b/i.test(c) || /(?:^|[\s;&])cargo\s+build\b/i.test(c)) return "build";
    if (/(?:^|[\s;&])(?:\.\/|[\w.-]+\/)[\w./-]*(?:test|tests)[\w./-]*(?:\s|$)/i.test(c)) return "test";
    if (/(?:^|[\s;&])(?:docker|kubectl|podman)\s+(?:compose\s+)?logs\b|(?:^|[\s;&])journalctl\b/i.test(c)) return "log";
    return undefined;
}
