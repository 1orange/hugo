# 06 — Threads and slots on the model node

Type: HITL — measured on node-hetzner; the setting is a decision
Status: open

## What to build

The extractor runs on node-hetzner, ARM64 with 8 Neoverse-N1 cores (dotprod, no i8mm) and 16 GB.
llama.cpp uses 4 threads and 1 slot, with a CPU request of 2. The node's current use is low, but other
workloads have 4.7 of its 8 CPUs reserved.

Measure documents per minute on the node, with the stage timings from 01, for:

- threads 4, 6 and 8 with one slot. Prompt reading is compute-bound and should scale with threads.
- 2 slots at the best thread count, with `-c 16384`. The context is shared between slots, so each
  keeps its 8192. Writing several answers at once is cheaper per token than one after another.

Then set threads, `-np`, `-c` and the CPU request in the flux manifests. KV cache costs about 1.2 GiB
per 8192-token slot for Qwen3-4B, which must fit the 6 GiB limit. With 03 done, the worker follows
`-np` by itself.

## Acceptance criteria

- [ ] Documents per minute and median/p90 per document recorded for each setting in an ADR 0017 amendment.
- [ ] The chosen threads, slots, context and CPU and memory requests are applied in the flux repository. The accountant-visible median does not get worse.

## Blocked by

- 01 — Show where a document's time goes
- 03 — The worker takes its model concurrency from the model server
