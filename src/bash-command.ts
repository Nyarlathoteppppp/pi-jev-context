/** Recognize literal shell wrappers without evaluating shell code or substitutions. */
type Token = { kind: "word" | "and" | "merge"; value: string; assignment?: boolean };
function lex(command: string): Token[] | undefined {
    const tokens: Token[] = [];
    let i = 0;
    while (i < command.length) {
        if (/[ \t]/.test(command[i]!)) { i++; continue; }
        if (command.startsWith("&&", i)) { tokens.push({ kind: "and", value: "&&" }); i += 2; continue; }
        if (command.startsWith("2>&1", i) && (i + 4 === command.length || /[ \t]/.test(command[i + 4]!))) {
            tokens.push({ kind: "merge", value: "2>&1" }); i += 4; continue;
        }
        const start = i;
        let value = "", quote = "";
        while (i < command.length) {
            const c = command[i]!;
            if (quote === "'") { if (c === "'") quote = ""; else value += c; i++; continue; }
            if (quote === '"') {
                if (c === '"') { quote = ""; i++; continue; }
                if (c === "$" || c === "`" || c === "\n" || c === "\r") return;
                if (c === "\\") {
                    const next = command[i + 1];
                    if (!next) return;
                    if ('"\\$`'.includes(next)) { value += next; i += 2; continue; }
                }
                value += c; i++; continue;
            }
            if (/[ \t]/.test(c) || command.startsWith("&&", i)) break;
            if (";|&<>()$`\n\r".includes(c) || (c === "#" && i === start)) return;
            if (c === "'" || c === '"') { quote = c; i++; continue; }
            if (c === "\\") {
                const next = command[++i];
                if (!next || /[\n\r]/.test(next)) return;
                value += next; i++; continue;
            }
            value += c; i++;
        }
        if (quote || i === start) return;
        tokens.push({ kind: "word", value, assignment: /^[A-Za-z_]\w*=/.test(command.slice(start, i)) });
    }
    return tokens;
}
export function literalCommandArgs(command: string): string[] | undefined {
    let tokens = lex(command.trim());
    if (!tokens?.length) return;
    if (tokens[0]!.kind === "word" && tokens[0]!.value === "cd") {
        let n = 1;
        if (tokens[n]?.value === "--") n++;
        const path = tokens[n];
        if (path?.kind !== "word" || !path.value || path.value.startsWith("-") || tokens[n + 1]?.kind !== "and") return;
        tokens = tokens.slice(n + 2);
    }
    if (tokens.some(t => t.kind === "and")) return;
    // Only a trailing stderr merge is supported. Other redirects can replace or
    // suppress the observed output; pipelines can truncate it before Pi sees it.
    if (tokens.at(-1)?.kind === "merge") tokens = tokens.slice(0, -1);
    if (tokens.some(t => t.kind !== "word")) return;
    while (tokens[0]?.assignment) tokens = tokens.slice(1);
    if (tokens[0]?.value === "env") tokens = tokens.slice(1);
    while (tokens[0]?.assignment) tokens = tokens.slice(1);
    if (!tokens.length) return;
    return tokens.map(t => t.value);
}
