# 15 — ISDOC export with gate and batches

Type: AFK
User stories: 63, 64, 65, 66, 67, 68, 69

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Getting confirmed data into Omega without retyping it.

`IsdocExport` is a pure module mapping confirmed invoice fields to ISDOC XML. Omega imports ISDOC
natively into Došlá faktúra, Došlá preddavková faktúra and Došlý dobropis, validating IČO against
the company and filling partner, items and VAT itself — which is why it is the right target for
received invoices. It cannot carry issued invoices, cash bločky, card bločky or iné doklady; that
is slice 18 and remains open.

Per ADR 0010 **her tick is the gate**. Nothing exports unless she ticked it. That single flag does
three jobs: progress marker, export approval, and exclusion of non-accounting documents — a
proforma is simply never ticked, so it cannot double-book.

One export file per company, because Omega databases are per accounting entity. Export is a
once-a-month operation performed after the month's work is complete.

`exportedAt` and an export batch are recorded per payment. Because Omega import is a manual file
drop and Omega cannot be asked what it already holds, re-export protection lives entirely on our
side: a second export warns rather than silently duplicating entries in her books.

A preview shows what the export will contain before download, since an XML file is the least
reviewable artifact in the system.

## Acceptance criteria

- [ ] Output validates against the ISDOC schema
- [ ] A multi-rate invoice maps base and VAT per rate correctly
- [ ] A missing mandatory field fails the build rather than emitting invalid XML
- [ ] Only ticked payments are included
- [ ] An unticked proforma is absent from the export
- [ ] One file is produced per company
- [ ] `exportedAt` and a batch reference are recorded on every exported payment
- [ ] A second export of already-exported payments warns explicitly
- [ ] An explicit re-export-everything path exists and is not the default
- [ ] Export contents are previewable before download
- [ ] The export batch records what it contained, so an Omega/dashboard disagreement can be reconstructed
- [ ] A closed month can still be exported; an unclosed month is not blocked from exporting either
- [ ] `Exported` events are emitted
- [ ] E2E: export, then attempt a second export and observe the warning

## Blocked by

- 09 — Manual pairing, tick and what's-left
- 11 — Invoice text extraction and field confirmation
