# Read scope experiment — v0.7.1, no runtime changes

**Model performance first. Smaller tool outputs are not sufficient evidence of improvement.**

## Local workload

`node bench/read-inventory.ts --out results/read-inventory-v071-02.json`

The current local snapshot has 25 non-temporary session files and 3,496 successful,
text-only reads with recoverable input arguments (all branches). It differs from
older inventories in snapshot and inclusion criteria; it is not a time trend.
No private content was sent to a model or included in published results.

| Read category | Estimated tokens |
| --- | ---: |
| Source code | 1,679,704 |
| Documentation | 550,584 |
| Structured data | 126,654 |
| Agent instructions | 115,713 |
| Other | 74,987 |

Source code accounts for 65.9% of read tokens. 161 source reads (84,747 tokens,
5.0%) exactly repeat the most recent ancestor read at the identical literal path,
offset and limit. Of these, 121 reads / 64,873 tokens cross a user-message boundary.
This is potential redundancy, not removable context: the inventory does not check
visibility, compaction, freshness or intervening mutations. Different ranges and
path aliases are not compared. Exact equality includes the full returned text.

Only 319 source reads / 225,647 tokens (13.4%) omit both offset and limit. Thus
unbounded whole-file reads are a limited opportunity, not the explanation for all
source-read volume. Range parameters alone do not prove a read was well scoped.
The initial `read-inventory-v071-01.json` lacks the additional unbounded counters;
`02` is the primary inventory. Both are retained.

## Frozen live experiment

Commands:

```sh
node bench/live/read-scope.ts --reps 2 --out results/live-read-scope-v071-01.json
node bench/live/read-scope.ts --reps 1 --out results/live-read-scope-v071-diagnostic-01.json
```

Actual installed Pi SDK, `antigravity/gemini-3.8-flash`, same stable tools and
production extension with dedupe/sieve on. Synthetic 100-function source file,
three sequential questions per session:

1. Read a policy value and resolve its dependency elsewhere in the source.
2. After an external source change, distinguish the previously observed value from
   the current value.
3. Retrieve an initially unrequested policy and resolve its dependency.

Whole condition explicitly requests complete source reads. Scoped condition asks
for search, ranges and relevant dependencies, allowing more reading when needed.
Exact JSON files and unchanged current source are graded; 90 seconds per phase,
30 agent turns per session. Fixture paths are temporary; no private source used.
This compares prescribed tool-use strategies, not baseline autonomous behavior,
semantic deletion, active Jev quality or the safety of hiding source code.

## Results

Primary paired run: two repetitions, reversed order on the second repetition.

| Metric, summed | Whole | Scoped |
| --- | ---: | ---: |
| Correct graded answers | 6/6 | 6/6 |
| Sessions preserving current source | 2/2 | 2/2 |
| Read/bash/recall returned estimated tokens | 33,731 | 7,264 |
| Read calls | 9 | 16 |
| Bash calls (all commands, not only search) | 6 | 12 |
| Wall time, summed seconds | 64.35 | 78.16 |
| Reported input tokens | 244,608 | 248,527 |
| Reported cache-read tokens | 195,275 | 0 |
| Tool errors, recovered | 1 | 2 |

Returned text fell 78.5%, but calls increased, time increased 21.5%, and reported
input did not improve. Extra model turns reprocess context. Provider cache counters
also differ; they do not establish why a cache hit occurred, nor a causal cache
regression. No billing-cost estimate is made. Output estimates use characters/4;
provider usage counters are reported separately.

Diagnostic repeat with tool-call details: 3/3 correct answers per condition;
returned tokens 16,736 vs 1,193; time 30.74s vs 44.82s; reported input 108,844 vs
66,263; cache-read 113,989 vs 0. Both had one recovered `git status` failure because
the temporary fixture was not a Git repository. These calls were extra model
behavior. The original run did not retain tool-error text, so its errors cannot
be retrospectively assigned this cause. The diagnostic was launched before the
primary run ended: some requests overlap, so timings are descriptive, not a clean
latency benchmark. Future timing comparisons should be serial.

Across all six sessions / 18 graded answers: all passed, current source preserved,
no provider errors, no Jev decisions/failures, no plugin rewrites, no hidden tokens,
and no recalls. The benefit here came from requesting less source, not compression.
The first scoped primary phase still returned 5,598 estimated tokens, nearly a full
file. Strategy compliance and efficiency vary even on this small fixture.

## Decision

Do not relax cross-user read freshness or enable semantic source filtering based
on these results. Real source volume is large, but demonstrably identical reads
are a small part of it. This fixture has task-irrelevant source that can be left
unread initially, yet multi-step navigation can cost more than it saves.

A next bounded experiment could batch locating a symbol and retrieving its nearby
source plus dependencies in fewer calls, retaining explicit source line numbers
and allowing full reads. Compare against autonomous baseline behavior on real,
public repositories with serial execution and harder multi-file dependencies.
Do not introduce a production tool or filtering policy until that experiment wins
on correctness and total cost/latency, rather than returned text alone.

Validation: 77 existing tests passed; TypeScript typecheck passed. Runtime code,
model configuration, prompt history and package version were not changed.
