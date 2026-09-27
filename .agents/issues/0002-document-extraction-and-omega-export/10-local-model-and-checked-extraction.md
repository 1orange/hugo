# 10 — Local model sidecar and checked extraction in the harness

Type: AFK
Status: ready-for-agent
User stories: 16, 17, 44, 45

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

A real model behind the `Extractor` port, and the checks that make its output safe, measured by the
slice 09 harness before anything touches her screen (ADR 0017).

End to end: a `docker compose` file runs a `llama.cpp` server (or Ollama) speaking the
OpenAI-compatible API, with the model chosen by configuration. The `Extractor` HTTP adapter sends
the document's text lines — the `|`-joined shape `pdf-access.ts` produces — and asks for
**JSON-schema-constrained output** matching the `extracted` payload, so a malformed answer cannot
come back. Thinking is a switch, off by default.

`ExtractionChecks` then decides every field's check state — correct, flagged or empty:

- **arithmetic**: base + VAT = total per rate, and the rates sum to the total;
- **grounding**: IČO, DIČ, IČ DPH, VS, document number and IBAN must occur literally in the source
  text after whitespace normalisation, or they are dropped;
- **format**: IČO checksum, `SK` + 10 digits and the `CZ` VAT-ID form, IBAN mod-97, dates near the
  document's month, VAT rates valid for the **issuer's** country (SK 23/19/5, CZ 21/12); credit
  notes' negative amounts pass.

The harness gains a mode that runs the real adapter and the checks, and reports the ADR 0017 bar
with timing measured **in Docker, CPU-only** — Docker on macOS has no access to the Apple GPU, which
approximates the deployment node.

## Acceptance criteria

- [ ] One `docker compose` file starts the model server on the Mac, with model and thinking mode set by configuration
- [ ] The `Extractor` HTTP adapter requests JSON-schema-constrained output and maps it to the `extracted` payload, with a stub used by every test
- [ ] Parties come back without roles
- [ ] `ExtractionChecks` implements arithmetic, grounding and format checks, each covered by unit tests on synthetic documents
- [ ] An identifier not present in the source text is dropped, never offered
- [ ] A rate invalid for the issuer's country is flagged; a credit note's negative amounts are accepted
- [ ] The harness runs the real adapter plus checks over the fixtures and reports the adoption bar and median time per document
- [ ] Timing is taken from the model running in Docker, and the report says so
- [ ] No test calls a real model

## Blocked by

- 09 — Benchmark fixtures and scoring from Omega's outputs
