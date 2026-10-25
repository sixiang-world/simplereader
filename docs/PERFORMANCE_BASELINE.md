# Performance checks and remaining limits

`node test/browser-performance.mjs` (after `npm run build`) records a 10,000-line
DOM lookup and 500/2,000-book metadata reads in a fresh Chromium context. It
asserts algorithmic/retention properties, not machine-specific wall-clock limits.

Observed in this cloud run: 15 geometry reads for 10,000 rendered lines; first
forced layout + lookup ~474-504 ms, a second warm lookup below timer resolution.
These are not steady-state FPS figures and do not prove the cold layout cost
has disappeared. Metadata projection read 500 rows in 9.5-14.5 ms and 2,000 in
~30-34 ms; returned rows retain no File/Blob fields. Times are illustrative, not
portable thresholds or a before/after speedup claim.

## C01 staged baseline (2026-10-25, Node v22.22.2, same machine)

Deterministic generated samples; `PERF_BASELINE_RUNS` overrides iteration
count (default 5). Timings are same-machine observations for before/after
comparison only — never thresholds. Structure counts are asserted:
10k→45,679/9,138 htmlLines, 1,253/253 titles, 425/85 pages stay identical
across runs (determinism check).

### TXT staged processing (FileProcessorCore, Node-side, same shared core as the worker)

| Sample | cold | hot median: decode / process / paginate |
|---|---|---|
| 10,000 lines (章节标题每40行、180字长行、①脚注对、空白行) | 1,420 ms | 0.7 / **1,363** / 0.2 ms |
| 50,000 lines (同构 5×) | **171,853 ms** | 4.5 / **171,851** / 0.6 ms |

**Key finding (feeds C03):** 5× the input costs ~126× the time in
`processChunkStatic` — decode (<5 ms) and pagination (<1 ms) are irrelevant;
the text-processing stage scales superlinearly (consistent with an O(n²)-class
pass, e.g. repeated whole-prefix rescans). Hot==cold rules out JIT warmup.
Opening a 50k-line TXT therefore blocks the worker for minutes after the
initial prefix — this is now quantified, not anecdotal. The 50k sample keeps
only cold+1 run in the suite so validate stays bounded.

### EPUB conversion shapes (EpubConverter, Node + linkedom, default budgets)

| Shape | cold / median | output |
|---|---|---|
| multi-short: 120 chapters × 8 paragraphs | 1,732 / 1,797 ms | 962 htmlLines |
| single-long: 1 chapter × 3,000 paragraphs | 17.1 / 17.1 ms | 3,002 htmlLines |
| illustrated: 40 chapters, shared 1px PNG (dedup cache) | 589 / 604 ms | 442 htmlLines, 80 image lines |

Chapter-count-heavy books dominate conversion time roughly linearly per
spine item; no superlinear growth observed at these sizes.

Implemented low-risk changes (earlier rounds): metadata-only cursor projection,
old-language migration at the data boundary, one worker save instead of
size/chunk/write round trips, logarithmic flow geometry lookup, coalesced font
notifications, one DOM parse per EPUB chapter, decompression/node/depth/line
budgets and abortable conversion, bounded off-thread regular expressions.

Deliberately retained: flow mode accumulates DOM and is still experimental.
Do not claim bounded heap for an unlimited session. Window pruning requires
backscroll/anchor/image-height/selection measurements before implementation.
TXT fast opening still parses an initial prefix then recomputes the whole book;
the 2026-10-25 C01 numbers above now QUANTIFY that full recompute (superlinear
process stage) — a separate measured design task (C03) is justified before any
streaming rewrite. The pagination algorithm and distinct canvas/DOM cover
fallbacks were preserved.
