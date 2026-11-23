# 15 — A faster streak filter for QR retries

Type: AFK
Status: done

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

The pipeline speed investigation found one project function among the reading lane's CPU costs:
`closeLightStreaks`, which closes print-head streaks before a QR retry. It was up to 23% of in-Node
CPU on the benchmark corpus, though only on documents whose first QR decode fails. It computes a
one-dimensional minimum by scanning the whole window for every pixel (O(pixels × width)), four times
per failed decode.

Rewrite it as a linear-time one-dimensional minimum filter (sliding-window deque, or van Herk/Gil-Werman),
in TypeScript, with **identical output**:

- the same luminance weights and rounding into the output array;
- the same edge handling (out-of-range neighbours ignored);
- both axes;
- alpha 255.

No Rust: the gain is too small to justify a toolchain in the image.

## Acceptance criteria

- [x] The existing streak tests pass unchanged.
- [x] A randomised equivalence test compares the new implementation with the current one (kept in the test as the reference) over random rasters: several sizes including 1×N and N×1, widths 3 and 5, both axes. The output is byte-identical.
- [x] A micro-benchmark note in this issue: the time for a 2000×1500 raster, before and after.

## Done

`closeLightStreaks` now runs a monotonic-deque sliding-window minimum per row (`across: "x"`) or per
column (`across: "y"`). The luminance loop and the Uint8Array rounding are unchanged. The randomised test
covers sizes 1×1, 1×9, 9×1, 2×7, 7×2, 5×5, 13×9, 200×150, widths −3, 0, 1, 2, 2.5, 3, 4, 5, 6, 7 and 40,
both axes, full-range and binary (tie-heavy) rasters. Every case is byte-identical to the original.

### Benchmark

2000×1500 random RGBA raster, median of 5 runs after one warm-up (Node v25.2.1, macOS, run via tsx):

| Axis | Width | Before | After |
| ---- | ----- | ------ | ----- |
| x    | 5     | 52.2 ms | 40.5 ms |
| y    | 5     | 61.1 ms | 45.2 ms |
| x    | 15    | 120.4 ms | 42.6 ms |
| y    | 15    | 148.3 ms | 46.8 ms |

Width 5 is the case the issue asked for, and the gain there is modest: the old code did only five
comparisons per pixel. The rest of the time is the luminance pass and RGBA expansion, which both
versions share. The old cost grows with width and the new cost does not, so the gap widens for wider
windows. Outputs on the 2000×1500 raster were byte-identical to the original for widths 3 and 5 on both axes.

## Blocked by

None - can start immediately
