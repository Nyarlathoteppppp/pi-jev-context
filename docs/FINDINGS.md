# Findings ledger

Append-only record of what the experiments established. Each entry states the question, the setup, the
result, the conclusion and where the evidence is. A later entry may supersede an earlier one; earlier
entries are never rewritten. Raw data lives in `results/`, full write-ups in `docs/experiments/`.

Model for all entries: `typesafe/jev-1.13-20260917` via OpenRouter `~typesafe/jev-latest`.

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
