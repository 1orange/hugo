# 15 — A faster streak filter for QR retries

Type: AFK
Status: ready-for-agent

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

- [ ] The existing streak tests pass unchanged.
- [ ] A randomised equivalence test compares the new implementation with the current one (kept in the test as the reference) over random rasters: several sizes including 1×N and N×1, widths 3 and 5, both axes. The output is byte-identical.
- [ ] A micro-benchmark note in this issue: the time for a 2000×1500 raster, before and after.

## Blocked by

None - can start immediately
