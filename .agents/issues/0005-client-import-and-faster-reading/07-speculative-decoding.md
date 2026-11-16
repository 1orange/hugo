# 07 — Try speculative decoding

Type: HITL — adopted only on benchmark evidence
Status: open

## What to build

The answer is mostly the invoice's own values copied into fixed keys, which suits speculative
decoding. Benchmark both of llama.cpp's options against the adopted Qwen3-4B Q4_0 on the same
fixtures:

- a draft model: Qwen3-0.6B Q8_0, which shares the 4B's tokenizer;
- n-gram lookup on the prompt (no draft model).

First confirm that the server combines each with the JSON-schema grammar and with temperature 0. Run
the benchmark on the M4 for accuracy, then measure speed on node-hetzner.

## Acceptance criteria

- [ ] For each option: median and worst time, answer tokens per second, draft acceptance rate and benchmark accuracy, recorded in ADR 0017.
- [ ] Adopted only if faster on the node at equal accuracy. Then the extractor manifest (and the draft model's download) is updated in the flux repository and in docker-compose.

## Blocked by

- 01 — Show where a document's time goes
