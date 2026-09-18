# pi-jev-context shadow evaluation

- file: `results/run-q1.json`
- model: `typesafe/jev-1.13-20260917` (requested `~typesafe/jev-latest`), questions `q1`, repeats per item: 5
- items: 37 (from 26 cases), critical: 18, Jev calls: 185 (0 failed)
- latency: p50 **308 ms**, p95 **433 ms**, max 571 ms
- cost: **$0.012311** total, $0.0000665 per call, 1584 input tokens per call

## Metrics

Per call (every repeat counted):

| policy | acc | lenient acc | KEEP recall | retention | **critical false drop** | false drop | TRUNCATE acc | DROP precision | DROP recall | UNCERTAIN | token savings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| jev raw | 87.0% | 87.0% | 86.7% | 85.0% | **11.1%** | 15.0% | 80.0% | 83.5% | 89.4% | 0.0% | 92.2% |
| jev safe | 83.8% | 89.7% | 86.7% | 91.0% | **4.4%** | 9.0% | 80.0% | 88.6% | 82.4% | 0.0% | 90.9% |
| jev composite | 58.4% | 78.4% | 86.7% | 95.0% | **0.0%** | 5.0% | 96.0% | 79.2% | 22.4% | 0.0% | 87.5% |

Per item, majority of 5 repeats (ties → safer):

| policy | acc | lenient acc | KEEP recall | retention | **critical false drop** | false drop | TRUNCATE acc | DROP precision | DROP recall | UNCERTAIN | token savings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| jev raw | 86.5% | 86.5% | 86.7% | 85.0% | **11.1%** | 15.0% | 80.0% | 83.3% | 88.2% | 0.0% | 92.1% |
| jev safe | 83.8% | 89.2% | 86.7% | 90.0% | **5.6%** | 10.0% | 80.0% | 87.5% | 82.4% | 0.0% | 91.0% |
| jev composite | 59.5% | 78.4% | 86.7% | 95.0% | **0.0%** | 5.0% | 100.0% | 80.0% | 23.5% | 0.0% | 87.5% |
| rules only (no Jev) | 73.0% | 81.1% | 93.3% | 95.0% | **5.6%** | 5.0% | 60.0% | 90.9% | 58.8% | 0.0% | 83.1% |
| always KEEP | 40.5% | 45.9% | 100.0% | 100.0% | **0.0%** | 0.0% | 0.0% | n/a | 0.0% | 0.0% | 0.0% |

Critical false drops (per call): jev raw: C05.A:pkg, C16:ver · jev safe: C05.A:pkg · jev composite: none

## Confusion matrices

**Jev raw, per call** (rows = truth, columns = prediction)

| truth \ pred | KEEP | TRUNCATE | DROP | UNCERTAIN |
|---|---|---|---|---|
| KEEP | 65 | 0 | 10 | 0 |
| TRUNCATE | 0 | 20 | 5 | 0 |
| DROP | 9 | 0 | 76 | 0 |

**Jev composite, per call** (rows = truth, columns = prediction)

| truth \ pred | KEEP | TRUNCATE | DROP | UNCERTAIN |
|---|---|---|---|---|
| KEEP | 65 | 5 | 5 | 0 |
| TRUNCATE | 1 | 24 | 0 | 0 |
| DROP | 20 | 46 | 19 | 0 |

**rules only** (rows = truth, columns = prediction)

| truth \ pred | KEEP | TRUNCATE | DROP | UNCERTAIN |
|---|---|---|---|---|
| KEEP | 14 | 0 | 1 | 0 |
| TRUNCATE | 2 | 3 | 0 | 0 |
| DROP | 6 | 1 | 10 | 0 |

## Stability

Raw choice identical across all 5 repeats for 36/37 items.

## Per item

