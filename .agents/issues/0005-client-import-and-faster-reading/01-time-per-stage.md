# 01 — Show where a document's time goes

Type: AFK
Status: done

## What to build

Every finished job already records its total duration. It should also record how long each stage took:
download, text layer, ISDOC/MOL, QR and eKasa lookup, OCR (with its page count), the model reading the
prompt, and the model writing the answer. Take the model's two figures from llama.cpp's streamed
`timings` (`prompt_ms`, `predicted_ms`, token counts) where the server sends them, otherwise from the
stream's own clock.

*Spracovanie* shows the stages of each recently finished document. Its summary shows the median and
p90 per stage over the recent list, so a change to the worker or to the node can be judged by its
before and after.

Baseline, read from the production extractor's logs on 2026-11-16 (93 requests, Qwen3-4B Q4_0,
4 threads on the 8-core Neoverse-N1 node):

| | p50 | p90 | max |
|---|---:|---:|---:|
| Prompt tokens | 1,087 | 1,689 | 5,412 |
| Prompt (s) | 28.4 | 46.5 | 233 |
| Answer tokens | 332 | 477 | 677 |
| Answer (s) | 45.4 | 71.7 | 141 |
| Total (s) | 76.3 | 107.3 | 347 |

Prompt speed is about 40 tokens/s and answer speed 7.8 tokens/s. The answer takes 57% of the model's time.

## Acceptance criteria

- [x] A finished job's record carries each stage's duration, plus prompt and answer token counts when the model was used.
- [x] *Spracovanie* shows a document's stages and a median and p90 per stage over the recent list.
- [x] Records written before this change still display (stages missing, total kept).
- [x] Unit tests: stage timing in the progress reporter, and llama.cpp `timings` parsed from a recorded stream (fallback when absent).
- [x] A UI test covers the stage breakdown on *Spracovanie*.

## Blocked by

None - can start immediately
