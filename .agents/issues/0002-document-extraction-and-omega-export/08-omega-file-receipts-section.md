# 08 — The Omega file: receipts

Type: AFK
Status: ready-for-agent
User stories: 35, 36, 40

## Parent

PRD 0002 — Document extraction and the Omega export (`.agents/prds/0002-document-extraction-and-omega-export.md`)

## What to build

The file's third section, `R00 T00`, for receipts — the documents `T01` cannot carry, because
Fakturácia has no cash documents (ADR 0019).

End to end: every confirmed receipt of the month goes into the `T00` section after the invoices, and
its supplier into `T04` — for eKasa receipts from the lookup's `organization`. **The section is
chosen by what the document is, not which folder it sits in**: an eKasa payload or a `docTypeHint`
of `receipt` goes to `T00`, an invoice goes to `T01` wherever it was filed. In `spring` May the Bolt
taxi invoice sits in `05 Bločky_firemná karta` and is booked as a received invoice; that is the case
to get right. She can override the section on any document.

`T00` requires an evidence code and a number series that exist in her Omega, plus a document type.
These come from settings with defaults taken from how she books today: `IDk` for receipts, `DF` for
received invoices. The cash-versus-card distinction does not exist in the app any more; she changes
the type in Omega where she needs to. The supplier's own number travels as the external number and
the KV DPH document number.

`T00` marks MD and DAL accounts mandatory. The writer leaves them **empty**, per ADR 0019: whether
Omega accepts that is one of the unknowns slice 15 settles, and nothing here chooses an account.
Foreign-currency receipts use Omega's foreign-currency types and carry currency and amount; the
app never writes an invented exchange rate.

## Acceptance criteria

- [ ] Confirmed receipts appear in a `T00` section after `T01`, with their suppliers in `T04`
- [ ] The section is chosen by document type: the Bolt taxi invoice in `05` lands in `T01`, an eKasa receipt in `T00`
- [ ] She can override the section per document, and the override persists and is logged
- [ ] Evidence code, number series and document type come from settings, defaulting to `IDk` and `DF`
- [ ] The supplier's number is written as the external number and the KV DPH document number
- [ ] MD and DAL are left empty and no other accounting field is written
- [ ] Foreign-currency receipts use the foreign-currency document types, keep currency and amount, and carry no invented rate
- [ ] eKasa suppliers are added to `T04` from the lookup's `organization`
- [ ] Integration test: a month with an eKasa receipt, a receipt-type extracted document and an invoice filed in `05` produces the three sections with each document in the right one

## Blocked by

- 07 — The Omega file: invoices and partners
- 01 — Text-layer eBločky read through the OPD lookup
