# pi-jev-context shadow evaluation

- file: `results/run-q1-holdout.json`
- model: `typesafe/jev-1.13-20260917` (requested `~typesafe/jev-latest`), questions `q1`, repeats per item: 5
- items: 16 (from 14 cases), critical: 8, Jev calls: 80 (0 failed)
- latency: p50 **315 ms**, p95 **430 ms**, max 571 ms
- cost: **$0.004554** total, $0.0000569 per call, 1355 input tokens per call

## Metrics

Per call (every repeat counted):

| policy | acc | lenient acc | KEEP recall | retention | **critical false drop** | false drop | TRUNCATE acc | DROP precision | DROP recall | UNCERTAIN | token savings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| jev raw | 93.8% | 93.8% | 100.0% | 87.5% | **12.5%** | 12.5% | 50.0% | 88.9% | 100.0% | 0.0% | 89.0% |
| jev safe | 87.5% | 87.5% | 100.0% | 87.5% | **12.5%** | 12.5% | 50.0% | 87.5% | 87.5% | 0.0% | 88.0% |
| jev composite | 62.5% | 81.3% | 100.0% | 100.0% | **0.0%** | 0.0% | 100.0% | 100.0% | 25.0% | 0.0% | 82.2% |
| jev guarded (frozen) | 75.0% | 83.8% | 100.0% | 92.5% | **7.5%** | 7.5% | 50.0% | 89.3% | 62.5% | 0.0% | 85.1% |

Per item, majority of 5 repeats (ties → safer):

| policy | acc | lenient acc | KEEP recall | retention | **critical false drop** | false drop | TRUNCATE acc | DROP precision | DROP recall | UNCERTAIN | token savings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| jev raw | 93.8% | 93.8% | 100.0% | 87.5% | **12.5%** | 12.5% | 50.0% | 88.9% | 100.0% | 0.0% | 89.0% |
| jev safe | 87.5% | 87.5% | 100.0% | 87.5% | **12.5%** | 12.5% | 50.0% | 87.5% | 87.5% | 0.0% | 88.0% |
| jev composite | 62.5% | 81.3% | 100.0% | 100.0% | **0.0%** | 0.0% | 100.0% | 100.0% | 25.0% | 0.0% | 82.2% |
| jev guarded (frozen) | 75.0% | 81.3% | 100.0% | 87.5% | **12.5%** | 12.5% | 50.0% | 83.3% | 62.5% | 0.0% | 85.9% |
| rules only (no Jev) | 62.5% | 68.8% | 100.0% | 100.0% | **0.0%** | 0.0% | 50.0% | 100.0% | 37.5% | 0.0% | 81.9% |
| always KEEP | 37.5% | 43.8% | 100.0% | 100.0% | **0.0%** | 0.0% | 0.0% | n/a | 0.0% | 0.0% | 0.0% |

Critical false drops (per call): jev raw: H02.A:schema · jev safe: H02.A:schema · jev composite: none · jev guarded (frozen): H02.A:schema

## Confusion matrices

**Jev raw, per call** (rows = truth, columns = prediction)

| truth \ pred | KEEP | TRUNCATE | DROP | UNCERTAIN |
|---|---|---|---|---|
| KEEP | 30 | 0 | 0 | 0 |
| TRUNCATE | 0 | 5 | 5 | 0 |
| DROP | 0 | 0 | 40 | 0 |

**Jev composite, per call** (rows = truth, columns = prediction)

| truth \ pred | KEEP | TRUNCATE | DROP | UNCERTAIN |
|---|---|---|---|---|
| KEEP | 30 | 0 | 0 | 0 |
| TRUNCATE | 0 | 10 | 0 | 0 |
| DROP | 10 | 20 | 10 | 0 |

**Jev guarded (frozen), per call** (rows = truth, columns = prediction)

