# 02 — Fill invoice VAT summary totals from rate rows

Type: AFK
Status: ready-for-agent
User stories: 12–15, 27–28

## Parent

PRD 0003 — Invoice enrichment and document browser (`.agents/prds/0003-invoice-enrichment-and-document-browser.md`)

## What to build

When a newly extracted invoice has valid rows under *DPH podľa sadzby* but an empty aggregate in
*Sumy*, calculate *Základ DPH (SPOLU)* as the signed sum of row bases and *DPH (SPOLU)* as the signed
sum of row VAT amounts. Include every valid rate, including 0%, and support multi-rate invoices and
negative credit-note rows. Derive each missing aggregate independently so an existing aggregate is
never replaced.

Introduce compatible persisted `derived` provenance for calculated accounting fields. It must
survive reload, be visible as *vypočítané*, and make the exact effective values available to Omega
export without duplicating arithmetic there. Values without derived metadata remain protected as
non-derived for backward compatibility. Gate automatic extraction enrichment to the new pipeline
contract so existing completed documents do not change merely because this slice is deployed.

## Acceptance criteria

- [ ] A missing aggregate VAT base is the signed sum of all valid VAT-row bases.
- [ ] A missing aggregate VAT amount is the signed sum of all valid VAT-row VAT amounts.
- [ ] Multi-rate, zero-rate, decimal, and negative credit-note rows are handled in integer minor units.
- [ ] Each aggregate is derived independently; an extracted or confirmed populated aggregate is preserved.
- [ ] Invalid or incomplete rows do not silently contribute zero and instead retain the existing warning/review behavior.
- [ ] Calculated aggregates persist with `derived` provenance and render with a compact *vypočítané* indicator after reload.
- [ ] Payloads written before this slice still parse, and values without derived metadata are treated as protected rather than recalculable.
- [ ] The Omega export consumes the same effective calculated aggregates shown in the fields panel.
- [ ] Existing completed documents are not newly enriched until an explicit fresh extraction; new pipeline results are enriched.
- [ ] Unit tests cover single/multiple/zero/negative rows, independent aggregate precedence, invalid rows, provenance compatibility, persistence, and export-facing values.
- [ ] A UI or integration test proves the Sumy section fills from VAT rows, labels the values, reloads them, and exports them.

## Blocked by

None - can start immediately
