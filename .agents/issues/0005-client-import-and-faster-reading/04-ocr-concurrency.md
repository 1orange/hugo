# 04 — OCR takes several requests at once

Type: AFK
Status: open

## What to build

Once the reading lane (02) runs several documents, the OCR service becomes the next queue. Today it
runs as:

- one uvicorn process;
- one RapidOCR engine, reading pages one after another;
- a 500m CPU request on node-2. That is an Intel N100 with 4 cores, whose CPU requests are already 94%
  reserved by OCR, the worker and both web replicas.

Make the OCR service read concurrently:

- a configurable number of uvicorn workers, each with its own engine;
- onnxruntime threads set per worker, so workers × threads matches the CPUs it is given;
- pages of one request read in parallel where it pays off.

Measure pages per minute with the OCR benchmark at 1, 2 and 3 concurrent requests, on an N100 or with
the CPU limited to match. Then set the deployment's CPU request, in the flux repository, to what was
measured. If node-2 cannot give it that, move it to node-3, which is idle.

## Acceptance criteria

- [ ] The OCR service takes `OCR_WORKERS` and `OCR_THREADS`, and returns the same boxes as before for the benchmark pages.
- [ ] Benchmark figures for 1/2/3 concurrent requests are recorded in ADR 0017, and the chosen setting is applied in the flux manifests.
- [ ] Recognition matches the current OCR benchmark scores (words, diacritics, numbers).

## Blocked by

- 02 — Documents that need no model don't wait for it
