# 11 — Invoice text extraction and field confirmation

Type: AFK
User stories: 31, 32, 33, 34, 35, 36, 37

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The slice that removes the retyping — the pain her hours actually go into.

Per ADR 0008 there is no OCR. Text is extracted locally with `pdfjs-dist`, which is free and
covers 60 of the 61 received invoices in the sample. That text goes to a small model behind the
`Extractor` port for field structuring, running on cheap text tokens rather than images. The port's
interface is stable so the implementation can be swapped or stubbed; every test uses a stub.

`InvoiceFields` normalises and validates the result. It owns the **base + VAT == total** assertion:
a misread digit in an amount is otherwise invisible downstream. It also owns currency
normalisation, date sanity, and the merge rule that **her confirmed payload always wins over a
re-extraction**. Per ADR 0004's amendment those are two separate JSON payloads on the document, not
one field set overwritten in place, so a later parser improvement cannot destroy what she typed.

The document view gains a fields panel beside the preview showing supplier, IČO, IČ DPH, invoice
number, variabilný symbol, issue date, delivery date, base and VAT per rate, total and currency.
Every field is editable and her edit persists.

Received invoices are `02`; issued invoices in `01` are in scope too, since she books revenue from
them and 39 of the sample's 151 files are issued invoices with clean text layers throughout
(ADR 0013). The same port and the same payload shape cover both.

Extraction is triggered on discovery and runs a few documents in parallel; the UI shows pending
state rather than blocking, so opening a month stays fast when many documents are new.

A scoring harness runs the extractor against slice 10's labels and reports per-field exact-match
accuracy plus the arithmetic-check pass rate. It runs on demand, not in the normal test suite.

## Acceptance criteria

- [ ] Text is extracted locally from a text-layer PDF with no external binary
- [ ] The `Extractor` port has a stub implementation used by all tests; no test calls a real model
- [ ] `InvoiceFields` passes and fails base + VAT == total correctly
- [ ] Multiple VAT rates sum correctly to the total
- [ ] Foreign currency is preserved, never silently converted to euro
- [ ] An implausible delivery date is flagged rather than accepted
- [ ] Her confirmed payload survives a subsequent re-extraction of the same document, which only rewrites the extracted payload
- [ ] Extracted fields render beside the document preview and every field is editable
- [ ] Extraction pending state is visible and does not block the month view
- [ ] Several documents extract concurrently without exhausting the box
- [ ] Scoring harness reports per-field exact-match accuracy against the labelled fixtures
- [ ] A document whose extraction fails presents an empty, editable payload with the reason stated, never silently skipped and never a separate queue
- [ ] `Extracted` events are emitted
- [ ] E2E: correct a field, reload, see the correction persist

## Blocked by

- 03 — Drive sweep to company and month tree, read-only
- 10 — Label invoices for the extraction benchmark
