# 12 — The Extractor in the app

Type: AFK
Status: ready-for-agent
User stories: 10, 11, 15, 18, 19, 20, 21, 23

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

The slice that removes most of her typing. Every document with a text layer and no eKasa UID —
issued and received invoices, tickets, ride-hailing invoices filed with the receipts — is read by
the local model, checked, and shown to her pre-filled (ADR 0017). It replaces PRD 0001 slice 11.

End to end: discovery runs the pipeline from PRD 0002 — a UID first (slices 01 and 02), otherwise
the text goes to the `Extractor` from slice 10; `ExtractionChecks` sets each field's check state; the
result is written as the `extracted` payload and shown in the fields panel from slice 06, with
flagged and empty fields distinct and roles derived from the company profile. A document whose
`docTypeHint` is `proforma` shows "looks like a proforma" and stays hers to decide; a credit note's
negative amounts are accepted.

Extraction runs in the background, a few documents at a time, and the workbench shows progress
rather than blocking. When the model service is unreachable the document stays pending and is
retried on the next sweep; it never becomes a hard failure because a box was switched off. Her
confirmed payload always survives a re-read. Nothing leaves machines we control: the only calls are
to the configured model service.

## Acceptance criteria

- [ ] Text-layer documents without an eKasa UID go to the `Extractor`; eKasa receipts never do
- [ ] The `extracted` payload is written with `source: "model"` and a check state per field
- [ ] Flagged and empty fields are visibly distinct in the fields panel, and roles are derived from the profile
- [ ] A multi-rate document shows each rate
- [ ] The proforma hint appears and does not change her decision
- [ ] Credit notes with negative amounts are not flagged for their sign
- [ ] Extraction runs in the background with bounded concurrency and visible progress
- [ ] An unreachable model service leaves documents pending and retried later, not failed
- [ ] Her confirmed payload survives a re-extraction, which rewrites only the extracted one
- [ ] Extraction events are recorded with their source
- [ ] Integration test: a text-layer invoice with the stub `Extractor` ends with checked fields and derived roles
- [ ] E2E: open a month with a pending invoice, see it fill from the stub, correct one field, reload, and see the correction persist

## Blocked by

- 10 — Local model sidecar and checked extraction in the harness
- 06 — Invoice fields and derived roles
