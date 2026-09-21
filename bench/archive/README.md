# Retired experiments

The v0.3 runtime and its tests are preserved for reproducibility, not installed.
They include probabilistic write-time trimming, old-context shadow pruning, and
cache/connection experiments. index-v03.ts uses seen-v03.ts to preserve the prior
semantics; the MVP uses src/index.ts and src/seen.ts instead.

Run archived runtime integration tests with `npm run test:archive`. Other research
helpers now reside in bench/experimental/. No archive file is part of the package.
