# pi-jev-context (v0.0 — shadow evaluation only)

**Question:** can [Jev](https://docs.typesafe.ai) reliably decide whether an old pi tool result should be **KEEP**, **TRUNCATE** or **DROP**?

This repository is only a benchmark. It never touches a real pi session: no context hook, no compaction, no dropping.

## Answer (jev-1.13, 2026-09-19)

Jev is good at judging whether something is **relevant right now**. It does **not reliably judge future value**. Jev alone is not safe enough to decide an irreversible DROP. With deterministic guards and reversible stubs around it, it is worth building.

| | dev (37 items) | held-out (16 items, labelled after the policy was frozen) |
|---|---|---|
| Jev raw accuracy (per call) | 87.0% | 93.8% |
| KEEP recall | 86.7% | 100% |
| **Critical false drop, Jev raw** | **11.1%** (C05.A, C16) | **12.5%** (H02.A) |
| Critical false drop, frozen `guardedPolicy` | 0.0% (fitted on this set) | **7.5%** (did not generalise) |
| Critical false drop, hybrid (post-hoc) | 0.0% | 0.0% |
| latency p50 / p95 | 308 / 433 ms | 315 / 430 ms |
| cost | $0.0123 for 185 calls | $0.0046 for 80 calls |
| stability (identical choice over 5 repeats) | 36/37 | 16/16 |

- Every critical false drop is the same kind of item: a **durable fact that is irrelevant to the current goal** (`package.json` engines, `prisma --version`, `schema.prisma`). Once the goal changes and makes that fact relevant, Jev re-judges the same item as KEEP every time (C05.B, H02.B, H03, H11).
- Jev never chose `UNCERTAIN` (0 of 265 calls). Abstention has to come from `confidence` and probabilities, not from the UNCERTAIN option.
- `unique_fact` has no discriminating power (it is 0.70 even for `pwd`). `durable` is informative, but not reliable enough to be the only guard.
- Key-line selection for TRUNCATE works when the code-generated candidates contain the right lines (C04, C24, C26: 100% of key lines kept in every repeat). The regex that generates candidates missed `✕ unmet peer` in H08, and that is a gap in the extractor.

Full reports: `results/run-q1.md`, `results/run-q1-holdout.md`. The ground truth was committed before each live run (see git log).

## Run

```bash
npm install
npm test                                              # offline unit tests
node bench/run.ts --dry-run                           # print every Jev state, no network
PI_JEV_ENV_FILE=~/litellm-gateway/.env node bench/run.ts --set dev --repeats 5
node bench/report.ts results/run-XXXX.json            # metrics, confusion, sweep
node bench/hybrid.ts results/run-q1.json results/run-q1-holdout.json   # post-hoc hybrid
```

## Layout

| file | role |
|---|---|
| `src/state.ts` | bounded Jev state: goal, recent conversation, the item (full text or an excerpt), what happened after it, and newer related results (computed in code) |
| `src/questions.ts` | pre-registered Choice (KEEP/TRUNCATE/DROP/UNCERTAIN) plus 6 Noul signals and per-line key-line Nouls, all in one fan-out call |
| `src/policy.ts` | raw / safe / composite / guarded policies, plus a rules-only baseline |
| `bench/cases.ts`, `bench/holdout.ts` | synthetic sessions with ground truth |
