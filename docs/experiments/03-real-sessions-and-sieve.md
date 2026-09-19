# Experiment 03: Real-session replays, and the sieve

**Status:** done, shipped in v0.2 · **Public results:** `results/writetime-sieve-{dev,holdout,holdout2}.json`, `results/writetime-v02-*.json` · **Private per-item records:** `results-private/` (gitignored; they contain real session content) · **Findings:** F11–F18

## Why

Experiments 01 and 02 used synthetic sessions written by the same person who wrote the questions. This experiment replays **real** pi sessions: 20 local sessions and 8,741 tool results, with the user's consent to send their content to Jev. The goal is to see whether the synthetic results hold.

## Weak labels

Real sessions have no ground truth, so we use a weak one.

- **Fact:** a distinctive token. That is a path, a dotted or underscored identifier, an error code, a number with 4 or more digits, or a long camelCase word.
- **Write time:** a trimmed output "hid something needed" if a fact from its omitted part is used by the agent (text or tool arguments) or the user later, and no later tool result supplied that fact first. Without the "supplied first" check, the same data reads 57% instead of 17%. This label is noisy, and its noise mostly overcounts.
- **Old context:** an old result is "needed later" if it is the only source, as of the checkpoint, of a fact that is used after the checkpoint and before anything supplies it again.

## Results

### Write time, v0.1 "keep only what Jev selects"

Replayed on 365 real outputs:

| | |
|---|---|
| outputs trimmed | 48% |
| eligible tokens saved | 44% |
| trims that hid a fact used later | **17.2%** |
| … block mode (search results, listings, grep) | 23.4% |
| … line mode (logs) | 12.6% |

Two causes, found by reading the hits:

- code viewed through wrapped commands (`ssh host 'sed -n …'`, `cd x && sed …`);
- exploratory outputs whose items the agent later picks from.

### Code guards

- the viewer check applies anywhere in a compound command;
- source-code detection;
- failure lines and nearby `file:line` locations are always kept;
- omitted blocks leave a skeleton.

With these, the rate falls to **10.6%**, with 0 of 12 on failing commands.

### Old context, 300 weakly-needed pairs

| policy | needed items dropped |
|---|---|
| raw Jev | 73.3% |
| hybrid (source protection + guarded thresholds) | **21.3%** |
| rules only | 24.3% |

On synthetic data the hybrid scored 0%. On real data it does not come close, so old-context DROP stays in shadow mode.

### Write time, v0.2 sieve

Every block is judged. A block is hidden only if P(needed) < 0.15. Uncertain blocks stay, and every code guard still applies.

Synthetic sets, official endpoint, 3 repeats:

| set | trimmed when it should be | false trims | key lines kept | tokens saved |
|---|---|---|---|---|
| dev (13) | 87.5% | 0/15 | 100% | 45% |
| held-out (12) | 100% | 0/15 | 100% | 53% |
| **held-out 2 (7, written before the guards ran)** | **100%** | **0/9** | **100%** | 31% |

Real replay, 184 outputs, with the threshold swept offline over recorded probabilities:

| hide if P < | outputs rewritten | tokens hidden | outputs with a later-used block hidden |
|---|---|---|---|
| 0.10 | 4.9% | 3.6% | 0/9 |
| **0.15** | 23.4% | **19.2%** | **1/43** |
| 0.20 | 42.4% | 43.2% | 2/78 |
| 0.30 | 63.6% | 58.1% | 3/117 |

Only 8 blocks in the replay carried the "used later" label, so these regret rates are rough. The one case at 0.15 is a block of passing tests whose name the agent repeated in its summary.

### End to end in real pi

5 of 5 runs on the 509-line failing log:

- sieve rewrote 5,115 → about 1,300 tokens;
- the model named both failures with `file:line` every time;
- Jev took 560–650 ms per call.

## Lessons

1. **Synthetic benchmarks overestimate safety.** Every synthetic "0%" in this project became a non-zero number on real sessions.
2. **Hide what is confidently useless; do not keep only what looks useful.** The asymmetry matters more than the question wording.
3. **Let code own the invariants.** These should never be left to a model's probability:
   - failures always survive;
   - a hidden block must have been seen in full;
   - "only parts matter" cannot mean "nothing matters";
   - request terms protect their blocks.
4. **Jev reads blocks as wholes.** One relevant line inside an unrelated block can score 0.07.

## Limitations

- 20 sessions from one user, mostly Swift, Python and TypeScript work, with some Chinese requests.
- The labels are weak and the counts of "needed" items are small.
- The comparison with v0.1 uses the same label, but the eligible sets differ because v0.2 excludes code views.