| truth \ pred | KEEP | TRUNCATE | DROP | UNCERTAIN |
|---|---|---|---|---|
| KEEP | 30 | 0 | 0 | 0 |
| TRUNCATE | 2 | 5 | 3 | 0 |
| DROP | 10 | 5 | 25 | 0 |

**rules only** (rows = truth, columns = prediction)

| truth \ pred | KEEP | TRUNCATE | DROP | UNCERTAIN |
|---|---|---|---|---|
| KEEP | 6 | 0 | 0 | 0 |
| TRUNCATE | 1 | 1 | 0 | 0 |
| DROP | 5 | 0 | 3 | 0 |

## Stability

Raw choice identical across all 5 repeats for 16/16 items.

## Per item

| item | category | truth (acceptable) | crit | Jev raw picks | p(choice) | conf | needed_now | superseded | unique | durable | user_req | noise | guarded | ok? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| H01:old | durable-looking but superseded | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 1.00 | 1.00 | 0.19 | 0.93 | 0.45 | 0.52 | 0.03 | 0.59 | DROP | ✓ |
| H02.A:schema | temporarily irrelevant | TRUNCATE (TRUNCATE/KEEP) | yes | DROP DROP DROP DROP DROP | 0.80 | 0.73 | 0.07 | 0.04 | 0.57 | 0.71 | 0.04 | 0.36 | DROP | **CRITICAL DROP** |
| H02.B:schema | temporarily irrelevant | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.97 | 0.96 | 0.86 | 0.04 | 0.72 | 0.70 | 0.05 | 0.31 | KEEP | ✓ |
| H03:cfg | temporarily irrelevant | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.94 | 0.92 | 0.90 | 0.04 | 0.86 | 0.70 | 0.04 | 0.28 | KEEP | ✓ |
| H04:ls | durable-looking but superseded | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.94 | 0.92 | 0.08 | 0.21 | 0.62 | 0.82 | 0.07 | 0.72 | TRUNCATE | ✓ |
| H05:log | stale orientation | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 1.00 | 0.99 | 0.10 | 0.05 | 0.39 | 0.21 | 0.07 | 0.43 | DROP | ✓ |
| H06:root | old but critical | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.93 | 0.90 | 0.94 | 0.03 | 0.81 | 0.64 | 0.16 | 0.67 | KEEP | ✓ |
| H07:l1 | repeated failure | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.51 | 0.35 | 0.92 | 0.20 | 0.50 | 0.58 | 0.05 | 0.89 | KEEP | ✗ |
| H07:l2 | repeated failure | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.78 | 0.70 | 0.93 | 0.04 | 0.91 | 0.62 | 0.05 | 0.89 | KEEP | ✓ |
| H08:log | very long log (one key line) | TRUNCATE (TRUNCATE) | yes | TRUNCATE TRUNCATE TRUNCATE TRUNCATE TRUNCATE | 0.86 | 0.81 | 0.94 | 0.03 | 0.91 | 0.82 | 0.03 | 0.93 | TRUNCATE | ✓ |
| H09:pass | old passing result | DROP (DROP) |  | DROP DROP DROP DROP DROP | 0.98 | 0.97 | 0.04 | 0.24 | 0.43 | 0.20 | 0.04 | 0.84 | DROP | ✓ |
| H10:ps | user-requested evidence | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.94 | 0.92 | 0.92 | 0.04 | 0.86 | 0.61 | 0.67 | 0.49 | KEEP | ✓ |
| H11:env | temporarily irrelevant (Chinese) | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.91 | 0.88 | 0.71 | 0.04 | 0.89 | 0.85 | 0.04 | 0.41 | KEEP | ✓ |
| H12:read | deleted file | DROP (DROP) |  | DROP DROP DROP DROP DROP | 0.98 | 0.98 | 0.13 | 0.05 | 0.56 | 0.64 | 0.06 | 0.26 | DROP | ✓ |
| H13:grep | superseded search | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.98 | 0.97 | 0.63 | 0.07 | 0.57 | 0.71 | 0.05 | 0.26 | KEEP | ✗ |
| H14:flaky | user-dismissed evidence | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.91 | 0.87 | 0.25 | 0.07 | 0.76 | 0.34 | 0.04 | 0.66 | DROP | ✓ |

