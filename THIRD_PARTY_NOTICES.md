# Third-party notices

## Winnow

Project: https://github.com/GhalebDweikat/winnow

The paragraph-aware blank-line boundary rule in `src/recall.ts` is adapted from
`sidecar/src/winnow/chunk.py`. Contiguous hidden-range markers in `src/sieve.ts`
and deterministic hidden-content hints also draw on Winnow's design. The rest
of the search implementation, Pi storage integration, and protection rules are
maintained here. Source reviewed: the user-provided `winnow-main` snapshot on
2026-09-22; the downloaded archive did not supply a verified commit id.

Original license:

MIT License

Copyright (c) 2026 Ghaleb Dweikat

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
