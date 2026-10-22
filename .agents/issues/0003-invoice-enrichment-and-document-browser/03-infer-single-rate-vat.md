# 03 — Infer and recalculate single-rate invoice VAT

Type: AFK
Status: ready-for-agent
User stories: 16–28

## Parent

PRD 0003 — Invoice enrichment and document browser (`.agents/prds/0003-invoice-enrichment-and-document-browser.md`)

## What to build

Complete a single-rate invoice when it has no populated VAT recap but does have *Celkom* and
*Základ DPH (SPOLU)*. Calculate VAT as the signed difference and create one VAT row only when the
result matches one permitted issuer-country rate within one cent. Slovak rates are 23%, 19%, 5%,
and 0%; Czech rates are 21%, 12%, and 0%. On received invoices, prefer the supplier IČ DPH prefix
for issuer country. When that is unavailable, use company-profile country as a visibly flagged
fallback. Issued invoices use the client company country.

Use the shared VAT derivation in both newly produced extraction results and live field editing.
Calculated values carry dependency-aware derived provenance, recalculate when a dependency changes,
persist after reload, and feed export. A value or rate deliberately entered by the accountant is
never overwritten; inconsistent manual data produces a warning. Support signed credit notes and
abstain for ambiguous, unsupported, zero-base, or unsound arithmetic rather than inventing a rate.

## Acceptance criteria

- [ ] With no populated VAT recap, valid total and base produce VAT as `total − base` in integer minor units.
- [ ] A VAT row is created only when one permitted issuer-country rate matches within at most one cent.
- [ ] Slovak and Czech permitted-rate sets are enforced exactly as specified in PRD 0003.
- [ ] Received invoices use supplier IČ DPH country first; profile-country fallback is visibly flagged; issued invoices use client country.
- [ ] Negative credit-note amounts use the same signed arithmetic and valid rates.
- [ ] Unsupported countries, ambiguous matches, non-zero totals with zero base, malformed amounts, and unsound arithmetic leave the rate empty and show a warning.
- [ ] Editing total or base immediately updates only values carrying derived provenance.
- [ ] Manually or previously extracted populated VAT values and rates are never overwritten; a mismatch remains visible.
- [ ] Derived dependencies and values persist across reload and the Omega export receives the same effective row and aggregates.
- [ ] Automatic enrichment is gated to the new pipeline contract; an intentional dependency edit may derive values on the document being edited.
- [ ] Table-driven tests cover every accepted rate, country selection, one-cent boundaries, negative values, zero-base cases, ambiguity, manual protection, and recalculation.
- [ ] A UI/end-to-end test proves live calculation, the *vypočítané* state, safe recalculation, manual override protection, reload, and export-facing persistence.

## Blocked by

- 01 — Complete invoice parties from VAT IDs and company profiles (`01-complete-invoice-parties.md`)
- 02 — Fill invoice VAT summary totals from rate rows (`02-fill-invoice-vat-summary-totals.md`)
