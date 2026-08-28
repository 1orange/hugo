# 10 — Label invoices for the extraction benchmark

Type: HITL
Resolves: PRD open question 7

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Ground truth. Half an hour of labelling that both settles how extraction should be implemented and
becomes the permanent regression fixture — so it is not throwaway benchmark work.

Label a stratified subset of the **61 received invoices in the spring sample**. That is the right
corpus: 60 of those 61 carry a text layer, which is precisely why there is no OCR engine in this
design (ADR 0008). The 40 documents in `mix dokladov` are the **wrong** corpus for this — 27 of 40
are scans, which belong to the eKasa QR path and the manual path, not the invoice path.

Label the exact field set production will extract, no more: supplier name, IČO, IČ DPH, invoice
number, variabilný symbol, issue date, delivery date, tax base per VAT rate, VAT per rate, total,
currency.

Stratify so the hard cases are represented rather than averaged away: a plain Slovak supplier
invoice, a telecom invoice (`UPC_09643266_FA_*`), a foreign-currency one (`ChatGPT_faktura_*` in
CZK, `FlixBus_*` in CZK), an English-language US supplier (`Claude_Anthropic_faktura_*`), a
multi-rate invoice if one exists, a proforma (`Predfaktúra_*`, `*_proforma_faktura.pdf`) which must
be recognisable as excludable, and the single scan (`Potvrdenie_2026-06-16_221033.pdf`).

Labels are stored as fixtures in the repository. Because they contain real supplier data, decide
explicitly whether to redact counterparties or keep the fixture out of any public remote.

## Acceptance criteria

- [ ] At least 20 invoices labelled, stratified across the categories above
- [ ] Every label covers the full production field set
- [ ] Multi-rate invoices record base and VAT per rate separately, not just a total
- [ ] Foreign-currency invoices record the original currency, not a euro conversion
- [ ] At least one proforma included and marked as a document that must not be booked
- [ ] Labels stored as fixtures in a stable, machine-readable format
- [ ] A decision recorded on redaction versus keeping the fixture private
- [ ] PRD open question 7 updated

## Blocked by

None - can start immediately
