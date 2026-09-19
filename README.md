<div align="center">

# pi-jev-context

**Long tool output, cut to the lines that matter, before it can cost you a cache miss.**

Context trimming for the [pi](https://pi.dev) coding agent, powered by [TypeSafe Jev](https://docs.typesafe.ai). It is measured before it is trusted.

[![pi](https://img.shields.io/badge/pi-%E2%89%A50.85.1-7c5cff)](https://pi.dev)
[![Jev](https://img.shields.io/badge/powered%20by-TypeSafe%20Jev-f5a524)](https://docs.typesafe.ai)
[![tests](https://img.shields.io/badge/tests-29%20passing-2ea043)](#development)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

In real pi sessions, **96% of message tokens are tool results**. The usual fix is to rewrite old context, and that breaks the provider's prompt cache: every edit invalidates the cached prefix after it.

pi-jev-context works on the one place where trimming is free. It shortens a long output **when the output arrives**, before it has ever been sent or cached. Nothing is paraphrased: the kept lines are verbatim, and the rest is one `context_recall` away.

```
[pi-jev-context] Output shortened: 137 of 509 lines kept verbatim. You cannot see the omitted lines; before relying on anything not shown here, call context_recall with id "t1".
 RUN  v2.1.8 /home/dev/acme-app
… [27 lines omitted] …
 ✓ src/orders/orders1.test.ts (9 tests) 11ms
… [30 lines omitted] …
 ❯ src/auth/auth.test.ts (6 tests | 2 failed) 88ms
   × auth › refreshes an expired session
   × auth › retries the original request after refresh
…
 ❯ src/auth/auth.test.ts:42:31
…
 ❯ src/auth/auth.test.ts:58:34
…
      Tests  2 failed | 402 passed (404)
… [39 lines omitted] …
```

(An excerpt of an actual rewrite from a real pi run; `…` marks lines left out of this README.)

In real pi (5 of 5 runs), this 509-line failing test log went into the context as about 1,300 tokens instead of 5,115, and the model still named both failures with `file:line`. When the model needs an omitted line, it calls `context_recall` and gets the original back byte for byte.

## How it decides (v0.2 "sieve")

**Code controls the flow; Jev is the sensor.**

- **Every block is judged.** The output is cut into blocks of up to 1,500 characters, at file, directory or paragraph boundaries. One Jev call (~350 ms) gives each block a probability that the current request needs it, and says whether the request needs every line.
- **Only confidently useless blocks are hidden** (P < 0.15). Uncertain blocks stay. An earlier version kept only what Jev selected; on real sessions that hid facts the agent used later in 17% of trims.
- **Code guarantees what must never be hidden:**
  - failure lines and the `file:line` locations next to them;
  - summary lines;
  - the first and last lines;
  - the 3 blocks Jev ranks highest;
  - any block containing a distinctive term from your request;
  - any block Jev did not see in full.

  Hidden blocks leave their first line behind as a signpost.
- **When unsure, it does nothing.** Nothing is trimmed if Jev answers "every line", if you asked for the full output, if the output looks like source code, if the command is a file viewer (`cat`, `sed`, `git diff`, …, even inside `ssh … '…'` or `cd … &&`), or if Jev errors, times out, or would hide less than 30%.
- **Never trimmed:** `read`, `edit`, `write`.

## What we measured

Full reports are in [`docs/experiments/`](docs/experiments), running conclusions in [`docs/FINDINGS.md`](docs/FINDINGS.md). Ground truth was committed before every live run, and held-out sets were written after the design was frozen. Real-session replays (20 sessions, 8,741 tool results) used weak labels, and only aggregates are published.

**Write-time trimming** (v0.2, TypeSafe endpoint, `jev-1.13.0`):

| | synthetic dev | held-out | fresh held-out 2 | **real sessions** (184 outputs) |
|---|---|---|---|---|
| outputs that needed every line but were trimmed | 0/15 | 0/15 | 0/9 | — |
| key lines kept when trimmed | 100% | 100% | 100% | — |
| trimmed outputs that hid something used later | — | — | — | **1/43** (a passing-test name) |
| tokens saved | 45% | 53% | 31% | 19% of eligible |
| latency p50 / p95 | 347 / 457 ms | 360 / 524 ms | 348 / 504 ms | 416 / 758 ms |

**Old-context pruning** (shadow only, never applied):

| | synthetic (53 items) | real sessions (300 items needed later) |
|---|---|---|
| raw Jev dropped something needed later | 11–12.5% | **73%** |
| with deterministic source protection | 0% | **21%** |

Jev is very good at judging whether something is relevant *now*. It cannot judge *future* value, and synthetic benchmarks hide how much that matters. That is why pi-jev-context never deletes old context. It only logs what it would do.

These lessons transfer to other Jev projects.

1. **Every synthetic 0% became non-zero on real sessions.** Replay real sessions before you trust a number.
2. **Hide only what is confidently useless.** Keeping only what looks useful hid more; the asymmetry mattered more than the wording.
3. **Ask what the output is *for*.** Situational options beat an abstract KEEP/TRUNCATE/DROP question (trim recall 50% → 75–89%, 0 false trims).
4. **Jev reads a block as a whole.** One relevant line inside an unrelated block scored 0.07, so protect request terms in code.
5. **Jev never picks `UNCERTAIN`** (0 of 265 calls). Use probabilities and confidence.
6. **Warm up with a real call.** The first request took 897 ms and later ones about 336 ms.

## Install

```bash
pi install git:github.com/Nyarlathoteppppp/pi-jev-context
```

It starts in **shadow** mode: it decides and logs, and never changes anything. Turn trimming on for a session with `/context mode on`, or everywhere, including pi launched from a GUI without your shell environment, with `~/.pi/agent/pi-jev-context.json`:

```json
{ "mode": "on", "envFile": "/path/to/.env" }
```

It needs a Jev key: `TYPESAFE_API_KEY` (preferred, TypeSafe's endpoint) or `OPENROUTER_API_KEY`, from the environment or from a dotenv file named by `PI_JEV_ENV_FILE`, `PI_HEED_ENV_FILE` (shared with [pi-heed](https://github.com/Nyarlathoteppppp/pi-heed)) or `envFile` above. Without a key it does nothing.

## Commands and tool

```
/context report          trims, recalls, shadow pruning decisions, cold-cache windows, Jev cost
/context mode <off|shadow|on>
/context recalls         shortened outputs on this branch
/context label <good|bad> [note]   label the latest trim
```

`context_recall(id, offset?, limit?)` is the model's tool for getting a shortened output back. It is always registered, in every mode, because the tool list is part of the cached prompt prefix and must not change when you switch modes.

## Safety properties

- **Cache-neutral.** It modifies an output only before it enters the context. The `context` hook never returns anything.
- **Lossless.** Every trimmed original is stored in the session (custom entries never reach the model) and can be recalled by id. Kept lines are verbatim; nothing is paraphrased.
- **Fails open.** No key, a Jev error, a 2.5 s timeout, an output too large for one Jev call, or low confidence all leave the output unchanged.
- **Never starts a turn.** It never sends messages or re-prompts the model.
- **Deterministic.** The same output always renders the same text.

**What leaves your machine:** for each long output that is considered, Jev receives the call summary, your latest request, the output itself (in blocks of up to 1,500 characters) and a few recent messages. In shadow pruning, the same applies to old tool results. Nothing is sent without a key.

## Roadmap

- [x] v0.1: write-time trimming, `context_recall`, shadow pruning with source protection, cold-cache observation
- [x] v0.2: sieve engine, code guards found in real-session replays, TypeSafe endpoint with warm-up, settings file
- [ ] v0.3: add what the agent said just before a call to Jev's state (real user messages are often "continue"); measure it
- [ ] v0.3: compaction experiment: in the one place where the cache is lost anyway, compare Jev-selected verbatim history (as in [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)) with pi's LLM summary, on real sessions
- [ ] pi-heed integration: never trim or prune the evidence behind an active constraint

## Known issues

- On one machine, 7 `pi -p` runs stalled at startup while another session was launching many pi processes. The stall happened before this extension's `session_start` handler ran, and it has not reproduced since. See F17 in the findings.

## Development

```bash
npm install
npm test                                    # 29 tests, no network
npm run typecheck
node bench/run.ts --dry-run                 # print every Jev state for the old-context benchmark
PI_JEV_ENV_FILE=~/.env node bench/run.ts --set dev|holdout --repeats 5
node bench/report.ts results/run-XXXX.json
PI_JEV_ENV_FILE=~/.env node bench/writetime.ts --engine sieve --set dev|holdout|holdout2 --repeats 3
node bench/real-sessions.ts                 # offline census of your own ~/.pi sessions
PI_JEV_ENV_FILE=~/.env node bench/replay.ts write --engine sieve   # replay your own sessions (sends them to Jev)
```

MIT © Nyarlathoteppppp
