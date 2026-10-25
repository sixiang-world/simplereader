# Performance checks and remaining limits

`node test/browser-performance.mjs` (after `npm run build`) records a 10,000-line
DOM lookup and 500/2,000-book metadata reads in a fresh Chromium context. It
asserts algorithmic/retention properties, not machine-specific wall-clock limits.

Observed in this cloud run: 15 geometry reads for 10,000 rendered lines; first
forced layout + lookup 228.1 ms, a second warm lookup below timer resolution.
The earlier run's cold observation was 437.8 ms, illustrating layout/cache/noise.
These are not steady-state FPS figures and do not prove the cold layout cost
has disappeared. Metadata projection read 500 rows in 33.1 ms and 2,000 in
44.9 ms; returned rows retain no File/Blob fields. Times are illustrative, not
portable thresholds or a before/after speedup claim.

Implemented low-risk changes: metadata-only cursor projection, old-language
migration at the data boundary, one worker save instead of size/chunk/write
round trips, logarithmic flow geometry lookup, coalesced font notifications,
one DOM parse per EPUB chapter, decompression/node/depth/line budgets and
abortable conversion, bounded off-thread regular expressions. Functional tests
remain the primary gate; malformed and over-budget EPUBs fail explicitly.

Deliberately retained: flow mode accumulates DOM and is still experimental.
Do not claim bounded heap for an unlimited session. Window pruning requires
backscroll/anchor/image-height/selection measurements before implementation.
TXT fast opening still parses an initial prefix then recomputes the whole book;
this is documented behavior, not claimed streaming. Incremental title detection
and page/history compatibility require a separate measured design before a
streaming rewrite. The pagination algorithm and distinct canvas/DOM cover
fallbacks were preserved.
