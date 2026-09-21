# pi-jev-context

A small Pi extension that shortens repeated file reads before they enter context and, in v0.5, can sieve narrowly classified long bash test/build/lint/diagnostic output with an active Jev judgment. Read deduplication remains deterministic and Jev never participates in its matching decision.

> [!IMPORTANT]
> **Model performance first. Token savings second.**
>
> - **When in doubt, keep it.** Dedupe needs visible exact duplicates; sieve must pass hard KEEP rules and complete Jev judgments.
> - **Protect the cache prefix.** Never rewrite old messages or change tool declarations when toggling modes.
> - **Stop on regression.** Disable folding that demonstrably harms task performance. Recall is not proof of losslessness.

## Install

```sh
pi install git:github.com/Nyarlathoteppppp/pi-jev-context
```

Reload an existing Pi session with `/reload`. Default mode is `on`.

```text
/context report
/context mode off
/context mode shadow
/context mode on
/context dedupe on
/context sieve off
/context sieve on
/context recalls
/context label good
/context label bad incorrect location
```

### Independent configuration

At startup, each layer resolves independently:
**`options.config` > environment > settings file > compatibility `mode`.**
Environment switches are `PI_JEV_CONTEXT_DEDUPE` and `PI_JEV_CONTEXT_SIEVE`;
the settings file is `~/.pi/agent/pi-jev-context.json`:

```json
{ "dedupe": "on", "sieve": "off" }
```

`/context dedupe on|off` and `/context sieve on|off` are explicit session overrides,
persisted in `jev-context-config` and restored from the active branch on reload or
tree navigation. They override startup values. `/context mode` only changes layers
without an explicit setting; **it is not a master switch**. To disable both layers,
set both to `off` explicitly. Tool declarations remain unchanged.

For old mode-only sessions: `off` disables both, `on` enables both, and `shadow`
logs dedupe candidates without rewriting (sieve off). Explicit `dedupe=on` acts even
under `mode=shadow`. The default compatibility mode is `on`.

Numeric options (also accepted in the settings file) default to `jevThreshold=0.10`,
`minHiddenShare=0.30`, and `minSavedTokens=1000`. Corresponding environment variables
are `PI_JEV_CONTEXT_JEV_THRESHOLD`, `PI_JEV_CONTEXT_MIN_HIDDEN_SHARE`, and
`PI_JEV_CONTEXT_MIN_SAVED_TOKENS`. Threshold/share must be finite numbers in [0,1];
saved tokens must be finite, nonnegative and within the safe integer range. Invalid
values use defaults. JSON/options strings are invalid; environment numeric strings
are parsed, while empty strings are invalid. The decision is strictly
**`P(needed) < jevThreshold`**, not less-than-or-equal.

## Fresh-output sieve

**`sieve=on` means active Jev participation**, using the configured TypeSafe or
OpenRouter transport. It is not shadow logging. No key means unchanged output.

Only long, successful, text-only `bash` results with an unambiguous test, build,
lint, typecheck/diagnostic, or explicit log command are eligible. Source viewers,
search/list commands, pipelines, read/edit/write results, errors, old context,
compaction, user/assistant messages, and history rewriting are excluded. Jev sees
complete structural blocks and answers relevance questions only; it does not write
summaries or visible replacement text. Deterministic guards retain failures,
warnings, complete common stack-trace regions (including cross-block frames),
diagnostics, summaries, task terms, and uncertain blocks. Rewrites save
the full original on the active branch and expose it through `context_recall`.
All Jev network/timeout, malformed-answer, parser, budget and original-persistence
failures return the full output without a replacement marker. Out-of-range Jev
probabilities are rejected, never clamped into a hide decision.
Recall is an escape hatch, not proof that hiding content preserves capability.

## Deterministic read dedupe


An incoming successful text-only `read` is compared with unshortened reads of the
same exact path string in Pi's current compaction-aware session context. Only
identical text at the same absolute file positions can match. Reads shorter than
60 lines pass through; matching spans must contain at least 30 consecutive lines,
and the replacement must save at least 30% of estimated tokens.

A short header reports folded/total file lines; markers identify absolute file
lines and the earlier read's tool-call ID. Changed
and new lines remain verbatim. Pi continuation notices are retained separately.
Original output is stored in a custom session entry before replacement. The model
can call `context_recall` with the marker's ID; its optional offset/limit refer to
**original output lines**, not absolute file lines.

No old messages are rewritten and there is no context-rewriting hook. The recall
tool remains registered in every mode. This preserves earlier message bytes;
it is not a claim that provider cache hits or model behavior are guaranteed.

## Deliberate limits

- Read dedupe uses no in-memory sibling-read shortcut, disk hash cache, or Jev judgments.
- Folded outputs are not reused as matching evidence; stored originals are for
  recall only. Compacted-away source reads cannot authorize new collapses.
- Relative and absolute path aliases are not merged. Content shifted by insertion
  at another position is kept. Up to four recent eligible source reads are checked.
- Raw session context is the source of truth. Other extensions that independently
  remove/transform old context are outside this MVP's verified configuration.
- Recall restores the output Pi originally returned, not bytes Pi had already
  truncated. Original entries stay available on the active branch after compaction.
- Removing repeated text can change attention even when it is recoverable. The
  live checks are regression smoke tests, not proof of equal model capability.

## Verification

```sh
npm test
npm run typecheck
npm run bench
npm run test:archive
```

The current offline replay uses Pi's branch/compaction boundaries, feeds each
replacement into later decisions, and never sends session content externally.
On 27 local sessions: 3,814 reads; 142 rewritten; approximately 103k tokens saved
(3.8% of read tokens, 1.5% of all tool-result tokens). These are character/4
estimates, not billed token savings. See `results/seen-v05-hardening.txt`.

`bench/live/mvp.ts` is the historical v0.4 runner; it tests two scenarios with two
repetitions each, using the installed Pi SDK and Antigravity 3.8 Flash. It loads
only the provider and this extension, with no user project instructions or other
extensions. `bench/live/flash-compaction.ts` probes actual native compaction;
`bench/live/compaction-compare.ts` compares native and an explicit Wang checkout.
These scripts are local-machine experiment runners; their SDK/provider paths
are explicit. Private session inputs and summaries stay in gitignored
`results-private/`.

The v0.5 A/B/C runner uses plugin off, dedupe only, and dedupe plus active sieve:

```sh
node --test test/lifecycle.integration.test.ts
node bench/live/v05-hardening.ts --reps 1 --out results/live-v05-new.json
node bench/live/v05-hardening.ts --reps 1 --focused --scenarios multiple-failures,delayed-fact --out results/live-v05-focused-new.json
```

It refuses to overwrite an existing result file. Filesystem predicates are fixed
before calls. Failure-exit logs exercise full retention; multiple-failure diagnostics
exit zero deliberately to exercise the sieve; delayed-fact tasks require evidence
from a previous result. Synthetic fixtures and a small pilot cannot prove capability
equivalence. Lifecycle/fault injection use deterministic tests, not live model tasks.
The SessionManager tests use the installed Pi SDK with simulated event dispatch;
they do not claim full UI, AgentSession compaction or disk-I/O integration coverage.

## Experimental history

`bench/experimental/` holds sieve, Jev transport, and policy research.
`bench/archive/` holds the retired runtime/select/pruning experiments and their
integration tests. Neither directory is shipped in the extension package or
imported by its runtime. Old research results are retained in `docs/FINDINGS.md`;
new entries supersede unsafe claims rather than rewriting the historical record.
