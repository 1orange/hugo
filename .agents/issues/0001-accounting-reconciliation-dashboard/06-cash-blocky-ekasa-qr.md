# 06 — Cash bločky as payments via eKasa QR

Type: AFK
User stories: 31, 32, 34

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The first payments in the system, produced without depending on any human artifact — which is why
this comes before the bank statement parser.

Per ADR 0002 a cash bloček from `04 Bločky_hotovosť` is a payment in its own right: money left the
till, and the document proving it arrived attached. It will never match a bank line, so it is not
something to pair — it flows to Omega on its own.

Per ADR 0008 the amount does not need reading. The eKasa QR code is specified by Finančná správa
and carries the figure authoritatively. Two documented payload variants must be handled:

- the 34-character unique receipt identifier (UID), and
- the composite form: OKP (44 chars) + register code (16–17) + timestamp as `YYMMDDHHMISS` +
  sequence number (1–6 chars) + total amount (1–12 chars).

`EkasaQr` is a pure module mapping a decoded payload string to receipt facts. `PdfAccess` gains
embedded-image extraction, and QR decoding runs through a WASM zxing binding — no native
dependency.

A receipt with no readable QR is flagged for manual entry and queued, never silently skipped.
There is no OCR fallback by design.

The month view gains a payments section listing cash payments with amount, timestamp and source
document.

## Acceptance criteria

- [ ] `EkasaQr` parses the UID variant and the composite variant
- [ ] Total amount and timestamp are extracted exactly, with no rounding or locale coercion
- [ ] Field-length boundaries at the edges of the specification are accepted
- [ ] A malformed payload is rejected with a reason, never coerced into a partial result
- [ ] QR codes are decoded from the embedded images of real eBloček PDFs in `04` and `05`
- [ ] A cash bloček becomes a `Payment` with `source = cash` referencing its source file
- [ ] A receipt with no readable QR appears in a manual-entry queue with an explanation
- [ ] Re-running discovery on the same receipt does not create a duplicate payment
- [ ] Cash payments appear in the month view with amount, timestamp and a link to the document
- [ ] Integration test: a fixture eBloček produces exactly one cash payment with the expected amount and timestamp

## Blocked by

- 03 — Drive sweep to company and month tree, read-only

## Notes

There is no public API for third-party eKasa lookup — verification exists only as the
`Over doklad` web app and the ePeňaženka mobile app. The QR is therefore the only authoritative
source available offline, and VAT breakdown and supplier must come from the receipt's own text
layer later. See PRD open question 6.