| item | category | truth (acceptable) | crit | Jev raw picks | p(choice) | conf | needed_now | superseded | unique | durable | user_req | noise | composite | ok? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C01:pwd | stale directory info | DROP (DROP) |  | DROP DROP DROP DROP DROP | 1.00 | 1.00 | 0.09 | 0.05 | 0.70 | 0.48 | 0.05 | 0.57 | TRUNCATE | ✗ |
| C01:ls | stale directory info | DROP (DROP) |  | DROP DROP DROP DROP DROP | 1.00 | 1.00 | 0.12 | 0.04 | 0.43 | 0.56 | 0.05 | 0.43 | TRUNCATE | ✗ |
| C01:find | stale directory info | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.97 | 0.95 | 0.25 | 0.04 | 0.56 | 0.67 | 0.06 | 0.44 | TRUNCATE | ✓ |
| C02:fail | superseded failure | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.97 | 0.96 | 0.34 | 0.95 | 0.79 | 0.56 | 0.06 | 0.83 | TRUNCATE | ✓ |
| C02:pass | superseded failure | KEEP (KEEP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.89 | 0.86 | 0.10 | 0.05 | 0.47 | 0.26 | 0.05 | 0.84 | DROP | ✗ |
| C03:root | old but critical | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.97 | 0.96 | 0.89 | 0.03 | 0.91 | 0.59 | 0.06 | 0.43 | KEEP | ✓ |
| C03:lsTests | old but critical | DROP (DROP) |  | DROP DROP DROP DROP DROP | 1.00 | 0.99 | 0.15 | 0.04 | 0.50 | 0.56 | 0.07 | 0.46 | TRUNCATE | ✗ |
| C04:log | very long log | TRUNCATE (TRUNCATE) | yes | TRUNCATE TRUNCATE TRUNCATE TRUNCATE TRUNCATE | 0.99 | 0.98 | 0.95 | 0.03 | 0.88 | 0.85 | 0.02 | 0.89 | TRUNCATE | ✓ |
| C05.A:pkg | temporarily irrelevant | TRUNCATE (TRUNCATE/KEEP) | yes | DROP DROP DROP DROP DROP | 0.71 | 0.62 | 0.17 | 0.04 | 0.73 | 0.91 | 0.13 | 0.55 | TRUNCATE | ✓ |
| C05.B:pkg | temporarily irrelevant | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.75 | 0.67 | 0.93 | 0.03 | 0.84 | 0.94 | 0.05 | 0.59 | KEEP | ✓ |
| C06:g | empty grep (stale) | DROP (DROP) |  | DROP DROP DROP DROP DROP | 0.98 | 0.97 | 0.10 | 0.05 | 0.28 | 0.22 | 0.05 | 0.45 | DROP | ✓ |
| C07:g | empty grep (evidence) | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.67 | 0.55 | 0.77 | 0.04 | 0.28 | 0.15 | 0.10 | 0.21 | KEEP | ✓ |
| C07:g2 | empty grep (evidence) | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.80 | 0.73 | 0.73 | 0.04 | 0.58 | 0.25 | 0.09 | 0.35 | KEEP | ✓ |
| C08:gs1 | repeated git status | DROP (DROP) |  | DROP DROP DROP DROP DROP | 0.98 | 0.97 | 0.28 | 0.90 | 0.59 | 0.45 | 0.10 | 0.78 | DROP | ✓ |
| C08:gs2 | repeated git status | DROP (DROP) |  | DROP DROP DROP DROP DROP | 0.95 | 0.93 | 0.29 | 0.75 | 0.68 | 0.44 | 0.10 | 0.78 | DROP | ✓ |
| C09:f1 | repeated test failure | DROP (DROP/TRUNCATE) |  | KEEP KEEP KEEP DROP KEEP | 0.49 | 0.32 | 0.88 | 0.16 | 0.49 | 0.57 | 0.04 | 0.81 | KEEP | ✗ |
| C09:f2 | repeated test failure | DROP (DROP/TRUNCATE) |  | KEEP KEEP KEEP KEEP KEEP | 0.60 | 0.46 | 0.91 | 0.14 | 0.76 | 0.61 | 0.04 | 0.79 | KEEP | ✗ |
| C09:f3 | repeated test failure | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.95 | 0.93 | 0.92 | 0.03 | 0.92 | 0.62 | 0.03 | 0.79 | KEEP | ✓ |
| C10:trace | old stack trace (resolved) | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.91 | 0.89 | 0.08 | 0.05 | 0.73 | 0.59 | 0.05 | 0.55 | TRUNCATE | ✓ |
| C11:trace | old stack trace (unresolved) | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.89 | 0.84 | 0.88 | 0.03 | 0.92 | 0.62 | 0.03 | 0.54 | KEEP | ✓ |
| C12:diff | old git diff | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.81 | 0.75 | 0.07 | 0.06 | 0.62 | 0.48 | 0.06 | 0.91 | TRUNCATE | ✓ |
| C13:lint | fixed lint error | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.98 | 0.97 | 0.17 | 0.80 | 0.77 | 0.61 | 0.05 | 0.73 | TRUNCATE | ✓ |
| C14:adr | architecture decision | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.98 | 0.96 | 0.88 | 0.03 | 0.84 | 0.92 | 0.05 | 0.33 | KEEP | ✓ |
| C15:find | file path | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.82 | 0.75 | 0.93 | 0.04 | 0.81 | 0.78 | 0.05 | 0.21 | KEEP | ✓ |
| C16:ver | version number | KEEP (KEEP/TRUNCATE) | yes | DROP DROP DROP DROP DROP | 0.62 | 0.49 | 0.19 | 0.04 | 0.81 | 0.85 | 0.06 | 0.83 | TRUNCATE | ✓ |
| C17:api | API name | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.99 | 0.98 | 0.96 | 0.03 | 0.92 | 0.87 | 0.05 | 0.33 | KEEP | ✓ |
| C18:log | user-requested evidence | KEEP (KEEP) | yes | KEEP KEEP KEEP KEEP KEEP | 0.80 | 0.73 | 0.45 | 0.04 | 0.79 | 0.37 | 0.92 | 0.61 | KEEP | ✓ |
| C19:old | superseded config value | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.81 | 0.74 | 0.90 | 0.93 | 0.64 | 0.67 | 0.05 | 0.28 | KEEP | ✗ |
| C19:new | superseded config value | KEEP (KEEP/TRUNCATE) |  | KEEP KEEP KEEP KEEP KEEP | 0.91 | 0.88 | 0.91 | 0.04 | 0.82 | 0.68 | 0.06 | 0.24 | KEEP | ✓ |
| C20:v1 | same file old/new read | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.93 | 0.90 | 0.58 | 0.93 | 0.57 | 0.59 | 0.05 | 0.22 | KEEP | ✗ |
| C20:v2 | same file old/new read | KEEP (KEEP) | yes | KEEP KEEP KEEP KEEP KEEP | 0.97 | 0.96 | 0.91 | 0.03 | 0.84 | 0.71 | 0.05 | 0.15 | KEEP | ✓ |
| C21:css | goal changed | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.96 | 0.94 | 0.04 | 0.71 | 0.73 | 0.49 | 0.05 | 0.19 | DROP | ✓ |
| C22:build | irrelevant big build log | DROP (DROP/TRUNCATE) |  | DROP DROP DROP DROP DROP | 0.63 | 0.50 | 0.06 | 0.04 | 0.87 | 0.74 | 0.04 | 0.92 | TRUNCATE | ✓ |
| C23:root | old but critical (Chinese) | KEEP (KEEP/TRUNCATE) | yes | KEEP KEEP KEEP KEEP KEEP | 0.91 | 0.87 | 0.79 | 0.03 | 0.92 | 0.47 | 0.11 | 0.40 | KEEP | ✓ |
| C24:tsc | very long log (repetitive) | TRUNCATE (TRUNCATE) | yes | TRUNCATE TRUNCATE TRUNCATE TRUNCATE TRUNCATE | 0.74 | 0.65 | 0.93 | 0.07 | 0.75 | 0.75 | 0.03 | 0.79 | TRUNCATE | ✓ |
| C25:vite | config value in long file | TRUNCATE (TRUNCATE/KEEP) | yes | TRUNCATE TRUNCATE TRUNCATE TRUNCATE TRUNCATE | 0.78 | 0.71 | 0.78 | 0.04 | 0.88 | 0.84 | 0.30 | 0.95 | TRUNCATE | ✓ |
| C26:logs | very long log (one key line) | TRUNCATE (TRUNCATE) | yes | TRUNCATE TRUNCATE TRUNCATE TRUNCATE TRUNCATE | 0.82 | 0.75 | 0.91 | 0.03 | 0.85 | 0.47 | 0.03 | 0.93 | TRUNCATE | ✓ |

## TRUNCATE key-line selection

Candidates are chosen by code (errors, failures, file:line, summaries); Jev marks which to keep (noul ≥ 0.5).

| item | key lines | covered by candidates | covered by Jev-kept lines | Jev kept / candidates |
|---|---|---|---|---|
| C04:log | 5 | 5/5 | 5/5 5/5 5/5 5/5 5/5 | 11/15 |
| C05.A:pkg | 1 | no candidates (not excerpted) | - | - |
| C05.B:pkg | 1 | no candidates (not excerpted) | - | - |
| C24:tsc | 3 | 3/3 | 3/3 3/3 3/3 3/3 3/3 | 7/16 |
| C25:vite | 1 | no candidates (not excerpted) | - | - |
| C26:logs | 2 | 2/2 | 2/2 2/2 2/2 2/2 2/2 | 4/4 |

## Threshold sweep (composite policy, per call)

| drop p ≥ | confidence ≥ | veto ≥ | critical false drop | false drop | DROP precision | DROP recall | lenient acc | token savings |
|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.3 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.5 | 0.3 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.5 | 0.3 | 0.7 | 0.0% | 5.0% | 91.7% | 64.7% | 86.5% | 89.6% |
| 0.5 | 0.5 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.5 | 0.5 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.5 | 0.5 | 0.7 | 0.0% | 5.0% | 91.7% | 64.7% | 86.5% | 89.6% |
| 0.5 | 0.7 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.5 | 0.7 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.5 | 0.7 | 0.7 | 0.0% | 5.0% | 91.7% | 64.7% | 86.5% | 89.5% |
| 0.6 | 0.3 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.6 | 0.3 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.6 | 0.3 | 0.7 | 0.0% | 5.0% | 91.7% | 64.7% | 86.5% | 89.6% |
| 0.6 | 0.5 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.6 | 0.5 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.6 | 0.5 | 0.7 | 0.0% | 5.0% | 91.7% | 64.7% | 86.5% | 89.6% |
| 0.6 | 0.7 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.6 | 0.7 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.6 | 0.7 | 0.7 | 0.0% | 5.0% | 91.7% | 64.7% | 86.5% | 89.5% |
| 0.7 | 0.3 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.7 | 0.3 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.7 | 0.3 | 0.7 | 0.0% | 5.0% | 91.7% | 64.7% | 86.5% | 89.6% |
| 0.7 | 0.5 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.7 | 0.5 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.7 | 0.5 | 0.7 | 0.0% | 5.0% | 91.7% | 64.7% | 86.5% | 89.6% |
| 0.7 | 0.7 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.7 | 0.7 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.7 | 0.7 | 0.7 | 0.0% | 5.0% | 91.7% | 64.7% | 86.5% | 89.5% |
| 0.8 | 0.3 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.8 | 0.3 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.8 | 0.3 | 0.7 | 0.0% | 5.0% | 91.5% | 63.5% | 86.5% | 89.4% |
| 0.8 | 0.5 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.8 | 0.5 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.8 | 0.5 | 0.7 | 0.0% | 5.0% | 91.5% | 63.5% | 86.5% | 89.4% |
| 0.8 | 0.7 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.8 | 0.7 | 0.5 | 0.0% | 5.0% | 79.2% | 22.4% | 78.4% | 87.5% |
| 0.8 | 0.7 | 0.7 | 0.0% | 5.0% | 91.5% | 63.5% | 86.5% | 89.4% |
| 0.9 | 0.3 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.9 | 0.3 | 0.5 | 0.0% | 3.0% | 86.4% | 22.4% | 79.5% | 87.4% |
| 0.9 | 0.3 | 0.7 | 0.0% | 3.0% | 94.3% | 58.8% | 87.6% | 88.8% |
| 0.9 | 0.5 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.9 | 0.5 | 0.5 | 0.0% | 3.0% | 86.4% | 22.4% | 79.5% | 87.4% |
| 0.9 | 0.5 | 0.7 | 0.0% | 3.0% | 94.3% | 58.8% | 87.6% | 88.8% |
| 0.9 | 0.7 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 72.4% | 86.6% |
| 0.9 | 0.7 | 0.5 | 0.0% | 3.0% | 86.4% | 22.4% | 79.5% | 87.4% |
| 0.9 | 0.7 | 0.7 | 0.0% | 3.0% | 94.3% | 58.8% | 87.6% | 88.8% |
| 0.95 | 0.3 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 69.7% | 86.6% |
| 0.95 | 0.3 | 0.5 | 0.0% | 0.0% | 100.0% | 22.4% | 78.4% | 87.3% |
| 0.95 | 0.3 | 0.7 | 0.0% | 0.0% | 100.0% | 52.9% | 83.8% | 88.4% |
| 0.95 | 0.5 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 69.7% | 86.6% |
| 0.95 | 0.5 | 0.5 | 0.0% | 0.0% | 100.0% | 22.4% | 78.4% | 87.3% |
| 0.95 | 0.5 | 0.7 | 0.0% | 0.0% | 100.0% | 52.9% | 83.8% | 88.4% |
| 0.95 | 0.7 | 0.3 | 0.0% | 0.0% | 100.0% | 4.7% | 69.7% | 86.6% |
| 0.95 | 0.7 | 0.5 | 0.0% | 0.0% | 100.0% | 22.4% | 78.4% | 87.3% |
| 0.95 | 0.7 | 0.7 | 0.0% | 0.0% | 100.0% | 52.9% | 83.8% | 88.4% |

## Misjudgements (Jev raw, per call, not in acceptable set)

- **repeated test failure** (9): C09:f1: DROP→KEEP ×4; C09:f2: DROP→KEEP ×5
- **superseded failure** (5): C02:pass: KEEP→DROP ×5
- **temporarily irrelevant** (5): C05.A:pkg: TRUNCATE→DROP (CRITICAL) ×5
- **version number** (5): C16:ver: KEEP→DROP (CRITICAL) ×5
