# Experiment 01: Can Jev decide KEEP / TRUNCATE / DROP for old tool results?

**Status:** done · **Result files:** `results/run-q1.{json,md}`, `results/run-q1-holdout.{json,md}` · **Findings:** F1–F5

## Question

A coding agent's context fills with old tool results. We want to know which ones can be kept whole, cut down to a few lines, or removed. The question is whether a fast decision model (Jev, about 300 ms per call, $0.00006 per call) can make that call reliably. The most expensive mistake is dropping something the agent will need later. We call that a *critical false drop*.

## Setup

- **Cases:** synthetic pi sessions built with a small DSL (`bench/builder.ts`). Each labelled item is an old tool result judged at a checkpoint, with:
  - `truth`: the best decision;
  - `acceptable`: decisions that lose nothing;
  - `critical`: the information is needed later;
  - `keyLines`: lines a truncation must keep.
- **Dev set:** 26 sessions, 37 items, 18 critical. Categories: stale navigation (pwd/ls/find), superseded failures, old-but-critical root causes, 500-line logs, temporarily irrelevant facts, empty greps (both stale and as evidence), repeated git status, repeated failures, resolved and unresolved stack traces, old diffs, fixed lint, architecture decisions, file paths, version numbers, API names, user-requested evidence, superseded config, old/new reads of one file, goal changes (Chinese), irrelevant build logs, a Chinese root cause, repetitive tsc output, a config value in a long file, one key line in long compose logs.
- **Held-out set:** 14 sessions, 16 items, 8 critical. Written after freezing the policy, aimed at the weak spots.
- **State given to Jev** (`src/state.ts`, bounded to about 2k tokens):
  - the current goal (latest user request plus original task);
  - recent conversation;
  - the item: the call, its status, its age in words, its size in words, and the full result or an excerpt (head, notable lines, tail);
  - the tool activity that came after it;
  - newer results about the same thing, computed in code ("the same command was run again later").
- **Questions** (one fan-out call, pre-registered as `q1`):
  - a Choice KEEP / TRUNCATE / DROP / UNCERTAIN;
  - Nouls `superseded`, `needed_now`, `unique_fact`, `durable`, `user_requested`, `mostly_noise`;
  - one Noul per candidate key line.
- **Protocol:** ground truth committed before each live run (`e63bc2b`, then `d6395f8` for held-out). 5 repeats per item. No label was changed after seeing results.

## Results

| | dev (37) | held-out (16) |
|---|---|---|
| Jev raw accuracy / lenient | 87.0% / 87.0% | 93.8% / 93.8% |
| KEEP recall | 86.7% | 100% |
| **Critical false drop, raw** | **11.1%** | **12.5%** |
| Critical false drop, `guardedPolicy` (frozen after dev) | 0.0% | **7.5%** |
| Critical false drop, hybrid (post-hoc) | 0.0% | 0.0% |
| Rules only (no Jev): critical FD / DROP recall | 5.6% / 58.8% | 0% / 37.5% |
| latency p50 / p95 | 308 / 433 ms | 315 / 430 ms |
| cost | $0.0123 / 185 calls | $0.0046 / 80 calls |

Raw Jev, both sets pooled, counted per call:

| truth \ pred | KEEP | TRUNCATE | DROP | UNCERTAIN |
|---|---|---|---|---|
| KEEP | 95 | 0 | 10 | 0 |
| TRUNCATE | 0 | 25 | 10 | 0 |
| DROP | 9 | 0 | 116 | 0 |

### What went wrong, all of it

| item | truth | Jev | kind |
|---|---|---|---|
| C05.A `cat package.json` (engines node ≥ 22) during a UI task | TRUNCATE, critical | DROP ×5 (p 0.71) | **durable fact, irrelevant now** |
| C16 `prisma --version` → 4.16 | KEEP, critical | DROP ×5 (p 0.62) | **durable fact, irrelevant now** |
| H02.A `schema.prisma` during a UI task | TRUNCATE, critical | DROP ×5 (p 0.80, c 0.73) | **durable fact, irrelevant now** |
| C02 latest passing `npm test` | KEEP | DROP ×5 | regenerable; the label is debatable |
| C09 f1/f2: two identical earlier failures | DROP | KEEP | safe error; exact duplicate |
| H07 l1: identical earlier lint failure | DROP | DROP (p 0.51) → guard fell back to KEEP | safe error |

The same three items were judged correctly once the goal changed (C05.B, H02.B, and also H03 and H11). Jev reads relevance against the current request. It does not estimate future value.

### Signals

- `unique_fact` is uninformative: it is 0.70 even for `pwd`.
- `durable` separates durable facts reasonably (0.71–0.91), but not well enough to be the only guard (F3).
- `UNCERTAIN` was never chosen (F5).
- TRUNCATE key-line selection kept 100% of labelled key lines whenever the code-generated candidates contained them.

## Conclusions

1. Jev answers "is this still relevant right now" well.
2. It cannot be trusted to protect latent value. An irreversible DROP needs deterministic protection plus lossless recall.
3. The hybrid policy (`src/protect.ts`) is the current best design. It is post-hoc, so v0.1 runs it in shadow mode only and logs decisions from real use.

## Limitations

The cases are synthetic, and the same person wrote the cases and the questions. Real sessions contain assistant restatements, longer histories and other tools. The next validation step is shadow data from real use (`/context report`) and weakly labelled replays of real sessions.
