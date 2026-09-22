# Findings ledger

Append-only record of what the experiments established. Each entry states the question, the setup, the
result, the conclusion and where the evidence is. A later entry may supersede an earlier one; earlier
entries are never rewritten. Raw data lives in `results/`, full write-ups in `docs/experiments/`.

Model for the original Jev experiments (later entries specify their own models): `typesafe/jev-1.13-20260917` via OpenRouter `~typesafe/jev-latest`.

---

## F1 · Jev judges current relevance well (2026-09-19)

- **Question:** Can Jev decide KEEP / TRUNCATE / DROP for an old tool result?
- **Setup:** 53 labelled old tool results: 37 dev (26 synthetic sessions) and 16 held-out (14 sessions, labelled after the policy was frozen). 5 repeats each. Ground truth committed before each run (`e63bc2b`, `d6395f8`).
- **Result:** raw accuracy 87.0% on dev and 93.8% on held-out. KEEP recall 86.7% and 100%. When the goal changes and makes an old fact relevant again, Jev re-judges it as KEEP in 4 of 4 cases.
- **Conclusion:** For "is this still relevant to what we are doing now", Jev is accurate, stable and fast.
- **Evidence:** `results/run-q1.md`, `results/run-q1-holdout.md`, [experiment 01](experiments/01-old-context-pruning.md).

## F2 · Jev does not judge future value (2026-09-19)

- **Question:** Does Jev protect facts that are irrelevant now but needed later?
- **Result:** No. Raw Jev dropped 3 of 3 "durable but currently irrelevant" critical items: `package.json` engines (C05.A), `prisma --version` (C16) and `schema.prisma` (H02.A). The critical false-drop rate was 11.1% on dev and 12.5% on held-out.
- **Conclusion:** Jev alone must never make an irreversible DROP. Any real pruning needs deterministic protection plus a lossless recall path.

## F3 · A guard fitted to Jev's own signals did not generalise (2026-09-19)

- **Setup:** `guardedPolicy` (p(DROP) ≥ 0.8, confidence ≥ 0.7, needed_now/user_requested veto, durable ≥ 0.8 → TRUNCATE) was frozen after dev and then evaluated on held-out.
- **Result:** 0% critical false drops on dev (fitted), **7.5% on held-out**. H02.A passed every threshold (p = 0.80, c = 0.73, durable = 0.71).
- **Conclusion:** Thresholds on Jev's confidence cannot fix a systematic blind spot. Protection has to come from outside Jev.

## F4 · Deterministic source protection closes the gap, post-hoc (2026-09-19)

- **Setup:** hybrid = guardedPolicy + "manifest / config / schema / env / version / docs sources are never dropped unless superseded" + "exact repeats drop without Jev".
- **Result:** 0% critical false drops on both dev and held-out, DROP precision 93–100%.
- **Caveat:** designed after seeing both sets. Not yet confirmed on fresh data. v0.1 runs it in shadow mode only.

## F5 · Jev never abstains by choosing UNCERTAIN (2026-09-19)

- **Result:** 0 of 265 calls chose `UNCERTAIN`. 52 of 53 items got the identical choice in all 5 repeats.
- **Conclusion:** Abstention must come from `confidence` and probabilities. Repeating a request adds almost nothing.

## F6 · Asking what the output is *for* beats asking for an abstract category (2026-09-19)

- **Question:** At write time, may the agent see only the key parts of a fresh long output?
- **Setup:** Same 13 dev cases. q1 asked the abstract KEEP/TRUNCATE/DROP question; w2 asked "what does the agent need from this output for the latest request?" with the options every_line / specific_parts / outcome_only / unclear, and put the call and request first in the state.
- **Result (dev):** trim recall 50% → 75%, key lines kept 90% → 100%, 0 false trims in both. On held-out (12 new cases, other tools, some Chinese requests) w2 reached 88.6% trim recall with **0/25 false trims and 100% (61/61) key lines kept**.
- **Conclusion:** Options that describe the user's situation work far better than abstract classes. This matches the pi-heed experiments.
- **Evidence:** `results/writetime-*.json`, [experiment 02](experiments/02-write-time-trimming.md).

## F7 · Backticked field paths and one-judgment questions: no measurable change here (2026-09-19)

