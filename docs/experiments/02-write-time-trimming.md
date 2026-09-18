# Experiment 02: Cache-neutral write-time trimming

**Status:** done, shipped in v0.1 · **Result files:** `results/writetime-{q1-dev,w2-dev,w2-holdout,w3-dev,w3-holdout}.json` · **Findings:** F6–F10

## Why write time

Prompt caches match on prefixes. Rewriting a message that is already cached invalidates everything after it. Anthropic's own context editing warns about exactly this and adds `clear_at_least` so that each clearing is worth the invalidation. A long tool output that is shortened *before* it enters the context was never cached, so shortening it costs nothing in cache terms. That makes write time the one place where trimming is always cache-neutral.

What we trim:

- long outputs (≥ 150 lines) from bash, grep, find, ls, and custom or MCP tools.

What we never trim:

- `read`, `edit` and `write`;
- file or diff viewers such as `cat`, `git diff` and `sed`, because the agent needs their content verbatim the first time it sees it.

How it works:

- The original is kept losslessly in a session entry, which never reaches the model.
- The `context_recall` tool returns the original.

## Mechanism (`src/trim.ts`, `src/writetime.ts`)

1. Candidate units are built in code:
   - **line mode** for logs: error, failure and summary lines, ranked, deduplicated by shape, at most two per shape;
   - **block mode** for everything else: grep and find output grouped by file, then coarsened to directories until the groups fit; prose split by paragraph.
2. One Jev call asks one Choice about what the output is needed *for*, plus one Noul per unit and a Noul for "the user asked for the full output".
3. The output is trimmed only if all of these hold:
   - the need is `specific_parts` or `outcome_only`, with p ≥ 0.7 and confidence ≥ 0.6;
   - the user did not ask for the full output;
   - the result keeps at most 50% of the tokens.
4. What stays in context:
   - kept units, with ±2 lines of context in line mode;
   - the first 5 lines, the last 8 lines, and every summary line;
   - all of these verbatim, with `… [N lines omitted] …` markers and a header naming the recall id.

   The rendering is deterministic.
5. On any Jev failure or timeout (2.5 s), the output passes through unchanged.

## Results

13 dev cases (8 should be trimmed, 5 must stay whole) and 12 held-out cases (7 and 5), 5 repeats each. Held-out cases were committed before any Jev call on them.

| version | set | trimmed when it should | **false trims** | **key lines kept** | tokens saved | p50 / p95 |
|---|---|---|---|---|---|---|
| q1 (abstract KEEP/TRUNCATE/DROP) | dev | 50.0% | 0/25 | 90.0% | 30.4% | 331 / 446 ms |
| w2 (what is it needed for) | dev | 75.0% | 0/25 | 100% | 48.7% | 337 / 532 ms |
| w2 | **held-out** | **88.6%** | **0/25** | **100%** | 63.1% | 319 / 466 ms |
| w3 (backticked paths, one judgment per question) | dev | 75.0% | 0/25 | 100% | 48.7% | 350 / 576 ms |
| w3 (**adopted**) | **held-out** | 85.7% | **0/25** | **100%** | 61.4% | 359 / 563 ms |

Must-stay-whole cases, all kept whole in every run:

- grep for a repo-wide rename;
- "review every config field";
- a CSV to convert;
- "list every test name";
- a full file inventory;
- all TODOs into a checklist;
- git log for release notes;
- every feature-flag row (Chinese request);
- renaming every test file;
- SQL rows to export.

Missed trims, all on the safe side:

- W02 (`tsc`, 90 errors): Jev says `every_line`. Defensible, because fixing all 90 errors needs every `file:line`.
- W05 (successful build): p = 0.58, under the threshold.
- W19 (grep for `useEffect` while hunting a websocket): p = 0.67, under the threshold.

### End to end in real pi (0.85.1)

- 509-line failing test log: 5,115 → 421 tokens entered the context. The model answered the failing tests with `file:line` correctly. Jev took 587 ms and cost $0.000086.
- Six minutes later, a question about an omitted line: the model called `context_recall("t1")` on its own and answered correctly.

### Real-session census (offline)

- 20 local sessions, 8,741 tool results.
- Tool results are 96.3% of message-text tokens.
- Trim-eligible outputs are 4.2% of results but 26.8% of tool-result tokens (about 1.5 M).

## Conclusions

1. Write-time trimming is safe enough to ship behind a switch: 0 false trims and 100% key lines on held-out data, a lossless recall, and no cache cost.
2. Question design mattered more than thresholds. Asking what the output is for (w2) beat asking for an abstract category (q1). Backticked paths (w3) were neutral here.
3. The regex and block candidate generation is the component to watch. When candidates contain the key lines, Jev keeps them.
