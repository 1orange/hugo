# 06 — eKasa receipt extraction from the text layer

Type: AFK
User stories: 27, 28, 29 (the detection half; the empty-payload half is slice 22)

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The first extracted data in the system, produced without depending on any human artifact — which is
why this comes early.

`EkasaText` is a pure module mapping eBloček text-layer lines to receipt facts: the payable total
with its currency from the `NA ÚHRADU` line, a four-digit-year local timestamp resolved for
Europe/Bratislava, per-item name, VAT rate, quantity and unit price, the VAT recapitulation per
rate, and the UID and OKP. Text items are grouped into lines by y-coordinate; flattening
`getTextContent()` destroys the columns. Names are normalised to NFC at the extractor boundary.

Two arithmetic self-checks must both pass before the values are offered to her: the item line
totals sum to the payable total, and `SPOLU` base plus VAT equals it too. A receipt failing either
is shown with the discrepancy stated rather than accepted.

Anything in `04` or `05` that is not an eBloček — airline, train and bus tickets, ride-hailing
invoices, fuel receipts, phone photos — is detected and left with an empty payload, never
half-parsed.

> **Amended, 2026-08-28 (ADR 0008).** This slice was specified as *"Cash bločky as payments via
> eKasa QR"*, decoding the fiscal QR code for amount and timestamp. Measuring the real corpus
> overturned it: all six eBločeks carry the UID-only QR variant, which by specification holds
> neither, and the QR is drawn as vector paths so decoding it needs a full page render and a native
> canvas dependency. The text layer already contains everything, in a regular labelled structure.
> The file name still says `ekasa-qr`; the implementation does not, and neither does anything else.
>
> **Amended, 2026-08-30 (ADR 0013, ADR 0010).** Two further things this slice built are superseded.
> A cash bloček is no longer a `Payment` in its own right — it is a `Document`, like every other
> file in a processed folder, and whether it is cash or card is derived from the folder rather than
> stored. And the `receipt_manual_queue` table is retired: because she confirms every document
> regardless of which path produced its data, a receipt the parser could not read is simply a
> document with an empty payload, not a separate queue. Both are carried out in slice 22.

## Status

Done, against the text layer. All six eBločeks in the spring corpus parse with both arithmetic
checks passing, and the fourteen non-receipts in those folders are detected rather than
half-parsed. The rows it writes are `payments` and `receipt_manual_queue` rows; slice 22 reshapes
them into `documents`.

## Acceptance criteria

- [x] `EkasaText` parses the payable total, currency and timestamp from a real eBloček's text layer
- [x] Per-item name, rate, quantity, unit price and the VAT recapitulation are extracted
- [x] Item rows and recapitulation rows are distinguished by formatting, not by position
- [x] Amounts compare by value in minor units, so a dropped trailing zero does not fail a check
- [x] Timestamps resolve for Europe/Bratislava and are correct on both sides of the DST boundary
- [x] Both arithmetic checks pass on all six real receipts, and a tampered fixture fails
- [x] NFD-normalised PDF text still matches the Slovak labels
- [x] A non-eBloček in `04` or `05` is detected and not half-parsed
- [x] Re-running discovery on the same receipt does not duplicate its data
- [x] Extracted receipt data appears in the month view with amount, timestamp and a link to the document
- [x] Integration test: a fixture eBloček yields exactly the expected amount and timestamp
- [ ] A receipt the parser cannot read presents an empty, editable payload rather than a queue entry — slice 22

## Blocked by

- 03 — Drive sweep to company and month tree, read-only

## Notes

There is no public API for third-party eKasa lookup — verification exists only as the
`Over doklad` web app and the ePeňaženka mobile app — so a receipt's VAT breakdown and supplier
come from its own text layer. See PRD open question 6, resolved.

Multi-rate receipts remain unverified: Slovakia has 23%, 19% and 5% rates and the parser supports
multiple recapitulation rows, but every receipt in the sample is single-rate 23%.
