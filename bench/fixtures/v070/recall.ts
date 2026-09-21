// Frozen v0.7.0 search baseline from commit 96371e2.
import { estimateTokens } from "../../../src/extract.ts";
import { stackTraceLines } from "../../../src/sieve.ts";

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
    const terms = words(query);
    if (!terms.length) return { text: "Provide a query containing words or identifiers, or an id with offset/limit for exact original lines.", hits: 0, returned: 0 };
    const hits = [...sources].flatMap(source => recallChunks(source.text).map(chunk => {
        const tokens = new Set(words(chunk.text));
        const matched = terms.filter(t => tokens.has(t)).length;
        const exact = chunk.text.toLowerCase().includes(query.toLowerCase());
        return { source, chunk, score: matched + (exact ? terms.length : 0) };
    })).filter(h => h.score > 0).sort((a,b) => b.score-a.score || a.source.alias.localeCompare(b.source.alias) || a.chunk.from-b.chunk.from);
    if (!hits.length) return { text: "No lexical matches in saved originals on this branch. This does not establish absence of the fact; try other keywords or retrieve original lines by id.", hits: 0, returned: 0 };
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
    const continuation = pending ? ` More: repeat query with offset ${next + 1}; increase budget if no chunk fits, or use id "${pending.source.alias}", offset ${pending.chunk.from}, limit ${pending.chunk.to-pending.chunk.from+1} for exact lines.` : "";
    return { text: `[context_recall search] ${parts.length}/${hits.length} matching chunks returned; ${used} estimated tokens of chunk content and source headers (budget ${budget}; this navigation header is additional). Results may be partial keyword matches.${continuation}\n${parts.join("\n\n")}`, hits: hits.length, returned: parts.length };
}
