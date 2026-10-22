# 01 — Complete invoice parties from VAT IDs and company profiles

Type: AFK
Status: ready-for-agent
User stories: 1–11

## Parent

PRD 0003 — Invoice enrichment and document browser (`.agents/prds/0003-invoice-enrichment-and-document-browser.md`)

## What to build

Complete safe invoice-party identity data from information the system already trusts. For either
party, a valid Slovak IČ DPH with no DIČ supplies the DIČ by removing its `SK` prefix. The invoice
folder determines the expected client side: supplier for issued invoices and customer for received
invoices. When a company profile exists, fill that side's missing legal name, IČO, DIČ, and IČ DPH,
including when extraction omitted the client party entirely.

This enrichment must preserve every populated extracted or confirmed value during ordinary review.
If printed identity data conflicts with the profile, keep it and show the existing party warning
instead of silently changing it. Never copy profile identity onto the counterparty and do not add
party addresses. Carry the same effective party projection through the fields panel and Omega
export so the accountant reviews what will be exported.

Apply automatic enrichment only to results produced under the new extraction-pipeline contract.
Shipping this slice must not alter already completed stored documents; explicit re-extraction is how
the accountant opts an existing document into a fresh result.

## Acceptance criteria

- [ ] A missing DIČ is filled from `SK` plus exactly ten digits for either supplier or customer, and an existing DIČ is never overwritten.
- [ ] Invalid, malformed, Czech, and other non-Slovak IČ DPH values do not produce a DIČ.
- [ ] Issued invoices fill missing supplier identity from the company profile; received invoices fill missing customer identity.
- [ ] An entirely absent expected client party can be populated from the profile without changing the counterparty.
- [ ] Profile enrichment fills only legal name, IČO, DIČ, and IČ DPH; address remains outside document fields.
- [ ] Extracted and confirmed populated values take precedence during ordinary review.
- [ ] A conflict with the profile preserves the document value and visibly flags the party or role for review.
- [ ] The fields panel and Omega export consume the same enriched party values.
- [ ] Existing completed documents remain unchanged until explicitly re-extracted; newly produced pipeline results receive the enrichment.
- [ ] Table-driven unit tests cover both parties, both invoice directions, valid and invalid identifiers, absent/partial profiles, missing parties, conflicts, and manual precedence.
- [ ] An integration or UI test proves an enriched invoice displays and exports the completed client party without mutating an older completed document.

## Blocked by

None - can start immediately