- **Setup:** w3 = w2, with every question pointing at `output` / `latest_user_request` in backticks and no "and" questions (TypeSafe's guidance). The adoption rule was fixed before the run.
- **Result:** dev identical to w2. Held-out 85.7% trim recall (w2: 88.6%, one call apart), 0 false trims, 100% key lines. w3 was adopted per the rule.
- **Conclusion:** Harmless and cleaner, but w2 was already near the ceiling on this set. The big gain was F6.

## F8 · Regex candidate generation is the weak link in trimming, not Jev (2026-09-19)

- **Result:** When the code-generated candidates contained the key lines, Jev kept them 100% of the time. When they did not (for example `✕ unmet peer` in q1), the lines were lost. Three extractor fixes (plural `errors`, number-masked dedupe with at most 2 per shape, Unicode failure marks) mattered more than any change to the questions.
- **Related:** block mode (grouping grep/find output by file then directory, prose by paragraph) plus a rank fallback turned "Jev said trim but nothing was selected" into correct trims (W04, W05→outcome, W17).

## F9 · Write-time trimming works end-to-end in real pi (2026-09-19)

- **Setup:** pi 0.85.1 `-p`, the extension loaded with `-e`, and a 509-line failing test log.
- **Result:** 5,115 → 421 tokens entered the context (44 verbatim lines). The model answered which tests failed, with file:line, correctly. Jev took 587 ms and cost $0.000086. In a follow-up 6 minutes later, the model asked about an omitted line, called `context_recall("t1")` on its own and answered correctly. The idle gap was logged as a cold-cache window.
- **Open:** one resumed `pi -p` run hung at startup before any message was written. It did not reproduce with or without the extension (9 s and 11 s). Cause unknown.

## F10 · Where tokens go in real sessions (2026-09-19)

- **Setup:** 20 local pi sessions, 8,741 tool results, counted offline (nothing sent anywhere).
- **Result:** tool results are 96.3% of message-text tokens. Outputs eligible for write-time trimming (≥ 150 lines, not read/edit/write/file viewers) are 4.2% of results but 26.8% of tool-result tokens. `read` alone is 37% and is deliberately untouched by v0.1.
- **Conclusion:** Write-time trimming targets about a quarter of tool-result tokens at zero cache cost. The larger `read` share needs old-context pruning (v0.2), which is where F2 applies.

---

## F11 · On real sessions, "keep only what Jev selects" hides things the agent uses later (2026-09-19)

- **Setup:** v0.1 write-time trimming replayed on every eligible tool result in 20 local pi sessions (365 outputs), live Jev. Weak label: a fact (path, identifier, error code, 4+ digit number) from the *omitted* part that the agent or user used later, before any later tool result supplied it again. Per-item records stay local (`results-private/`, gitignored). Only aggregates are published.
- **Result:** trims on 48% of eligible outputs, 44% of eligible tokens saved, but **17.2%** of trims hid a fact used later. Blocks mode (search results, listings, grep) was at 23.4%, line mode (logs) at 12.6%. The naive label (no "supplied again" check) said 57%, so the label choice matters.
- **Cause, from reading the hits:**
  - code viewed through wrapped commands (`ssh host 'sed -n …'`, `cd x && sed …`), which the first-word viewer check missed;
  - exploratory outputs (search results, file lists, test lists) that the agent later picks items from.
- **Conclusion:** The synthetic benchmark (0 false trims, 100% key lines) did not predict this. Real replays are required.

## F12 · Code guards fix most of it; failures are always kept (2026-09-19)

- **Changes:**
  - the viewer check applies anywhere in a compound command;
  - outputs that are ≥ 30% source lines are never trimmed (except grep);
  - failure-level lines (with ±1 line of context), plus `file:line` locations within 6 lines of a failure, are always kept, whatever Jev selected;
  - omitted blocks leave a skeleton (first line and URL lines);
  - the header now tells the model it cannot see omitted lines and must recall them.
- **Result (real replay):** "omitted fact used later" fell from 17.2% to **10.6%**. Failing commands: **0 of 12**. The eligible set shrank from 365 to 191 outputs (code views excluded).
- **Origin of the failure-lines rule:** in real pi, a trim judged "outcome only" hid the second of two failures. The model noticed the output had been shortened and still did not call `context_recall`.

## F13 · Old-context pruning is not safe on real sessions, even with protection (2026-09-19)

- **Setup:** 19,794 (checkpoint, old tool result ≥ 150 tokens) pairs from real sessions. Weak label: the result is the only source of a fact that was used after the checkpoint, before anything supplied it again. 600 random pairs (1.7% needed) plus **300 weakly needed pairs**.
- **Result on the needed pairs:** raw Jev dropped **73.3%**, the hybrid policy **21.3%** (64/300), rules alone 24.3%. The false drops spread across read, find, grep, bash and web search.
- **Conclusion:** The 0% on synthetic sets (F4) did not transfer. DROP of old context stays shadow-only. F2 (no sense of future value) is the dominant effect on real data.

## F14 · Sieve: hide only what Jev is confident is unneeded (2026-09-19)

- **Design** (after Winnow): every block (at most 1,500 characters, shown to Jev in full, cut at blank lines or path changes) gets its own P(needed), asked with `true`/`false` criteria. A block is hidden only when P < 0.15. Uncertain blocks stay, and every guard from F12 still applies.
- **Synthetic** (official endpoint, 3 repeats): dev 87.5% trimmed; held-out 100%; **held-out 2, written before the guards ran, 100%**. **0 false trims and 100% key lines on all three.**
- **Real replay, threshold sweep** (184 outputs):

  | hide if P < | tokens hidden | outputs with a later-used block hidden |
  |---|---|---|
  | 0.10 | 3.6% | 0/9 |
  | **0.15** (default) | **19.2%** | **1/43** (2.3%) |
  | 0.20 | 43.2% | 2/78 (2.6%) |

  The single 0.15 case was a block of *passing* tests whose name the agent repeated in a summary.
- **Conclusion:** Sieve trades savings for safety. It is the v0.2 default at 0.15. Only 8 blocks carried the "used later" label, so these regret rates are rough.

## F15 · Jev judges a block as a whole, so one relevant line can drown (2026-09-19)

- **Result:** in W08 the `omit` section sat at the end of a block about logging, and Jev gave it P = 0.07. In W16 the block text shown to Jev was truncated, so it never saw the `CrashLoopBackOff` line. That second one was our bug.
- **Guards (code):**
  - a block is at most what Jev sees, and is never hidden if it was shown truncated;
  - blocks are cut at blank lines;
  - with `specific_parts`, the top 3 blocks are never hidden (the answer "only parts matter" contradicts "nothing matters");
  - a block containing a distinctive term from the request is never hidden.

## F16 · Official endpoint: warm it up with a real call (2026-09-19)

- **Result:** `api.typesafe.ai` returned `jev-1.13.0`. The first request on a fresh connection took **897 ms**; after one warm-up call the p50 was **336 ms** (p95 386 ms). Idle gaps up to 45 s did not bring the cold cost back. The response has no `cost` field, so cost is computed as input tokens × $0.042 / M.
- **Change:** warm-up is a real tiny decision (about $0.00001) at session start, repeated on user input after 5 minutes without one. The key now prefers `TYPESAFE_API_KEY`.

## F17 · v0.2 end-to-end in real pi, and an unexplained startup stall (2026-09-19)

- **Result:** in 5 of 5 runs on the 509-line failing log, sieve rewrote the output (5,115 → about 1,300 tokens) and the model named both failures with `file:line`. Jev latency was 560–650 ms.
- **Open issue:** 7 `pi -p` runs stalled before any output. All of them happened while another session was starting many pi processes. Instrumentation showed the stall comes *before* our `session_start` handler runs. It did not reproduce in 12 later runs, with or without instrumentation. Cause unknown; not attributed to this extension.

## F18 · Real user requests are often not the task (2026-09-19)

- **Observation:** in real sessions the latest user message is frequently a meta instruction ("continue", "check it and finish", `/goal …`). Jev then judges relevance against a weak goal. Winnow includes the assistant's last sentence before the call.
- **Next:** add what the agent said just before the call to the write-time state (v0.3, to be measured).

## F19 · Correction to F16, from pi-heed's E13: the cold cost is the connection (2026-09-19)

- **What F16 claimed:** a warm-up should be a real decision "so the model path is warm too". That was never measured.
- **Evidence:** [pi-heed E13](https://github.com/Nyarlathoteppppp/pi-heed/blob/main/EXPERIMENTS.md) measured this on the same endpoint in fresh processes, five runs each. The first decision took 790–918 ms with no warm-up, 305–382 ms after an unauthenticated HEAD, and 288–397 ms after a tiny real decision. After 1–30 s idle there was no second cold start. The cold cost is TLS to `api.typesafe.ai`, not the model.
- **Change:** warm-up is a HEAD again (free). The re-warm on user input after 5 minutes stays, because a HEAD costs nothing and idle gaps that long were not measured.
- **Also ported from pi-heed v0.7:** the Jev client retries 429 and transient 5xx (up to twice, honouring Retry-After, never past the caller's deadline), and clamps answers into [0, 1], rejecting non-finite or off-schema values.

## F20 · Deterministic read de-duplication: reference the context, not the disk (2026-09-21)

- **Question:** Re-reads are a large share of context. Can they be shortened without a model, without touching the cache, and without risk?
- **Prior art:** [cachebro](https://github.com/glommer/cachebro) (MIT, MCP) and its pi port in [rawwerks/ypi](https://github.com/rawwerks/ypi/blob/main/contrib/extensions/cachebro.ts) hash the file **on disk** against their own cache and answer `[unchanged]` or a diff.
- **Their flaw, measured on 22 real sessions:** the disk is the wrong reference. The agent reads lines 1–100, then reads 300–350 of the same unchanged file; cachebro answers "unchanged in lines 300-350" for lines the agent has never been shown. That pattern fires **2,301 times**, and in **598 of them (25%) more than half of the requested lines had never been shown** — about **458k tokens** of content that would simply vanish. In these sessions 97% of re-reads use different `offset`/`limit` arguments, so this is the common case, not an edge case.
- **What this extension does instead:** collapse a run of lines only when the agent was shown exactly those lines, contiguously, by an earlier read of the same file **that is still in the context**. Contiguity matters: a set of lines seen scattered around a file is not a block the agent read. If compaction removed the earlier read, nothing is collapsed.
- **Result on the same sessions** (production code, `minRun` 30 lines, `minSavedShare` 0.3): 12.0% of reads rewritten, **332k tokens saved = 13.4% of read tokens, 5.3% of all tool tokens**; best session 22.5% of its read tokens.
- **Thresholds barely matter:** from `minRun` 10 to 50 the saving moves only 14.9% → 12.4% of read tokens, so the conservative setting is close to free.
- **Cost:** no model call, no network. The layer is pure line comparison.
- **Ceiling, for honesty:** 47% of read tokens are lines seen before somewhere. Most of that is not contiguous enough, or the earlier read is no longer visible, so it is not collectable this way.

## F21 · Narrow read-dedupe MVP and corrected replay (2026-09-21)

- **Change:** 0.4 runtime only performs deterministic read dedupe and recall. Retired runtime is in `bench/archive/`; Jev/sieve/policy helpers are in `bench/experimental/`. Neither is shipped. Default is on; shadow is deterministic and makes no network calls.
- **Correctness:** matching requires the same file positions and exact path string. No `runReads` cache or stored-original evidence; shortened prior outputs are excluded. File positions and recall output positions are explicitly distinguished. Native read continuation notices remain intact.
- **Correction to F20:** the old replay accumulated messages without processing compaction entries. Its claim that it enforced current-context visibility was not supported by that runner. New replay uses Pi's `buildContextEntries` at each entry's parent, respecting branches and compaction. F20's 13.4% must not be quoted as the MVP result.
- **Result:** 24 sessions, 3,670 reads, about 2,482k read tokens / 6,344k tool tokens; 141 reads shortened, about 101k tokens saved = 4.1% of read tokens / 1.6% of all tool tokens. Estimates use characters/4, not billing tokenization. This is a different corpus and stricter matcher, so the decrease cannot be attributed to one change alone.
- **Validation:** 28 active tests plus 16 archived runtime integration tests pass; typecheck passes. Lifecycle tests include actual Pi SessionManager compaction boundaries, resume/recall, range overlap, changes and repeated content at different positions.
- **Evidence:** `results/seen-mvp.txt`, `test/seen.test.ts`.

## F22 · Antigravity tools were missing from outgoing requests (2026-09-21)

- **Observed:** isolated Antigravity Gemini 3.8 Flash read calls returned `MALFORMED_FUNCTION_CALL`. Native compaction could still generate summaries. An initial SDK OAuth attempt also failed parsing a compressed response; a subsequent attempt succeeded.
- **Cause of malformed calls:** the currently installed Pi normalizes tool declarations and system instructions into transcript system messages. pi-antigravity 0.7.3 still read `context.tools` and `context.systemPrompt`; outgoing request inspection showed no tool declarations. Switching JSON-schema fields did not fix it.
- **Fix:** installed provider `buildRequest` now calls Pi's `normalizeContext`, `getCurrentSystemPrompt`, and `getCurrentTools`, then excludes system messages from Gemini contents. Regression assertions cover tool additions/removals, prompt preservation, and legacy shorthand. Live read succeeded after the change.
- **Scope:** this is a local installed-provider patch, stored with backup and tests at `~/.pi/agent/local-patches/pi-antigravity-transcript/`. Reinstall can overwrite it. No credentials were printed or manually changed.
- **Harness correction:** repository SDK dependencies and installed Pi SDK expose different pi-ai interfaces despite their coding-agent version labels. Live runners now use the installed SDK, plus the same HTTP dispatcher initialization as CLI. The initial mismatched-SDK runs are retained as harness errors, not model or dedupe failures.
- **Quota:** all successful live/summary runs use `antigravity/gemini-3.8-flash`. One Google Direct diagnostic attempt returned 402 prepaid credits depleted; it produced no summary and was not retried. Google Direct is not used by the resulting runners.

## F23 · MVP live smoke: off 4/4, dedupe 4/4 (2026-09-21)

- **Setup:** two fixtures (overlapping reread followed by exact edit; early-region recall plus fresh status after a later read), two repetitions each, off/on. Only Antigravity and this extension loaded; tools read/write/edit/context_recall. Conditions alternate order. The fixture setup and filesystem acceptance predicates were fixed before model runs.
- **Result:** off 4/4, on 4/4. Every on run performed one collapse (~1,502 tokens saved), preserved the fresh update, and passed exact file/JSON checks. No provider errors in the valid runs.
- **Limit:** smoke-sized, synthetic, one model; this does not establish general non-inferiority. Offline real-session replay measures savings, not task success. No success rate is inferred for sieve.
- **Evidence:** `bench/live/mvp.ts`, `results/live-mvp.json`. Invalid SDK trials: `results/live-mvp-sdk-mismatch.json`.

## F24 · Wang compaction falls back on all five real checkpoints (2026-09-21)

- **Setup:** five distinct local sessions at their first recorded compaction point, with substantial older context. Same branch entries, keepRecentTokens=1024, reserveTokens=16384, and actual `AgentSession.compact()` for native and Wang. Native summarizer: Antigravity Gemini 3.8 Flash. Wang source commit: `058d91db752f97c7d52062e465eb151bddab060d` (0.1.0). TypeSafe key resolved through existing configuration; no production install of Wang.
- **Result:** native completed 5/5; Wang extractive path completed 0/5 and native fallback completed 5/5. Retention boundary IDs match within every pair. Diagnostic reruns reported four "no candidates or less than 10% byte reduction" and one "protected history exceeds output budget". These combined fallback messages do not distinguish no candidates from low reduction.
- **Conclusion:** these results establish loading/lifecycle compatibility with installed Pi, not Jev semantic superiority. Comparing the generated summaries would compare two native samples. Do not enable Wang based on these results; no additional online Jev-vs-native trial is justified by this pilot. Native compaction remains in use.
- **Evaluation note:** iefnaf `eval/vs-pi.ts` was inspected. It uses cached/offline outputs and later-used lexical facts; useful for diagnostics, but lexical recall alone favors extractive text and is not an adequate capability endpoint.
- **Evidence:** `results/compaction-mvp.json`, `results/wang-mvp-diagnostics.json`; private snapshots/summaries in gitignored `results-private/`. Input checkpoints were selected before calls. No semantic score or claim about cost advantage is made.

## F25 · Explicit folded-line counts (2026-09-21)

- **Change:** each replacement header reports folded/total file lines, alongside the
  file range, visible source read ID and recall ID. Span markers retain absolute
  file positions. The count describes omitted lines, not semantic information.
- **Validation:** overlap regression checks `Folded 100/200`; all 28 active tests
  pass. Replaying the same 24 sessions after adding the count rewrites 140 reads
  instead of 141 (one result no longer clears the 30% savings threshold). Rounded
  savings remain 101k tokens, 4.1% of reads / 1.6% of tool tokens.
- **Limit:** F23's live outcomes precede this small marker wording change.

## F26 · v0.5 follow-up lifecycle, configuration and fail-open hardening (2026-09-21)

- **Baseline:** 37/38 tests passed; the new lifecycle test attempted to restore an in-memory session using an undefined filename. Typecheck also failed on a SessionEntry union access. This was not a passing acceptance baseline.
- **Fixes:** installed Pi 0.86.1 SessionManager harness reconstructs entries/leaf and tests active branches. Concurrent sieve/sieve and sieve/read aliases are distinct; both original entries and exact recalled text survive rebuild. Sibling originals are absent after tree navigation. Compaction entries remove old reads as dedupe evidence without rejudging old outputs; fresh post-compaction results still sieve.
- **Configuration:** independent startup precedence is options > environment > file > mode fallback. Explicit session commands persist and override startup choices on rebuild. Mode-only old sessions retain their mapping. Explicit dedupe on now acts under shadow mode. All tool declarations remain stable and no context handler exists.
- **Numeric/schema fixes:** invalid numeric configuration uses defaults (threshold 0.10, share 0.30, saved tokens 1000); empty environment strings do not become zero, and positive fractional savings floors are not rounded downward. Threshold remains strict `<`. Invalid Jev probabilities are rejected instead of clamped toward a hide decision; malformed choice confidence/probabilities fail open too.
- **Stack protection:** corrected an over-escaped Caused-by expression; standalone frame-shaped lines also seed protection. Every actual JS/TS, Python, Java chain and Go frame in regression fixtures maps to a hard-KEEP block, including deliberately small block boundaries. Ordinary PASS regions remain hideable. Regex recognition is not a complete parser for every traceback format.
- **Command scope:** `echo npm test` and mixed `npm test && ...` previously matched the substring classifier. These now pass through; a single recognized executable with optional simple `cd ... &&` is required.
- **Validation:** 53 active tests (including 9 installed-SDK lifecycle cases), 16 archived tests, typecheck, standalone lifecycle test, replay and diff whitespace checks pass. HTTP fixture tests exercise actual timeout, malformed, 429 and 503 responses. No-key and persistence-failure tests preserve complete output. Persistence failure is injected, not a real full disk; lifecycle dispatch is simulated around real SessionManager entries, not a full AgentSession/UI test.
- **Replay:** 27 sessions, 3,814 reads, 142 rewrites, ~103k estimated tokens saved: 3.8% of read / 1.5% of tool tokens. Corpus count differs from the handoff's 28; this reports the actual current files. Evidence: `results/seen-v05-hardening.txt`.

## F27 · v0.5 filesystem A/B/C pilot: distinguish participation from rewriting (2026-09-21)

- **Model:** Antigravity Gemini 3.8 Flash, installed Pi 0.86.1. A=plugin off; B=dedupe only; C=dedupe plus active Jev. Frozen source/JSON predicates, fresh directories and unique output files. Default Jev threshold/gates were not relaxed.
- **Run 01:** three scenarios × one repetition × three conditions = 9 tasks, 9 passed. Failure-exit logs, multiple failures across blocks, and delayed warning/run-label use. A/B/C passed 3/3 each. B performed 3 dedupe rewrites (3,359 estimated tokens); C performed 3 dedupe rewrites (3,357 tokens), 4 Jev decisions, but **zero sieve rewrites**. Common-word task/intent matching can conservatively retain every PASS block. This run cannot establish performance after sieve removal.
- **Run 02:** focused first instruction, unchanged filesystem acceptance, two scenarios × one repetition × three conditions = 6 tasks, 6 passed. A/B/C passed 2/2 each. B performed 2 dedupe rewrites (2,238 tokens). C performed 2 dedupe plus **2 sieve rewrites**, hid **35 sieve blocks**, and saved **14,055 total estimated tokens across both layers**. Three Jev decisions, zero Jev failures, zero recalls. Multiple failures were fixed and the delayed JSON facts were correct. These prompts differ from Run 01 and are not identical repeats.
- **Latency/cache:** Jev recorded 4,406 ms total over Run 01's four decisions and 3,328 ms over Run 02's three decisions. Run 01 C reported 20,324 cache-read tokens; other groups and all cache-write counters reported zero. This is not controlled evidence of cache hit-rate equivalence. No actual charge is inferred from Jev list-price metadata during free preview.
- **Limits:** only synthetic fixtures, one model and one repetition per prompt/condition. Real-session replay measures deterministic savings only, not real-log sieve capability. Delayed-fact correctness without recalls does not establish recovery of a fact that was actually omitted; the pilot does not label every later-used hidden fact or independently audit every hidden stack frame. The live protocol check catches direct reads of the fixture script but does not fully audit arbitrary shell rereads. Fault/branch tests are separate deterministic tests. Results support smoke acceptance, not general capability equivalence or a zero-regression guarantee.
- **Commands:** `node bench/live/v05-hardening.ts --reps 1 --out results/live-v05-hardening-01.json`; `node bench/live/v05-hardening.ts --reps 1 --focused --scenarios multiple-failures,delayed-fact --out results/live-v05-hardening-02.json`.
- **Protected files:** `live-v03.json`, `live-probe.json`, and `live-probe2.json` were not modified; before/after checksums match.

## F28 · v0.6 freshness-aware deterministic read dedupe (2026-09-21)

- **Change:** read dedupe now requires the source result to remain visible in the active branch, match the exact path and absolute line positions, belong to the latest user-message task epoch, and be no older than `dedupeMaxAgeTokens` estimated visible-context tokens. The default window is 12,000 tokens. The newest eligible exact occurrence wins; stale sources are never combined with fresh partial ranges.
- **Task boundary:** the epoch is the count of visible user messages before the tool result. Any new user message makes previous reads stale. No semantic task inference is performed.
- **Age:** `ceil(characters / 4)` is summed for visible user, assistant, and tool-result message content after the source and before the incoming read. The incoming read itself is excluded.
- **Validation:** immediate, 5k same-task, over-window stale, new-user-turn, recent-copy selection, stale refresh, partial-overlap, active-branch, compaction and invalid-configuration cases pass. Existing fresh-output sieve tests remain green.
- **Focused benchmark:** 14 reads, 4 fresh dedupes, 1 stale refresh, 1 prevented cross-user-turn dedupe, 1 partial-overlap dedupe, and approximately 6,166 estimated tokens saved. This is a deterministic synthetic fixture, not a capability benchmark.
- **Limits:** token age is an approximation of visible message text, not provider billing tokens. The latest-user-message epoch is intentionally coarse and treats every new user message as a hard freshness boundary. No semantic similarity, embeddings, summaries, attention prediction, or Jev participation is used.
- **Acceptance corrections:** read-only evidence projection now stops at context-bearing custom messages, summaries, and unmodeled message roles; plain custom storage remains ignored. The v0.5 sieve projection is unchanged. Explicit invalid option values cannot inherit a larger environment/file age window. Token age uses suffix sums instead of repeated suffix scans.
- **Acceptance verification:** 64 active tests, 16 archived tests, typecheck and diff checks pass. New cases cover age 0/11999/12000/12001, two fresh partial/full sources, folded-result age non-renewal, resumed branch age, unknown visible-message boundaries, and configuration precedence. The focused benchmark asserts its decisions and reproduces 6,166 estimated tokens saved. A local read replay reported 27 sessions, 3,845 reads, 24 rewrites and approximately 15k tokens saved; the local corpus continues growing.

## F29 · v0.7 searchable recall and expanded failure logs (2026-09-22)

Search now scans existing active-branch originals deterministically and returns
verbatim, source-labelled chunks. It preserves exact line pagination and never
rewrites previous results. Paragraph boundary selection adapts Winnow (MIT);
THIRD_PARTY_NOTICES.md records the source and license. Small hidden-content hints
and contiguous omission markers count against the existing benefit gate.

Final retrieval ablation:

```sh
node bench/live/v07-recall.ts --out results/live-v07-recall-05.json --reps 2
```

Model: antigravity/gemini-3.8-flash. Three fixed scenarios (needed, unnecessary,
absent component), two repetitions, three conditions. The fixture deliberately
hides historical evidence; this measures retrieval, not production sieve safety.
Only write and recall tools are available, so filesystem grading cannot be bypassed
by rerunning the fixture. Budget: 20 turns / 90 seconds per case.

| Condition | Pass | Recalls | Search calls | Estimated recall tokens | Reported input tokens | Total latency |
|---|---:|---:|---:|---:|---:|---:|
| A: full original | 6/6 | 0 | 0 | 0 | 89,480 | 21.1s |
| B: exact v0.6 id/line declaration | 6/6 | 4 | 0 | 26,964 | 67,185 | 28.3s |
| C: searchable chunks + hints | 6/6 | 12 | 12 | 2,268 | 36,776 | 49.6s |

C's needed-fact cases each made one search and returned about 340 estimated tokens.
Unnecessary cases made no recalls. Each absent-component case made five searches,
returned about 794 tokens, and took about 15.4s. Search therefore reduced returned
text but increased tool rounds and latency; no-match is not proof of absence.
All cache counters were zero, so these runs establish no cache-hit improvement.
No live Jev calls or sieve rewrites occur in this retrieval ablation.

Earlier attempts remain available. Run 01 stalled; run 02 exposed a benchmark
startup defect: SDK `bindExtensions()` was missing, so `session_start` never
restored seeded originals. Those runs are invalid for capability comparison.
Run 03 fixed startup but limited execution to eight turns. Run 04 used 20 turns
and passed 18/18, but its legacy declaration omitted v0.6's parameter descriptions,
including the 2,000-line default. Run 05 restores the exact legacy declaration and
is the primary comparison. Do not pool these different harness versions.

Expanded failed-output benchmark (three conditions, one repetition per run):

```sh
node bench/live/v05-hardening.ts --reps 1 --focused --scenarios failure-exit --out results/live-v07-failure-02.json
```

Run 01 passed 3/3 but C made two Jev calls that timed out; all output passed through.
Run 02 passed 3/3; C made two Jev decisions, one sieve rewrite hiding 18 blocks and
6,184 estimated net tokens, zero Jev failures, and zero recalls. A/B made no
rewrites. The unchanged failure-exit fixture grades the repaired booleans and
preservation of its source files. This small test does not establish broad safety.
The diagnostic-only `sieve-v07-probe.json` also records real Jev block probabilities;
it is not a task-capability benchmark.

Local inventory (`results/output-profile-v07.json`) covers 26 non-temporary session
files, all branches, and exports no private text. Read output dominates at ~2.74M
estimated tokens; bash view/search adds ~1.13M. No output passes the current sieve
eligibility rules. Of 148 long bash outputs, 117 have shell composition syntax.
This is a real coverage limitation, not justification to filter arbitrary compound
commands. Repetition counts are candidates for investigation, not safe savings.

The separate replay includes 27 files and 3,847 text-only reads; 20 rewrites save
~13K estimated tokens (0.5% of reads, 0.2% of all tool output). Inventory and replay
have different inclusion rules. Token reductions are not billing reductions.

Validation: 73 unit/integration tests, 16 archive tests, typecheck, replay,
standalone 10-test lifecycle/SDK suite, package dry-run, and diff whitespace check.
The actual SDK startup regression test makes no model completion call. Three
preexisting protected result files retain their original checksums.

## F30 · v0.7.1 common wrappers and recall feedback (2026-09-22)

The follow-up adds literal directory/environment/stderr wrappers and reports search
scope, unmatched terms/identifiers and source ids. It leaves Jev policy and retrieval
ranking unchanged. See [the full report](V0.7.1_FOLLOW_UP.md) for commands, baseline
construction, fixture constraints and official guidance considered.

On antigravity/gemini-3.8-flash, a paired four-scenario/two-repetition recall pilot
passed 8/8 per condition. Recall calls fell from 22 to 14; total latency from 67.0s
to 55.6s; estimated returned tokens from 18,304 to 16,378. Absent-component cases
improved, but alternate-wording cases returned more text (2,120 to 7,255 tokens),
including a full-original inspection. Two scenarios explicitly prescribe an initial
query. This is evidence of navigation improvement on small fixtures, not a general
quality or cost guarantee. Cache counters were all zero.

A real wrapped-command filesystem fixture passed for both versions. v0.7.1 made
two Jev decisions, one rewrite and zero Jev failures, saving 8,682 estimated net
tokens; v0.7.0 did not classify the wrapper. No recalls occurred. In contrast,
offline inventory of 26 non-temporary session files (2,792 bash results) found no
historical coverage gain: both versions classify 45 commands, and none pass full
sieve eligibility. Supporting common syntax is useful interoperability work, but
the earlier 117 compound long commands must not be portrayed as available savings.

Validation: 77 tests, 16 archive tests, typecheck, the standalone 10-test
lifecycle/SDK suite, read replay, command replay and diff whitespace checks passed.
No prior messages are rewritten and no model-call or retrieval fallback was added.

### F31 — Source reads dominate; smaller reads did not reliably reduce total work

The current 25-file local snapshot attributes 65.9% of successful text-only read
tokens to source code. Exact same-path/range repeats account for only 5.0% of source
read tokens, mostly across user turns; reads with neither offset nor limit account
for 13.4%. Neither measure establishes safe deletability.

A synthetic, filesystem-graded Antigravity Gemini 3.8 Flash experiment compared
explicit whole-file reads with task-directed search and ranges. Both passed all
six primary questions, including current versus historical values and a delayed
unrequested dependency. Scoped retrieval reduced returned estimated tokens from
33,731 to 7,264, but read/bash calls rose from 15 to 28, time from 64.35s to 78.16s,
and reported input from 244,608 to 248,527. Cache-read counters differed (195,275
versus zero), preventing a simple output-size-to-cost inference. A diagnostic
repeat also passed, but remained slower despite smaller output. Some diagnostic
and primary execution overlapped; timings are descriptive. Recovered diagnostic
errors were incidental git-status calls outside a Git repository.

No Jev judgments, rewrites, hidden tokens or recalls occurred. No production
policy changed. This supports testing fewer navigation round trips, not hiding
source code or relaxing freshness. See `docs/READ_SCOPE_EXPERIMENT.md` for scope,
commands, complete metrics and limitations. Private session content stays local.

### F32 — v0.7.1 closeout review and boundary fixes

Review covered the production extension, read matching, sieve stack protection,
shell recognition, original search, transport, SDK lifecycle tests and pending
read-scope experiments. Four new regression tests failed before the fixes:

- Exact recall beyond EOF produced inverted ranges (for example, lines 3-2).
  It now returns an explicit empty-page message and the original's line count.
- Feedback after a recall attached to the recall log; subsequent feedback attached
  to the previous label. Labels now select the latest seen/sieve decision.
- An absent Retry-After header became zero via Number(null), skipping intended
  backoff. Missing/empty headers now use the existing bounded exponential delay.
  Transport latency also includes response-body decoding, previously omitted.
- The status report called pre-request sieve skips Jev calls and concealed missing
  credentials. It now reports evaluations and configuration availability, without
  claiming an actual network connectivity check.

No filtering thresholds, tool declarations, historical messages or package version
changed. No new severe defect was identified in this review. Semantic filtering
remains probabilistic, lexical recall can miss synonyms, and recoverability is not
capability equivalence. Other history-transforming extensions remain outside the
verified configuration. This is not a full audit of external dependencies.

Validation: npm test 81/81; npm run test:archive 16/16; standalone lifecycle/SDK
10/10; npm run typecheck and git diff --check passed. npm run bench on the current
26-file snapshot: 3,573 reads, 19 rewrites, approximately 12k saved tokens (0.5% of
read tokens; 0.2% of all tool-result tokens). Snapshot counts differ from earlier
runs; no filtering-policy change was made. Benchmark is offline: no Jev calls or
live model rerun in this closeout. The prior six-session live source-read experiment
is retained with its limitations. Protected user result files remain unchanged.
