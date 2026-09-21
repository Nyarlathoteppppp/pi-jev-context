import { estimateTokens } from "./extract.ts";
import { stackTraceLines } from "./sieve.ts";

export interface RecallSource { alias: string; summary: string; text: string; }
export interface Chunk { from: number; to: number; text: string; }
/** Line-based chunks; never split a recognized stack region to meet a budget. */
export function recallChunks(text: string): Chunk[] {
    const lines = text.split("\n"), protectedLines = stackTraceLines(lines), chunks: Chunk[] = [];
    for (let start = 0; start < lines.length;) {
        // Adapted from Winnow chunk.py (MIT, Ghaleb Dweikat): close at a
        // blank line once half full. See THIRD_PARTY_NOTICES.md.
        let end = Math.min(lines.length, start + 24);
        for (let i = start + 11; i < end; i++) {
            if (!lines[i]!.trim()) { end = i + 1; break; }
        }
        while (end < lines.length && protectedLines.has(end) && protectedLines.has(end - 1)) end++;
        chunks.push({ from: start + 1, to: end, text: lines.slice(start, end).join("\n") });
        start = end;
    }
    return chunks;
}
function words(text: string): string[] {
    return [...new Set(text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
}
export function searchOriginals(sources: Iterable<RecallSource>, query: string, budget = 800, offset = 1) {
    const originals = [...sources];
    const directory = originals.slice(-5).map(s => `${s.alias} (${s.text.split("\n").length} lines; ${s.summary})`).join("; ");
    const scope = `Searched ${originals.length} saved original(s) on this branch.`;
    const inspect = `For evidence beyond keyword matching, inspect original lines by id/offset/limit (default limit 2000). Available sources${originals.length > 5 ? " (last 5)" : ""}: ${directory}.`;
    if (!originals.length) return { text: "No saved originals on this branch. There is no historical store here to search; use current read/search tools for current state.", hits: 0, returned: 0 };
    const terms = words(query);
    if (!terms.length) return { text: "Provide a query containing words or identifiers, or an id with offset/limit for exact original lines.", hits: 0, returned: 0 };
    const present = new Set(originals.flatMap(s => words(s.text)));
    const missing = terms.filter(t => !present.has(t));
    const identifiers = [...new Set((query.match(/(?:\.{0,2}\/)?[A-Za-z_$][\w$./:-]*/g) ?? []).map(t => t.replace(/[.:/-]+$/, "")).filter(t => /[a-z][A-Z]|_|[/.]/.test(t)))];
    const missingIds = identifiers.filter(id => {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_$./-])${escaped}(?![\\p{L}\\p{N}_$./-])`, "iu");
        return !originals.some(source => pattern.test(source.text));
    });
    const coverage = `${missing.length ? ` Unmatched query terms: ${missing.join(", ")}.` : ""}${missingIds.length ? ` No exact identifier match: ${missingIds.join(", ")}.` : ""}`;
    const hits = originals.flatMap(source => recallChunks(source.text).map(chunk => {
        const tokens = new Set(words(chunk.text));
        const matched = terms.filter(t => tokens.has(t)).length;
        const exact = chunk.text.toLowerCase().includes(query.toLowerCase());
        return { source, chunk, score: matched + (exact ? terms.length : 0) };
    })).filter(h => h.score > 0).sort((a,b) => b.score-a.score || a.source.alias.localeCompare(b.source.alias) || a.chunk.from-b.chunk.from);
    if (!hits.length) return { text: `No lexical matches. ${scope}${coverage} This does not establish absence of the fact. ${inspect}`, hits: 0, returned: 0 };
    const first = offset - 1;
    const parts: string[] = [];
    let used = 0;
    for (const hit of hits.slice(first)) {
        const part = `[context_recall ${hit.source.alias}] Historical ${hit.source.summary}: output lines ${hit.chunk.from}-${hit.chunk.to}\n${hit.chunk.text}`;
        const tokens = estimateTokens(part);
        if (used + tokens > budget) break;
        parts.push(part); used += tokens;
    }
    const next = first + parts.length;
    const pending = hits[next];
    const continuation = pending ? ` More: repeat query with offset ${next + 1}; increase budget if no chunk fits, or use id "${pending.source.alias}", offset ${pending.chunk.from}, limit ${pending.chunk.to-pending.chunk.from+1} for exact lines.` : " No further ranked chunks for this query.";
    const partial = missing.length || missingIds.length;
    const guidance = partial ? ` Keyword matches below do not establish a match for the requested entity. ${inspect}` : "";
    return { text: `[context_recall search] ${scope}${coverage}${guidance} ${parts.length}/${hits.length} matching chunks returned; ${used} estimated tokens of chunk content and source headers (budget ${budget}; this navigation header is additional). Results may be partial keyword matches.${continuation}\n${parts.join("\n\n")}`, hits: hits.length, returned: parts.length };
}
