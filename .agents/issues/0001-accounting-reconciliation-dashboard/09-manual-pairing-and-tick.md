# 09 — Manual pairing, tick and what's-left

Type: AFK
User stories: 33, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The screen she lives in, and the point at which the app becomes useful even with no extraction and
no Omega integration. She can pair by hand and finally see what is left — which was the original
feature request, satisfied without any OCR existing.

One reconciliation route per company-month: payments down the left (bank lines and cash bločky),
unpaired proofs on the right, a preview pane, and a tick per payment. Folders are a filter, not
navigation. Historical months render the same component read-only.

Pairings are **many-to-many** per ADR 0002: one transfer settling three supplier invoices, and one
invoice settled by several installments, must both be expressible. The join carries how it was
created (`auto` | `manual`), a confidence and a reason.

Per ADR 0010 her tick is authoritative. Derived status is computed and shown as a quiet hint
alongside it, never overruling her. The remaining count reads off her ticks, because that is her
mental model of unfinished work. The tick is also the export gate, which slice 15 relies on.

Unpaired in either direction is a warning she resolves case by case. No reason codes — the app does
not encode Slovak tax rules.

The preview must handle the real corpus: PDFs, JPEG, and HEIC photos such as `IMG_3475.HEIC`, which
need `libheif` conversion (PRD open question 9 lands here).

Notes can be left on a payment or a proof.

## Status

Done, on cash payments. Route is `/companies/[companyId]/[monthKey]/reconcile`. Bank lines enrich
the same screen when slice 08 lands; `payments.blocek_file_id` is already nullable for them.

## Acceptance criteria

- [x] Reconciliation route shows payments, unpaired proofs and a preview pane for one company-month
- [x] A payment can be paired with several proofs
- [x] A proof can be paired with several payments
- [x] Unpairing is available and reversible without data loss
- [x] Cash bločky appear as payments needing no pairing, not as permanently unpaired warnings
- [x] Payments with no proof are listed as warnings
- [x] Proofs with no payment are listed as warnings
- [x] Ticking a payment increments completion and decrements the remaining count
- [x] Derived status is visible but never overrides or auto-sets her tick
- [x] The company list's remaining count reflects ticks, not derived status
- [x] PDF, JPEG and HEIC previews all render, HEIC via conversion — WASM `libheif`, server-side,
      checked against the real `IMG_3475.HEIC` (PRD open question 9)
- [x] Notes persist on payments and proofs
- [x] A closed month renders the same view read-only
- [x] `Paired`, `Unpaired` and `Confirmed` events are emitted
- [x] E2E: pair, tick, observe the remaining count fall, reload and see it persist

## Blocked by

- 06 — Cash bločky as payments via eKasa QR

## Notes

Demoable on cash payments alone, so this does not wait for slice 08. Bank payments enrich the same
screen when 08 lands.
