# pi-jev-context

**Less noise. Original evidence within reach.**

A context extension for Pi that folds repeated reads, filters long command logs with Jev, and retrieves saved originals as searchable, verbatim chunks.

> [!IMPORTANT]
> ## Model performance first. Token savings second.
>
> **Keep uncertain evidence. Protect the cache prefix. Stop on capability regressions.**
>
> Only transform incoming results—never rewrite old messages or change tool declarations when toggling modes. Recall is an escape hatch, not proof of losslessness.

| Capability | What it does |
|---|---|
| **Deterministic dedupe** | Folds exact repeated file lines only while the source remains fresh and visible. |
| **Active Jev sieve** | Filters eligible command logs with hard KEEP rules; judgment and persistence failures preserve the original output. |
| **Searchable recall** | Finds original chunks by keyword, with source ids, line ranges, and a retrieval budget. |

Independent switches. Branch-local originals. Pi-native compaction.

### v0.7.1: common command forms and clearer recall

The same log policy now recognizes literal wrappers such as
`cd "my repo" && CI=1 npm test 2>&1`, `env CI=1 pnpm test`, and
`npx --no-install vitest run`. Common script names such as `test:unit` and
`build:production` remain supported. Parsing identifies the executable and subcommand;
a test name inside another command's arguments is not enough. Commands are never
rewritten or evaluated by the parser. Pipelines, command substitutions and mixed
command sequences still pass through unchanged.

Recall distinguishes an empty store, an unknown id, zero keyword matches, partial
identifier matches, and a chunk that does not fit the budget. It shows available
source ids when useful and points to exact line retrieval. Missing lexical matches
still do not prove a historical fact is absent. See
[v0.7.1 measurements and limits](docs/V0.7.1_FOLLOW_UP.md).

## Install

```sh
pi install git:github.com/Nyarlathoteppppp/pi-jev-context
```

Reload an existing Pi session with `/reload`. Default mode is `on`.

```text
/context report
/context mode off
/context mode shadow
/context mode on
/context dedupe on
/context sieve off
/context sieve on
/context recalls
/context label good
/context label bad incorrect location
```

`/context report` also shows the active deterministic freshness window.

### Independent configuration

At startup, each layer resolves independently:
**`options.config` > environment > settings file > compatibility `mode`.**
Environment switches are `PI_JEV_CONTEXT_DEDUPE` and `PI_JEV_CONTEXT_SIEVE`;
the settings file is `~/.pi/agent/pi-jev-context.json`:

```json
{ "dedupe": "on", "sieve": "off", "dedupeMaxAgeTokens": 12000 }
```

`/context dedupe on|off` and `/context sieve on|off` are explicit session overrides,
persisted in `jev-context-config` and restored from the active branch on reload or
tree navigation. They override startup values. `/context mode` only changes layers
without an explicit setting; **it is not a master switch**. To disable both layers,
set both to `off` explicitly. Tool declarations remain unchanged.

For old mode-only sessions: `off` disables both, `on` enables both, and `shadow`
logs dedupe candidates without rewriting (sieve off). Explicit `dedupe=on` acts even
under `mode=shadow`. The default compatibility mode is `on`.

Numeric options (also accepted in the settings file) default to `jevThreshold=0.10`,
`minHiddenShare=0.30`, `minSavedTokens=1000`, and `dedupeMaxAgeTokens=12000`.
Corresponding environment variables are `PI_JEV_CONTEXT_JEV_THRESHOLD`,
`PI_JEV_CONTEXT_MIN_HIDDEN_SHARE`, `PI_JEV_CONTEXT_MIN_SAVED_TOKENS`, and
`PI_JEV_CONTEXT_DEDUPE_MAX_AGE_TOKENS`. Threshold/share must be finite numbers in [0,1];
saved tokens must be finite nonnegative numbers within the safe integer range, and dedupe age must be a finite safe nonnegative integer. Invalid values use
defaults. JSON/options strings are invalid; environment numeric strings are parsed, while
empty strings are invalid. The decision is strictly **`P(needed) < jevThreshold`**, not
less-than-or-equal.

## Freshness-aware dedupe

A repeated read is eligible only when its exact source is still visible on the active
branch, has the same path and absolute line positions, belongs to the current latest
user-message task epoch, and is no more than `dedupeMaxAgeTokens` estimated tokens
behind the incoming read. The default age window is 12,000 estimated tokens. Any new
user message makes earlier reads stale, even when it is only a few tokens away.

When several exact copies exist, the newest eligible occurrence wins. A stale read is
passed through in full; that full result then becomes the new fresh source for later
reads. Exact matching is line-range based, so a fresh `80-130` source can fold only
that range from a later `50-150` read; stale ranges are not used to fill the rest.
Fork, compaction, and resume rebuild freshness from the active context only. No
semantic similarity, embedding, summary, or attention prediction is used.

