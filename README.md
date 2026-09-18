<div align="center">

# pi-jev-context

**Long tool output, cut to the lines that matter, before it can cost you a cache miss.**

Context trimming for the [pi](https://pi.dev) coding agent, powered by [TypeSafe Jev](https://docs.typesafe.ai). It is measured before it is trusted.

[![pi](https://img.shields.io/badge/pi-%E2%89%A50.85.1-7c5cff)](https://pi.dev)
[![Jev](https://img.shields.io/badge/powered%20by-TypeSafe%20Jev-f5a524)](https://docs.typesafe.ai)
[![tests](https://img.shields.io/badge/tests-28%20passing-2ea043)](#development)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

In real pi sessions, **96% of message tokens are tool results**. The usual fix is to rewrite old context, and that breaks the provider's prompt cache: every edit invalidates the cached prefix after it.

pi-jev-context works on the one place where trimming is free. It shortens a long output **when the output arrives**, before it has ever been sent or cached:

```
[pi-jev-context] Output shortened: 44 of 509 lines kept (chosen by Jev for the current task; kept lines are verbatim). Full output: context_recall with id "t1".
 RUN  v2.1.8 /home/dev/acme-app
… [307 lines omitted] …
 ❯ src/auth/auth.test.ts (6 tests | 2 failed) 88ms
   × auth › refreshes an expired session
…
AssertionError: expected 401 to be 200 // Object.is equality
 ❯ src/auth/auth.test.ts:42:31
…
      Tests  2 failed | 402 passed (404)
```

5,115 tokens became 421. The model still named both failures with `file:line`. When it later needed an omitted line, it called `context_recall` and got the original back, byte for byte.

## How it decides

- **Code picks the candidates.** For logs these are error, failure and summary lines. For grep, find and search output, it forms blocks by file, directory or paragraph.
- **Jev decides the rest, in one ~300 ms call.** It judges what the output is *for* (every line / specific parts / only the outcome / unclear) and which candidates the current request needs.
- **When unsure, it does nothing.** Low confidence, a user who asked for the full output, a Jev error or a timeout: the output passes through untouched.
- **Never trimmed:** `read`, `edit`, `write`, `cat`, `git diff` and other file viewers. The agent needs those verbatim the first time.

## What we measured

The full reports are in [`docs/experiments/`](docs/experiments) and the running conclusions in [`docs/FINDINGS.md`](docs/FINDINGS.md). Ground truth was committed before every live run, and held-out sets were written after the design was frozen.

**Write-time trimming** (shipped): 25 labelled fresh outputs, 5 repeats each, from bash, grep, find, MCP-style search/fetch and SQL, including Chinese requests.

| | dev | **held-out** |
|---|---|---|
| outputs that needed every line but were trimmed | 0 / 25 | **0 / 25** |
| key lines kept when trimmed | 100% | **100%** |
| trimmed when it should have been | 75% | 86% |
| tokens saved | 49% | 61% |
| latency p50 / p95 | 350 / 576 ms | 359 / 563 ms |
| cost per decision | ≈ $0.00014 | ≈ $0.00014 |

**Old-context pruning** (shadow only): 53 labelled old tool results.

| | dev | held-out |
|---|---|---|
| Jev accuracy | 87% | 94% |
| critical info dropped by raw Jev | **11%** | **12.5%** |
| … with deterministic source protection (post-hoc) | 0% | 0% |

Jev is very good at judging whether something is relevant now. It does **not** judge future value: it dropped 3 of 3 facts that were irrelevant at the time but needed later (a `package.json` engines field, a Prisma version, a schema). That is why v0.1 never rewrites old context. It only logs what it would do.

Three lessons that transfer to other Jev projects:

1. **Ask what the output is for, not which category it is in.** Situational options raised trim recall from 50% to 75–89% with zero false trims. An abstract KEEP/TRUNCATE/DROP question did not.
2. **Jev never abstains by picking `UNCERTAIN`** (0 of 265 calls). Use `confidence`, and put deterministic guards around the known blind spots.
3. **Candidate generation limits you before the model does.** When the key line was among the candidates, Jev kept it every time.

## Install

```bash
pi install git:github.com/Nyarlathoteppppp/pi-jev-context
```

It starts in **shadow** mode: it decides and logs, and never changes anything. Turn trimming on with:

```
/context mode on
```

It needs a Jev key: `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`, or a dotenv file named by `PI_JEV_ENV_FILE` (it also reads `PI_HEED_ENV_FILE`, so it shares the key with [pi-heed](https://github.com/Nyarlathoteppppp/pi-heed)). Without a key it does nothing.

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
- **Fails open.** No key, a Jev error, a 2.5 s timeout or low confidence all leave the output unchanged.
- **Never starts a turn.** It never sends messages or re-prompts the model.
- **Deterministic.** The same output always renders the same text.

**What leaves your machine:** for each long output that is considered, the call summary, your latest request, an excerpt of the output (head, notable lines, tail, block previews) and a few recent messages go to Jev. In shadow pruning, the same applies to old tool results.

## Roadmap

- [x] v0.1: write-time trimming, `context_recall`, shadow pruning with source protection, cold-cache observation
- [ ] Validate shadow pruning on real sessions (`/context report`, weakly labelled replays)
- [ ] v0.2: apply pruning only in cache-cold windows (idle gap past the TTL, model switch, compaction), as monotone stubs with recall
- [ ] v0.3: goal-change re-evaluation; pi-heed integration (never prune an active constraint's evidence)

## Development

```bash
npm install
npm test                                    # 23 tests, no network
npm run typecheck
node bench/run.ts --dry-run                 # print every Jev state for the old-context benchmark
PI_JEV_ENV_FILE=~/.env node bench/run.ts --set dev|holdout --repeats 5
node bench/report.ts results/run-XXXX.json
PI_JEV_ENV_FILE=~/.env node bench/writetime.ts --set dev|holdout --repeats 5
node bench/real-sessions.ts                 # offline census of your own ~/.pi sessions
```

MIT © Nyarlathoteppppp
