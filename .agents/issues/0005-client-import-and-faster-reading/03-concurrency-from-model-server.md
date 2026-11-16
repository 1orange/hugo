# 03 — The worker takes its model concurrency from the model server

Type: AFK
Status: open

## What to build

The model lane's concurrency must equal llama.cpp's `-np`, which today is set in two places: `-np` on
the extractor, and `EXTRACTOR_CONCURRENCY` in the config map. If they drift, documents either queue at
the server, where they can time out, or leave a slot idle.

At start, the worker asks the model server how many slots it has (llama.cpp's `/props`,
`total_slots`). It sets the model lane's global concurrency to that number and logs it. While the
server cannot be reached, it uses `EXTRACTOR_CONCURRENCY`, or 1, and asks again when the service
monitor sees the model come back. Other servers (Ollama) fall back the same way.

## Acceptance criteria

- [ ] With a fake server reporting 2 slots, the model lane runs 2 documents at once without `EXTRACTOR_CONCURRENCY` set.
- [ ] Without `/props`, or with the server down, the env value (or 1) is used. It is corrected when the server comes back.
- [ ] The deploy README and config comments say `-np` is now the only setting. `EXTRACTOR_CONCURRENCY` is only a fallback.

## Blocked by

- 02 — Documents that need no model don't wait for it
