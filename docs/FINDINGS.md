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
