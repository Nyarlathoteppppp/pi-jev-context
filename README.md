# pi-jev-context

**Keep repeated reads and noisy logs out of your [Pi](https://github.com/earendil-works/pi) context, without losing them.**

A Pi extension with two independent layers and a recall tool:

| | What it does | Network | Default |
|---|---|---|---|
| **Dedupe** | When a file is read again, lines you were just shown, unchanged and at the same position, become a one-line marker. | none | **on** |
| **Sieve** | Long test / build / lint logs: [Jev](https://docs.typesafe.ai) marks the passing-test noise, code keeps every failure, warning, stack trace and summary. | sends the log to Jev | **off** (opt-in) |
| **`context_recall`** | The model's tool to get any shortened output back verbatim, by id or by keyword. | none | always available |

> [!IMPORTANT]
> **Model performance first, token savings second.** When in doubt, the output passes through unchanged.
> Only output that is *arriving* is ever shortened: earlier messages are never rewritten, so the cached prompt prefix stays intact.

## What to expect

Be realistic about the savings. Replaying 24 real Pi sessions offline (3,492 file reads):

| Dedupe setting | Reads shortened | Share of all tool-result tokens saved |
|---|---|---|
| default (since your last message, within 12k tokens) | 19 | **0.2%** |
| `dedupeSameTurn: false`, `dedupeMaxAgeTokens: 50000` | 65 | 0.6% |
| no freshness limit at all | 89 | 0.9% |

Dedupe is cheap and safe, but it only helps when an agent re-reads the same part of a file within one task. The defaults favour keeping evidence close to where the model last saw it.

The sieve does more where it applies. On two small synthetic tasks it hid 35 blocks of passing-test output, about 11.8k estimated tokens (14k together with dedupe), and both tasks still passed. That is a smoke test on synthetic fixtures, not proof for your workload. Use `/context report` to see what it does in your sessions.

## Install

```sh
pi install git:github.com/Nyarlathoteppppp/pi-jev-context
```

Run `/reload` in an open Pi session. Dedupe starts working at once and needs no key.

To turn on the sieve, set a Jev key (`TYPESAFE_API_KEY`, or `OPENROUTER_API_KEY`) and then:

```text
/context sieve on
```

## Commands

```text
/context report                    what is on, what was shortened, tokens kept out of context
/context dedupe on|off
/context sieve on|off
/context recalls                   shortened outputs on this branch
/context label good|bad [note]     label the latest decision
/context mode off|shadow|on        compatibility switch, see the reference
```

The model recalls originals itself:

```js
context_recall({ id: "t12" })                         // the whole original
context_recall({ id: "t12", offset: 120, limit: 80 })  // a line range
context_recall({ query: "AuthMiddleware JWT" })        // keyword search over saved originals
```

## Configuration

Put defaults for every session in `~/.pi/agent/pi-jev-context.json`:

```json
{ "dedupe": "on", "sieve": "off", "dedupeMaxAgeTokens": 12000, "dedupeSameTurn": true, "envFile": "/path/to/.env" }
```

| Setting | Env variable | Default | Meaning |
|---|---|---|---|
| `dedupe` | `PI_JEV_CONTEXT_DEDUPE` | `on` | read dedupe |
| `sieve` | `PI_JEV_CONTEXT_SIEVE` | `off` | Jev log sieve |
| `dedupeMaxAgeTokens` | `PI_JEV_CONTEXT_DEDUPE_MAX_AGE_TOKENS` | `12000` | how far back an earlier read may be |
| `dedupeSameTurn` | `PI_JEV_CONTEXT_DEDUPE_SAME_TURN` (`true`/`false`) | `true` | only reads since your last message count |
| `jevThreshold` | `PI_JEV_CONTEXT_JEV_THRESHOLD` | `0.10` | sieve hides a block only if P(needed) is below this |
| `envFile` | `PI_JEV_ENV_FILE` | — | dotenv file to read the Jev key from |

Precedence: `/context` commands in the session, then environment, then the settings file. Invalid values fall back to the defaults. Every option is documented in the [reference](docs/REFERENCE.md#independent-configuration).

## What leaves your machine

- **Dedupe and recall:** nothing. They are local text comparison and local storage.
- **Sieve (only when on, and only with a key):** for each long test/build/lint log, Jev receives the command and its arguments, your first and latest messages in the session, what the agent said just before the call, the text of the last 8 messages, and the log itself split into blocks. Without a key the sieve does nothing.

Originals are stored as custom entries in your Pi session file, which the model never sees unless it calls `context_recall`.

## Guarantees and limits

- **Arriving output only.** Old messages are never modified, there is no context hook, and the tool list never changes when you switch layers.
- **Recoverable.** Every shortened output keeps its original on the active branch. Recall is an escape hatch, though, not proof that shortening never affects the model.
- **Fails open.** No key, a Jev error or timeout, low confidence, too little to gain, or any internal failure: the original output is returned unchanged.
- **Narrow on purpose.** Dedupe needs the same path, the same line positions, and an earlier read still in the context. The sieve only touches long logs from recognisable test/build/lint/typecheck commands. Source views, searches and pipelines are not touched.
- **Not measured broadly.** The live checks are small regression smoke tests on one model. See the [findings ledger](docs/FINDINGS.md) for what was and was not established.

## Measure it on your own sessions

From a clone (`npm install` first), offline and with nothing sent anywhere:

```sh
node bench/seen-replay.ts                                      # dedupe with the defaults
node bench/seen-replay.ts --any-turn --max-age 50000           # what a relaxed setting would save
```

## More

- [Detailed reference](docs/REFERENCE.md): exact matching and freshness rules, recall paging, validation commands.
- [Findings ledger](docs/FINDINGS.md): every experiment, including the negative results.
- Ideas informed by [Winnow](https://github.com/GhalebDweikat/winnow) (hidden-content hints, chunk boundaries; see [third-party notices](THIRD_PARTY_NOTICES.md)) and [cachebro](https://github.com/glommer/cachebro). Dedupe compares against what the model was actually shown, not the file on disk.

MIT © Nyarlathoteppppp
