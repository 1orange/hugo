# 18 — Omega TXT export path for issued invoices, bločky and iné doklady

Type: HITL
Status: BLOCKED — awaiting decision
Resolves: PRD open question 1

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Deliberately not started. Recorded so it is visible rather than forgotten.

Slice 15 covers received invoices via ISDOC, which Omega imports natively. ISDOC cannot carry
anything else. That leaves four folders with **no export path at all**:

- `01 Vystavené faktúry` — issued invoices
- `04 Bločky_hotovosť` — cash receipts
- `05 Bločky_firemná karta` — card receipts
- `06 Iné doklady` — other documents

The only channel Omega offers for these is its TXT import (`Firma – Import`), a line-prefixed
format where `R00` declares the data type, `R01` a document header and `R02` a line item. Relevant
data types are `T00` (accounting documents), `T01` (invoicing) and `T08` (payments). The
specification is an Excel file, `ImportExport_20_60.xls`, published at kros.sk/66711, and runs to
roughly 166 columns for invoicing.

The KROS Konektor API is not an alternative: it is e-shop oriented, paid, and imports only odoslané
faktúry and došlé objednávky — not received invoices, which are the actual workload.
`api-economy.kros.sk` belongs to KROS Fakturácia, their cloud invoicing product, not to Omega.

Unblocking this needs two things: the specification file, and a decision on which data type each
folder maps to. The recommended way to settle the second is to watch her import one month manually
and record which Omega evidence each document type lands in.

## Acceptance criteria

- [ ] `ImportExport_20_60.xls` obtained from kros.sk/66711
- [ ] One month observed being imported manually, recording which Omega evidence each document type goes into
- [ ] A mapping decided from each of `01`, `04`, `05`, `06` to a data type (`T00` / `T01` / `T08`)
- [ ] The mandatory column subset identified — only mandatory columns get filled
- [ ] A generated file imported successfully into a test Omega company before any UI work
- [ ] Confirmed whether payments (`T08`) need exporting separately from documents, or whether documents suffice
- [ ] PRD open question 1 updated and this issue unblocked or closed as unnecessary

## Blocked by

- 15 — ISDOC export with gate and batches
- PRD open question 1 — awaiting Filip's decision on the Omega import channel