## TRUNCATE key-line selection

Candidates are chosen by code (errors, failures, file:line, summaries); Jev marks which to keep (noul ≥ 0.5).

| item | key lines | covered by candidates | covered by Jev-kept lines | Jev kept / candidates |
|---|---|---|---|---|
| H08:log | 2 | 0/2 | 0/2 0/2 0/2 0/2 0/2 | 1/1 |

## Threshold sweep (composite policy, per call)

| drop p ≥ | confidence ≥ | veto ≥ | critical false drop | false drop | DROP precision | DROP recall | lenient acc | token savings |
|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.3 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.5 | 0.3 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.5 | 0.3 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.5 | 0.5 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.5 | 0.5 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.5 | 0.5 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.5 | 0.7 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.5 | 0.7 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.5 | 0.7 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.6 | 0.3 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.6 | 0.3 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.6 | 0.3 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.6 | 0.5 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.6 | 0.5 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.6 | 0.5 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.6 | 0.7 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.6 | 0.7 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.6 | 0.7 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.7 | 0.3 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.7 | 0.3 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.7 | 0.3 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.7 | 0.5 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.7 | 0.5 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.7 | 0.5 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.7 | 0.7 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.7 | 0.7 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.7 | 0.7 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.8 | 0.3 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.8 | 0.3 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.8 | 0.3 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.8 | 0.5 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.8 | 0.5 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.8 | 0.5 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.8 | 0.7 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 75.0% | 80.3% |
| 0.8 | 0.7 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 81.3% | 82.2% |
| 0.8 | 0.7 | 0.7 | 2.5% | 2.5% | 95.2% | 50.0% | 92.5% | 83.7% |
| 0.9 | 0.3 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 73.8% | 80.3% |
| 0.9 | 0.3 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 80.0% | 82.2% |
| 0.9 | 0.3 | 0.7 | 0.0% | 0.0% | 100.0% | 50.0% | 92.5% | 83.4% |
| 0.9 | 0.5 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 73.8% | 80.3% |
| 0.9 | 0.5 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 80.0% | 82.2% |
| 0.9 | 0.5 | 0.7 | 0.0% | 0.0% | 100.0% | 50.0% | 92.5% | 83.4% |
| 0.9 | 0.7 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 73.8% | 80.3% |
| 0.9 | 0.7 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 80.0% | 82.2% |
| 0.9 | 0.7 | 0.7 | 0.0% | 0.0% | 100.0% | 50.0% | 92.5% | 83.4% |
| 0.95 | 0.3 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 65.0% | 80.3% |
| 0.95 | 0.3 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 71.3% | 82.2% |
| 0.95 | 0.3 | 0.7 | 0.0% | 0.0% | 100.0% | 50.0% | 83.8% | 83.4% |
| 0.95 | 0.5 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 65.0% | 80.3% |
| 0.95 | 0.5 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 71.3% | 82.2% |
| 0.95 | 0.5 | 0.7 | 0.0% | 0.0% | 100.0% | 50.0% | 83.8% | 83.4% |
| 0.95 | 0.7 | 0.3 | 0.0% | 0.0% | n/a | 0.0% | 65.0% | 80.3% |
| 0.95 | 0.7 | 0.5 | 0.0% | 0.0% | 100.0% | 25.0% | 71.3% | 82.2% |
| 0.95 | 0.7 | 0.7 | 0.0% | 0.0% | 100.0% | 50.0% | 83.8% | 83.4% |

## Misjudgements (Jev raw, per call, not in acceptable set)

- **temporarily irrelevant** (5): H02.A:schema: TRUNCATE→DROP (CRITICAL) ×5