The age is a deterministic estimated-token sum of modeled message content after the
source tool result and before the incoming read. It includes intervening user and
tool-result text, plus assistant text, thinking, and tool-call arguments, but not the
incoming read output itself. Visible custom messages, summaries, and unmodeled
message roles conservatively end prior read evidence rather than silently undercounting
age. Plain custom storage does not count and never supplies read evidence.
See [v0.6 freshness semantics](docs/V0.6_FRESHNESS.md) for exact boundaries and configuration precedence.

## Searchable historical recall (v0.7)

```js
context_recall({ query: "AuthMiddleware JWT", budget: 800 })
context_recall({ id: "t12", query: "JWT" })
context_recall({ id: "t12", offset: 120, limit: 80 })
```

Search reuses saved originals on the **active branch**. It returns ranked verbatim
chunks with original output line numbers and source ids. Matching is deterministic
keyword/identifier overlap with an exact-phrase bonus; partial keyword matches are
possible. No database, embeddings, summarizer, or Jev call is involved in recall.
For current file contents use Pi's native read/search tools; recalled outputs are historical.

Chunks target 24 lines and keep recognized contiguous stack regions together.
The default search budget is 800 estimated tokens for chunks and source headers;
the small navigation header is additional. Whole chunks that do not fit are not cut.
Follow the returned continuation, raise the budget, or request exact lines by id.
With a query, `offset` is a 1-based ranked chunk position; without a query it is a
1-based output line, and `limit` defaults to 2,000 lines. Omit query and paginate by
id to recover all saved text. An empty search does not prove a fact is absent.

Shortened outputs include counts, recall instructions, and up to six actual paths
or identifiers from hidden text when available. This hint is incomplete, not a
summary. Its overhead counts against the existing savings requirements. Original
storage and recall are escape hatches, **not proof of capability equivalence**.

## Fresh-output sieve

v0.7 also recognizes `python[3] -m pytest`, `cargo check`, `cargo clippy`,
`go build`, and `go vet`. Failed commands are eligible only when they contain
recognizable failure evidence and PASS lines. In such results only separate
PASS-only blocks can be hidden; all other blocks and the error status stay intact.
Existing hard KEEP, task overlap, strict probability threshold and benefit gates
still apply. Mixed shell pipelines and arbitrary commands remain outside scope.
Pi truncates very large logs before extension handling: already-truncated bash
results pass through, retaining Pi's full-output-file pointer. Recall restores the
original received by this extension, not bytes Pi never delivered.

**`sieve=on` means active Jev participation**, using the configured TypeSafe or
OpenRouter transport. It is not shadow logging. No key means unchanged output.

Only long, text-only `bash` results with an unambiguous test, build,
lint, typecheck/diagnostic, or explicit log command are eligible. Source viewers,
search/list commands, pipelines, read/edit/write results, unclassified errors, old context,
compaction, user/assistant messages, and history rewriting are excluded. Jev sees
complete structural blocks and answers relevance questions only; it does not write
summaries or visible replacement text. Deterministic guards retain failures,
warnings, complete common stack-trace regions (including cross-block frames),
diagnostics, summaries, task terms, and uncertain blocks. Rewrites save
the full original on the active branch and expose it through `context_recall`.
All Jev network/timeout, malformed-answer, parser, budget and original-persistence
failures return the full output without a replacement marker. Out-of-range Jev
probabilities are rejected, never clamped into a hide decision.
Recall is an escape hatch, not proof that hiding content preserves capability.

## Deterministic read dedupe


An incoming successful text-only `read` is compared with unshortened reads of the
same exact path string in Pi's current compaction-aware active branch context. Only
identical text at the same absolute file positions, within the current latest
user-message task epoch and freshness token window, can match. Reads shorter than 60
lines pass through; matching spans must contain at least 30 consecutive lines, and the
replacement must save at least 30% of estimated tokens.

A short header reports folded/total file lines; markers identify absolute file
lines and the earlier read's tool-call ID. Changed
and new lines remain verbatim. Pi continuation notices are retained separately.
Original output is stored in a custom session entry before replacement. The model
can call `context_recall` with the marker's ID; its optional offset/limit refer to
**original output lines**, not absolute file lines.

No old messages are rewritten and there is no context-rewriting hook. The recall
tool remains registered in every mode. This preserves earlier message bytes;
it is not a claim that provider cache hits or model behavior are guaranteed.

## Deliberate limits

- Read dedupe uses no in-memory sibling-read shortcut, disk hash cache, or Jev judgments.
- Folded outputs are not reused as matching evidence; stored originals are for
  recall only. Compacted-away source reads cannot authorize new collapses.
- Relative and absolute path aliases are not merged. Content shifted by insertion
  at another position is kept. Up to four recent eligible source reads are checked.
- A new user turn makes previous reads stale; the newest exact eligible source wins.
- Raw session context is the source of truth. Other extensions that independently
  remove/transform old context are outside this MVP's verified configuration.
