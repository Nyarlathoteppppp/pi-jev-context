# pi-jev-context

A small Pi extension that shortens repeated file reads before they enter context.
Version 0.4 keeps deterministic read deduplication and original-output recall. It
makes no Jev/model/network calls and does not implement compaction.

## Principles / 项目原则

**模型表现第一，节省 token 第二。宁可不折叠，也不隐藏模型仍需要的证据。**

1. **默认保留全文。** 只有当前有效上下文中存在同一路径、同一文件行位置的逐字相同内容，才允许折叠重复段；来源或位置不确定就原样保留。
2. **保护缓存前缀。** 只在新工具结果进入上下文之前处理它，不改写、删除、重排旧消息；模式切换不增删工具声明。不为了省 token 主动触发 compaction。
3. **表现优先于收益。** token 节省不能抵消任务正确性、约束遵守或信息获取能力的退化。可复现且归因于折叠的退化，应先禁用相关行为，再修复验证。
4. **可恢复不等于无损。** recall 是恢复途径，不能成为隐藏未知价值内容的理由。确定性匹配、测试通过都不等于模型表现绝对不变；不做“零风险”承诺。
5. **不把概率筛选放进默认路径。** sieve、旧 context pruning 和第三方 compaction 都不属于 MVP 的运行时。Pi 自身的原生 compaction 另行评估。
6. **证据决定默认值。** 真实回放衡量收益，live 任务验收检查表现；如实记录失败和样本限制，不改验收标准来美化结果。

Model performance comes first. Preserve full output unless duplicate evidence is
proven in the current context. Transform only the arriving result, preserve prior
message bytes and the tool list, and disable any behavior with a reproducible,
attributable capability regression. Cache hits and equal model performance are
validation targets, never guarantees inferred from token savings.

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
/context recalls
/context label good
/context label bad incorrect location
```

`PI_JEV_CONTEXT_MODE` or `~/.pi/agent/pi-jev-context.json` (`{"mode":"on"}`)
sets the initial mode. A saved session mode takes precedence when resumed.
`shadow` records deterministic candidates without changing output; it sends nothing
externally. Existing `envFile` settings are unused by the MVP.

## What is collapsed

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

- No in-memory sibling-read shortcut, disk hash cache, or Jev judgments.
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
On 24 local sessions: 3,670 reads; 140 rewritten; approximately 101k tokens saved
(4.1% of read tokens, 1.6% of all tool-result tokens). These are character/4
estimates, not billed token savings. See `results/seen-mvp.txt`.

`bench/live/mvp.ts` tests two filesystem-graded scenarios under off/on, with two
repetitions each, using the installed Pi SDK and Antigravity 3.8 Flash. It loads
only the provider and this extension, with no user project instructions or other
extensions. `bench/live/flash-compaction.ts` probes actual native compaction;
`bench/live/compaction-compare.ts` compares native and an explicit Wang checkout.
These scripts are local-machine experiment runners; their SDK/provider paths
are explicit. Private session inputs and summaries stay in gitignored
`results-private/`.

## Experimental history

`bench/experimental/` holds sieve, Jev transport, and policy research.
`bench/archive/` holds the retired runtime/select/pruning experiments and their
integration tests. Neither directory is shipped in the extension package or
imported by its runtime. Old research results are retained in `docs/FINDINGS.md`;
new entries supersede unsafe claims rather than rewriting the historical record.
