# Project principles

Model performance first; token savings second. These rules apply to implementation,
reviews, benchmarks, and documentation.

- Preserve full output unless exact duplicate evidence exists in the current,
  compaction-aware context at the same path and file positions. When uncertain,
  leave the arriving output unchanged.
- Transform only new tool results before they enter context. Never rewrite,
  remove, or reorder old messages or vary tool declarations when toggling mode.
  Do not proactively compact to improve a token-saving metric.
- Recall is a recovery mechanism, not proof of semantic losslessness. Do not claim
  zero risk, guaranteed cache hits, or unchanged model capability from line equality.
- A reproducible capability regression attributable to folding takes precedence
  over any token benefit: disable the offending behavior, then investigate and test.
- Keep probabilistic pruning and third-party compaction outside the MVP runtime.
- Fix acceptance criteria before live runs. Report failures and sample limitations;
  distinguish replay savings, synthetic task checks, and real task capability.
- Keep raw private session content and credentials out of Git; publish aggregates.