- Recall restores the output Pi originally returned, not bytes Pi had already
  truncated. Original entries stay available on the active branch after compaction.
- Removing repeated text can change attention even when it is recoverable. The
  live checks are regression smoke tests, not proof of equal model capability.

## Verification

```sh
npm test
npm run typecheck
npm run bench
npm run test:archive
```

The current offline replay uses Pi's branch/compaction boundaries, feeds each
replacement into later decisions, and never sends session content externally.
On the v0.7 replay of 27 local sessions: 3,847 reads; 20 rewritten; approximately
13k tokens saved (0.5% of read tokens, 0.2% of all tool-result tokens) under the v0.6 freshness
window. Local sessions continue growing, so later replay counts can differ. The v0.5 replay baseline was 142 rewrites and approximately 103k tokens;
the reduction is expected because old and cross-user-turn copies no longer qualify.
These are character/4 estimates, not billed token savings. See `results/seen-v05-hardening.txt`
for the historical baseline and the v0.6 focused result for freshness-specific counts.

`bench/live/mvp.ts` is the historical v0.4 runner; it tests two scenarios with two
repetitions each, using the installed Pi SDK and Antigravity 3.8 Flash. It loads
only the provider and this extension, with no user project instructions or other
extensions. `bench/live/flash-compaction.ts` probes actual native compaction;
`bench/live/compaction-compare.ts` compares native and an explicit Wang checkout.
These scripts are local-machine experiment runners; their SDK/provider paths
are explicit. Private session inputs and summaries stay in gitignored
`results-private/`.

The v0.6 focused freshness benchmark is deterministic and makes no Jev or network calls:

```sh
node bench/live/v06-freshness.ts --out /tmp/live-v06-freshness-new.json
```

The runner asserts its expected decisions and refuses to overwrite an existing output
path; use a new path for repeat runs. The recorded run uses a 12,000-token age window and reports `14` reads, `4` fresh
dedupes, `1` stale refresh, `1` cross-user-turn prevented dedupe, `1` partial-overlap
dedupe, and approximately `6,166` estimated tokens saved. These are character/4
estimates, not billed token savings.

The v0.5 A/B/C runner uses plugin off, dedupe only, and dedupe plus active sieve:

```sh
node --test test/lifecycle.integration.test.ts
node bench/live/v05-hardening.ts --reps 1 --out results/live-v05-new.json
node bench/live/v05-hardening.ts --reps 1 --focused --scenarios multiple-failures,delayed-fact --out results/live-v05-focused-new.json
```

It refuses to overwrite an existing result file. Filesystem predicates are fixed
before calls. Failure-exit logs exercise full retention; multiple-failure diagnostics
exit zero deliberately to exercise the sieve; delayed-fact tasks require evidence
from a previous result. Synthetic fixtures and a small pilot cannot prove capability
equivalence. Lifecycle/fault injection use deterministic tests, not live model tasks.
The SessionManager tests use the installed Pi SDK with simulated event dispatch;
they do not claim full UI, AgentSession compaction or disk-I/O integration coverage.

## Experimental history

`bench/experimental/` holds sieve, Jev transport, and policy research.
`bench/archive/` holds the retired runtime/select/pruning experiments and their
integration tests. Neither directory is shipped in the extension package or
imported by its runtime. Old research results are retained in `docs/FINDINGS.md`;
new entries supersede unsafe claims rather than rewriting the historical record.


## Design acknowledgements

[Winnow](https://github.com/GhalebDweikat/winnow) informed the hidden-content
hints and contiguous omission markers. The recall chunker's paragraph boundary
rule adapts Winnow's MIT-licensed implementation; see
[third-party notices](THIRD_PARTY_NOTICES.md). Pi branch-local storage, deterministic
search, freshness rules and stack-region protection remain specific to this project.
We also reviewed [RTK](https://github.com/rtk-ai/rtk) for command-specific filtering
and [Anthropic's context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
for on-demand retrieval. Their compression ratios are not our capability evidence.

## v0.7 validation

```sh
node bench/live/v07-recall.ts --reps 2 --out results/live-v07-recall-new.json
node bench/live/v05-hardening.ts --reps 1 --focused --scenarios failure-exit --out results/live-v07-failure-new.json
node bench/output-profile.ts
```

The final synthetic recall comparison passed 18/18 tasks on Pi's
`antigravity/gemini-3.8-flash`: full originals, v0.6 id/line recall, and searchable
recall each passed 6/6. Search returned 2,268 estimated tokens versus 26,964 for
id/line recall, but took 49.6s versus 28.3s across six tasks. Absence checks required
more searches. These small fixtures do not prove capability equivalence or cache
benefits. See [v0.7 design](docs/V0.7_SEARCHABLE_RECALL.md) and
[measured limitations](docs/FINDINGS.md#f29--v07-searchable-recall-and-expanded-failure-logs-2026-09-22).
